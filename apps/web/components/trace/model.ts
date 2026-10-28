// Shared, presentation-agnostic trace model. Maps the owner-accessible trace
// payload from GET /api/admin/traces/:engineId — { engine, router[], lanes[],
// analyst[], sources[] } — into the stage/card shape the user-facing TraceView
// renders (the same shape as design-mocks/trace-source-display.html).

export type TraceStageId = 'plan' | 'retrieve' | 'compute' | 'write' | 'verify';
export type StageTone = 'neutral' | 'warn' | 'bad';

export type TraceCard = {
  title: string;
  subtitle?: string;
  badges?: string[];
  rows?: [string, string][];
  code?: string;
  table?: string[][];
  tableNote?: string;
  csv?: string;
  answer?: string;
  source?: string;
  // Labeled preformatted text sections (e.g. system prompt, the assembled
  // AnalystContext the model received). `open` shows it expanded by default.
  blocks?: { label: string; text: string; open?: boolean }[];
  defaultOpen?: boolean;
  raw?: unknown;
};

export type TraceStage = {
  id: TraceStageId;
  label: string;
  note: string;
  count: number;
  tone: StageTone;
  cards: TraceCard[];
};

export type UserTrace = {
  query: string;
  status: string;
  runStats: { duration: string; lanes: number; sources: number };
  stages: TraceStage[];
};

type AnyRecord = Record<string, any>;

export function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function preview(text: unknown, max = 140): string {
  const value = String(text ?? '').trim().replace(/\s+/g, ' ');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function unique(values: Array<unknown>): string[] {
  return [...new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean))];
}

function toolEvents(messages: any[]): Array<{ name: string; detail: string }> {
  const events: Array<{ name: string; detail: string }> = [];
  for (const message of asArray(messages)) {
    for (const call of asArray(message?.tool_calls)) {
      events.push({ name: String(call?.function?.name || 'tool_call'), detail: String(call?.function?.arguments || '') });
    }
    if (message?.role === 'tool') {
      events.push({ name: String(message?.name || 'tool_result'), detail: String(message?.content || '') });
    }
  }
  return events;
}

function laneArtifact(lane: AnyRecord): AnyRecord {
  return lane?.artifact || {};
}
function laneCoverage(lane: AnyRecord): AnyRecord {
  return laneArtifact(lane)?.coverage || lane?.analysis_attachment?.coverage || {};
}
function laneAskObject(lane: AnyRecord): AnyRecord {
  return laneArtifact(lane)?.askObject || {};
}

function isDataAttachment(value: unknown): value is AnyRecord {
  const record = value as AnyRecord;
  return !!record && typeof record === 'object' && (
    record.type === 'table'
    || Array.isArray(record.rows)
    || typeof record.csv === 'string'
  );
}

function attachmentKey(table: AnyRecord): string {
  return String(table?.id || table?.title || table?.name || table?.summary || JSON.stringify(table?.headers || []));
}

function uniqueAttachments(tables: unknown[]): AnyRecord[] {
  const seen = new Set<string>();
  const result: AnyRecord[] = [];
  for (const table of tables) {
    if (!isDataAttachment(table)) continue;
    const key = attachmentKey(table);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(table);
  }
  return result;
}

function sourcePreviewOf(source: AnyRecord): AnyRecord {
  return source?.preview || source || {};
}

export function sourceTitle(source: AnyRecord): string {
  const p = sourcePreviewOf(source);
  const ticker = p?.ticker || source?.ticker || '';
  const period = p?.filingPeriod || source?.filing_period || p?.filingYear || source?.filing_year || '';
  const page = p?.pageNumber ?? source?.page_number;
  return `${ticker} ${period}${page ? ` · p.${page}` : ''}`.trim() || 'Source';
}

export function sourceHref(source: AnyRecord): string {
  const p = sourcePreviewOf(source);
  return p?.pdfUrl || p?.pageUrl || p?.sourceUrl || p?.url || source?.source_url || source?.url || p?.thumbnailUrl || '';
}

