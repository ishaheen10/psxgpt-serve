#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import json
import os
import re
import traceback
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from contextlib import redirect_stderr, redirect_stdout
from datetime import UTC, datetime
from pathlib import Path


COLAB_ROOT = Path(__file__).resolve().parent
REPO_ROOT = COLAB_ROOT.parent
ENGINE_NOTEBOOK = COLAB_ROOT / "notebooks" / "engine_colab.ipynb"
LANE_GOLD_PATH = COLAB_ROOT / "gold" / "lane-gold.json"
OUTPUT_ROOT = COLAB_ROOT / "outputs" / "lane_gold_runs"
# Zero-based notebook indexes matching the current engine_colab.ipynb layout:
# §0 setup plus §2.1-§2.14 lane prompts, tools, validation, runners, and dispatcher.
ENGINE_CELL_IDS = [2, 3, 4, 5, 6, 7, 8, 12, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]

ENGINE = None


def load_engine_runtime(notebook_path: Path, cell_ids: list[int]) -> dict:
    nb = json.loads(notebook_path.read_text())
    ns = {"__name__": "__main__"}
    cwd_before = Path.cwd()
    try:
        os.chdir(notebook_path.parent)
        for idx in cell_ids:
            cell = nb["cells"][idx]
            if cell.get("cell_type") != "code":
                continue
            code = "".join(cell.get("source", []))
            code = code.replace(
                'REPO_ROOT = find_colab_root(Path.cwd().resolve())\nCONTEXT_ROOT = REPO_ROOT / "context"\nDATA_ROOT = REPO_ROOT / "data"',
                f'REPO_ROOT = Path({str(REPO_ROOT)!r})\nCONTEXT_ROOT = REPO_ROOT / "apps" / "analysis" / "context"\nDATA_ROOT = REPO_ROOT / "apps" / "analysis" / "data"',
            )
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                exec(compile(code, f"{notebook_path.name}:cell_{idx}", "exec"), ns)
    finally:
        os.chdir(cwd_before)
    return ns


def init_worker() -> None:
    global ENGINE
    ENGINE = load_engine_runtime(ENGINE_NOTEBOOK, ENGINE_CELL_IDS)
    if os.getenv("OVERRIDE_BASE_URL") and os.getenv("OVERRIDE_API_KEY"):
        from openai import OpenAI
        ENGINE["client"] = OpenAI(
            api_key=os.environ["OVERRIDE_API_KEY"],
            base_url=os.environ["OVERRIDE_BASE_URL"],
        )
    if os.getenv("OVERRIDE_MODEL_ROUTER"):
        ENGINE["MODEL_ROUTER"] = os.environ["OVERRIDE_MODEL_ROUTER"]
    if os.getenv("OVERRIDE_MODEL_LANE"):
        ENGINE["MODEL_LANE"] = os.environ["OVERRIDE_MODEL_LANE"]
    # Inject thinking / reasoning_effort via extra_body when env vars are set.
    thinking_mode = os.getenv("OVERRIDE_THINKING")
    reasoning_effort = os.getenv("OVERRIDE_REASONING_EFFORT")
    if thinking_mode or reasoning_effort:
        original_create = ENGINE["client"].chat.completions.create
        def patched_create(*args, **kwargs):
            extra = dict(kwargs.get("extra_body") or {})
            if thinking_mode:
                extra["thinking"] = {"type": thinking_mode}
            if reasoning_effort:
                extra["reasoning_effort"] = reasoning_effort
            kwargs["extra_body"] = extra
            return original_create(*args, **kwargs)
        ENGINE["client"].chat.completions.create = patched_create

    # Preserve reasoning_content for thinking-mode models (e.g. deepseek-v4-*).
    def patched_append_tool_call(messages: list, msg) -> None:
        entry = {
            "role": "assistant",
            "content": msg.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in msg.tool_calls
            ],
        }
        rc = getattr(msg, "reasoning_content", None)
        if rc:
            entry["reasoning_content"] = rc
        messages.append(entry)
    ENGINE["append_tool_call"] = patched_append_tool_call


def load_lane_gold(path: Path) -> list[dict]:
    payload = json.loads(path.read_text())
    if isinstance(payload, dict) and "cases" in payload:
        return payload["cases"]
    if isinstance(payload, list):
        return payload
    raise ValueError(f"Unsupported lane gold shape in {path}")


