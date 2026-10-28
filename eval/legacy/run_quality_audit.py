#!/usr/bin/env python3
"""
run_quality_audit.py — per-query quality assessment of pipeline audit output.

Reads all JSON artifacts from a pipeline audit run directory and flags issues
across five dimensions:
  A. Market data quality  (staleness, null fields per ticker)
  B. Ratios quality       (period_duration correctness per ratio family)
  C. Formatting           ([TABLE N] citation artifacts in analyst answer)
  D. Source coverage      (panel parity, structured pages, citation rate)
  E. Lane efficiency      (LLM call count, ticker coverage gaps)

Usage:
  python run_quality_audit.py [--run-dir PATH] [--output-dir PATH]

Defaults:
  --run-dir   most recent directory under colab/outputs/pipeline_audit/
  --output-dir  <run-dir>/quality_audit/
"""

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Ratio family definitions mirror engine_colab.ipynb §2.9 submit validation
# and §2.10a/§2.10b provenance helpers.
# ---------------------------------------------------------------------------
BS_RATIOS = frozenset({"current_ratio", "debt_to_equity", "quick_ratio", "cash_ratio"})
# P&L-only ratios: acceptable at any flow period (3M/6M/9M/12M/LTM)
PL_RATIOS = frozenset({
    "gross_margin", "net_margin", "operating_margin", "ebitda_margin",
    # banking P&L ratios
    "cost_to_income",
    # insurance P&L ratios
    "loss_ratio", "expense_ratio", "combined_ratio", "underwriting_margin", "investment_yield",
})
# BS-joined flow ratios: must be annualised (12M or LTM only)
FLOW_RATIOS = frozenset({
    "roe", "roa", "asset_turnover", "net_interest_margin",
    "roce", "roic", "dividend_payout_ratio",
    "revenue_growth", "pat_growth", "cfo_to_pat", "capex_to_revenue",
})
# Keep for backwards compat (was MARGIN_RATIOS in older code)
MARGIN_RATIOS = PL_RATIOS

_ALL_FLOW_PERIODS = {"3M", "6M", "9M", "12M", "LTM"}

def expected_duration(ratio_name: str) -> set[str]:
    """Return the set of acceptable period_duration values for a ratio."""
    if ratio_name in BS_RATIOS:
        return {"PIT"}
    if ratio_name in PL_RATIOS:
        return _ALL_FLOW_PERIODS  # P&L-only ratios can be at any sub-annual period
    if ratio_name in FLOW_RATIOS:
        return {"12M", "LTM"}  # BS-joined ratios must be annualised
    return {"12M", "LTM", "PIT", "3M", "6M", "9M"}  # unknown — don't flag

TODAY = date.today()
STALE_DAYS_THRESHOLD = 30   # market_data older than this is flagged
MAX_LLM_CALLS_PER_LANE = 3  # lanes with more calls than this are flagged
TABLE_CITATION_RE = re.compile(r'\[TABLE\s*\d+\]', re.IGNORECASE)

# ---------------------------------------------------------------------------
# Issue container
# ---------------------------------------------------------------------------
class Issues:
    def __init__(self):
        self._items: list[tuple[str, str, str]] = []  # (severity, dimension, message)

    def flag(self, severity: str, dimension: str, msg: str):
        self._items.append((severity, dimension, msg))

    def all(self):
        return self._items

    def count(self, severity=None):
        if severity:
            return sum(1 for s, _, _ in self._items if s == severity)
        return len(self._items)

# ---------------------------------------------------------------------------
# Per-query checks
# ---------------------------------------------------------------------------
def check_market_data(lane: dict, issues: Issues):
    rows = lane.get("attachment_rows", [])
    for row in rows:
        ticker = row.get("ticker", "?")
        raw_date = row.get("date")
        if raw_date:
            try:
                data_date = datetime.fromisoformat(raw_date).date()
                days_old = (TODAY - data_date).days
                if days_old > STALE_DAYS_THRESHOLD:
                    issues.flag("WARN", "market_data",
                                f"{ticker}: market_data is {days_old}d stale (last={raw_date})")
            except ValueError:
                pass
        null_fields = [f for f in ("pe_ratio", "dividend_yield", "market_cap")
                       if row.get(f) is None]
        if null_fields:
            issues.flag("WARN", "market_data",
                        f"{ticker}: null fields {null_fields}")