function summarizeAsk(ask: AnyRecord) {
  const tickers = unique([...asArray(ask?.tickers), ...asArray(ask?.selected_tickers)]).slice(0, 8);
  const concepts = unique(asArray(ask?.concepts)).slice(0, 8);
  const tables = unique([ask?.table, ask?.table_name, ask?.surface, ...asArray(ask?.tables)]).slice(0, 4);
  const periods = unique([ask?.period, ask?.period_end, ask?.from_period, ask?.to_period, ...asArray(ask?.periods)]).slice(0, 6);
  return {
    label: String(ask?.kind || ask?.type || ask?.lane || ask?.table || ask?.table_name || 'ask'),
    goal: String(ask?.ask || ask?.question || ask?.description || ask?.intent || '').trim(),
    posture: String(ask?.posture || '').trim(),
    tickers,
    concepts,
    tables,
    periods,
  };
}

function durationLabel(ms: unknown): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

// The exact user message the analyst received — the assembled AnalystContext
// (USER QUERY + EXECUTION ARTIFACTS + COMPUTED DATA + SOURCES). Falls back to the
// last user-role message in the transcript.
function analystInsertedMessage(analyst: AnyRecord | null): string {
  const stored = String(analyst?.analyst_user_message_text || '').trim();
  if (stored) return stored;
  const messages = asArray(analyst?.messages);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user' && String(messages[i]?.content || '').trim()) {
      return String(messages[i].content);
    }
  }
  return '';
}

// The fixed section headers buildAnalystMessage emits. Used only to split the
// stored final user message for display — no semantic coupling: if the assembly
// changes, unknown text still renders under a fallback section.
const ANALYST_SECTION_HEADERS = [
  'USER QUERY', 'ANSWER SCOPE', 'FCFE ANSWER RULES', 'CONTEXT COVERAGE',
  'RETRIEVAL SUMMARY', 'OUT OF COVERAGE', 'MISSING SCOPE', 'APPLICABLE RULES',
  'DATA QUALITY WARNINGS', 'EVIDENCE INDEX', 'DATA', 'COMPUTED DATA', 'RETRIEVED DATA', 'CALCULATED DATA', 'SOURCES',
];

function parseAnalystSections(text: string): { label: string; text: string }[] {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  const sections: { label: string; text: string }[] = [];
  const preamble: string[] = [];
  let current: { label: string; text: string } | null = null;
  const normalizeLine = (line: string) => {
    const trimmed = line.trim();
    if (/^\[DATA\]$/i.test(trimmed)) return 'DATA';
    if (/^\[COMPUTED DATA\]$/i.test(trimmed)) return 'COMPUTED DATA';
    if (/^\[RETRIEVED DATA\]$/i.test(trimmed)) return 'RETRIEVED DATA';
    if (/^\[CALCULATED DATA\]$/i.test(trimmed)) return 'CALCULATED DATA';
    return trimmed;
  };
  for (const line of trimmed.split('\n')) {
    const normalizedLine = normalizeLine(line);
    const header = ANALYST_SECTION_HEADERS.find((h) => normalizedLine === h);
    if (header) {
      current = { label: header, text: '' };
      sections.push(current);
    } else if (current) {
      current.text += (current.text ? '\n' : '') + line;
    } else {
      preamble.push(line);
    }
  }
  for (const s of sections) s.text = s.text.trim();
  if (sections.length === 0) return [{ label: 'Final user message', text: trimmed }];
  if (preamble.join('').trim()) sections.unshift({ label: 'preamble', text: preamble.join('\n').trim() });
  return sections;
}

// Best-effort answer text: last assistant message in the analyst transcript.
function analystAnswer(analyst: AnyRecord | null, engine: AnyRecord): string {
  const direct = String(analyst?.answer_text || analyst?.final_answer || engine?.final_answer || engine?.answer || '').trim();
  if (direct) return direct;
  const messages = asArray(analyst?.messages);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'assistant' && String(messages[i]?.content || '').trim()) {
      return String(messages[i].content);
    }
  }
  return '';
}

