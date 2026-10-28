// Direct source-page publisher. No financial_statements, ratios, normalization or derived periods.
// node scripts/build-research-index.mjs INPUT.json OUTPUT_DIR
// Input: array of filing page rows from document publication (id/ticker/jpg_path/text/metadata).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error("Provide input page JSON and output directory.");
const out = resolve(output);
await mkdir(out, { recursive: true });
const vars = Object.fromEntries(
  (
    await readFile(new URL("../.dev.vars", import.meta.url), "utf8").catch(
      () => "",
    )
  )
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i),
        l
          .slice(i + 1)
          .trim()
          .replace(/^"|"$/g, ""),
      ];
    }),
);
const key = process.env.GEMINI_API_KEY || vars.GEMINI_API_KEY;
if (!key)
  throw new Error("Set GEMINI_API_KEY or configure apps/analysis/.dev.vars.");
const pages = JSON.parse(await readFile(input, "utf8"));
const metrics = ["deposits", "total_assets", "total_equity"];
const records = [],
  failures = [];
const quote = (v) =>
  v === null || v === undefined
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : "'" + String(v).replaceAll("'", "''") + "'";
async function run(page) {
  const cache = `${out}/${page.id}.json`;
  const inputHash = createHash("sha256")
    .update(JSON.stringify(page))
    .digest("hex");
  let facts;
  try {
    facts = JSON.parse(await readFile(cache, "utf8"));
    if (facts.publisher_version !== 2 || facts.input_hash !== inputHash)
      throw new Error("refresh");
  } catch {
    const pdfUrl = `https://source.psxgpt.com/PDF_PAGES/${page.jpg_path.replace(/\.jpg$/, ".pdf")}`;
    const pdf = await fetch(pdfUrl, { signal: AbortSignal.timeout(25000) });
    if (!pdf.ok) throw new Error(`Source PDF HTTP ${pdf.status}`);
    const bytes = Buffer.from(await pdf.arrayBuffer());
    const prompt = `Read this ORIGINAL filing page for ${page.ticker}. Copy only reported balance sheet totals: deposits (the total Deposits and other accounts, not customer-only subcategories), total_assets, total_equity. No components, ratios, arithmetic, inferred totals or scale repairs. Use the latest date PRINTED in the statement, not an assumed date. Identify standalone (unconsolidated) versus consolidated. If the total, date, scale or basis is ambiguous return null for it. Return JSON {statement_type:balance_sheet|changes_in_equity|note|other,heading:exact printed heading,period_end:YYYY-MM-DD,basis:unconsolidated|consolidated|unknown,currency:PKR|unknown,scale:1|1000|1000000|null,observations:[{metric:deposits|total_assets|total_equity,label:exact printed row label,printed_value:exact printed numeric text,value:number|null}],note:string}. Read only primary statement totals, not Islamic-segment or note subtotals. If not a primary balance sheet, observations must be empty. No private reasoning.`;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: "application/pdf",
                    data: bytes.toString("base64"),
                  },
                },
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0,
            maxOutputTokens: 2200,
          },
        }),
        signal: AbortSignal.timeout(60000),
      },
    );
    if (!res.ok) throw new Error(`Extraction HTTP ${res.status}`);
    const body = await res.json();
    facts = JSON.parse(
      body.candidates[0].content.parts
        .filter((p) => !p.thought)
        .map((p) => p.text || "")
        .join(""),
    );
    facts.publisher_version = 2;
    facts.input_hash = inputHash;
    await writeFile(cache, JSON.stringify(facts, null, 2));
  }
  for (const metric of metrics) {
    const observations = (facts.observations || []).filter(
      (r) => r.metric === metric,
    );
    const row = observations[0];
    const printed = row?.printed_value?.replaceAll(",", "").replace(/\s/g, "");
    const parsed = printed?.startsWith("(")
      ? -Number(printed.slice(1, -1))
      : Number(printed);
    const sourceText = page.text
      .replaceAll(",", "")
      .replace(/\s/g, "")
      .toLowerCase();
    const sourceMatch =
      sourceText.includes(String(printed).toLowerCase()) &&
      sourceText.includes(
        String(row?.label || "")
          .replace(/\s/g, "")
          .toLowerCase(),
      );
    const good =
      facts.statement_type === "balance_sheet" &&
      sourceMatch &&
      observations.length === 1 &&
      row?.label &&
      row?.value !== null &&
      Number.isFinite(row?.value) &&
      parsed === row.value &&
      facts.currency === "PKR" &&
      [1, 1000, 1000000].includes(facts.scale) &&
      /^\d{4}-\d{2}-\d{2}$/.test(facts.period_end) &&
      ["unconsolidated", "consolidated"].includes(facts.basis);
    if (!good) {
      failures.push({
        ticker: page.ticker,
        id: page.id,
        metric,
        reason: "Missing or ambiguous reported total",
        facts,
      });
      continue;
    }
    records.push({
      ticker: page.ticker,
      metric,
      period_end: facts.period_end,
      basis: facts.basis,
      value: row.value,
      scale: facts.scale,
      value_rupees: row.value * facts.scale,
      original_label: row.label,
      printed_value: row.printed_value,
      source_id: `filing:${page.id}`,
      source_url: `https://source.psxgpt.com/PDF_PAGES/${page.jpg_path.replace(/\.jpg$/, ".pdf")}`,
      source_text: page.text,
      status: "usable",
      reason: "",
      retrieved_at: new Date().toISOString(),
    });
  }
  console.log(
    JSON.stringify({
      ticker: page.ticker,
      page: page.pg,
      observations: records.filter((r) => r.source_id === `filing:${page.id}`)
        .length,
    }),
  );
}
for (let i = 0; i < pages.length; i += 3)
  await Promise.all(
    pages
      .slice(i, i + 3)
      .map((p) =>
        run(p).catch((e) =>
          failures.push({ ticker: p.ticker, id: p.id, reason: String(e) }),
        ),
      ),
  );