def check_ratios(lane: dict, issues: Issues):
    rows = lane.get("attachment_rows", [])
    for row in rows:
        ticker = row.get("ticker", "?")
        ratio_name = row.get("ratio_name", "")
        period_duration = row.get("period_duration", "")
        acceptable = expected_duration(ratio_name)
        if period_duration and period_duration not in acceptable:
            issues.flag("ERROR", "ratios",
                        f"{ticker} {ratio_name}: period_duration={period_duration!r}, "
                        f"expected one of {sorted(acceptable)}")
    # Check that SQL queries for flow/margin ratios include LTM as a fallback
    for sql in lane.get("finalQueries", []):
        flow_margin = FLOW_RATIOS | MARGIN_RATIOS
        mentions_ltm = "ltm" in sql.lower()
        mentions_12m = "12m" in sql.lower() or "12M" in sql
        # If the SQL targets flow/margin ratios but has no LTM option, flag it
        if not mentions_ltm and mentions_12m:
            ratio_matches = [r for r in flow_margin if r in sql.lower()]
            if ratio_matches:
                issues.flag("WARN", "ratios",
                            f"SQL for {ratio_matches} constrains period_duration to 12M only "
                            f"(no LTM fallback — tickers without 12M data will be absent)")
                break  # one flag per lane is enough


def check_formatting(query_data: dict, issues: Issues):
    answer = (query_data.get("analyst") or {}).get("answer", "")
    matches = TABLE_CITATION_RE.findall(answer)
    if matches:
        issues.flag("WARN", "formatting",
                    f"[TABLE N] citation artifacts in analyst answer: "
                    f"{sorted(set(matches))} ({len(matches)} occurrences)")


def check_source_coverage(query_data: dict, issues: Issues):
    panel = query_data.get("panel", [])
    source_audit = query_data.get("source_audit", {})
    router_plan = query_data.get("router", {}).get("plan", [])

    # Collect all tickers from router plan
    all_tickers = set()
    for step in router_plan:
        all_tickers.update(step.get("tickers", []))

    # Panel pages per ticker
    pages_per_ticker: Counter = Counter(p.get("ticker") for p in panel)
    structured_per_ticker: Counter = Counter(
        p.get("ticker") for p in panel if p.get("kind") == "structured"
    )

    # Parity: flag if one ticker has 2x+ more pages than another in multi-ticker asks
    if len(all_tickers) >= 2 and pages_per_ticker:
        counts = [pages_per_ticker.get(t, 0) for t in all_tickers]
        if max(counts) > 0 and min(counts) == 0:
            missing = [t for t in all_tickers if pages_per_ticker.get(t, 0) == 0]
            issues.flag("ERROR", "coverage",
                        f"Panel has zero pages for tickers: {missing}")
        elif max(counts) >= 2 * max(min(counts), 1) + 1 and min(counts) < 2:
            issues.flag("WARN", "coverage",
                        f"Panel imbalance: pages per ticker = "
                        f"{dict(pages_per_ticker)} (requested tickers: {sorted(all_tickers)})")

    # Structured coverage: broad/deep asks should have balance-sheet pages
    has_structured_ask = any(
        step.get("table") == "financial_statements" for step in router_plan
    )
    if has_structured_ask and len(panel) > 0 and not structured_per_ticker:
        issues.flag("WARN", "coverage",
                    "Financial statements ask present but no structured pages in panel")

    # Narrative pages per ticker (for document lanes)
    narrative_lanes = [la for la in query_data.get("lane_audits", [])
                       if la.get("table") == "financial_documents_new"]
    if narrative_lanes:
        narrative_per_ticker: Counter = Counter(
            p.get("ticker") for p in panel if p.get("kind") == "narrative"
        )
        for ticker in all_tickers:
            count = narrative_per_ticker.get(ticker, 0)
            if count == 0:
                issues.flag("WARN", "coverage",
                            f"Narrative lane present but {ticker} has 0 narrative pages in panel")
            elif count < 3:
                issues.flag("INFO", "coverage",
                            f"{ticker}: only {count} narrative page(s) in panel (may be thin)")

    # Citation rate
    analyst_fed = source_audit.get("analyst_fed", 0)
    not_cited = source_audit.get("fed_not_cited", [])
    if analyst_fed > 0:
        drop_rate = len(not_cited) / analyst_fed
        if drop_rate > 0.4:
            issues.flag("WARN", "coverage",
                        f"Low citation rate: {len(not_cited)}/{analyst_fed} fed pages not cited "
                        f"({drop_rate:.0%} unused)")