// Try to coerce a computed table into [headerRow, ...rows]; otherwise return null.
function computedTableGrid(table: AnyRecord): string[][] | null {
  const columns = asArray<string>(table?.columns).map((c) => String(c));
  const fallbackColumns = asArray<string>(table?.headers).map((c) => String(c));
  const resolvedColumns = columns.length > 0 ? columns : fallbackColumns;
  const rows = asArray<any>(table?.rows);
  if (resolvedColumns.length > 0 && rows.length > 0) {
    const body = rows.slice(0, 12).map((r) => {
      if (Array.isArray(r)) return r.map((c) => String(c ?? ''));
      if (r && typeof r === 'object') return resolvedColumns.map((c) => String((r as AnyRecord)[c] ?? ''));
      return [String(r ?? '')];
    });
    if (body.length > 0 && body.every((row) => row.length > 0)) return [resolvedColumns, ...body];
    return null;
  }
  if (rows.length > 0 && resolvedColumns.length === 0 && rows[0] && typeof rows[0] === 'object' && !Array.isArray(rows[0])) {
    const keys = Object.keys(rows[0] as AnyRecord);
    if (keys.length > 0) {
      const body = rows.slice(0, 12).map((r) => {
        const record = r as AnyRecord;
        return keys.map((key) => String(record?.[key] ?? ''));
      });
      return [keys, ...body];
    }
  }
  return null;
}

function computedTableCsv(table: AnyRecord): string {
  const direct = String(table?.csv || '').trim();
  if (direct) return direct;

  const columns = asArray<string>(table?.columns).map((c) => String(c));
  const fallbackColumns = asArray<string>(table?.headers).map((c) => String(c));
  const headers = columns.length > 0 ? columns : fallbackColumns;
  const rows = asArray<any>(table?.rows);
  if (headers.length === 0 || rows.length === 0) return '';

  const escapeCsv = (value: unknown) => {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => {
      if (Array.isArray(row)) return row.map(escapeCsv).join(',');
      if (row && typeof row === 'object') return headers.map((header) => escapeCsv((row as AnyRecord)[header])).join(',');
      return escapeCsv(row);
    }),
  ];
  return lines.join('\n');
}

function compactJson(value: unknown): string {
  const text = formatJson(value);
  return text.length > 6000 ? `${text.slice(0, 6000)}\n... truncated in card; use Raw JSON for the full object.` : text;
}

function artifactBlocks(art: AnyRecord): NonNullable<TraceCard['blocks']> {
  const blocks: NonNullable<TraceCard['blocks']> = [];
  const askParts = [
    art?.table ? `table: ${art.table}` : '',
    art?.ask ? `ask: ${art.ask}` : '',
    art?.askObject ? `ask_object:\n${compactJson(art.askObject)}` : '',
  ].filter(Boolean);
  if (askParts.length > 0) blocks.push({ label: 'runtime input', text: askParts.join('\n\n'), open: true });

  const finalQueries = asArray<string>(art?.finalQueries).map((query) => String(query || '').trim()).filter(Boolean);
  if (finalQueries.length > 0) blocks.push({ label: 'runtime query/code', text: finalQueries.join('\n\n'), open: true });

  const outputParts = [
    art?.resultSummary || art?.result_summary || art?.summary ? String(art?.resultSummary || art?.result_summary || art?.summary) : '',
    art?.analysisAttachment ? `analysis table: ${art.analysisAttachment.title || art.analysisAttachment.id || 'table'} (${asArray(art.analysisAttachment.rows).length} rows)` : '',
    asArray(art?.provenanceIds).length > 0 ? `provenance ids: ${asArray(art.provenanceIds).join(', ')}` : '',
    asArray(art?.narrativeIds).length > 0 ? `narrative ids: ${asArray(art.narrativeIds).join(', ')}` : '',
  ].filter(Boolean);
  if (outputParts.length > 0) blocks.push({ label: 'runtime output', text: outputParts.join('\n'), open: true });

  if (art?.coverage && Object.keys(art.coverage).length > 0) {
    blocks.push({ label: 'coverage / row flow', text: compactJson(art.coverage), open: true });
  }

  const extractions = asArray<AnyRecord>(art?.narrativeExtractions);
  if (extractions.length > 0) {
    const sample = extractions.slice(0, 6).map((item, index) => (
      `#${index + 1} page_id=${item?.page_id ?? '-'}\n${String(item?.extracted_text || '').trim()}`
    )).join('\n\n---\n\n');
    const suffix = extractions.length > 6 ? `\n\n... ${extractions.length - 6} more extraction(s); use Raw JSON for the full list.` : '';
    blocks.push({ label: 'extracted output', text: `${sample}${suffix}`, open: true });
  }

  if (blocks.length === 0) blocks.push({ label: 'artifact payload', text: compactJson(art), open: true });
  return blocks;
}