def normalize_benchmark_type(value: str) -> str:
    return str(value or "").strip().lower().replace("-", "_")


def classify_lane_failure(artifact: dict) -> str | None:
    if not artifact.get("resultSummary", "").startswith("lane_failed"):
        return None
    history = artifact.get("_debug", {}).get("message_history", [])
    joined = "\n".join(str(m.get("content", "")) for m in history if m.get("role") == "tool")
    sqls = artifact.get("_debug", {}).get("sql_queries", [])
    if "no such column: score" in joined:
        return "invalid_sql_score_column"
    if artifact["table"] == "ratios" and any("SELECT DISTINCT" in sql.upper() for sql in sqls):
        return "ignored_ratio_shortcuts_or_overprobed"
    if artifact["table"] == "financial_documents_new" and history and len(history) >= 2 and history[-2].get("role") == "assistant":
        tool_calls = history[-2].get("tool_calls") or []
        names = [tc["function"]["name"] for tc in tool_calls]
        if "submit" not in names:
            return "final_turn_no_submit"
    if artifact["table"] == "financial_statements":
        return "structured_overprobing_or_no_submit"
    return "unknown_lane_failure"


def parse_attachment_rows(artifact: dict) -> list[dict]:
    attachment = artifact.get("analysisAttachment")
    if not attachment:
        return []
    headers = attachment.get("headers", [])
    return [dict(zip(headers, row)) for row in attachment.get("rows", [])]


def _parse_source_pages_value(value: object) -> list[int]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            value = [int(p.strip()) for p in value.replace("[", "").replace("]", "").split(",") if p.strip().isdigit()]
    if not isinstance(value, list):
        return []
    return [int(x) for x in value if isinstance(x, (int, float)) and int(x) > 0]


def _add_lookup_pages(page_map: dict[tuple[str, str], set[int]], ticker: str, filing_key: str, pages: list[int]) -> None:
    clean_ticker = str(ticker or "").strip().upper()
    clean_key = str(filing_key or "").strip()
    if not clean_ticker or not clean_key or not pages:
        return
    bucket = page_map.setdefault((clean_ticker, clean_key), set())
    for page in pages:
        if isinstance(page, int) and page > 0:
            bucket.add(page)


def _parse_filing_year_from_source_url(source_url: object) -> str | None:
    text = str(source_url or "").strip()
    match = re.search(r"/(\d{4})/[^/]*$", text)
    return match.group(1) if match else None


def _parse_ticker_from_source_url(source_url: object) -> str | None:
    text = str(source_url or "").strip()
    match = re.search(r"/PDF_PAGES/([^/]+)/", text, re.I)
    return match.group(1).upper() if match else None


def _parse_management_source_pdf(source_pdf: object) -> tuple[str, str, int] | None:
    text = str(source_pdf or "").strip()
    match = re.search(r"^([^/]+)/(\d{4})/.*/page_(\d+)\.pdf$", text, re.I)
    if not match:
        return None
    return match.group(1).upper(), match.group(2), int(match.group(3))


def _resolve_page_map_to_doc_ids(page_map: dict[tuple[str, str], set[int]]) -> list[int]:
    out: list[int] = []
    for (ticker, filing_key), pages in page_map.items():
        unique_pages = sorted(pages)
        if not unique_pages:
            continue
        ph = ",".join(["?"] * len(unique_pages))
        if str(filing_key).startswith("YEAR:"):
            sql = f"SELECT id FROM financial_documents_new WHERE ticker = ? AND filing_year = ? AND pg IN ({ph})"
            binds: list[object] = [ticker, filing_key.replace("YEAR:", ""), *unique_pages]
        else:
            sql = f"SELECT id FROM financial_documents_new WHERE ticker = ? AND filing_period = ? AND pg IN ({ph})"
            binds = [ticker, filing_key, *unique_pages]
        res = ENGINE["run_sql"](sql, binds)
        for row in res.get("rows", []):
            pid = row.get("id")
            if isinstance(pid, int):
                out.append(pid)
    return list(dict.fromkeys(out))


