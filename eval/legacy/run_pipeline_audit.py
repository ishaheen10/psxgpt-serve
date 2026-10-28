#!/usr/bin/env python3
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import html as _html_mod
import io
import json
import os
import re
import subprocess
import threading
import traceback
import time
from pathlib import Path

_ENGINE_LOAD_LOCK = threading.Lock()


COLAB_ROOT = Path(__file__).resolve().parent
ENGINE_NOTEBOOK = COLAB_ROOT / "engine_colab.ipynb"
OUTPUT_ROOT = COLAB_ROOT / "outputs" / "pipeline_audit"
# Zero-based notebook indexes; these match the visible Cell N labels used in
# engine_colab_walkthrough.md and engine_guide.html.
ENGINE_CELLS = [2, 3, 4, 5, 6, 7, 8, 10, 11, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]
DEFAULT_QUERIES = [
    "Top 5 banks by latest CASA/deposit ratio and explain funding strategy from directors report.",
    "Top 3 textile firms by net profit growth and summarize export-demand commentary from annual reports.",
]


def load_dotenv_if_present() -> None:
    for env_path in [
        COLAB_ROOT.parent / ".env",
        COLAB_ROOT.parent / ".env.local",
        COLAB_ROOT.parent / "client" / "dspy" / ".dev.vars",
        COLAB_ROOT.parent.parent / "PSXClient" / ".env",
    ]:
        if not env_path.exists():
            continue
        for line in env_path.read_text(errors="ignore").splitlines():
            if not line or line.lstrip().startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key and not os.getenv(key):
                os.environ[key] = value.strip().strip('"').strip("'")


def wrangler_run_sql(sql: str, params: list | None = None) -> dict:
    if params:
        for value in params:
            if value is None:
                literal = "NULL"
            elif isinstance(value, (int, float)) and not isinstance(value, bool):
                literal = str(value)
            else:
                literal = "'" + str(value).replace("'", "''") + "'"
            sql = sql.replace("?", literal, 1)
    last_error = ""
    for attempt in range(3):
        try:
            env = os.environ.copy()
            env["CLOUDFLARE_ACCOUNT_ID"] = "2e5783bcf42effc537210ebfacff3f56"
            env["CF_ACCOUNT_ID"] = "2e5783bcf42effc537210ebfacff3f56"
            proc = subprocess.run(
                ["npx", "wrangler", "d1", "execute", "psx", "--remote", "--json", "--command", sql],
                cwd=COLAB_ROOT.parent / "client" / "dspy",
                env=env,
                text=True,
                capture_output=True,
                timeout=80,
                check=False,
            )
        except Exception as exc:
            last_error = f"wrangler failed: {exc}"
            proc = None
        if proc is not None:
            match = re.search(r"(\[\s*\{[\s\S]*\}\s*\])\s*$", proc.stdout)
            if match:
                break
            last_error = proc.stderr[-1200:] or proc.stdout[-1200:] or "could not parse wrangler JSON output"
        if attempt < 2:
            time.sleep(1.5 * (attempt + 1))
    else:
        return {"success": False, "rows": [], "row_count": 0, "columns": [], "error": last_error}
    try:
        blocks = json.loads(match.group(1))
    except Exception as exc:
        return {"success": False, "rows": [], "row_count": 0, "columns": [], "error": f"could not parse wrangler JSON: {exc}"}
    block = blocks[0] if blocks else {}
    rows = block.get("results", []) if block.get("success") else []
    columns = list(rows[0].keys()) if rows else []
    return {
        "success": bool(block.get("success")),
        "rows": rows,
        "row_count": len(rows),
        "columns": columns,
        "error": None if block.get("success") else str(block),
    }


def exec_notebook_cell(ns: dict, nb: dict, idx: int, code: str | None = None) -> None:
    source = code if code is not None else "".join(nb["cells"][idx].get("source", []))
    source = source.replace('return "\n".join(lines)', 'return "\\n".join(lines)')
    source = source.replace('return "\n".join(sections)', 'return "\\n".join(sections)')
    source = source.replace("\x08", "\\b")
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        exec(compile(source, f"{ENGINE_NOTEBOOK.name}:cell_{idx}", "exec"), ns)


def load_engine() -> dict:
    nb = json.loads(ENGINE_NOTEBOOK.read_text())
    ns: dict = {"__name__": "__main__"}
    use_wrangler = not os.getenv("CF_API_TOKEN", "").strip()
    with _ENGINE_LOAD_LOCK:
        cwd = Path.cwd()
        os.chdir(COLAB_ROOT)
    try:
        for idx in ENGINE_CELLS:
            if use_wrangler and idx == 3:
                source = "".join(nb["cells"][idx].get("source", []))
                source = source.replace(
                    'if not CF_API_TOKEN or CF_API_TOKEN in {"REPLACE_ME", "cfat_REPLACE_ME"}:\n    missing.append("CF_API_TOKEN")',
                    'if not CF_API_TOKEN or CF_API_TOKEN in {"REPLACE_ME", "cfat_REPLACE_ME"}:\n    CF_API_TOKEN = "WRANGLER_OAUTH_FALLBACK"',
                )
                exec_notebook_cell(ns, nb, idx, source)
            elif use_wrangler and idx == 6:
                ns["run_sql"] = wrangler_run_sql
                test = ns["run_sql"]("SELECT date('now') AS today")
                if not test["success"]:
                    raise RuntimeError("Wrangler D1 connection failed: " + str(test["error"]))
            else:
                exec_notebook_cell(ns, nb, idx)

        # Cell 12 = §1.3a ask contract/normalisers; Cell 13 = §1.3b run_router.
        # Load §1.3b / Cell 13 definitions without its notebook-only "Try it" block.
        exec_notebook_cell(ns, nb, 12)
        router_defs = "".join(nb["cells"][13].get("source", [])).split("# ── Try it", 1)[0]
        exec_notebook_cell(ns, nb, 13, router_defs)

        ns["lane_artifacts"] = []
        exec_notebook_cell(ns, nb, 36)
        exec_notebook_cell(ns, nb, 37)
        ns["QUERY"] = ""
        ns["analyst_sources"] = []
        exec_notebook_cell(ns, nb, 38)
        analyst_defs = "".join(nb["cells"][39].get("source", [])).split("\nanalyst_result = run_analyst", 1)[0]
        exec_notebook_cell(ns, nb, 39, analyst_defs)
    finally:
        with _ENGINE_LOAD_LOCK:
            os.chdir(cwd)
    return ns


# ── Data helpers ──────────────────────────────────────────────────────────────

def slugify(text: str, idx: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80]
    return f"{idx:02d}-{slug or 'query'}"


def attachment_rows(artifact: dict) -> list[dict]:
    att = artifact.get("analysisAttachment")
    if not att:
        return []
    return [dict(zip(att.get("headers", []), row)) for row in att.get("rows", [])]


def attachment_coverage(artifact: dict) -> dict:
    att = artifact.get("analysisAttachment") or {}
    coverage = dict(att.get("coverage") or artifact.get("coverage") or {})
    if coverage:
        row_flow = dict(coverage.get("row_flow") or {})
        rows = attachment_rows(artifact)
        row_flow.setdefault("fed_rows", len(rows))
        row_flow.setdefault("submitted_rows", len(rows))
        coverage["row_flow"] = row_flow
    return coverage


def source_rows(ns: dict, ids: list[int]) -> list[dict]:
    clean = list(dict.fromkeys(int(i) for i in ids if int(i) > 0))
    if not clean:
        return []
    row_map = ns["fetch_document_rows_by_ids"](
        clean,
        "id, ticker, filing_period, filing_type, filing_year, pg, search_text, text, jpg_path",
    )
    return [row_map[i] for i in clean if i in row_map]


def unique_ints(values: list) -> list[int]:
    out: list[int] = []
    for v in values or []:
        try:
            i = int(v)
        except Exception:
            continue
        if i > 0 and i not in out:
            out.append(i)
    return out


def build_source_audit(panel: list[dict], analyst_sources: list[dict], analyst: dict | None) -> dict:
    fed_ids = {int(s["id"]) for s in analyst_sources if s.get("id")}
    fed_tags = {str(s.get("tag")) for s in analyst_sources if str(s.get("tag") or "").strip()}
    cited_tags = {str(t) for t in (analyst or {}).get("used_sources", [])}
    return {
        "panel_total": len(panel),
        "analyst_fed": len(analyst_sources),
        "extraction_pages": sum(1 for s in analyst_sources if s.get("content_kind") == "extraction"),
        "raw_pages": sum(1 for s in analyst_sources if s.get("content_kind") == "raw_page"),
        "panel_dropped": len([p for p in panel if int(p.get("id") or 0) not in fed_ids]),
        "fed_not_cited": sorted(fed_tags - cited_tags),
        "cited_tags": sorted(cited_tags),
    }


def safe_json_loads(value: str | None, fallback):
    try:
        return json.loads(value or "")
    except Exception:
        return fallback


def compact_text(value: object, limit: int = 1000) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\r\n", "\n")
    return text if len(text) <= limit else text[:limit].rstrip() + "\n...[truncated]"


def summarize_tool_result(content: object) -> dict:
    parsed = content if isinstance(content, dict) else safe_json_loads(str(content), {})
    if not isinstance(parsed, dict):
        return {"content": compact_text(parsed, 500)}
    keys = ("ok", "row_count", "candidate_count", "candidates_remaining",
            "extraction_count", "title", "error", "submitted")
    summary = {k: parsed.get(k) for k in keys if k in parsed}
    rows = parsed.get("rows")
    if isinstance(rows, list):
        summary["sample_rows"] = rows[:3]
    return summary