NARRATIVE_TABLES = {"financial_documents_new"}

def check_lane_efficiency(query_data: dict, issues: Issues):
    for lane in query_data.get("lane_audits", []):
        var = lane.get("variable", "?")
        table = lane.get("table", "?")
        call_count = len(lane.get("llm_calls", []))
        if call_count > MAX_LLM_CALLS_PER_LANE:
            issues.flag("WARN", "efficiency",
                        f"Lane {var} ({table}): {call_count} LLM calls (threshold={MAX_LLM_CALLS_PER_LANE})")

    # Ticker coverage gap: router tickers vs result tickers
    # Narrative lanes don't populate attachment_rows — use panel pages as proxy instead.
    router_plan = query_data.get("router", {}).get("plan", [])
    panel = query_data.get("panel", [])
    panel_tickers = {p.get("ticker") for p in panel}

    for lane_def in router_plan:
        expected_tickers = set(lane_def.get("tickers", []))
        if not expected_tickers:
            continue
        table = lane_def.get("table", "")

        if table in NARRATIVE_TABLES:
            # Narrative lanes: check panel has pages for expected tickers
            missing = expected_tickers - panel_tickers
            if missing:
                issues.flag("WARN", "coverage",
                            f"Narrative lane ({table}): no panel pages for tickers: {sorted(missing)}")
        else:
            # Structured lanes: check attachment_rows
            for la in query_data.get("lane_audits", []):
                if la.get("table") == table:
                    rows = la.get("attachment_rows", [])
                    got_tickers = {r.get("ticker") for r in rows if r.get("ticker")}
                    missing = expected_tickers - got_tickers
                    if missing:
                        issues.flag("ERROR", "coverage",
                                    f"Structured lane ({table}): missing tickers in result: {sorted(missing)}")
                    break


# ---------------------------------------------------------------------------
# Main audit loop
# ---------------------------------------------------------------------------
def audit_file(json_path: Path) -> tuple[str, str, Issues]:
    with open(json_path) as f:
        data = json.load(f)

    query = data.get("query", json_path.stem)
    issues = Issues()

    for lane in data.get("lane_audits", []):
        table = lane.get("table", "")
        if table == "market_data":
            check_market_data(lane, issues)
        elif table == "ratios":
            check_ratios(lane, issues)

    check_formatting(data, issues)
    check_source_coverage(data, issues)
    check_lane_efficiency(data, issues)

    return json_path.stem, query, issues


