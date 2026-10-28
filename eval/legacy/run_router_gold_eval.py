#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import json
import os
import traceback
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, as_completed
from contextlib import redirect_stderr, redirect_stdout
from datetime import UTC, datetime
from pathlib import Path


COLAB_ROOT = Path(__file__).resolve().parent
REPO_ROOT = COLAB_ROOT.parent
ENGINE_NOTEBOOK = COLAB_ROOT / "notebooks" / "engine_colab.ipynb"
ROUTER_GOLD_PATH = COLAB_ROOT / "gold" / "gold-50.json"
OUTPUT_ROOT = COLAB_ROOT / "outputs" / "router_gold_runs"
# Zero-based notebook indexes matching the current engine_colab.ipynb layout:
# §0 setup, §1.1 live ticker enrichment, §1.2 router prompt assembly,
# and §1.3a typed ask normalisation. This runner installs its own tolerant
# run_router wrapper, so it does not need to execute §1.3b's notebook Try-it block.
ENGINE_CELL_IDS = [2, 3, 4, 5, 6, 7, 8, 10, 11, 12]

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
            # Skip the inline "Try it" block in the router cell so loading does not fire an API call.
            marker = "# ── Try it"
            if marker in code:
                code = code.split(marker, 1)[0]
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
    # Tolerate router responses that arrive as a bare list instead of {"asks": [...]}.
    safe_json = ENGINE["safe_json"]
    normalize_router_ask = ENGINE["normalize_router_ask"]
    import datetime as _dt
    def tolerant_run_router(query: str) -> dict:
        today = _dt.date.today().isoformat()
        user_message = f"[Today: {today}] {query}"
        messages = [
            {"role": "system", "content": ENGINE["ROUTER_SYSTEM"]},
            {"role": "user", "content": user_message},
        ]
        response = ENGINE["client"].chat.completions.create(
            model=ENGINE["MODEL_ROUTER"],
            messages=messages,
            temperature=0.1,
        )
        raw = response.choices[0].message.content or ""
        parsed = safe_json(raw, {"asks": []})
        if isinstance(parsed, list):
            parsed = {"asks": parsed}
        asks = []
        for item in parsed.get("asks", []) if isinstance(parsed, dict) else []:
            ask_obj = normalize_router_ask(item)
            if ask_obj:
                asks.append(ask_obj)
        return {
            "plan": asks[:8],
            "system_prompt": ENGINE["ROUTER_SYSTEM"],
            "user_message": user_message,
            "messages": messages,
            "raw_content": raw,
            "usage": {
                "input_tokens": response.usage.prompt_tokens,
                "output_tokens": response.usage.completion_tokens,
            },
            "parse_ok": len(asks) > 0,
        }
    ENGINE["run_router"] = tolerant_run_router


def upper_set(values) -> set[str]:
    return {str(v).strip().upper() for v in (values or []) if str(v).strip()}


def lower_set(values) -> set[str]:
    return {str(v).strip().lower() for v in (values or []) if str(v).strip()}