def lane_llm_calls(artifact: dict) -> list[dict]:
    history = [m for m in artifact.get("_debug", {}).get("message_history", [])
               if m.get("role") != "system"]
    tool_name_by_id: dict[str, str] = {}
    for msg in history:
        if msg.get("role") != "assistant":
            continue
        for tc in msg.get("tool_calls") or []:
            fn = tc.get("function", {})
            if tc.get("id"):
                tool_name_by_id[tc["id"]] = fn.get("name", "")
    calls: list[dict] = []
    pending: list[dict] = []
    call_index = 0
    i = 0
    while i < len(history):
        msg = history[i]
        role = msg.get("role")
        if role == "user":
            pending.append({"role": "user", "content": compact_text(msg.get("content"), 800)})
            i += 1
            continue
        if role == "tool":
            tcid = msg.get("tool_call_id")
            pending.append({
                "role": "tool",
                "tool": msg.get("name") or tool_name_by_id.get(tcid, ""),
                "tool_call_id": tcid,
                "summary": summarize_tool_result(safe_json_loads(msg.get("content"), msg.get("content"))),
            })
            i += 1
            continue
        if role != "assistant":
            i += 1
            continue
        call_index += 1
        tool_calls = []
        for tc in msg.get("tool_calls") or []:
            fn = tc.get("function", {})
            tool_calls.append({
                "id": tc.get("id"),
                "name": fn.get("name"),
                "arguments": safe_json_loads(fn.get("arguments"), fn.get("arguments") or ""),
            })
        calls.append({
            "call": call_index,
            "input": pending,
            "assistant_content": compact_text(msg.get("content"), 800),
            "tool_calls": tool_calls,
        })
        pending = []
        i += 1
    return calls


def analyst_context_payload(query: str, artifacts: list[dict], analyst_sources: list[dict]) -> dict:
    return {
        "query": query,
        "executions": [{"variable": a.get("variable"), "table": a.get("table"),
                        "ask": a.get("ask"), "ask_object": a.get("ask_object"),
                        "resultSummary": a.get("resultSummary"),
                        "selected_tickers": a.get("selected_tickers", []),
                        "coverage": attachment_coverage(a),
                        "provenanceIds": a.get("provenanceIds", []),
                        "narrativeIds": a.get("narrativeIds", [])} for a in artifacts],
        "computedTables": [a.get("analysisAttachment") for a in artifacts if a.get("analysisAttachment")],
        "computedTableCoverage": [attachment_coverage(a) for a in artifacts if a.get("analysisAttachment")],
        "sources": analyst_sources,
    }


def postprocess_artifacts(ns: dict, artifacts: list[dict]) -> None:
    for art in artifacts:
        if art["table"] in {"financial_statements", "ratios", "management_comp"} and not art.get("provenanceIds"):
            rows = attachment_rows(art)
            if rows:
                art["provenanceIds"] = ns["recover_structured_provenance"](art["table"], rows)


def replay_sql_for_audit(ns: dict, artifact: dict) -> list[dict]:
    out = []
    for qi, sql in enumerate(artifact.get("_debug", {}).get("sql_queries", []), 1):
        entry = {"index": qi, "model_sql": sql, "executed": []}
        res = ns["run_sql"](sql)
        rows = res.get("rows", []) if res.get("success") else []
        entry["executed"].append({"sql": sql, "row_count": len(rows),
                                  "error": res.get("error"), "rows_preview": rows[:12]})
        out.append(entry)
    return out


# ── run_query ─────────────────────────────────────────────────────────────────

def run_query(ns: dict, query: str, run_analyst: bool) -> dict:
    router = ns["run_router"](query)
    tickers_chars, n_tickers = _extract_tickers_block_size(router.get("system_prompt", ""))
    router["tickers_ref_chars"] = tickers_chars
    router["n_tickers"] = n_tickers

    artifacts: list[dict] = []
    resolved_steps: list[dict] = []

    for i, raw_ask in enumerate(router["plan"], 1):
        ask = ns["resolve_pipeline_ask"](query, raw_ask, artifacts)
        resolved_steps.append({
            "variable": f"q{i}",
            "raw_ask": raw_ask,
            "resolved_ask": ask,
            "dependency": ask.get("dependency", ""),
        })
        artifact = ns["run_lane"](ask, variable=f"q{i}")
        artifacts.append(artifact)

    postprocess_artifacts(ns, artifacts)
    panel = ns["assemble_source_panel"](artifacts)
    analyst_sources = ns["assemble_analyst_sources"](artifacts)
    analyst_context = analyst_context_payload(query, artifacts, analyst_sources)
    analyst_user_message = ns["build_analyst_message"](query, artifacts, analyst_sources)
    analyst = ns["run_analyst"](query, artifacts, analyst_sources, user_memories=[]) if run_analyst else None

    lane_audits = []
    for art in artifacts:
        narr_ids = unique_ints(art.get("narrativeIds", []))
        prov_ids = unique_ints(art.get("provenanceIds", []))
        att_rows = attachment_rows(art)
        coverage = attachment_coverage(art)
        preview_rows = att_rows[:40]
        if coverage:
            row_flow = dict(coverage.get("row_flow") or {})
            row_flow["audit_display_rows"] = len(preview_rows)
            row_flow["audit_display_is_preview"] = len(preview_rows) < len(att_rows)
            coverage["row_flow"] = row_flow
        narr_rows = source_rows(ns, narr_ids)[:40]
        lane_audits.append({
            "variable": art.get("variable"),
            "table": art.get("table"),
            "ask_object": art.get("ask_object"),
            "resultSummary": art.get("resultSummary"),
            "finalQueries": art.get("finalQueries", []),
            "narrativeIds": narr_ids,
            "provenanceIds": prov_ids,
            "system_prompt": art.get("_debug", {}).get("system_prompt", ""),
            "llm_calls": lane_llm_calls(art),
            "sql_replay": replay_sql_for_audit(ns, art),
            "attachment_row_count": len(att_rows),
            "attachment_rows_preview_count": len(preview_rows),
            "attachment_rows_preview_is_capped": len(preview_rows) < len(att_rows),
            "attachment_coverage": coverage,
            "attachment_rows": preview_rows,
            "selected_source_rows": narr_rows,
            "narrativeExtractions": art.get("narrativeExtractions", []),
        })

    source_audit = build_source_audit(panel_rows(panel), analyst_sources, analyst)
    structured_provenance_total = len(unique_ints([pid for art in artifacts for pid in art.get("provenanceIds", [])]))
    structured_panel_displayed = sum(1 for p in panel if p.get("kind") in {"structured", "both"})
    source_audit.update({
        "structured_provenance_total": structured_provenance_total,
        "structured_panel_displayed": structured_panel_displayed,
        "structured_panel_omitted": max(0, structured_provenance_total - structured_panel_displayed),
    })

    return {
        "query": query,
        "router": router,
        "resolved_steps": resolved_steps,
        "panel": panel,
        "analyst_sources": analyst_sources,
        "analyst_context": analyst_context,
        "analyst_user_message": analyst_user_message,
        "analyst_system_prompt": ns.get("ANALYST_PROMPT_MD", ""),
        "analyst": analyst,
        "lane_audits": lane_audits,
        "source_audit": source_audit,
    }


# ── Shared display helpers ────────────────────────────────────────────────────

def normalize_sql(sql: str) -> str:
    sql = (sql or "").strip()
    if sql and not sql.endswith(";"):
        sql += ";"
    return sql


def trim_cell(value: object, limit: int = 180) -> str:
    text = "" if value is None else str(value)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > limit:
        text = text[:limit - 1].rstrip() + "..."
    return text.replace("|", "\\|")


def md_table(rows: list[dict], columns: list[str] | None = None, limit: int = 12) -> str:
    if not rows:
        return "_No rows._"
    if columns is None:
        preferred = ["id", "ticker", "filing_period", "filing_year", "filing_type", "pg",
                     "canonical_name", "value", "period_end", "name", "period", "label",
                     "page_url", "source_page_url", "search_text"]
        seen: set[str] = set()
        columns = [c for c in preferred if any(c in row for row in rows)]
        for row in rows:
            for key in row:
                if key not in columns and key not in seen:
                    seen.add(key); columns.append(key)
                if len(columns) >= 10:
                    break
            if len(columns) >= 10:
                break
    shown = rows[:limit]
    out = ["| " + " | ".join(columns) + " |",
           "| " + " | ".join(["---"] * len(columns)) + " |"]
    for row in shown:
        out.append("| " + " | ".join(trim_cell(row.get(col)) for col in columns) + " |")
    if len(rows) > limit:
        out.append(f"\n_Showing {limit} of {len(rows)} rows._")
    return "\n".join(out)


def coverage_summary_lines(coverage: dict) -> list[str]:
    if not coverage:
        return []
    lines = []
    flow = coverage.get("row_flow") or {}
    if flow:
        bits = []
        for key in ("final_sql_rows", "submitted_rows", "fed_rows", "audit_display_rows"):
            if key in flow:
                bits.append(f"{key}={flow[key]}")
        if flow.get("audit_display_is_preview"):
            bits.append("audit preview capped")
        if bits:
            lines.append("row_flow: " + ", ".join(bits))
    for key in ("requested_tickers", "fed_tickers", "missing_tickers", "periods_present",
                "selected_tickers", "expected_tickers", "unselected_requested_tickers",
                "ratio_names_present", "canonical_names_present"):
        vals = coverage.get(key)
        if vals:
            lines.append(f"{key}: " + ", ".join(map(str, vals[:16])))
    if coverage.get("market_data_max_date"):
        lines.append("market_data_max_date: " + str(coverage["market_data_max_date"]))
    if coverage.get("null_market_fields_by_ticker"):
        lines.append("null_market_fields_by_ticker: " + json.dumps(coverage["null_market_fields_by_ticker"], sort_keys=True))
    if coverage.get("stale_market_rows"):
        lines.append("stale_market_rows: " + json.dumps(coverage["stale_market_rows"][:8], sort_keys=True))
    if coverage.get("mixed_period_tickers"):
        lines.append("mixed_period_tickers: " + json.dumps(coverage["mixed_period_tickers"][:8], sort_keys=True))
    for note in coverage.get("notes") or []:
        lines.append("note: " + str(note))
    return lines