RATIO_PROVENANCE_MAP: dict[str, list[tuple[str, list[str], str]]] = {
    "roe": [("profit_loss", ["net_profit"], "same"), ("balance_sheet", ["total_equity", "equity"], "pit")],
    "roa": [("profit_loss", ["net_profit"], "same"), ("balance_sheet", ["total_assets"], "pit")],
    "net_margin": [("profit_loss", ["net_profit"], "same"), ("profit_loss", ["revenue_net", "total_income"], "same")],
    "gross_margin": [("profit_loss", ["gross_profit"], "same"), ("profit_loss", ["revenue_net"], "same")],
    "current_ratio": [
        ("balance_sheet", ["total_current_assets", "current_assets"], "pit"),
        ("balance_sheet", ["total_current_liabilities", "current_liabilities"], "pit"),
    ],
    "debt_to_equity": [
        ("balance_sheet", ["total_liabilities"], "pit"),
        ("balance_sheet", ["total_equity", "equity"], "pit"),
    ],
    "asset_turnover": [("profit_loss", ["revenue_net"], "same"), ("balance_sheet", ["total_assets"], "pit")],
}


def _recover_financial_statements_provenance(rows: list[dict]) -> list[int]:
    page_map: dict[tuple[str, str], set[int]] = {}
    lookup_keys: dict[tuple[str, str, str, str, str, str], dict[str, str]] = {}
    for row in rows:
        ticker = str(row.get("ticker") or _parse_ticker_from_source_url(row.get("source_url")) or "").strip().upper()
        period_end = str(row.get("period_end") or row.get("filing_period") or "").strip()
        pages = _parse_source_pages_value(row.get("source_pages"))
        _add_lookup_pages(page_map, ticker, period_end, pages)
        filing_year = row.get("filing_year") or _parse_filing_year_from_source_url(row.get("source_url"))
        if filing_year:
            _add_lookup_pages(page_map, ticker, f"YEAR:{filing_year}", pages)
        if not ticker or not period_end:
            continue
        canonical_name = str(row.get("canonical_name") or "").strip()
        statement_type = str(row.get("statement_type") or "").strip()
        section = str(row.get("section") or "").strip()
        original_name = str(row.get("original_name") or "").strip()
        lookup_keys[(ticker, period_end, canonical_name, statement_type, section, original_name)] = {
            "ticker": ticker,
            "period_end": period_end,
            "canonical_name": canonical_name,
            "statement_type": statement_type,
            "section": section,
            "original_name": original_name,
        }

    for key in lookup_keys.values():
        conditions = ["ticker = ?", "period_end = ?", "source_pages IS NOT NULL"]
        binds: list[object] = [key["ticker"], key["period_end"]]
        if key["canonical_name"]:
            conditions.append("canonical_name = ?")
            binds.append(key["canonical_name"])
        if key["statement_type"]:
            conditions.append("statement_type = ?")
            binds.append(key["statement_type"])
        if key["section"]:
            conditions.append("section = ?")
            binds.append(key["section"])
        if key["original_name"]:
            conditions.append("original_name = ?")
            binds.append(key["original_name"])
        sql = f"SELECT ticker, period_end, source_pages, source_url FROM financial_statements WHERE {' AND '.join(conditions)}"
        res = ENGINE["run_sql"](sql, binds)
        for row in res.get("rows", []):
            ticker = str(row.get("ticker") or "").strip().upper()
            period_end = str(row.get("period_end") or "").strip()
            pages = _parse_source_pages_value(row.get("source_pages"))
            _add_lookup_pages(page_map, ticker, period_end, pages)
            filing_year = _parse_filing_year_from_source_url(row.get("source_url"))
            if filing_year:
                _add_lookup_pages(page_map, ticker, f"YEAR:{filing_year}", pages)

    return _resolve_page_map_to_doc_ids(page_map)