function artifactDisplayTitle(art: AnyRecord): string {
  const variable = String(art?.variable || '').trim();
  const ask = String(art?.ask || '').trim();
  const summary = String(art?.resultSummary || art?.result_summary || art?.summary || '').trim();
  if (ask) return preview(ask, 90);
  if (summary) return preview(summary.replace(/:\s*\d+\s*(rows|pages|extractions).*$/i, ''), 90);
  if (variable && !/^q\d+$/i.test(variable)) return variable;
  return 'Execution artifact';
}

function artifactKind(art: AnyRecord): { badge: string; note: string } {
  const table = String(art?.table || '');
  if (["model_build", "roic_screen", "dividend_yield_screen"].includes(table)) {
    return { badge: 'deterministic compute', note: 'code-generated calculation' };
  }
  if (art?.analysisAttachment) return { badge: 'retrieved table', note: 'SQL/table result packaged for AnalystContext' };
  if (asArray(art?.narrativeExtractions).length > 0) return { badge: 'extracted evidence', note: 'source pages extracted for AnalystContext' };
  if (asArray(art?.narrativeIds).length > 0) return { badge: 'retrieved pages', note: 'source-page retrieval artifact' };
  return { badge: 'retrieval artifact', note: 'runtime evidence summary' };
}

export function buildUserTrace(detail: AnyRecord | null): UserTrace {
  const engine: AnyRecord = detail?.engine || {};
  if (detail?.research) {
    const report = detail.research;
    const sections = asArray(report.sections);
    const evidence = asArray(report.evidence);
    const stages: TraceStage[] = [
      {id:'plan',label:'Questions',note:'The scope and independent questions selected for this answer.',count:sections.length,tone:'neutral',cards:sections.map(s=>({title:s.title,subtitle:s.question,badges:[s.status],raw:s}))},
      {id:'retrieve',label:'Research',note:'Actual source searches, page reads and dated market snapshots.',count:asArray(report.events).length,tone:'neutral',cards:asArray(report.events).map(e=>({title:e.tool,subtitle:e.error || `${e.count} results · ${e.sectionId}`,badges:e.error?['failed']:[],raw:e}))},
      {id:'write',label:'Sections',note:'Each answer section is written from its own source evidence.',count:sections.length,tone:'neutral',cards:sections.map(s=>({title:s.title,answer:s.markdown,badges:[s.status],raw:s}))},
      {id:'verify',label:'Sources',note:'Open the original pages and inspect the Markdown provided to the model.',count:evidence.length,tone:'neutral',cards:evidence.map(e=>({title:sourceTitle(e.source),source:sourceHref(e.source),blocks:[{label:'Source Markdown',text:e.text}],raw:e.source}))},
    ];
    return {query:String(engine.query || report.query),status:String(engine.status || ''),runStats:{duration:durationLabel(engine.duration_ms),lanes:sections.length,sources:evidence.length},stages};
  }
  const routers = asArray(detail?.router);
  const lanes = asArray(detail?.lanes);
  const analyst = asArray(detail?.analyst)[0] || null;
  const laneArtifacts = lanes.map((lane) => laneArtifact(lane)).filter((artifact) => Object.keys(artifact).length > 0);
  const computedTables = uniqueAttachments([
    ...asArray(analyst?.computed_tables),
    ...laneArtifacts.map((artifact) => artifact?.analysisAttachment),
    ...lanes.map((lane) => lane?.analysis_attachment),
  ]);
  const executionArtifacts = asArray(analyst?.execution_artifacts).length > 0
    ? asArray(analyst?.execution_artifacts)
    : laneArtifacts;
  const sources = asArray(detail?.sources);

  // ── plan ──────────────────────────────────────────────────────────────────
  const planCards: TraceCard[] = [];
  for (const router of routers) {
    for (const ask of asArray(router?.asks)) {
      const s = summarizeAsk(ask);
      const rows: [string, string][] = [];
      if (s.tables.length) rows.push(['table', s.tables.join(', ')]);
      if (s.tickers.length) rows.push(['tickers', s.tickers.join(', ')]);
      if (s.concepts.length) rows.push(['concepts', s.concepts.join(', ')]);
      if (s.periods.length) rows.push(['periods', s.periods.join(', ')]);
      planCards.push({
        title: s.label,
        subtitle: s.goal ? preview(s.goal) : 'typed retrieval ask',
        badges: ['router', s.posture].filter(Boolean) as string[],
        rows,
        raw: ask,
      });
    }
  }
  if (planCards.length === 0 && routers.length > 0) {
    planCards.push({ title: 'Router', subtitle: 'typed asks', raw: routers });
  }

  // ── retrieve ────────────────────────────────────────────────────────────────
  const retrieveCards: TraceCard[] = lanes.map((lane) => {
    const artifact = laneArtifact(lane);
    const coverage = laneCoverage(lane);
    const tools = unique(toolEvents(asArray(lane?.message_history)).map((t) => t.name)).filter((n) => n !== 'submit');
    const sqlList = asArray<string>(lane?.sql_queries).map((q) => String(q)).filter(Boolean);
    const provenance = asArray(lane?.provenance_ids);
    const narrative = asArray(lane?.narrative_ids);
    const selectedTickers = unique([...asArray(artifact?.selected_tickers), ...asArray(coverage?.selected_tickers)]);
    const rows: [string, string][] = [];
    if (lane?.lane_variable) rows.push(['variable', String(lane.lane_variable)]);
    if (selectedTickers.length) rows.push(['tickers', selectedTickers.join(', ')]);
    if (provenance.length) rows.push(['provenance pages', String(provenance.length)]);
    if (narrative.length) rows.push(['narrative pages', String(narrative.length)]);
    const badges = [String(lane?.table_name || 'lane'), ...tools.slice(0, 3)].filter(Boolean);
    const failed = /failed|error|unsupported|not implemented/i.test(String(lane?.result_summary || ''));
    if (failed) badges.push('failed');
    return {
      title: String(lane?.table_name || lane?.lane_variable || 'lane'),
      subtitle: preview(lane?.result_summary) || 'retrieval lane',
      badges,
      rows,
      code: sqlList[0] || undefined,
      raw: { artifact: lane?.artifact, coverage, sql_queries: sqlList, provenance_ids: provenance, narrative_ids: narrative },
    };
  });

  // ── compute ──────────────────────────────────────────────────────────────────
  const computeCards: TraceCard[] = [];
  for (const table of computedTables) {
    const grid = computedTableGrid(table);
    const csv = computedTableCsv(table);
    const rowCount = asArray(table?.rows).length;
    computeCards.push({
      title: String(table?.title || table?.name || 'computed table'),
      subtitle: preview(table?.description) || `${rowCount} rows`,
      badges: ['table', `${rowCount} rows`],
      table: grid || undefined,
      tableNote: grid && rowCount > 12 ? `Previewing 12 of ${rowCount} rows. Full stored CSV is shown below.` : undefined,
      csv: csv || undefined,
      rows: grid ? undefined : [['rows', String(rowCount)]],
      raw: table,
    });
  }
  for (const art of executionArtifacts) {
    const finalQueries = asArray(art?.finalQueries).map((query) => String(query || '').trim()).filter(Boolean);
    const kind = artifactKind(art);
    const rows: [string, string][] = [];
    if (art?.variable) rows.push(['trace id', String(art.variable)]);
    if (art?.table) rows.push(['table', String(art.table)]);
    rows.push(['role', kind.note]);
    if (finalQueries.length > 0) rows.push(['queries', String(finalQueries.length)]);
    if (asArray(art?.provenanceIds).length > 0) rows.push(['provenance', String(asArray(art.provenanceIds).length)]);
    if (asArray(art?.narrativeIds).length > 0) rows.push(['pages', String(asArray(art.narrativeIds).length)]);
    if (asArray(art?.narrativeExtractions).length > 0) rows.push(['extractions', String(asArray(art.narrativeExtractions).length)]);
    if (art?.analysisAttachment) rows.push(['table output', `${asArray(art.analysisAttachment.rows).length} rows`]);
    computeCards.push({
      title: artifactDisplayTitle(art),
      subtitle: preview(art?.result_summary || art?.resultSummary || art?.summary) || 'deterministic compute',
      badges: ['artifact', kind.badge],
      rows,
      blocks: artifactBlocks(art),
      defaultOpen: false,
      raw: art,
    });
  }

  // ── write ────────────────────────────────────────────────────────────────────
  // Read the stored payload (analyst.messages / analyst_user_message_text /
  // system_prompt_text / model) — exactly what was sent to the analyst model.
  const answer = analystAnswer(analyst, engine);
  const writeCards: TraceCard[] = [];
  if (answer) {
    writeCards.push({
      title: 'Final answer',
      subtitle: 'what the analyst model returned',
      badges: ['answer'],
      answer,
      raw: { answer_text: answer },
    });
  }
  if (analyst) {
    const model = String(analyst?.model || '').trim();
    const messages = asArray(analyst?.messages);
    const systemPrompt = String(analyst?.system_prompt_text || '').trim();
    const finalUser = analystInsertedMessage(analyst);
    const contextLines = messages
      .filter((message) => message?.role === "user" || message?.role === "assistant")
      .map((message) => ({
        role: String(message?.role || '').trim(),
        content: String(message?.content || '').trim(),
      }))
      .filter((entry) => entry.content);
    const priorContext = contextLines.filter((entry) =>
      !(entry.role === "user" && entry.content === finalUser),
    ).map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`).join('\n\n');
    const blocks: NonNullable<TraceCard['blocks']> = [];
    if (systemPrompt) blocks.push({ label: 'system prompt', text: systemPrompt });
    if (priorContext.trim()) blocks.push({ label: 'prior conversation context', text: priorContext });
    const mapSectionLabel = (label: string) => {
      if (label === 'RETRIEVAL SUMMARY') return 'retrieval summary';
      if (label === 'OUT OF COVERAGE') return 'missing coverage';
      if (label === 'MISSING SCOPE') return 'missing scope';
      if (label === 'CONTEXT COVERAGE') return 'coverage notes';
      if (label === 'DATA QUALITY WARNINGS') return 'data quality notes';
      if (label === 'EVIDENCE INDEX') return 'evidence index';
      if (label === 'USER QUERY') return 'query and intent';
      if (label === 'ANSWER SCOPE') return 'answer scope';
      if (label === 'APPLICABLE RULES') return 'applicable rules';
      if (label === 'FCFE ANSWER RULES') return 'fcfe constraints';
      if (label === 'RETRIEVED DATA') return 'retrieved tables';
      if (label === 'CALCULATED DATA') return 'forecast / calculated tables';
      if (label === 'COMPUTED DATA' || label === 'DATA') return 'structured tables';
      if (label === 'SOURCES') return 'narrative sources';
      return `input packet: ${label.toLowerCase()}`;
    };
    for (const section of parseAnalystSections(finalUser)) {
      if (section.label === 'DATA' && !section.text.trim()) continue;
      const label = mapSectionLabel(section.label);
      blocks.push({ label, text: section.text });
    }
    const rows: [string, string][] = [];
    if (model) rows.push(['model', model]);
    const inTok = Number(analyst?.input_tokens);
    const outTok = Number(analyst?.output_tokens);
    if (Number.isFinite(inTok) && inTok > 0) rows.push(['tokens', `${inTok.toLocaleString()} in · ${(Number.isFinite(outTok) ? outTok : 0).toLocaleString()} out`]);
    rows.push(['messages sent', String(messages.length || ((systemPrompt ? 1 : 0) + (finalUser ? 1 : 0)))]);
    const citationTrace = analyst?.citation_trace || analyst?.citationTrace;
    if (citationTrace) {
      const acceptedSources = asArray(citationTrace?.acceptedSourceTags || citationTrace?.accepted_source_tags);
      const acceptedTables = asArray(citationTrace?.acceptedTableTags || citationTrace?.accepted_table_tags);
      rows.push(['accepted source tags', acceptedSources.length ? acceptedSources.join(', ') : 'none']);
      rows.push(['accepted table tags', acceptedTables.length ? acceptedTables.join(', ') : 'none']);
      blocks.push({ label: 'citation tag selection', text: compactJson(citationTrace), open: true });
    }
    writeCards.push({
      title: 'The analyst LLM call',
      subtitle: 'The exact payload sent to the analyst model, read from the stored trace and split into its sections. It receives computed tables as CSV and source text — not the SQL or raw rows.',
      badges: ['payload', model].filter(Boolean),
      rows,
      blocks,
      raw: messages.length ? messages : { system: systemPrompt, user: finalUser },
    });
  }

  // ── verify ───────────────────────────────────────────────────────────────────
  const verifyCards: TraceCard[] = sources.slice(0, 40).map((source) => {
    const p = sourcePreviewOf(source);
    const stage = String(source?.selection_stage || '');
    const badges = [String(p?.sourceType || source?.source_kind || 'source')];
    if (stage) badges.push(stage);
    const rows: [string, string][] = [];
    if (source?.id != null) rows.push(['source_id', String(source.id)]);
    if (stage) rows.push(['selection', stage]);
    return {
      title: sourceTitle(source),
      subtitle: preview(p?.snippet) || 'cited source page',
      badges,
      source: sourceHref(source) || undefined,
      rows,
      raw: source,
    };
  });

  const flagFailure = lanes.some((l) => /failed|error|unsupported|not implemented/i.test(String(l?.result_summary || '')));
  const planTone: StageTone = String(engine?.status || 'done') !== 'done' ? 'bad' : 'neutral';

  const stages: TraceStage[] = [
    { id: 'plan', label: 'Plan', note: 'Typed asks', count: planCards.length, tone: planTone, cards: planCards },
    { id: 'retrieve', label: 'Retrieve', note: 'Evidence lanes', count: retrieveCards.length, tone: flagFailure ? 'bad' : 'neutral', cards: retrieveCards },
    { id: 'compute', label: 'Compute', note: 'Tables + artifacts', count: computeCards.length, tone: 'neutral', cards: computeCards },
    { id: 'write', label: 'Write', note: 'Answer synthesis', count: writeCards.length, tone: 'neutral', cards: writeCards },
    { id: 'verify', label: 'Verify', note: 'Source pages', count: verifyCards.length, tone: 'neutral', cards: verifyCards },
  ];

  return {
    query: String(engine?.query || ''),
    status: String(engine?.status || ''),
    runStats: { duration: durationLabel(engine?.duration_ms), lanes: lanes.length, sources: sources.length },
    stages,
  };
}