def md_text(value: object, lang: str = "text") -> str:
    return f"```{lang}\n{'' if value is None else str(value)}\n```"


def md_sql(sql: str) -> str:
    return md_text(normalize_sql(sql), "sql")


def md_json(obj: object, limit: int = 3000) -> str:
    text = json.dumps(obj, indent=2, ensure_ascii=True)
    if len(text) > limit:
        text = text[:limit].rstrip() + "\n...[truncated]"
    return f"```json\n{text}\n```"


def md_details(summary: str, body: str) -> str:
    return f"<details>\n<summary>{summary}</summary>\n\n{body}\n\n</details>"


def pdf_page_url_from_jpg(jpg_path: object) -> str:
    path = str(jpg_path or "").strip()
    if not path:
        return ""
    return "https://source.psxgpt.com/PDF_PAGES/" + path.replace(".jpg", ".pdf")


def source_page_url(source_url: object, source_pages: object) -> str:
    base = str(source_url or "").strip().rstrip("/")
    if not base:
        return ""
    pages = re.findall(r"\d+", str(source_pages or ""))
    if not pages:
        return base
    return f"{base}/page_{int(pages[0]):03d}.pdf"


def panel_rows(panel: list[dict]) -> list[dict]:
    return [{**row, "page_url": pdf_page_url_from_jpg(row.get("jpg_path"))} for row in panel]


def source_preview_rows(rows: list[dict]) -> list[dict]:
    return [{
        "id": r.get("id"), "ticker": r.get("ticker"),
        "filing_period": r.get("filing_period"), "filing_type": r.get("filing_type"),
        "pg": r.get("pg"),
        "page_url": pdf_page_url_from_jpg(r.get("jpg_path")),
        "search_text": r.get("search_text"),
    } for r in rows]


def attachment_rows_for_display(rows: list[dict]) -> list[dict]:
    out = []
    for row in rows:
        item = dict(row)
        if "source_url" in item:
            item["source_page_url"] = source_page_url(item.get("source_url"), item.get("source_pages"))
        out.append(item)
    return out


def compact_source_panel(panel: list[dict]) -> str:
    from collections import defaultdict
    groups: dict = defaultdict(list)
    for row in panel:
        key = (row.get("ticker", ""), row.get("filing_type", ""), row.get("filing_period") or "")
        pg = row.get("page_number") or row.get("pg")
        url = row.get("page_url", "")
        if pg is not None:
            try:
                groups[key].append((int(pg), url))
            except (TypeError, ValueError):
                groups[key].append((pg, url))
    if not groups:
        return "_No sources._"
    out = [f"{len(panel)} pages from {len(groups)} filings:", ""]
    for (ticker, ftype, period), page_urls in sorted(groups.items(), key=lambda x: (x[0][0], x[0][2])):
        deduped = sorted({pg: url for pg, url in page_urls}.items())
        links = [f"[p.{pg}]({url})" if url else f"p.{pg}" for pg, url in deduped[:15]]
        if len(deduped) > 15:
            links.append(f"(+{len(deduped) - 15} more)")
        out.append(f"- {ticker} {ftype} {period}: {' '.join(links)}")
    return "\n".join(out)


def sql_one_liner(sql: str) -> str:
    flat = re.sub(r"\s+", " ", (sql or "").strip())
    m = re.search(r"WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s+GROUP\s+BY|$)", flat, re.IGNORECASE)
    cond = m.group(1).strip() if m else flat
    return (cond[:110] + "…") if len(cond) > 110 else cond


def tool_call_summary(name: str, args: dict) -> str:
    if name == "run_sql":
        return sql_one_liner(args.get("sql", ""))
    if name == "submit":
        return f'"{args.get("title", "")}"'
    if name in {"search_narrative", "search_pages"}:
        q = args.get("query", args.get("search_query", ""))
        return f'query="{q[:80]}"'
    if name in {"select_pages", "filter_candidates"}:
        ids = args.get("ids", args.get("page_ids", []))
        return f"ids={list(ids)[:6]}"
    return str(args)[:100]


def result_summary_str(summary: dict) -> str:
    parts = []
    labels = {"row_count": "rows", "candidate_count": "candidates",
              "candidates_remaining": "remaining", "extraction_count": "extractions"}
    for key in ("row_count", "candidate_count", "candidates_remaining", "extraction_count"):
        if key in summary:
            parts.append(f"{labels[key]}={summary[key]}")
    if summary.get("submitted"):
        parts.append("✓")
    if summary.get("error"):
        parts.append(f"error: {str(summary['error'])[:60]}")
    return ", ".join(parts) if parts else "ok"


def build_lane_turns(llm_calls: list[dict]) -> list[dict]:
    result_by_id: dict[str, dict] = {}
    for call in llm_calls:
        for item in call.get("input", []):
            if item.get("role") == "tool" and item.get("tool_call_id"):
                result_by_id[item["tool_call_id"]] = item.get("summary", {})
    rows = []
    for call in llm_calls:
        for tc in call.get("tool_calls", []):
            summary = result_by_id.get(tc.get("id"), {})
            result = result_summary_str(summary) if summary else ("✓" if tc["name"] == "submit" else "—")
            rows.append({"turn": call["call"], "tool": tc["name"],
                         "args": tool_call_summary(tc["name"], tc.get("arguments", {})),
                         "result": result})
    return rows


# ── Context file helpers ──────────────────────────────────────────────────────

# (path-relative-to-context, is_fact)
_ROUTER_CONTEXT_FILES: list[tuple[str, bool]] = [
    ("router/fact/tables.md",                   True),
    ("router/fact/router_ask.md",               True),
    ("router/fact/metric_routing_index.md",     True),
    ("router/instruction/rules.md",             False),
    ("router/instruction/examples.md",          False),
    ("router/instruction/analysis_intents.md",  False),
]

_LANE_CONTEXT_FILES: dict[str, list[tuple[str, bool]]] = {
    "financial_statements": [
        ("lane/fact/financial_statements.md",              True),
        ("lane/fact/financial_statements_canonicals.json", True),
        ("lane/instruction/financial_statements.md",       False),
    ],
    "financial_documents_new": [
        ("lane/fact/financial_documents_new.md",           True),
        ("lane/instruction/financial_documents_new.md",    False),
    ],
    "ratios": [
        ("lane/fact/ratios.md",                            True),
        ("lane/instruction/ratios.md",                     False),
    ],
    "management_comp": [
        ("lane/fact/management_comp.md",                   True),
        ("lane/instruction/management_comp.md",            False),
    ],
    "market_data": [
        ("lane/fact/market_data.md",                       True),
        ("lane/instruction/market_data.md",                False),
    ],
}


def context_file_previews(stage: str, table: str | None = None) -> list[tuple[str, bool, int, str]]:
    ctx = COLAB_ROOT / "context"
    if stage == "router":
        entries = _ROUTER_CONTEXT_FILES
    elif stage == "lane":
        entries = _LANE_CONTEXT_FILES.get(table or "", [])
    elif stage == "analyst":
        entries = [("analyst/prompt.md", False)]
    else:
        entries = []
    out = []
    for rel_path, is_fact in entries:
        f = ctx / rel_path
        if not f.exists():
            continue
        raw = f.read_text(errors="ignore")
        char_count = len(raw)
        non_slot_lines = [l.strip() for l in raw.splitlines()
                          if l.strip() and not l.strip().startswith("[[")]
        preview = " | ".join(non_slot_lines[:3])
        preview = (preview[:160] + "…") if len(preview) > 160 else preview
        out.append((f.name, is_fact, char_count, preview))
    return out


def _ctx_lines(
    stage: str,
    table: str | None = None,
    system_prompt: str = "",
    router_info: dict | None = None,
) -> list[str]:
    files = context_file_previews(stage, table)
    out = []
    for name, is_fact, char_count, preview in files:
        label = "fact" if is_fact else "instruction"
        size = f"{char_count:,}c"
        if name == "financial_statements_canonicals.json" and system_prompt:
            sections = list(dict.fromkeys(re.findall(r'"(CORPORATE|BANK|INSURANCE|MUTUAL FUND)"', system_prompt)))
            note = f"sections injected: {', '.join(sections)}" if sections else preview
            out.append(f"- `{name}` [{label}] ({size}) — {note}")
        elif name == "analysis_intents.md" and system_prompt:
            injected = "ANALYSIS INTENT RECIPES" in system_prompt
            flag = "✓ injected" if injected else "✗ not injected"
            out.append(f"- `{name}` [{label}] ({size}) — {flag}")
        else:
            out.append(f"- `{name}` [{label}] ({size}) — {preview}")

    if stage == "router" and router_info:
        tickers_chars = router_info.get("tickers_ref_chars", 0)
        n_tickers = router_info.get("n_tickers", 0)
        sp = router_info.get("system_prompt", "")
        usage = router_info.get("usage", {})
        if tickers_chars:
            out.append(f"- `tickers_reference` [runtime] ({tickers_chars:,}c) — "
                       f"enriched from `tickers100.md` + DB MCap; {n_tickers} tickers")
        total_chars = len(sp)
        if total_chars:
            in_tok = usage.get("input_tokens")
            out_tok = usage.get("output_tokens")
            tok_str = f" · {in_tok:,} in / {out_tok} out tokens" if in_tok is not None else ""
            out.append(f"- _Total prompt: {total_chars:,}c{tok_str}_")

    return out


def _extract_tickers_block_size(system_prompt: str) -> tuple[int, int]:
    marker = "TICKER REFERENCE\n"
    start = system_prompt.find(marker)
    if start < 0:
        return 0, 0
    content_start = start + len(marker)
    rest = system_prompt[content_start:]
    end = rest.find("\n\n")
    block = rest[:end] if end >= 0 else rest
    n = sum(1 for line in block.splitlines()
            if line.startswith("|") and "---" not in line
            and "Symbol" not in line and line.count("|") >= 3)
    return len(block), n