def _recover_ratios_provenance(rows: list[dict]) -> list[int]:
    page_map: dict[tuple[str, str], set[int]] = {}
    for row in rows:
        ticker = str(row.get("ticker") or "").strip().upper()
        period_end = str(row.get("period_end") or "").strip()
        ratio_name = str(row.get("ratio_name") or "").strip().lower()
        section = str(row.get("section") or "").strip()
        period_duration = str(row.get("period_duration") or "").strip().upper()
        if not ticker or not period_end or not ratio_name:
            continue
        for statement_type, canonical_names, duration_mode in RATIO_PROVENANCE_MAP.get(ratio_name, []):
            preferred_duration = None
            if duration_mode == "same" and period_duration:
                preferred_duration = "12M" if period_duration == "LTM" else period_duration
            elif duration_mode == "pit":
                preferred_duration = "PIT"
            attempts: list[str | None] = [preferred_duration] if preferred_duration else []
            attempts.append(None)
            for duration in attempts:
                placeholders = ",".join(["?"] * len(canonical_names))
                conditions = ["ticker = ?", "period_end = ?", f"canonical_name IN ({placeholders})", "statement_type = ?", "source_pages IS NOT NULL"]
                binds: list[object] = [ticker, period_end, *canonical_names, statement_type]
                if section:
                    conditions.append("section = ?")
                    binds.append(section)
                if duration:
                    conditions.append("period_duration = ?")
                    binds.append(duration)
                sql = f"SELECT ticker, period_end, source_pages, source_url FROM financial_statements WHERE {' AND '.join(conditions)}"
                res = ENGINE["run_sql"](sql, binds)
                if not res.get("rows"):
                    continue
                for match in res.get("rows", []):
                    pages = _parse_source_pages_value(match.get("source_pages"))
                    _add_lookup_pages(page_map, match.get("ticker"), match.get("period_end"), pages)
                    filing_year = _parse_filing_year_from_source_url(match.get("source_url"))
                    if filing_year:
                        _add_lookup_pages(page_map, match.get("ticker"), f"YEAR:{filing_year}", pages)
                break
    return _resolve_page_map_to_doc_ids(page_map)


def _recover_management_comp_provenance(rows: list[dict]) -> list[int]:
    page_map: dict[tuple[str, str], set[int]] = {}
    for row in rows:
        direct = _parse_management_source_pdf(row.get("source_pdf") or row.get("source_url"))
        if direct:
            ticker, year, page = direct
            _add_lookup_pages(page_map, ticker, f"YEAR:{year}", [page])
            continue
        ticker = str(row.get("ticker") or "").strip().upper()
        year = str(row.get("year") or row.get("filing_year") or "").strip()
        section = str(row.get("section") or row.get("reporting_scope") or "").strip()
        role = str(row.get("role") or "").strip()
        if not ticker or not year:
            continue
        conditions = ["ticker = ?", "year = ?", "source_pdf IS NOT NULL"]
        binds: list[object] = [ticker, year]
        if section:
            conditions.append("section = ?")
            binds.append(section)
        if role:
            conditions.append("role = ?")
            binds.append(role)
        sql = f"SELECT source_pdf FROM management_comp WHERE {' AND '.join(conditions)}"
        res = ENGINE["run_sql"](sql, binds)
        for match in res.get("rows", []):
            parsed = _parse_management_source_pdf(match.get("source_pdf"))
            if parsed:
                pticker, pyear, page = parsed
                _add_lookup_pages(page_map, pticker, f"YEAR:{pyear}", [page])
    return _resolve_page_map_to_doc_ids(page_map)


def recover_structured_provenance(table: str, rows: list[dict]) -> list[int]:
    if not rows:
        return []
    if table == "financial_statements":
        return _recover_financial_statements_provenance(rows)
    if table == "ratios":
        return _recover_ratios_provenance(rows)
    if table == "management_comp":
        return _recover_management_comp_provenance(rows)
    return []


def apply_stage3_postprocessing(artifact: dict) -> dict:
    if not artifact:
        return artifact
    if artifact.get("table") in {"financial_statements", "ratios", "management_comp"} and not artifact.get("provenanceIds"):
        rows = parse_attachment_rows(artifact)
        if rows:
            artifact["provenanceIds"] = recover_structured_provenance(artifact["table"], rows)
    return artifact


def fetch_narrative_rows(source_ids: list[int]) -> list[dict]:
    if not source_ids:
        return []
    ph = ",".join(["?"] * len(source_ids))
    sql = (
        "SELECT id, ticker, filing_type, filing_period, filing_year, pg, search_text, text "
        f"FROM financial_documents_new WHERE id IN ({ph})"
    )
    res = ENGINE["run_sql"](sql, source_ids)
    return res.get("rows", []) if res.get("success") else []