def score_router_case(case: dict, plan: list[dict]) -> tuple[float, dict]:
    expected = case.get("expected_plan", []) or []

    expected_tables = Counter(ask["table"] for ask in expected if ask.get("table"))
    actual_tables = Counter(ask.get("table") for ask in plan if ask.get("table"))
    expected_tickers = upper_set(t for ask in expected for t in ask.get("tickers", []))
    actual_tickers = upper_set(t for ask in plan for t in ask.get("tickers", []))
    expected_ratios = lower_set(r for ask in expected for r in ask.get("ratio_names", []))
    actual_ratios = lower_set(r for ask in plan for r in ask.get("ratio_names", []))
    expected_stmts = lower_set(s for ask in expected for s in ask.get("statement_types", []))
    actual_stmts = lower_set(s for ask in plan for s in ask.get("statement_types", []))
    expected_concepts = lower_set(c for ask in expected for c in ask.get("concepts", []))
    actual_concepts = lower_set(c for ask in plan for c in ask.get("concepts", []))
    expected_industry = next((ask.get("industry") for ask in expected if ask.get("industry")), None)
    actual_industries = lower_set(ask.get("industry") for ask in plan if ask.get("industry"))

    score = 0.0
    breakdown = {}

    if plan:
        score += 1.0
        breakdown["plan_nonempty"] = 1.0

    table_match = sum(min(actual_tables.get(t, 0), expected_tables.get(t, 0)) for t in expected_tables)
    table_total = sum(expected_tables.values())
    table_score = 2.0 * (table_match / table_total) if table_total else 0.0
    score += table_score
    breakdown["tables"] = round(table_score, 2)

    if expected_tickers:
        ticker_score = 2.0 * len(expected_tickers & actual_tickers) / len(expected_tickers)
        score += ticker_score
        breakdown["tickers"] = round(ticker_score, 2)
    else:
        breakdown["tickers"] = "n/a"

    if expected_ratios:
        ratio_score = 1.5 * len(expected_ratios & actual_ratios) / len(expected_ratios)
        score += ratio_score
        breakdown["ratio_names"] = round(ratio_score, 2)
    else:
        breakdown["ratio_names"] = "n/a"

    if expected_stmts:
        stmt_score = 1.5 * len(expected_stmts & actual_stmts) / len(expected_stmts)
        score += stmt_score
        breakdown["statement_types"] = round(stmt_score, 2)
    else:
        breakdown["statement_types"] = "n/a"

    if expected_concepts:
        if expected_concepts & actual_concepts:
            score += 1.0
            breakdown["concepts"] = 1.0
        else:
            breakdown["concepts"] = 0.0
    else:
        breakdown["concepts"] = "n/a"

    if expected_industry:
        if expected_industry.lower() in actual_industries:
            score += 1.0
            breakdown["industry"] = 1.0
        else:
            breakdown["industry"] = 0.0
    else:
        breakdown["industry"] = "n/a"

    plan_size_delta = abs(len(plan) - len(expected))
    if plan_size_delta == 0 and plan:
        score += 0.5
        breakdown["plan_size"] = 0.5
    elif plan_size_delta == 1:
        breakdown["plan_size"] = 0.0
    else:
        score -= 0.25 * (plan_size_delta - 1)
        breakdown["plan_size"] = round(-0.25 * (plan_size_delta - 1), 2)

    diag = {
        "expected_plan_size": len(expected),
        "actual_plan_size": len(plan),
        "expected_tables": dict(expected_tables),
        "actual_tables": dict(actual_tables),
        "missing_tickers": sorted(expected_tickers - actual_tickers),
        "extra_tickers": sorted(actual_tickers - expected_tickers),
        "missing_ratio_names": sorted(expected_ratios - actual_ratios),
        "missing_statement_types": sorted(expected_stmts - actual_stmts),
        "missing_concepts": sorted(expected_concepts - actual_concepts),
        "expected_industry": expected_industry,
        "actual_industries": sorted(actual_industries),
        "score_breakdown": breakdown,
    }
    return round(score, 3), diag


def classify_router_failure(case: dict, plan: list[dict], diag: dict) -> str | None:
    if not plan:
        return "router_empty_plan"
    if diag["missing_tickers"]:
        return "missing_tickers"
    if diag["expected_tables"] != diag["actual_tables"]:
        return "table_mismatch"
    if diag["missing_ratio_names"]:
        return "missing_ratios"
    if diag["missing_statement_types"]:
        return "missing_statement_types"
    if diag.get("missing_concepts") and any(case_ask.get("concepts") for case_ask in case.get("expected_plan", [])):
        return "missing_concepts"
    return None