# ── HTML output ───────────────────────────────────────────────────────────────

_HTML_CSS = """
:root {
  --c-router:   #3b82f6;
  --c-lane:     #10b981;
  --c-analyst:  #8b5cf6;
  --c-sources:  #64748b;
  --c-bg:       #f1f5f9;
  --c-card:     #ffffff;
  --c-border:   #e2e8f0;
  --c-text:     #1e293b;
  --c-muted:    #64748b;
  --c-code:     #f8fafc;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; font-size: 14px;
       line-height: 1.6; background: var(--c-bg); color: var(--c-text); }
a { color: var(--c-router); text-decoration: none; }
a:hover { text-decoration: underline; }

.page-header { background: #0f172a; color: #f8fafc; padding: 20px 32px 16px;
               position: sticky; top: 0; z-index: 100;
               border-bottom: 3px solid var(--c-router); }
.page-header h1 { font-size: 12px; letter-spacing: .08em; text-transform: uppercase;
                  color: #94a3b8; margin-bottom: 4px; }
.page-header .query { font-size: 17px; font-weight: 600; color: #f1f5f9; margin-bottom: 10px; }
.stage-nav { display: flex; gap: 8px; flex-wrap: wrap; }
.stage-nav a { padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 500;
               background: rgba(255,255,255,.1); color: #cbd5e1;
               border: 1px solid rgba(255,255,255,.15); }
.stage-nav a:hover { background: rgba(255,255,255,.2); text-decoration: none; }

main { max-width: 1080px; margin: 28px auto; padding: 0 24px 64px; }

.stage { margin-bottom: 44px; }
.stage-header { display: flex; align-items: center; gap: 10px;
                margin-bottom: 14px; padding-bottom: 8px;
                border-bottom: 2px solid var(--c-border); }
.stage-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.stage-router  .stage-dot { background: var(--c-router); }
.stage-lane    .stage-dot { background: var(--c-lane); }
.stage-analyst .stage-dot { background: var(--c-analyst); }
.stage-sources .stage-dot { background: var(--c-sources); }
.stage-header h2 { font-size: 16px; font-weight: 600; }
.stage-header .stage-sub { font-size: 13px; color: var(--c-muted); font-family: monospace; }

.card { background: var(--c-card); border: 1px solid var(--c-border);
        border-radius: 8px; padding: 16px 20px; margin-bottom: 10px; }
.card-label { font-size: 11px; font-weight: 600; letter-spacing: .06em;
              text-transform: uppercase; color: var(--c-muted); margin-bottom: 8px; }
.card-label.router  { color: var(--c-router); }
.card-label.lane    { color: var(--c-lane); }
.card-label.analyst { color: var(--c-analyst); }
.card-label.sources { color: var(--c-sources); }

.badge { display: inline-block; font-size: 11px; font-weight: 600;
         padding: 1px 7px; border-radius: 10px; margin-right: 4px; }
.badge-fact        { background: #dbeafe; color: #1d4ed8; }
.badge-instruction { background: #fef9c3; color: #854d0e; }
.badge-runtime     { background: #dcfce7; color: #166534; }
.badge-det         { background: #dbeafe; color: #1e40af; }
.badge-model       { background: #fed7aa; color: #9a3412; }
.badge-tickers     { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
.badge-stmts       { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
.badge-posture     { background: #faf5ff; color: #7c3aed; border: 1px solid #e9d5ff; }
.badge-industry    { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }

.ctx-file { display: flex; align-items: baseline; gap: 6px; padding: 5px 0;
            border-bottom: 1px solid var(--c-border); font-size: 13px; }
.ctx-file:last-child { border-bottom: none; }
.ctx-file .fname { font-family: monospace; font-size: 12px; min-width: 240px; }
.ctx-file .size  { font-size: 11px; color: var(--c-muted); min-width: 55px; }
.ctx-file .note  { font-size: 12px; color: var(--c-muted); }
.ctx-total { margin-top: 8px; font-size: 12px; color: var(--c-muted); font-style: italic; }

.ask-meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
.ask-text { font-size: 14px; font-weight: 500; margin-bottom: 4px; }

pre, code { font-family: 'SFMono-Regular', Consolas, monospace; }
.code-block { background: var(--c-code); border: 1px solid var(--c-border); border-radius: 6px;
              padding: 12px 14px; font-size: 12.5px; overflow-x: auto;
              white-space: pre; line-height: 1.5; }
.code-block.scrollable { max-height: 480px; overflow-y: auto; }
.sql-kw  { color: #7c3aed; font-weight: 600; }
code.inline { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 12px; }

.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th { background: #f8fafc; text-align: left; padding: 6px 10px;
                 border-bottom: 2px solid var(--c-border); font-weight: 600;
                 color: var(--c-muted); font-size: 11px; text-transform: uppercase; }
.data-table td { padding: 5px 10px; border-bottom: 1px solid var(--c-border);
                 vertical-align: top; max-width: 300px; }
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: #f8fafc; }
.table-note { font-size: 11px; color: var(--c-muted); margin-top: 4px; }

.tool-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.tool-table th { background: #f8fafc; padding: 5px 10px; font-size: 11px; font-weight: 600;
                 color: var(--c-muted); text-transform: uppercase; border-bottom: 2px solid var(--c-border); }
.tool-table td { padding: 5px 10px; border-bottom: 1px solid var(--c-border); vertical-align: top; }
.tool-table tr:last-child td { border-bottom: none; }
.t-turn { color: var(--c-muted); text-align: center; width: 40px; }
.t-tool { font-family: monospace; font-weight: 600; color: var(--c-lane); white-space: nowrap; }
.t-tool.submit { color: var(--c-analyst); }
.t-args { color: var(--c-muted); font-family: monospace; font-size: 11.5px;
          max-width: 460px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-result { font-size: 11.5px; text-align: right; white-space: nowrap; }
.t-ok { color: #16a34a; font-weight: 600; }

details.panel { border: 1px solid var(--c-border); border-radius: 6px; margin-top: 8px; }
details.panel summary { padding: 8px 14px; cursor: pointer; font-size: 12.5px; font-weight: 500;
                        color: var(--c-muted); list-style: none; display: flex;
                        align-items: center; gap: 6px; user-select: none; }
details.panel summary::before { content: "▶"; font-size: 9px; transition: transform .15s; }
details.panel[open] summary::before { transform: rotate(90deg); }
details.panel summary:hover { background: #f8fafc; border-radius: 6px; }
details.panel .panel-body { padding: 12px 14px; border-top: 1px solid var(--c-border); }

.prov-line { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; }
.prov-count { font-weight: 600; }

.answer-body { line-height: 1.8; }
.answer-body h3 { font-size: 15px; margin: 14px 0 5px; }
.answer-body h4 { font-size: 13px; margin: 12px 0 4px; }
.answer-body h5 { font-size: 12px; margin: 10px 0 3px; }
.answer-body p  { margin-bottom: 7px; }
.answer-body ul, .answer-body ol { padding-left: 20px; margin-bottom: 7px; }
.answer-body li { margin-bottom: 2px; }
.answer-body hr { border: none; border-top: 1px solid var(--c-border); margin: 14px 0; }
.answer-body strong { font-weight: 600; }
.answer-body em { font-style: italic; color: var(--c-muted); }
.answer-body table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 13px; }
.answer-body table th { background: #f8fafc; padding: 5px 10px; font-weight: 600;
                        border-bottom: 2px solid var(--c-border); text-align: left; }
.answer-body table td { padding: 4px 10px; border-bottom: 1px solid var(--c-border); }
.answer-body table tr:last-child td { border-bottom: none; }

.source-group { margin-bottom: 8px; font-size: 13px; }
.source-links { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
.source-link { display: inline-block; padding: 2px 7px; font-size: 12px;
               background: #f1f5f9; border: 1px solid var(--c-border);
               border-radius: 4px; color: var(--c-router); }
.source-link:hover { background: #dbeafe; }
.json-block { background: #0f172a; color: #e2e8f0; border-radius: 6px;
              padding: 14px 16px; font-family: monospace; font-size: 12px;
              overflow-x: auto; white-space: pre; line-height: 1.5; }
.token-line { font-size: 12px; color: var(--c-muted); margin-top: 8px; }
"""


def _he(value: object) -> str:
    return _html_mod.escape(str(value or ""), quote=True)


def _badge_html(text: str, cls: str) -> str:
    return f'<span class="badge badge-{cls}">{_he(text)}</span>'


def _sql_html(sql: str) -> str:
    sql = normalize_sql(sql)
    esc = _html_mod.escape(sql)
    keywords = ["SELECT", "FROM", "WHERE", "AND", "OR", "ORDER BY", "GROUP BY",
                "LIMIT", "JOIN", "LEFT JOIN", "INNER JOIN", "ON", "AS", "IN",
                "NOT IN", "IS NULL", "IS NOT NULL", "DISTINCT", "COUNT", "SUM",
                "AVG", "MAX", "MIN", "HAVING", "WITH", "CASE", "WHEN", "THEN", "ELSE", "END"]
    for kw in sorted(keywords, key=len, reverse=True):
        esc = re.sub(rf"(?<![a-zA-Z_]){re.escape(kw)}(?![a-zA-Z_])",
                     f'<span class="sql-kw">{kw}</span>', esc, flags=re.IGNORECASE)
    return f'<div class="code-block">{esc}</div>'