def count_ticker_coverage(rows: list[dict], header_rows: list[dict]) -> set[str]:
    out = set()
    for row in rows + header_rows:
        ticker = str(row.get("ticker", "")).strip().upper()
        if ticker:
            out.add(ticker)
    return out


def detect_sql_complexity(sql: str) -> dict:
    lower = sql.lower()
    return {
        "has_cte": bool(re.search(r"(^|\s)with\s", lower)),
        "has_window": "row_number(" in lower or " over (" in lower or "rank(" in lower or "dense_rank(" in lower,
        "join_count": len(re.findall(r"\bjoin\b", lower)),
        "nested_select_count": max(0, len(re.findall(r"\(\s*select\b", lower)) - 1),
        "distinct_count": len(re.findall(r"\bselect\s+distinct\b", lower)),
    }


def analyze_trace_sql(sql_queries: list[str]) -> dict:
    complexity = Counter()
    discovery_count = 0
    for sql in sql_queries:
        flags = detect_sql_complexity(sql)
        if flags["has_cte"]:
            complexity["has_cte"] += 1
        if flags["has_window"]:
            complexity["has_window"] += 1
        if flags["join_count"]:
            complexity["has_join"] += 1
        if flags["distinct_count"]:
            complexity["has_distinct"] += 1
        if ENGINE["is_discovery_sql"](sql):
            discovery_count += 1
    return {
        "query_count": len(sql_queries),
        "discovery_query_count": discovery_count,
        "complexity_counts": dict(complexity),
    }


def evaluate_structured(case: dict, artifact: dict, rows: list[dict]) -> tuple[float, dict]:
    expect = case["expect"]
    ideal = expect["ideal_output"]
    final_sql = (artifact.get("finalQueries") or [""])[0]
    headers = list(rows[0].keys()) if rows else (artifact.get("analysisAttachment", {}) or {}).get("headers", [])
    coverage = count_ticker_coverage(rows, [])
    complexity = detect_sql_complexity(final_sql)
    trace_sql = analyze_trace_sql(artifact.get("_debug", {}).get("sql_queries", []))
    semantic_blob = json.dumps(rows[:5], ensure_ascii=True).lower() + "\n" + final_sql.lower()
    semantic_hits = [target for target in ideal.get("semantic_targets", []) if str(target).lower() in semantic_blob]

    score = 0.0
    if not artifact.get("resultSummary", "").startswith("lane_failed"):
        score += 4.0
    if artifact.get("analysisAttachment"):
        score += 2.0
    if rows:
        score += 1.0
    if all(header in headers for header in ideal.get("must_include_headers", [])):
        score += 1.0
    required_tickers = set(t.upper() for t in expect.get("must_cover_tickers", []))
    if required_tickers and required_tickers.issubset(coverage):
        score += 1.0
    if semantic_hits:
        score += 1.0
    if expect["sql_preferences"].get("avoid_unnecessary_cte") and complexity["has_cte"]:
        score -= 0.5
    if expect["sql_preferences"].get("avoid_unnecessary_windows") and complexity["has_window"]:
        score -= 0.5
    if trace_sql["query_count"] > 1:
        score -= min(1.0, 0.25 * (trace_sql["query_count"] - 1))
    if trace_sql["discovery_query_count"] > 0:
        score -= min(1.0, 0.25 * trace_sql["discovery_query_count"])

    return score, {
        "headers": headers,
        "row_count": len(rows),
        "required_tickers": sorted(required_tickers),
        "covered_tickers": sorted(coverage),
        "semantic_hits": semantic_hits,
        "complexity": complexity,
        "trace_sql": trace_sql,
        "final_sql": final_sql,
    }