def run_case(case: dict) -> dict:
    start = datetime.now(UTC)
    try:
        router_result = ENGINE["run_router"](case["query"])
        plan = router_result.get("plan", [])
        score, diag = score_router_case(case, plan)
        failure_class = classify_router_failure(case, plan, diag)
        return {
            "qid": case["qid"],
            "query": case["query"],
            "expected_plan": case["expected_plan"],
            "actual_plan": plan,
            "score": score,
            "failure_class": failure_class,
            "review": diag,
            "usage": router_result.get("usage", {}),
            "raw_content": router_result.get("raw_content", ""),
            "status": "ok",
            "started_at": start.isoformat(),
            "finished_at": datetime.now(UTC).isoformat(),
        }
    except Exception as exc:
        return {
            "qid": case["qid"],
            "query": case["query"],
            "expected_plan": case.get("expected_plan", []),
            "actual_plan": [],
            "score": 0.0,
            "failure_class": "runner_exception",
            "review": {"error": str(exc)},
            "status": "error",
            "started_at": start.isoformat(),
            "finished_at": datetime.now(UTC).isoformat(),
            "traceback": traceback.format_exc(),
        }


def select_cases(cases: list[dict], ids: set[str], limit: int) -> list[dict]:
    selected = [c for c in cases if not ids or c["qid"] in ids]
    if limit > 0:
        selected = selected[:limit]
    return selected


def timestamp_dir() -> Path:
    return OUTPUT_ROOT / datetime.now().strftime("%Y-%m-%dT%H-%M-%S")


def write_json(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n")


def aggregate_results(results: list[dict]) -> dict:
    failures = Counter()
    by_status = Counter()
    scores = []
    for r in results:
        by_status[r["status"]] += 1
        if r.get("failure_class"):
            failures[r["failure_class"]] += 1
        scores.append(float(r.get("score", 0.0)))
    return {
        "total_cases": len(results),
        "avg_score": (sum(scores) / len(scores)) if scores else 0.0,
        "max_possible": 9.5,
        "by_status": dict(by_status),
        "failure_classes": dict(failures),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run router gold evaluation against engine_colab runtime.")
    parser.add_argument("--gold", default=str(ROUTER_GOLD_PATH))
    parser.add_argument("--out-dir", default="")
    parser.add_argument("--max-workers", type=int, default=12)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--ids", default="")
    args = parser.parse_args()

    gold_path = Path(args.gold).resolve()
    out_dir = Path(args.out_dir).resolve() if args.out_dir else timestamp_dir()
    out_dir.mkdir(parents=True, exist_ok=True)

    selected_ids = {item.strip() for item in args.ids.split(",") if item.strip()}
    cases = select_cases(json.loads(gold_path.read_text()), selected_ids, args.limit)
    if not cases:
        raise SystemExit("No router gold cases selected.")

    max_workers = len(cases) if args.max_workers == 0 else max(1, min(args.max_workers, len(cases)))
    write_json(out_dir / "manifest.json", {
        "gold_path": str(gold_path),
        "selected_cases": len(cases),
        "max_workers": max_workers,
        "created_at": datetime.now(UTC).isoformat(),
    })

    results = []
    with ProcessPoolExecutor(max_workers=max_workers, initializer=init_worker) as pool:
        future_map = {pool.submit(run_case, case): case["qid"] for case in cases}
        for future in as_completed(future_map):
            result = future.result()
            results.append(result)
            write_json(out_dir / f"{result['qid']}.json", result)
            print(f"[{result['status']}] {result['qid']} score={result['score']:.2f} failure={result.get('failure_class')}")

    results.sort(key=lambda item: item["qid"])
    write_json(out_dir / "results.json", results)
    aggregate = aggregate_results(results)
    write_json(out_dir / "aggregate.json", aggregate)

    print("\nSummary")
    print(f"  Output dir: {out_dir}")
    print(f"  Cases:      {aggregate['total_cases']}")
    print(f"  Avg score:  {aggregate['avg_score']:.2f} / {aggregate['max_possible']}")
    print(f"  Status:     {aggregate['by_status']}")
    print(f"  Failures:   {aggregate['failure_classes']}")


if __name__ == "__main__":
    main()