def _inline_md(text: str) -> str:
    text = _html_mod.escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"\*(.+?)\*", r"<em>\1</em>", text)
    text = re.sub(r"`([^`]+)`", r'<code class="inline">\1</code>', text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    return text


def _md_table_to_html(rows: list[str]) -> str:
    cells = []
    for line in rows:
        if re.match(r"^\|\s*[-: |]+\s*\|?$", line.strip()):
            continue
        cols = [c.strip() for c in line.strip().strip("|").split("|")]
        cells.append(cols)
    if not cells:
        return ""
    out = ['<table class="data-table"><thead><tr>']
    out += [f"<th>{_inline_md(h)}</th>" for h in cells[0]]
    out.append("</tr></thead><tbody>")
    for row in cells[1:]:
        out.append("<tr>" + "".join(f"<td>{_inline_md(c)}</td>" for c in row) + "</tr>")
    out.append("</tbody></table>")
    return "".join(out)


def _md_to_html(text: str) -> str:
    lines = text.split("\n")
    out: list[str] = []
    in_ul = in_ol = in_code = False
    table_buf: list[str] = []

    def flush_list():
        nonlocal in_ul, in_ol
        if in_ul: out.append("</ul>"); in_ul = False
        if in_ol: out.append("</ol>"); in_ol = False

    def flush_table():
        nonlocal table_buf
        if table_buf:
            out.append(_md_table_to_html(table_buf))
            table_buf = []

    for line in lines:
        if line.strip().startswith("```"):
            flush_list(); flush_table()
            in_code = not in_code
            out.append('<div class="code-block">' if in_code else "</div>")
            continue
        if in_code:
            out.append(_html_mod.escape(line)); continue
        if line.strip().startswith("|"):
            flush_list(); table_buf.append(line); continue
        else:
            flush_table()
        m = re.match(r"^(#{1,5})\s+(.*)", line)
        if m:
            flush_list()
            level = min(len(m.group(1)) + 2, 6)
            out.append(f"<h{level}>{_inline_md(m.group(2))}</h{level}>"); continue
        if re.match(r"^[-*_]{3,}$", line.strip()):
            flush_list(); out.append("<hr>"); continue
        m = re.match(r"^[-*]\s+(.*)", line)
        if m:
            if not in_ul: flush_list(); out.append("<ul>"); in_ul = True
            out.append(f"<li>{_inline_md(m.group(1))}</li>"); continue
        m = re.match(r"^\d+\.\s+(.*)", line)
        if m:
            if not in_ol: flush_list(); out.append("<ol>"); in_ol = True
            out.append(f"<li>{_inline_md(m.group(1))}</li>"); continue
        if not line.strip():
            flush_list(); out.append("<br>"); continue
        flush_list()
        out.append(f"<p>{_inline_md(line)}</p>")

    flush_list(); flush_table()
    return "\n".join(out)


def _html_table(rows: list[dict], columns: list[str] | None = None, limit: int = 20) -> str:
    if not rows:
        return '<p class="table-note">No rows.</p>'
    if columns is None:
        preferred = ["id", "ticker", "period_end", "filing_period", "filing_year",
                     "filing_type", "pg", "canonical_name", "value", "ratio_name",
                     "name", "period", "label", "page_url", "source_page_url", "search_text"]
        seen: set[str] = set()
        columns = [c for c in preferred if any(c in r for r in rows)]
        for row in rows:
            for k in row:
                if k not in seen and k not in columns:
                    seen.add(k); columns.append(k)
                if len(columns) >= 9: break
            if len(columns) >= 9: break
    shown = rows[:limit]
    parts = ['<table class="data-table"><thead><tr>']
    parts += [f"<th>{_he(c)}</th>" for c in columns]
    parts.append("</tr></thead><tbody>")
    for row in shown:
        parts.append("<tr>")
        for col in columns:
            val = row.get(col, "")
            cell = trim_cell(val, 200)
            if col in ("page_url", "source_page_url") and str(val).startswith("http"):
                parts.append(f'<td><a href="{_he(val)}" target="_blank">{_he(cell)}</a></td>')
            else:
                parts.append(f"<td>{_he(cell)}</td>")
        parts.append("</tr>")
    parts.append("</tbody></table>")
    if len(rows) > limit:
        parts.append(f'<p class="table-note">Showing {limit} of {len(rows)} rows.</p>')
    return "".join(parts)


def _html_ctx_files(stage: str, table: str | None = None,
                    system_prompt: str = "", router_info: dict | None = None) -> str:
    lines = _ctx_lines(stage, table, system_prompt, router_info)
    if not lines:
        return ""
    parts = []
    for line in lines:
        m = re.match(r"- `([^`]+)` \[([^\]]+)\] \(([^)]+)\) — (.*)", line)
        if m:
            fname, label, size, note = m.group(1), m.group(2), m.group(3), m.group(4)
            cls = {"fact": "fact", "instruction": "instruction", "runtime": "runtime"}.get(label, "runtime")
            parts.append(
                f'<div class="ctx-file">'
                f'<span class="fname">{_he(fname)}</span>'
                f'{_badge_html(label, cls)}'
                f'<span class="size">{_he(size)}</span>'
                f'<span class="note">{_inline_md(note)}</span>'
                f'</div>'
            )
        else:
            inner = re.sub(r"^- ", "", line)
            parts.append(f'<div class="ctx-total">{_inline_md(inner)}</div>')
    return "\n".join(parts)


def _html_ask_meta(ask_obj: dict) -> str:
    parts = [f'<div class="ask-text">{_he(ask_obj.get("ask", ""))}</div><div class="ask-meta">']
    if ask_obj.get("tickers"):
        parts.append(_badge_html(", ".join(ask_obj["tickers"]), "tickers"))
    if ask_obj.get("statement_types"):
        parts.append(_badge_html(" · ".join(ask_obj["statement_types"]), "stmts"))
    if ask_obj.get("posture"):
        parts.append(_badge_html(ask_obj["posture"], "posture"))
    if ask_obj.get("industry"):
        parts.append(_badge_html(ask_obj["industry"], "industry"))
    if ask_obj.get("ratio_names"):
        parts.append(_badge_html(", ".join(ask_obj["ratio_names"]), "stmts"))
    if ask_obj.get("concepts"):
        parts.append(_badge_html(", ".join(ask_obj["concepts"]), "posture"))
    parts.append("</div>")
    return "".join(parts)


def _html_tool_table(turns: list[dict]) -> str:
    if not turns:
        return ""
    parts = ['<table class="tool-table"><thead><tr>',
             "<th>#</th><th>Tool</th><th>Args</th><th>Result</th>",
             "</tr></thead><tbody>"]
    for t in turns:
        tool = t.get("tool", "")
        tool_cls = "submit" if tool == "submit" else ""
        result = t.get("result", "")
        res_cls = "t-ok" if ("✓" in result or "submitted" in result) else "t-result"
        parts.append(
            f'<tr><td class="t-turn">{_he(t.get("turn",""))}</td>'
            f'<td class="t-tool {tool_cls}">{_he(tool)}</td>'
            f'<td class="t-args" title="{_he(t.get("args",""))}">{_he(str(t.get("args",""))[:140])}</td>'
            f'<td class="{res_cls}">{_he(result)}</td></tr>'
        )
    parts.append("</tbody></table>")
    return "".join(parts)


def _html_prompt_collapsible(label: str, text: str, char_limit: int = 12000) -> str:
    if not text:
        return ""
    shown = text if len(text) <= char_limit else text[:char_limit].rstrip() + f"\n\n… (showing {char_limit:,} of {len(text):,} chars)"
    return (
        f'<details class="panel"><summary>{_he(label)} ({len(text):,}c)</summary>'
        f'<div class="panel-body">'
        f'<div class="code-block scrollable">{_he(shown)}</div>'
        f'</div></details>'
    )


def _html_source_panel(panel: list[dict]) -> str:
    from collections import defaultdict
    groups: dict = defaultdict(list)
    for row in panel:
        key = (row.get("ticker", ""), row.get("filing_type", ""), row.get("filing_period") or "")
        pg = row.get("page_number") or row.get("pg")
        url = row.get("page_url", "")
        if pg is not None:
            try:
                groups[key].append((int(pg), url))
            except (TypeError, ValueError):
                groups[key].append((pg, url))
    if not groups:
        return "<p>No sources.</p>"
    total = sum(len(v) for v in groups.values())
    parts = [f'<p style="margin-bottom:12px;font-weight:600;">{total} pages from {len(groups)} filings</p>']
    for (ticker, ftype, period), page_urls in sorted(groups.items(), key=lambda x: (x[0][0], x[0][2])):
        deduped = sorted({pg: url for pg, url in page_urls}.items())
        links = "".join(
            f'<a class="source-link" href="{_he(url)}" target="_blank">p.{pg}</a>'
            if url else f'<span class="source-link">p.{pg}</span>'
            for pg, url in deduped[:20]
        )
        label = " ".join(filter(None, [ticker, ftype, period]))
        parts.append(f'<div class="source-group"><strong>{_he(label)}</strong>'
                     f'<div class="source-links">{links}</div></div>')
    return "".join(parts)


def _build_audit_body(payload: dict, prefix: str = "") -> tuple[list[str], list[str]]:
    """Build nav pill list and body section list for one query payload.

    `prefix` is prepended to every section id so multiple payloads can coexist
    on the same page without id collisions (e.g. prefix="p3-").
    Returns (nav_items, body_sections).
    """
    query = payload.get("query", "")
    lane_audits = payload.get("lane_audits", [])
    router = payload.get("router", {})
    source_audit = payload.get("source_audit", {})

    def sid(name: str) -> str:
        return f"{prefix}{name}"

    # nav pills
    nav = [f'<a href="#{sid("router")}">Router</a>']
    for lane in lane_audits:
        v, t = lane.get("variable", ""), lane.get("table", "")
        nav.append(f'<a href="#{sid(f"lane-{v}")}">Lane {_he(v)}: {_he(t)}</a>')
    nav += [f'<a href="#{sid("analyst")}">Analyst</a>',
            f'<a href="#{sid("sources")}">Sources</a>']

    body: list[str] = []

    # ── Router ────────────────────────────────────────────────────────────────
    router_sp = router.get("system_prompt", "")
    ctx_html = _html_ctx_files("router", system_prompt=router_sp, router_info=router)
    user_msg = _he(router.get("user_message", query))
    usage = router.get("usage", {})
    token_line = ""
    if usage.get("input_tokens") is not None:
        token_line = f'<div class="token-line">{usage["input_tokens"]:,} in / {usage.get("output_tokens", "?")} out tokens</div>'

    raw = router.get("raw_content", "")
    plan = router.get("plan", [])
    try:
        router_json = json.dumps(json.loads(raw) if raw else {"asks": plan}, indent=2)
    except Exception:
        router_json = raw or json.dumps({"asks": plan}, indent=2)

    body.append(f"""
<section class="stage stage-router" id="{sid("router")}">
  <div class="stage-header"><div class="stage-dot"></div><h2>Router</h2></div>
  <div class="card">
    <div class="card-label router">Context</div>
    {ctx_html}
    {_html_prompt_collapsible("Full assembled system prompt", router_sp)}
  </div>
  <div class="card">
    <div class="card-label router">Query</div>
    <code class="inline">{user_msg}</code>
    {token_line}
  </div>
  <div class="card">
    <div class="card-label router">Output plan</div>
    <div class="json-block">{_he(router_json)}</div>
  </div>
</section>
""")

    # ── Lanes ─────────────────────────────────────────────────────────────────
    for lane in lane_audits:
        v = lane.get("variable", "")
        table = lane.get("table", "")
        sp = lane.get("system_prompt", "")
        ask_obj = lane.get("ask_object") or {}

        lane_ctx = _html_ctx_files("lane", table, sp)
        ask_html = _html_ask_meta(ask_obj)

        tool_html = ""
        sql_details: list[str] = []
        if lane.get("llm_calls"):
            turns = build_lane_turns(lane["llm_calls"])
            tool_html = _html_tool_table(turns)
            sql_replay_idx = 0
            for t in turns:
                if t["tool"] != "run_sql":
                    continue
                replays = lane.get("sql_replay", [])
                if sql_replay_idx < len(replays):
                    for ex in replays[sql_replay_idx]["executed"]:
                        ticker_label = f" [{ex['ticker']}]" if ex.get("ticker") else ""
                        label = f"Turn {t['turn']}{ticker_label} — {ex['row_count']} rows"
                        body_inner = _sql_html(ex.get("sql", ""))
                        if ex.get("rows_preview"):
                            body_inner += _html_table(ex["rows_preview"], limit=5)
                        sql_details.append(
                            f'<details class="panel">'
                            f'<summary>{_he(label)}</summary>'
                            f'<div class="panel-body">{body_inner}</div></details>'
                        )
                sql_replay_idx += 1

            # Submit final_sql collapsible
            final_queries = lane.get("finalQueries", [])
            if final_queries:
                result_summary = lane.get("resultSummary", "")
                row_hint = ""
                m = re.search(r"(\d+)\s+rows?", result_summary, re.IGNORECASE)
                if m:
                    row_hint = f" → {m.group(1)} rows"
                sql_details.append(
                    f'<details class="panel" style="border-color:#10b981;">'
                    f'<summary style="color:#059669;">Submit final_sql{_he(row_hint)}</summary>'
                    f'<div class="panel-body">{_sql_html(final_queries[0])}</div></details>'
                )

        result_html = ""
        if lane.get("attachment_rows"):
            display_rows = attachment_rows_for_display(lane["attachment_rows"])
            coverage_lines = coverage_summary_lines(lane.get("attachment_coverage") or {})
            coverage_html = (
                '<pre style="white-space:pre-wrap; font-size:12px; color:#475569; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px;">'
                + _he("\n".join(coverage_lines))
                + '</pre>'
            ) if coverage_lines else ""
            result_html = (
                f'<div class="card-label lane" style="margin-top:12px;">'
                f'Result — {_he(lane.get("resultSummary",""))}</div>'
                + coverage_html
                + _html_table(display_rows, limit=20)
            )

        prov_html = ""
        prov_ids = lane.get("provenanceIds", [])
        narr_ids = lane.get("narrativeIds", [])
        if prov_ids or narr_ids:
            prov_parts = []
            if prov_ids:
                prov_parts.append(
                    f'<div class="prov-line">{_badge_html("deterministic", "det")}'
                    f'<span class="prov-count">{len(prov_ids)}</span>'
                    f'<span style="color:var(--c-muted);font-size:12px">page(s) recovered from '
                    f'<code class="inline">source_pages</code> column</span></div>'
                )
            if narr_ids:
                prov_parts.append(
                    f'<div class="prov-line">{_badge_html("model-selected", "model")}'
                    f'<span class="prov-count">{len(narr_ids)}</span>'
                    f'<span style="color:var(--c-muted);font-size:12px">page(s) submitted by lane model</span></div>'
                )
            prov_html = (
                '<div class="card-label lane" style="margin-top:12px;">Sources surfaced</div>'
                + "".join(prov_parts)
            )

        narr_html = ""
        if lane.get("selected_source_rows"):
            preview = source_preview_rows(lane["selected_source_rows"])
            narr_html = (
                '<details class="panel"><summary>Narrative source pages</summary>'
                f'<div class="panel-body">{_html_table(preview, limit=15)}</div></details>'
            )

        ext_html = ""
        if lane.get("narrativeExtractions"):
            ext_html = (
                '<div class="card-label lane" style="margin-top:12px;">Extractions</div>'
                + _html_table(lane["narrativeExtractions"], limit=20)
            )

        body.append(f"""
<section class="stage stage-lane" id="{sid(f"lane-{v}")}">
  <div class="stage-header">
    <div class="stage-dot"></div><h2>Lane {_he(v)}</h2>
    <span class="stage-sub">{_he(table)}</span>
  </div>
  <div class="card">
    <div class="card-label lane">Context</div>
    {lane_ctx}
    {_html_prompt_collapsible("Full assembled system prompt", sp)}
  </div>
  <div class="card">
    <div class="card-label lane">Ask</div>
    {ask_html}
  </div>
  {"<div class='card'><div class='card-label lane'>Tool calls</div>" + tool_html + "".join(sql_details) + "</div>" if tool_html else ""}
  {"<div class='card'>" + result_html + "</div>" if result_html else ""}
  {"<div class='card'>" + prov_html + narr_html + ext_html + "</div>" if (prov_html or narr_html or ext_html) else ""}
</section>
""")

    # ── Analyst ───────────────────────────────────────────────────────────────
    analyst_sp = payload.get("analyst_system_prompt", "")
    analyst_ctx = _html_ctx_files("analyst")
    analyst_msg = payload.get("analyst_user_message", "")
    answer_html = "<p><em>Skipped.</em></p>"
    answer_meta = ""
    if payload.get("analyst"):
        analyst = payload["analyst"]
        n_ext = source_audit.get("extraction_pages", "?")
        n_raw = source_audit.get("raw_pages", "?")
        n_fed = source_audit.get("analyst_fed", "?")
        cited = analyst.get("used_sources", [])
        answer_meta = (
            f'<div style="font-size:12px;color:var(--c-muted);margin-bottom:12px;">'
            f'Used {len(analyst.get("used_tables",[]))} table(s) · '
            f'{len(cited)} source(s) cited · '
            f'{n_fed} pages fed ({n_ext} extraction, {n_raw} raw)'
            f'</div>'
        )
        answer_html = f'<div class="answer-body">{_md_to_html(analyst.get("answer", ""))}</div>'

    body.append(f"""
<section class="stage stage-analyst" id="{sid("analyst")}">
  <div class="stage-header"><div class="stage-dot"></div><h2>Analyst</h2></div>
  <div class="card">
    <div class="card-label analyst">Context</div>
    {analyst_ctx}
    {_html_prompt_collapsible("Analyst system prompt", analyst_sp)}
    {_html_prompt_collapsible("Input message to analyst", analyst_msg, char_limit=8000)}
  </div>
  <div class="card">
    <div class="card-label analyst">Answer</div>
    {answer_meta}
    {answer_html}
  </div>
</section>
""")

    # ── Sources ───────────────────────────────────────────────────────────────
    panel = panel_rows(payload.get("panel", []))
    dropped_raw = source_audit.get("panel_dropped", 0)
    dropped = len(dropped_raw) if isinstance(dropped_raw, list) else (dropped_raw or 0)
    panel_total = source_audit.get("panel_total") or source_audit.get("panel_count", 0)
    analyst_fed = source_audit.get("analyst_fed") or source_audit.get("analyst_source_count", 0)
    sa_line = (f'<p style="font-size:13px;color:var(--c-muted);margin-bottom:14px;">'
               f'Panel: {panel_total} pages · '
               f'Analyst-fed: {analyst_fed} · '
               f'Dropped (cap): {dropped}</p>') if source_audit else ""
    body.append(f"""
<section class="stage stage-sources" id="{sid("sources")}">
  <div class="stage-header"><div class="stage-dot"></div><h2>Sources</h2></div>
  <div class="card">
    {sa_line}
    {_html_source_panel(panel)}
  </div>
</section>
""")

    return nav, body


def write_html_audit(payload: dict, path: Path) -> None:
    query = payload.get("query", "")
    nav, body = _build_audit_body(payload)
    html = (
        f'<!DOCTYPE html>\n<html lang="en">\n<head>\n'
        f'  <meta charset="utf-8">\n'
        f'  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f'  <title>Audit — {_he(query)}</title>\n'
        f'  <style>{_HTML_CSS}</style>\n'
        f'</head>\n<body>\n'
        f'  <header class="page-header">\n'
        f'    <h1>psxGPT Pipeline Audit</h1>\n'
        f'    <div class="query">{_he(query)}</div>\n'
        f'    <nav class="stage-nav">{"".join(nav)}</nav>\n'
        f'  </header>\n'
        f'  <main>\n{"".join(body)}\n'
        f'    <p style="font-size:11px;color:var(--c-muted);text-align:center;margin-top:32px;">'
        f'Full trace: {_he(path.stem)}.json</p>\n'
        f'  </main>\n</body>\n</html>'
    )
    path.write_text(html, encoding="utf-8")


_COMBINED_EXTRA_CSS = """
.app { display: flex; height: 100vh; overflow: hidden; }

.sidebar {
  width: 280px; min-width: 220px; max-width: 340px;
  background: #0f172a; color: #cbd5e1;
  display: flex; flex-direction: column;
  border-right: 2px solid #1e293b;
  resize: horizontal; overflow: auto;
}
.sidebar-header {
  padding: 14px 16px 10px;
  font-size: 11px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; color: #64748b;
  border-bottom: 1px solid #1e293b; flex-shrink: 0;
}
.sidebar-search {
  padding: 8px 12px; border-bottom: 1px solid #1e293b; flex-shrink: 0;
}
.sidebar-search input {
  width: 100%; background: #1e293b; border: 1px solid #334155;
  border-radius: 5px; padding: 5px 9px; font-size: 12px; color: #e2e8f0;
  outline: none;
}
.sidebar-search input::placeholder { color: #475569; }
.query-list { list-style: none; overflow-y: auto; flex: 1; padding: 6px 0; }
.query-item {
  padding: 9px 14px; cursor: pointer; font-size: 12px; line-height: 1.45;
  border-left: 3px solid transparent; color: #94a3b8;
  display: flex; gap: 8px; align-items: flex-start;
  transition: background .1s;
}
.query-item:hover { background: #1e293b; color: #e2e8f0; }
.query-item.active { background: #1e293b; border-left-color: var(--c-router); color: #f1f5f9; }
.query-item.failed { border-left-color: #ef4444; }
.query-item.active.failed { border-left-color: #ef4444; }
.q-num { font-size: 10px; color: #475569; min-width: 18px; padding-top: 2px; }
.q-text { flex: 1; }
.q-status { font-size: 10px; margin-top: 3px; }
.q-status.ok   { color: #22c55e; }
.q-status.fail { color: #ef4444; }

.content-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.content-header {
  background: #0f172a; color: #f8fafc; padding: 12px 24px 10px;
  border-bottom: 3px solid var(--c-router); flex-shrink: 0;
}
.content-header .query { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
.content-scroll { flex: 1; overflow-y: auto; }
.content-scroll main { max-width: 1080px; margin: 24px auto; padding: 0 24px 64px; }

.pane { display: none; }
.pane.active { display: block; }
"""

_COMBINED_JS = """
(function() {
  var items  = document.querySelectorAll('.query-item');
  var panes  = document.querySelectorAll('.pane');
  var header = document.getElementById('content-query');
  var nav    = document.getElementById('content-nav');
  var scroll = document.querySelector('.content-scroll');

  function activate(idx) {
    items.forEach(function(el) { el.classList.remove('active'); });
    panes.forEach(function(el) { el.classList.remove('active'); });
    items[idx].classList.add('active');
    panes[idx].classList.add('active');
    var qNode = items[idx].querySelector('.q-text');
    header.textContent = qNode.firstChild ? qNode.firstChild.textContent.trim() : qNode.textContent.trim();
    nav.innerHTML = panes[idx].querySelector('.pane-nav').innerHTML;
    scroll.scrollTop = 0;
  }

  items.forEach(function(item, idx) {
    item.addEventListener('click', function() { activate(idx); });
  });

  var searchInput = document.getElementById('sidebar-search');
  searchInput.addEventListener('input', function() {
    var q = this.value.toLowerCase();
    items.forEach(function(item) {
      var text = item.querySelector('.q-text').textContent.toLowerCase();
      item.style.display = text.includes(q) ? '' : 'none';
    });
  });

  if (items.length > 0) activate(0);
})();
"""


def _lane_status(lane_audits: list[dict]) -> tuple[str, str]:
    """Return (css_class, status_text) for the sidebar query item."""
    for lane in lane_audits:
        rs = str(lane.get("resultSummary") or "")
        if "failed" in rs.lower():
            return "fail", "lane failed"
    if lane_audits:
        return "ok", f"{len(lane_audits)} lane(s)"
    return "fail", "no lanes"


def write_combined_html_audit(payloads: list[dict], path: Path) -> None:
    if not payloads:
        return

    sidebar_items: list[str] = []
    pane_sections: list[str] = []

    for idx, payload in enumerate(payloads):
        query = payload.get("query", "")
        lane_audits = payload.get("lane_audits", [])
        prefix = f"p{idx}-"
        nav, body = _build_audit_body(payload, prefix=prefix)

        status_cls, status_text = _lane_status(lane_audits)
        item_cls = f"query-item{' failed' if status_cls == 'fail' else ''}"
        sidebar_items.append(
            f'<li class="{item_cls}" data-idx="{idx}">'
            f'<span class="q-num">{idx + 1}</span>'
            f'<span class="q-text">{_he(query)}'
            f'<div class="q-status {status_cls}">{_he(status_text)}</div>'
            f'</span></li>'
        )

        # Store nav separately inside pane for the JS header swap
        nav_html = f'<div class="pane-nav stage-nav" style="display:none">{"".join(nav)}</div>'
        pane_sections.append(
            f'<div class="pane" id="pane-{idx}">'
            f'{nav_html}'
            f'{"".join(body)}'
            f'<p style="font-size:11px;color:var(--c-muted);text-align:center;margin-top:32px;">'
            f'Full trace: {_he(slugify(query, idx+1))}.json</p>'
            f'</div>'
        )

    n = len(payloads)
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>psxGPT Audit — {n} queries</title>
  <style>{_HTML_CSS}{_COMBINED_EXTRA_CSS}</style>
</head>
<body>
<div class="app">
  <nav class="sidebar">
    <div class="sidebar-header">{n} queries</div>
    <div class="sidebar-search">
      <input id="sidebar-search" type="text" placeholder="Filter queries…">
    </div>
    <ul class="query-list">{"".join(sidebar_items)}</ul>
  </nav>
  <div class="content-area">
    <div class="content-header">
      <h1 style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin-bottom:6px;">psxGPT Pipeline Audit</h1>
      <div class="query" id="content-query"></div>
      <nav class="stage-nav" id="content-nav"></nav>
    </div>
    <div class="content-scroll">
      <main>{"".join(pane_sections)}</main>
    </div>
  </div>
</div>
<script>{_COMBINED_JS}</script>
</body>
</html>"""
    path.write_text(html, encoding="utf-8")


# ── Markdown output ───────────────────────────────────────────────────────────

def write_markdown_audit(payload: dict, path: Path) -> None:
    lines = [f"# Audit: {payload['query']}", ""]

    # ── Router ────────────────────────────────────────────────────────────────
    lines += ["## Router", ""]
    router_sp = payload["router"].get("system_prompt", "")
    lines += ["**Context:**"] + _ctx_lines("router", system_prompt=router_sp,
                                           router_info=payload["router"]) + [""]
    if router_sp:
        trunc = router_sp if len(router_sp) <= 4000 else router_sp[:4000].rstrip() + "\n...[truncated]"
        lines += [md_details(f"Full assembled system prompt ({len(router_sp):,} chars)", md_text(trunc)), ""]
    lines += [f"**Query:** `{payload['router'].get('user_message', payload['query'])}`", ""]
    raw = payload["router"].get("raw_content", "")
    plan = payload["router"].get("plan", [])
    try:
        router_json = json.dumps(json.loads(raw) if raw else {"asks": plan}, indent=2)
    except Exception:
        router_json = raw or json.dumps({"asks": plan}, indent=2)
    lines += ["**Output:**", "```json", router_json, "```", ""]

    # ── Lanes ─────────────────────────────────────────────────────────────────
    for lane in payload["lane_audits"]:
        lines += [f"## Lane {lane['variable']}: {lane['table']}", ""]
        sp = lane.get("system_prompt", "")
        lines += ["**Context:**"] + _ctx_lines("lane", lane["table"], sp) + [""]
        if sp:
            trunc = sp if len(sp) <= 3000 else sp[:3000].rstrip() + "\n...[truncated]"
            lines += [md_details(f"Full assembled system prompt ({len(sp):,} chars)", md_text(trunc)), ""]

        ask_obj = lane.get("ask_object") or {}
        ask_text = ask_obj.get("ask", "")
        ask_meta = []
        if ask_obj.get("tickers"):
            ask_meta.append(f"tickers: `{ask_obj['tickers']}`")
        if ask_obj.get("statement_types"):
            ask_meta.append(f"statements: `{ask_obj['statement_types']}`")
        if ask_obj.get("industry"):
            ask_meta.append(f"industry: `{ask_obj['industry']}`")
        if ask_obj.get("posture"):
            ask_meta.append(f"posture: `{ask_obj['posture']}`")
        meta_str = f"  \n_{', '.join(ask_meta)}_" if ask_meta else ""
        lines += [f"**Ask:** {ask_text}{meta_str}", ""]

        if lane.get("llm_calls"):
            turns = build_lane_turns(lane["llm_calls"])
            lines += ["**Tool calls:**",
                      md_table(turns, columns=["turn", "tool", "args", "result"], limit=30), ""]
            sql_replay_idx = 0
            for t in turns:
                if t["tool"] != "run_sql":
                    continue
                replays = lane.get("sql_replay", [])
                if sql_replay_idx < len(replays):
                    for ex in replays[sql_replay_idx]["executed"]:
                        ticker_label = f" [{ex['ticker']}]" if ex.get("ticker") else ""
                        label = f"Turn {t['turn']}{ticker_label} — SQL + {ex['row_count']} rows"
                        body = md_sql(ex["sql"])
                        if ex.get("rows_preview"):
                            body += "\n\n" + md_table(ex["rows_preview"], limit=5)
                        lines += [md_details(label, body), ""]
                sql_replay_idx += 1

            final_queries = lane.get("finalQueries", [])
            if final_queries:
                result_summary = lane.get("resultSummary", "")
                m = re.search(r"(\d+)\s+rows?", result_summary, re.IGNORECASE)
                row_hint = f" → {m.group(1)} rows" if m else ""
                lines += [md_details(f"Submit final_sql{row_hint}", md_sql(final_queries[0])), ""]

        if lane["attachment_rows"]:
            display_rows = attachment_rows_for_display(lane["attachment_rows"])
            coverage_lines = coverage_summary_lines(lane.get("attachment_coverage") or {})
            lines += [f"**Result** — {lane['resultSummary']}", md_table(display_rows, limit=20), ""]
            if coverage_lines:
                lines += ["**Attachment coverage:**", md_text("\n".join(coverage_lines)), ""]

        prov_ids = lane.get("provenanceIds", [])
        narr_ids = lane.get("narrativeIds", [])
        if prov_ids or narr_ids:
            lines += ["**Sources surfaced:**", ""]
            if prov_ids:
                lines += [f"- {len(prov_ids)} page(s) via **deterministic provenance** "
                          f"(recovered from `source_pages` column)"]
            if narr_ids:
                lines += [f"- {len(narr_ids)} page(s) **selected by lane model**"]
            lines += [""]

        if lane["selected_source_rows"]:
            preview = source_preview_rows(lane["selected_source_rows"])
            lines += [md_details("Narrative source pages", md_table(preview, limit=15)), ""]
        if lane["narrativeExtractions"]:
            lines += ["**Extractions**", md_table(lane["narrativeExtractions"], limit=20), ""]

    # ── Analyst ───────────────────────────────────────────────────────────────
    lines += ["## Analyst", ""]
    lines += ["**Context:**"] + _ctx_lines("analyst") + [""]
    analyst_sp = payload.get("analyst_system_prompt", "")
    if analyst_sp:
        trunc = analyst_sp if len(analyst_sp) <= 3000 else analyst_sp[:3000].rstrip() + "\n...[truncated]"
        lines += [md_details(f"Analyst system prompt ({len(analyst_sp):,} chars)", md_text(trunc)), ""]
    analyst_msg = payload.get("analyst_user_message", "")
    if analyst_msg:
        trunc = analyst_msg if len(analyst_msg) <= 4000 else analyst_msg[:4000].rstrip() + "\n...[truncated]"
        lines += [md_details("Input message to analyst", md_text(trunc)), ""]
    if payload.get("analyst"):
        analyst = payload["analyst"]
        sa = payload.get("source_audit", {})
        lines += [f"**Answer** _(used {len(analyst.get('used_tables',[]))} table(s), "
                  f"{len(analyst.get('used_sources',[]))} source(s) cited · "
                  f"{sa.get('analyst_fed','?')} pages fed: "
                  f"{sa.get('extraction_pages','?')} extraction, {sa.get('raw_pages','?')} raw)_:", ""]
        lines += [analyst.get("answer", ""), ""]
    else:
        lines += ["**Answer:** _Skipped._", ""]

    # ── Sources ───────────────────────────────────────────────────────────────
    panel = panel_rows(payload["panel"])
    lines += ["## Sources", ""]
    lines += [compact_source_panel(panel), ""]
    lines += ["---", f"*Full trace: {path.stem}.json*", ""]
    path.write_text("\n".join(lines), encoding="utf-8")


def _run_one_query(task: tuple) -> tuple[int, str, dict]:
    """Worker: load engine, run one query, write per-query files. Returns (idx, query, payload)."""
    idx, query, out_dir, run_analyst = task
    ns = load_engine()
    payload = run_query(ns, query, run_analyst=run_analyst)
    slug = slugify(query, idx)
    json_path = out_dir / f"{slug}.json"
    md_path   = out_dir / f"{slug}.md"
    html_path = out_dir / f"{slug}.html"
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    write_markdown_audit(payload, md_path)
    write_html_audit(payload, html_path)
    status = "FAILED" if any("failed" in str(l.get("resultSummary","")).lower()
                              for l in payload.get("lane_audits",[])) else "ok"
    print(f"[{status}] ({idx}/{idx}) {query[:80]}")
    print(f"  html: {html_path}")
    return idx, query, payload


def _run_one_query_process(task: tuple, queue) -> None:
    try:
        queue.put(_run_one_query(task))
    except BaseException as exc:
        queue.put(("__error__", repr(exc), traceback.format_exc()))


def _error_payload(query: str, error: str) -> dict:
    return {
        "query": query,
        "router": {"plan": [], "system_prompt": "", "user_message": query},
        "resolved_steps": [],
        "panel": [],
        "analyst_sources": [],
        "analyst_context": {},
        "analyst_user_message": "",
        "analyst_system_prompt": "",
        "analyst": None,
        "lane_audits": [{
            "variable": "q1",
            "table": "runner_error",
            "resultSummary": f"RUNNER_ERROR — {error[:500]}",
            "ask_object": {},
            "finalQueries": [],
            "narrativeIds": [],
            "provenanceIds": [],
            "system_prompt": "",
            "llm_calls": [],
            "sql_replay": [],
            "attachment_rows": [],
            "selected_source_rows": [],
            "narrativeExtractions": [],
        }],
        "source_audit": {},
    }


def _run_one_query_safe(task: tuple) -> tuple[int, str, dict]:
    """Process-isolated wrapper around _run_one_query.

    Production is completion/cancellation driven rather than governed by a
    fixed query timeout. The audit runner follows that shape: wait for the
    child to publish a result, then clean up the process. This avoids false
    timeout stubs when SDK/background resources keep a worker process alive
    after the query payload has already been produced.
    """
    import multiprocessing as _mp
    idx, query, out_dir, run_analyst = task

    queue = _mp.Queue(maxsize=1)
    proc = _mp.Process(target=_run_one_query_process, args=(task, queue))
    proc.start()
    result = queue.get()
    if isinstance(result, tuple) and result and result[0] == "__error__":
        _tag, exc_repr, tb = result
        print(f"[ERROR] ({idx}) {query[:80]} — {exc_repr}")
        proc.join(5)
        if proc.is_alive():
            proc.terminate()
            proc.join(5)
        slug = slugify(query, idx)
        json_path = out_dir / f"{slug}.json"
        md_path = out_dir / f"{slug}.md"
        html_path = out_dir / f"{slug}.html"
        payload = _error_payload(query, tb)
        json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
        write_markdown_audit(payload, md_path)
        write_html_audit(payload, html_path)
        return idx, query, payload

    proc.join(5)
    if proc.is_alive():
        proc.terminate()
        proc.join(5)
        if proc.is_alive():
            proc.kill()
            proc.join()

    return result


def main() -> None:
    import concurrent.futures
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", action="append", help="Query to audit. Repeatable.")
    parser.add_argument("--queries-file", default="", help="JSON file with query list or [{qid,query}] objects.")
    parser.add_argument("--no-analyst", action="store_true", help="Skip final analyst call.")
    parser.add_argument("--jobs", type=int, default=1, help="Parallel workers (each loads its own engine).")
    parser.add_argument("--out", default="", help="Output directory.")
    args = parser.parse_args()

    load_dotenv_if_present()

    # ── Collect queries ───────────────────────────────────────────────────────
    queries: list[str] = []
    if args.queries_file:
        raw = json.loads(Path(args.queries_file).read_text())
        if isinstance(raw, list):
            for item in raw:
                if isinstance(item, dict):
                    queries.append(str(item.get("query") or item.get("q") or "").strip())
                else:
                    queries.append(str(item).strip())
        queries = [q for q in queries if q]
    if args.query:
        queries.extend(args.query)
    if not queries:
        queries = DEFAULT_QUERIES

    out_dir = Path(args.out) if args.out else OUTPUT_ROOT / dt.datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"Running {len(queries)} queries with jobs={args.jobs}  →  {out_dir}")

    tasks = [(idx, q, out_dir, not args.no_analyst) for idx, q in enumerate(queries, 1)]

    # ── Run (parallel or serial) ──────────────────────────────────────────────
    results: list[tuple[int, str, dict]] = []
    if args.jobs > 1:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
            for result in pool.map(_run_one_query_safe, tasks):
                results.append(result)
    else:
        ns = load_engine()
        for idx, query, out_dir_arg, run_analyst in tasks:
            payload = run_query(ns, query, run_analyst=run_analyst)
            slug = slugify(query, idx)
            json_path = out_dir / f"{slug}.json"
            md_path   = out_dir / f"{slug}.md"
            html_path = out_dir / f"{slug}.html"
            json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
            write_markdown_audit(payload, md_path)
            write_html_audit(payload, html_path)
            status = "FAILED" if any("failed" in str(l.get("resultSummary","")).lower()
                                      for l in payload.get("lane_audits",[])) else "ok"
            print(f"[{status}] {query[:80]}")
            print(f"  html: {html_path}")
            results.append((idx, query, payload))

    # ── Build combined index ──────────────────────────────────────────────────
    results.sort(key=lambda x: x[0])
    all_payloads = [p for _, _, p in results]
    manifest = {
        "created_at": dt.datetime.now(dt.UTC).isoformat(),
        "queries": queries,
        "items": [{"query": q, "json": str(out_dir / f"{slugify(q, i)}.json"),
                   "markdown": str(out_dir / f"{slugify(q, i)}.md"),
                   "html": str(out_dir / f"{slugify(q, i)}.html")}
                  for i, q in enumerate(queries, 1)],
    }
    index_path = out_dir / "index.html"
    write_combined_html_audit(all_payloads, index_path)
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"\nIndex:    {index_path}")
    print(f"Manifest: {out_dir / 'manifest.json'}")


if __name__ == "__main__":
    main()