def evaluate_narrative(case: dict, artifact: dict, rows: list[dict]) -> tuple[float, dict]:
    expect = case["expect"]
    ideal = expect["ideal_output"]
    ids = artifact.get("narrativeIds", [])
    coverage = {str(row.get("ticker", "")).upper() for row in rows if str(row.get("ticker", "")).strip()}
    content_blob = "\n".join(
        [
            str(row.get("search_text", "")) + "\n" + str(row.get("text", ""))[:400]
            for row in rows[:8]
        ]
    ).lower()
    semantic_hits = [target for target in ideal.get("semantic_targets", []) if str(target).lower() in content_blob]
    preferred_type = ideal.get("preferred_filing_type")
    filing_types = Counter(str(row.get("filing_type", "")).strip().lower() for row in rows if row.get("filing_type"))
    extractions = artifact.get("narrativeExtractions", [])
    final_sql = (artifact.get("finalQueries") or [""])[0]
    complexity = detect_sql_complexity(final_sql)
    trace_sql = analyze_trace_sql(artifact.get("_debug", {}).get("sql_queries", []))

    score = 0.0
    if not artifact.get("resultSummary", "").startswith("lane_failed"):
        score += 4.0
    if len(ids) >= ideal.get("min_source_ids", 1):
        score += 2.0
    required_tickers = set(t.upper() for t in expect.get("must_cover_tickers", []))
    if required_tickers and required_tickers.issubset(coverage):
        score += 1.5
    if expect["context_contract"].get("prefer_extractions") and extractions:
        score += 0.5
    if semantic_hits:
        score += 1.0
    if preferred_type and filing_types.get(preferred_type, 0) > 0:
        score += 0.5
    if expect["sql_preferences"].get("avoid_redundant_discovery") and trace_sql["discovery_query_count"] > 0:
        score -= min(1.0, 0.5 * trace_sql["discovery_query_count"])

    return score, {
        "source_count": len(ids),
        "required_tickers": sorted(required_tickers),
        "covered_tickers": sorted(coverage),
        "semantic_hits": semantic_hits,
        "filing_types": dict(filing_types),
        "extraction_count": len(extractions),
        "complexity": complexity,
        "trace_sql": trace_sql,
        "final_sql": final_sql,
        "source_preview": [
            {
                "id": row.get("id"),
                "ticker": row.get("ticker"),
                "filing_type": row.get("filing_type"),
                "filing_period": row.get("filing_period"),
                "pg": row.get("pg"),
                "search_text": str(row.get("search_text", ""))[:220],
            }
            for row in rows[:6]
        ],
    }


def run_case(case: dict) -> dict:
    start = datetime.now(UTC)
    artifact = None
    try:
        artifact = ENGINE["run_lane"](case["ask_object"], variable=case["id"])
        artifact = apply_stage3_postprocessing(artifact)
        if case["expect"]["artifact_kind"] == "structured":
            rows = parse_attachment_rows(artifact)
            score, review = evaluate_structured(case, artifact, rows)
        else:
            rows = fetch_narrative_rows(artifact.get("narrativeIds", []))
            score, review = evaluate_narrative(case, artifact, rows)

        if artifact.get("table") == "financial_statements":
            review["provenance_count"] = len(artifact.get("provenanceIds", []))

        failure_class = classify_lane_failure(artifact)
        return {
            "id": case["id"],
            "qid": case["qid"],
            "query": case["query"],
            "ask_index": case["ask_index"],
            "benchmark_type": case.get("benchmark_type"),
            "ask_object": case["ask_object"],
            "expect": case["expect"],
            "artifact": artifact,
            "score": score,
            "failure_class": failure_class,
            "review": review,
            "status": "ok",
            "started_at": start.isoformat(),
            "finished_at": datetime.now(UTC).isoformat(),
        }
    except Exception as exc:
        return {
            "id": case["id"],
            "qid": case["qid"],
            "query": case["query"],
            "ask_index": case["ask_index"],
            "benchmark_type": case.get("benchmark_type"),
            "ask_object": case["ask_object"],
            "expect": case["expect"],
            "artifact": artifact,
            "score": 0.0,
            "failure_class": "runner_exception",
            "review": {"error": str(exc)},
            "status": "error",
            "started_at": start.isoformat(),
            "finished_at": datetime.now(UTC).isoformat(),
            "traceback": traceback.format_exc(),
        }


def select_cases(cases: list[dict], ids: set[str], limit: int, benchmark_type: str) -> list[dict]:
    wanted_benchmark = normalize_benchmark_type(benchmark_type)
    selected = []
    for case in cases:
        if ids and case["id"] not in ids and case["qid"] not in ids:
            continue
        if wanted_benchmark and normalize_benchmark_type(case.get("benchmark_type")) != wanted_benchmark:
            continue
        selected.append(case)
    if limit > 0:
        selected = selected[:limit]
    return selected


def timestamp_dir() -> Path:
    return OUTPUT_ROOT / datetime.now().strftime("%Y-%m-%dT%H-%M-%S")