// Keep conflicting source observations: serving excludes duplicates instead of selecting a larger value.
const columns = [
  "ticker",
  "metric",
  "period_end",
  "basis",
  "value",
  "scale",
  "value_rupees",
  "original_label",
  "printed_value",
  "source_id",
  "source_url",
  "source_text",
  "status",
  "reason",
  "retrieved_at",
];
let sql = `CREATE TABLE IF NOT EXISTS research_aggregates (ticker TEXT NOT NULL,metric TEXT NOT NULL,period_end TEXT NOT NULL,basis TEXT NOT NULL,value REAL NOT NULL,scale INTEGER NOT NULL,value_rupees REAL NOT NULL,original_label TEXT NOT NULL,printed_value TEXT NOT NULL,source_id TEXT NOT NULL,source_url TEXT NOT NULL,source_text TEXT NOT NULL,status TEXT NOT NULL,reason TEXT NOT NULL,retrieved_at TEXT NOT NULL,PRIMARY KEY(ticker,metric,period_end,basis,source_id));\nCREATE INDEX IF NOT EXISTS research_aggregates_selection ON research_aggregates(metric,basis,period_end,ticker);\n`;
for (const page of pages)
  sql += `DELETE FROM research_aggregates WHERE source_id=${quote(`filing:${page.id}`)};\n`;
for (const row of records)
  sql += `INSERT INTO research_aggregates (${columns.join(",")}) VALUES (${columns.map((c) => quote(row[c])).join(",")});\n`;
await writeFile(`${out}/publish.sql`, sql);
await writeFile(`${out}/observations.json`, JSON.stringify(records, null, 2));
await writeFile(
  `${out}/coverage.json`,
  JSON.stringify(
    { inputPages: pages.length, observations: records.length, failures },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    out,
    observations: records.length,
    failures: failures.length,
    publish:
      "Not pushed. Inspect source fidelity and coverage before executing publish.sql.",
  }),
);