def find_latest_run_dir() -> Path:
    base = Path(__file__).parent / "outputs" / "pipeline_audit"
    candidates = sorted(
        [d for d in base.iterdir() if d.is_dir()],
        key=lambda d: d.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        sys.exit("No pipeline audit run directories found.")
    return candidates[0]


# ---------------------------------------------------------------------------
# Report rendering
# ---------------------------------------------------------------------------
SEV_ORDER = {"ERROR": 0, "WARN": 1, "INFO": 2}
SEV_EMOJI = {"ERROR": "❌", "WARN": "⚠️", "INFO": "ℹ️"}

def render_console_summary(results: list[tuple[str, str, Issues]]):
    errors = sum(1 for _, _, iss in results if iss.count("ERROR") > 0)
    warns  = sum(1 for _, _, iss in results if iss.count("WARN") > 0)
    total  = len(results)

    print(f"\n{'='*72}")
    print(f"QUALITY AUDIT — {total} queries   {errors} with errors   {warns} with warnings")
    print(f"{'='*72}")

    # Dimension-level summary
    dim_counts: Counter = Counter()
    for _, _, iss in results:
        for sev, dim, _ in iss.all():
            dim_counts[(dim, sev)] += 1

    dims = sorted({dim for (dim, _) in dim_counts})
    if dims:
        print("\nIssue counts by dimension:")
        for dim in dims:
            e = dim_counts.get((dim, "ERROR"), 0)
            w = dim_counts.get((dim, "WARN"), 0)
            i = dim_counts.get((dim, "INFO"), 0)
            print(f"  {dim:<16}  errors={e}  warnings={w}  info={i}")

    print(f"\n{'─'*72}")
    for stem, query, iss in results:
        if iss.count() == 0:
            continue
        short_q = (query[:70] + "…") if len(query) > 70 else query
        print(f"\n[{stem}]  {short_q}")
        for sev, dim, msg in sorted(iss.all(), key=lambda x: (SEV_ORDER.get(x[0], 9), x[1])):
            print(f"  {SEV_EMOJI.get(sev, ' ')} [{dim}] {msg}")

    clean = [stem for stem, _, iss in results if iss.count() == 0]
    if clean:
        print(f"\n{'─'*72}")
        print(f"Clean queries ({len(clean)}): {', '.join(clean)}")
    print()


def render_markdown_report(results: list[tuple[str, str, Issues]], out_path: Path):
    lines = ["# Quality Audit Report\n",
             f"Generated: {datetime.now().isoformat(timespec='seconds')}\n",
             f"Queries audited: {len(results)}\n"]

    # Summary table
    lines.append("## Summary\n")
    lines.append("| Query | Errors | Warnings | Info |\n")
    lines.append("|-------|--------|----------|------|\n")
    for stem, query, iss in results:
        short = (query[:60] + "…") if len(query) > 60 else query
        lines.append(f"| {short} | {iss.count('ERROR')} | {iss.count('WARN')} | {iss.count('INFO')} |\n")

    lines.append("\n## Per-Query Issues\n")
    for stem, query, iss in results:
        if iss.count() == 0:
            continue
        lines.append(f"### {stem}\n")
        lines.append(f"**Ask:** {query}\n\n")
        for sev, dim, msg in sorted(iss.all(), key=lambda x: (SEV_ORDER.get(x[0], 9), x[1])):
            lines.append(f"- **{sev}** `[{dim}]` {msg}\n")
        lines.append("\n")

    out_path.write_text("".join(lines))
    print(f"Markdown report written to: {out_path}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Quality-audit pipeline audit JSON artifacts.")
    parser.add_argument("--run-dir", type=Path, default=None,
                        help="Path to a pipeline audit run directory (default: most recent)")
    parser.add_argument("--output-dir", type=Path, default=None,
                        help="Where to write the report (default: <run-dir>/quality_audit/)")
    args = parser.parse_args()

    run_dir: Path = args.run_dir or find_latest_run_dir()
    if not run_dir.exists():
        sys.exit(f"Run directory not found: {run_dir}")

    output_dir: Path = args.output_dir or (run_dir / "quality_audit")
    output_dir.mkdir(parents=True, exist_ok=True)

    json_files = sorted(run_dir.glob("*.json"))
    # Skip manifest.json
    json_files = [f for f in json_files if f.name != "manifest.json"]

    if not json_files:
        sys.exit(f"No query JSON files found in {run_dir}")

    print(f"Auditing {len(json_files)} queries from: {run_dir.name}")

    results = []
    for jf in json_files:
        stem, query, issues = audit_file(jf)
        results.append((stem, query, issues))
        status = f"  {issues.count('ERROR')}E {issues.count('WARN')}W {issues.count('INFO')}I"
        print(f"  {stem[:60]:<60} {status}")

    render_console_summary(results)
    report_path = output_dir / "quality_report.md"
    render_markdown_report(results, report_path)


if __name__ == "__main__":
    main()