def write_json(path: Path, payload: dict | list) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n")


def aggregate_results(results: list[dict]) -> dict:
    by_table = Counter()
    by_benchmark = Counter()
    by_status = Counter()
    failures = Counter()
    complexity = Counter()
    scores = []
    examples = defaultdict(list)

    for result in results:
        table = result["ask_object"]["table"]
        by_table[table] += 1
        by_benchmark[result.get("benchmark_type", "unknown")] += 1
        by_status[result["status"]] += 1
        if result.get("failure_class"):
            failures[result["failure_class"]] += 1
            examples[result["failure_class"]].append(result["id"])
        review = result.get("review", {})
        comp = review.get("complexity", {})
        trace_sql = review.get("trace_sql", {})
        if comp.get("has_cte"):
            complexity["has_cte"] += 1
        if comp.get("has_window"):
            complexity["has_window"] += 1
        if comp.get("join_count", 0):
            complexity["has_join"] += 1
        if trace_sql.get("discovery_query_count", 0):
            complexity["has_discovery_queries"] += 1
        if trace_sql.get("query_count", 0) > 1:
            complexity["multi_query_lanes"] += 1
        scores.append(float(result.get("score", 0.0)))

    return {
        "total_cases": len(results),
        "avg_score": (sum(scores) / len(scores)) if scores else 0.0,
        "by_table": dict(by_table),
        "by_benchmark_type": dict(by_benchmark),
        "by_status": dict(by_status),
        "failure_classes": dict(failures),
        "complexity_flags": dict(complexity),
        "failure_examples": {k: v[:10] for k, v in examples.items()},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run lane gold evaluation against engine_colab runtime.")
    parser.add_argument("--gold", default=str(LANE_GOLD_PATH), help="Path to lane gold JSON")
    parser.add_argument("--out-dir", default="", help="Optional output directory")
    parser.add_argument("--max-workers", type=int, default=12, help="Process concurrency; use 0 for full parallelism")
    parser.add_argument("--limit", type=int, default=0, help="Optional case limit")
    parser.add_argument("--ids", default="", help="Comma-separated case ids or qids to run")
    parser.add_argument("--benchmark-type", default="", help="Optional benchmark type filter: retrieval_clear, retrieval_composed, exploratory")
    args = parser.parse_args()

    gold_path = Path(args.gold).resolve()
    out_dir = Path(args.out_dir).resolve() if args.out_dir else timestamp_dir()
    out_dir.mkdir(parents=True, exist_ok=True)

    selected_ids = {item.strip() for item in args.ids.split(",") if item.strip()}
    cases = select_cases(load_lane_gold(gold_path), selected_ids, args.limit, args.benchmark_type)
    if not cases:
        raise SystemExit("No lane gold cases selected.")

    max_workers = len(cases) if args.max_workers == 0 else max(1, min(args.max_workers, len(cases)))
    manifest = {
        "gold_path": str(gold_path),
        "selected_cases": len(cases),
        "max_workers": max_workers,
        "benchmark_type": normalize_benchmark_type(args.benchmark_type) or None,
        "created_at": datetime.now(UTC).isoformat(),
    }
    write_json(out_dir / "manifest.json", manifest)

    results = []
    with ProcessPoolExecutor(max_workers=max_workers, initializer=init_worker) as pool:
        future_map = {pool.submit(run_case, case): case["id"] for case in cases}
        for future in as_completed(future_map):
            result = future.result()
            results.append(result)
            write_json(out_dir / f"{result['id']}.json", result)
            print(f"[{result['status']}] {result['id']} score={result['score']:.2f} failure={result.get('failure_class')}")

    results.sort(key=lambda item: item["id"])
    write_json(out_dir / "results.json", results)
    aggregate = aggregate_results(results)
    write_json(out_dir / "aggregate.json", aggregate)

    print("\nSummary")
    print(f"  Output dir: {out_dir}")
    print(f"  Cases:      {aggregate['total_cases']}")
    print(f"  Avg score:  {aggregate['avg_score']:.2f}")
    print(f"  Status:     {aggregate['by_status']}")
    print(f"  Failures:   {aggregate['failure_classes']}")
    print(f"  Complexity: {aggregate['complexity_flags']}")


if __name__ == "__main__":
    main()
