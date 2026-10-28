import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, Database, ExternalLink, FileText, RefreshCw, Search, Wrench } from 'lucide-react';
import { API_BASE_URL } from '../hooks/useWebSocket';
import { useAuth } from '../hooks/useAuth';
import { Badge, Button, Input, ScrollArea } from './ui';
import { ThemeProvider, ThemeToggle } from './Theme';
import { cn } from '../types';
import { buildUserTrace } from './trace/model';
import { TraceView } from './trace/TraceView';

type TraceSummary = Record<string, any>;
type TraceDetail = Record<string, any>;
type TraceUser = {
  user_id?: string | null;
  user_email?: string | null;
  trace_count?: number;
  last_trace_at?: string;
};
type IssueSummary = {
  window_hours?: number;
  scanned?: Record<string, number>;
  issueCounts?: Array<{ key: string; count: number }>;
  tickerRequests?: Array<{ key: string; count: number }>;
  unresolvedTickerRequests?: Array<{ key: string; count: number }>;
  outOfUniverseRequests?: Array<{ key: string; count: number }>;
  evalSuggestions?: Array<Record<string, any>>;
  examples?: Array<Record<string, any>>;
};
type QualityFlag = {
  flag_id?: string;
  ticker?: string;
  severity?: 'warning' | 'blocker' | string;
  affected_table?: string | null;
  failed_stage?: string | null;
  origin_stage?: string | null;
  statement_type?: string | null;
  period_end?: string | null;
  period_duration?: string | null;
  section?: string | null;
  metric?: string | null;
  basis?: string | null;
  rule?: string | null;
  message?: string | null;
};
type QualityMatrixCell = {
  period_end: string;
  status: 'green' | 'yellow' | 'red';
  flags: QualityFlag[];
};
type QualityMatrix = {
  generatedAt?: string;
  periods?: string[];
  rows?: Array<{ ticker: string; status: 'green' | 'yellow' | 'red'; cells: QualityMatrixCell[] }>;
  summary?: {
    tickers?: number;
    periods?: number;
    greenCells?: number;
    yellowCells?: number;
    redCells?: number;
    flagCount?: number;
  };
};
type QualityTickerDetail = {
  ticker?: string;
  periods?: string[];
  cells?: QualityMatrixCell[];
  summary?: {
    status?: 'green' | 'yellow' | 'red';
    greenCells?: number;
    yellowCells?: number;
    redCells?: number;
    flagCount?: number;
  };
  statementCoverage?: Array<{
    period_end?: string;
    statement_type?: string;
    section?: string;
    period_duration?: string;
    rows?: number;
    source_files?: number;
  }>;
  documents?: Array<{
    filing_period?: string;
    filing_type?: string;
    filing_year?: string;
    pages?: number;
    first_page?: number;
    last_page?: number;
  }>;
};

const TRACE_ADMIN_EMAIL = 'isfandiyar.shaheen@gmail.com';
const ALL_USERS = '__all';
type TraceStageId = 'plan' | 'retrieve' | 'compute' | 'write' | 'verify';

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function preview(text: unknown, max = 160) {
  const value = String(text || '').trim();
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolEvents(messages: any[]) {
  const events: Array<{ name: string; detail: string }> = [];
  for (const message of messages) {
    for (const call of asArray(message?.tool_calls)) {
      events.push({
        name: String(call?.function?.name || 'tool_call'),
        detail: String(call?.function?.arguments || ''),
      });
    }
    if (message?.role === 'tool') {
      events.push({
        name: String(message?.name || 'tool_result'),
        detail: String(message?.content || ''),
      });
    }
  }
  return events;
}

function analystInsertedMessage(analyst: any): string {
  const stored = String(analyst?.analyst_user_message_text || '').trim();
  if (stored) return stored;
  const messages = asArray(analyst?.messages);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user' && String(message?.content || '').trim()) {
      return String(message.content);
    }
  }
  return '';
}

function sourcePreview(source: any) {
  return source?.preview || source;
}

function sourceTitle(source: any) {
  const preview = sourcePreview(source);
  const ticker = preview?.ticker || source?.ticker || '';
  const period = preview?.filingPeriod || source?.filing_period || preview?.filingYear || source?.filing_year || '';
  const page = preview?.pageNumber ?? source?.page_number;
  return `${ticker} ${period}${page ? ` p.${page}` : ''}`.trim() || 'Source';
}

function sourceHref(source: any) {
  const preview = sourcePreview(source);
  return preview?.pdfUrl || preview?.pageUrl || preview?.sourceUrl || preview?.url || source?.source_url || source?.url || preview?.thumbnailUrl || '';
}

function laneArtifact(lane: any) {
  return lane?.artifact || {};
}

function laneCoverage(lane: any) {
  return laneArtifact(lane)?.coverage || lane?.analysis_attachment?.coverage || null;
}

function laneAskObject(lane: any) {
  return laneArtifact(lane)?.askObject || null;
}

function summarizeAsk(ask: any) {
  const tickers = unique([...asArray(ask?.tickers), ...asArray(ask?.selected_tickers)]).slice(0, 8);
  const tables = unique([ask?.table, ask?.table_name, ask?.surface, ...asArray(ask?.tables)]).slice(0, 4);
  const periods = unique([ask?.period, ask?.period_end, ask?.from_period, ask?.to_period, ...asArray(ask?.periods)]).slice(0, 6);
  return {
    label: String(ask?.kind || ask?.type || ask?.lane || ask?.table || 'ask'),
    goal: String(ask?.ask || ask?.question || ask?.description || ask?.intent || '').trim(),
    tickers,
    tables,
    periods,
  };
}

function modelBuildSummary(lane: any) {
  const artifact = laneArtifact(lane);
  const coverage = laneCoverage(lane) || {};
  const askObject = laneAskObject(lane) || {};
  const reasoning = String(lane?.reasoning_text || '');
  const template = coverage.template_id
    || String(reasoning.match(/template=([^\n]+)/)?.[1] || '').trim()
    || (String(lane?.ask || '').match(/\b(bank|non_financial|holding_co)\b/)?.[1] || '');
  const ticker = asArray(artifact.selected_tickers)[0]
    || asArray(coverage.selected_tickers)[0]
    || asArray(askObject.tickers)[0]
    || String(reasoning.match(/ticker=([^\n]+)/)?.[1] || '').trim();
  const failed = /failed|not implemented|unsupported|error=/i.test(`${lane?.result_summary || ''}\n${reasoning}`);
  const tools = toolEvents(asArray(lane?.message_history)).filter((event) => !event.name.endsWith('_result'));
  return {
    template,
    ticker,
    failed,
    tools,
    status: failed ? 'failed' : (/updated|loaded|built/i.test(String(lane?.result_summary || '')) ? 'passed' : 'recorded'),
  };
}

function unique(values: Array<unknown>) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function traceAudit(detail: TraceDetail | null, selectedTrace: TraceSummary | null) {
  const lanes = asArray(detail?.lanes);
  const analyst = asArray(detail?.analyst)[0] || null;
  const computedTables = asArray(analyst?.computed_tables);
  const sources = asArray(detail?.sources);
  const flags: Array<{ type: string; label: string; severity: 'low' | 'medium' | 'high' }> = [];
  const laneSummaries = lanes.map((lane) => {
    const artifact = laneArtifact(lane);
    const coverage = laneCoverage(lane) || {};
    const askObject = laneAskObject(lane) || {};
    const tools = toolEvents(asArray(lane.message_history)).filter((event) => event.name !== 'submit');
    const outOfUniverse = unique([...asArray(artifact._out_of_universe), ...asArray(askObject._out_of_universe)]);
    const missingTickers = unique(asArray(coverage.missing_tickers));
    const selectedTickers = unique([...asArray(artifact.selected_tickers), ...asArray(coverage.selected_tickers), ...asArray(askObject.tickers)]);
    if (outOfUniverse.length > 0) flags.push({ type: 'coverage_gap', label: `Out of coverage: ${outOfUniverse.join(', ')}`, severity: 'medium' });
    if (missingTickers.length > 0) flags.push({ type: 'missing_ticker', label: `Missing ticker rows: ${missingTickers.join(', ')}`, severity: 'high' });
    if (artifact._missing_scope || askObject._missing_scope) flags.push({ type: 'missing_scope', label: String(artifact._missing_scope || askObject._missing_scope), severity: 'medium' });
    if (/failed|error|unsupported|not implemented/i.test(`${lane.result_summary || ''}`)) flags.push({ type: 'lane_failure', label: String(lane.result_summary || 'Lane issue'), severity: 'high' });
    return {
      table: lane.table_name,
      variable: lane.lane_variable,
      result: lane.result_summary,
      tools: unique(tools.map((tool) => tool.name)).slice(0, 8),
      selectedTickers,
      outOfUniverse,
      missingTickers,
    };
  });

  if (selectedTrace?.status && selectedTrace.status !== 'done') {
    flags.push({ type: 'run_status', label: `Run status: ${selectedTrace.status}`, severity: 'high' });
  }

  const evalIdeas = unique(flags.map((flag) => {
    if (flag.type === 'missing_ticker') return 'Add a multi-ticker coverage eval for this query shape.';
    if (flag.type === 'coverage_gap') return 'Add an unresolved ticker/entity eval that asserts no substitute SQL is used.';
    if (flag.type === 'lane_failure') return 'Replay this query in regression and assert the user-facing failure mode.';
    if (flag.type === 'missing_scope') return 'Add a scopeless-query eval that asks for clarification or returns no-data safely.';
    return '';
  }));

  return {
    status: flags.some((flag) => flag.severity === 'high') ? 'needs_review' : flags.length > 0 ? 'limited' : 'clean',
    flags,
    laneSummaries,
    tableCount: computedTables.length,
    sourceCount: sources.length || asArray(detail?.engine?.surfaced_sources).length || asArray(analyst?.sources).length,
    evalIdeas,
  };
}

export function AdminTracesApp() {
  const auth = useAuth();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [users, setUsers] = useState<TraceUser[]>([]);
  const [userFilter, setUserFilter] = useState(ALL_USERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [activeStage, setActiveStage] = useState<TraceStageId | null>(null);
  const [issueSummary, setIssueSummary] = useState<IssueSummary | null>(null);
  const [qualityMatrix, setQualityMatrix] = useState<QualityMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = String(auth.user?.email || '').trim().toLowerCase() === TRACE_ADMIN_EMAIL;
  const [traceViewMode, setTraceViewMode] = useState<'admin' | 'user'>('admin');
  const showAdminChrome = isAdmin && traceViewMode === 'admin';
  const isSignedIn = Boolean(auth.user);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await auth.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [auth.getToken]);

  const loadTraces = useCallback(async () => {
    if (!isSignedIn) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (query.trim()) params.set('q', query.trim());
      if (isAdmin && traceViewMode === 'user' && auth.user?.id) {
        params.set('user_id', String(auth.user.id));
      } else if (isAdmin && userFilter !== ALL_USERS) {
        params.set('user_id', userFilter);
      }
      const res = await fetch(`${API_BASE_URL}/api/admin/traces?${params}`, {
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load traces');
      const nextTraces = asArray<TraceSummary>(json.traces);
      setTraces(nextTraces);
      if (json.isAdmin) setUsers(asArray<TraceUser>(json.users));
      if (!nextTraces.some((trace) => String(trace.id) === selectedId)) {
        setSelectedId(nextTraces[0]?.id ? String(nextTraces[0].id) : null);
        if (!nextTraces[0]?.id) setDetail(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load traces');
    } finally {
      setLoading(false);
    }
  }, [auth.user?.id, authHeaders, isAdmin, isSignedIn, query, selectedId, traceViewMode, userFilter]);

  const loadDetail = useCallback(async (engineId: string) => {
    if (!isSignedIn) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/traces/${encodeURIComponent(engineId)}`, {
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load trace detail');
      setDetail(json.trace);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trace detail');
    }
  }, [authHeaders, isSignedIn]);

  const loadIssues = useCallback(async () => {
    if (!isSignedIn || !showAdminChrome) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/issues?hours=48&limit=250`, {
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load issue summary');
      setIssueSummary(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load issue summary');
    }
  }, [authHeaders, isSignedIn, showAdminChrome]);

  const loadQualityMatrix = useCallback(async () => {
    if (!isSignedIn || !showAdminChrome) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/data-quality/matrix?periods=12`, {
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load data quality matrix');
      setQualityMatrix(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data quality matrix');
    }
  }, [authHeaders, isSignedIn, showAdminChrome]);

  useEffect(() => {
    if (!auth.isLoading && isSignedIn) void loadTraces();
  }, [auth.isLoading, isSignedIn, userFilter, traceViewMode]);

  useEffect(() => {
    if (!auth.isLoading && isSignedIn && showAdminChrome) void loadIssues();
  }, [auth.isLoading, showAdminChrome, isSignedIn, loadIssues]);

  useEffect(() => {
    if (!auth.isLoading && isSignedIn && showAdminChrome) void loadQualityMatrix();
  }, [auth.isLoading, showAdminChrome, isSignedIn, loadQualityMatrix]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    setActiveStage(null);
  }, [selectedId, loadDetail]);

  const lanes = asArray(detail?.lanes);
  const analysts = asArray(detail?.analyst);
  const analyst = analysts[0] || null;
  const analystInputMessage = analystInsertedMessage(analyst);
  const computedTables = asArray(analysts[0]?.computed_tables);
  const executionArtifacts = asArray(analyst?.execution_artifacts);
  const modulesFired = asArray<any>(analyst?.modules_fired || analyst?.modulesFired);
  const sourceRows = asArray(detail?.sources);
  const surfacedSources = asArray(detail?.engine?.surfaced_sources);
  const analystSources = asArray(analyst?.sources);
  const selectedTrace = useMemo(
    () => traces.find((trace) => String(trace.id) === selectedId) || null,
    [traces, selectedId],
  );
  const audit = useMemo(() => traceAudit(detail, selectedTrace), [detail, selectedTrace]);
  const traceStages = useMemo(() => ([
    {
      id: 'plan' as const,
      label: 'Plan',
      note: audit.status === 'needs_review' ? 'Review route' : 'Typed asks',
      count: asArray(detail?.router).length,
      tone: audit.status === 'needs_review' ? 'bad' as const : audit.status === 'limited' ? 'warn' as const : 'neutral' as const,
    },
    {
      id: 'retrieve' as const,
      label: 'Retrieve',
      note: 'Evidence lanes',
      count: lanes.length,
      tone: audit.flags.some((flag) => flag.type === 'lane_failure') ? 'bad' as const : 'neutral' as const,
    },
    {
      id: 'compute' as const,
      label: 'Compute',
      note: 'Tables + artifacts',
      count: computedTables.length + executionArtifacts.length,
      tone: 'neutral' as const,
    },
    {
      id: 'write' as const,
      label: 'Write',
      note: 'Answer synthesis',
      count: analyst?.answer_text || analystInputMessage ? 1 : 0,
      tone: 'neutral' as const,
    },
    {
      id: 'verify' as const,
      label: 'Verify',
      note: 'Source pages',
      count: sourceRows.length || surfacedSources.length || analystSources.length,
      tone: audit.sourceCount > 0 ? 'good' as const : 'warn' as const,
    },
  ]), [analyst?.answer_text, analystInputMessage, analystSources.length, audit.flags, audit.sourceCount, audit.status, computedTables.length, detail?.router, executionArtifacts.length, lanes.length, sourceRows.length, surfacedSources.length]);

  return (
    <ThemeProvider>
      <div className="flex h-[var(--app-height,100vh)] flex-col bg-background text-foreground">
        <header className="border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                <h1 className="text-base font-semibold">Query Traces</h1>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {showAdminChrome ? 'Admin trace viewer' : 'Your query traces'} · {API_BASE_URL}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isAdmin ? (
                <div className="flex rounded-md border border-border bg-muted/40 p-0.5">
                  <button
                    type="button"
                    onClick={() => setTraceViewMode('user')}
                    className={cn(
                      'rounded px-2.5 py-1 text-xs font-medium transition',
                      traceViewMode === 'user' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    User view
                  </button>
                  <button
                    type="button"
                    onClick={() => setTraceViewMode('admin')}
                    className={cn(
                      'rounded px-2.5 py-1 text-xs font-medium transition',
                      traceViewMode === 'admin' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Admin
                  </button>
                </div>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => window.location.assign('/')}>Chat</Button>
              <ThemeToggle />
            </div>
          </div>
        </header>

        {!auth.isLoading && !isSignedIn ? (
          <main className="flex flex-1 items-center justify-center p-6">
            <div className="w-full max-w-md rounded-md border border-border p-5">
              <h2 className="text-base font-semibold">Sign in to view traces</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                You can view traces for your own queries. Admin accounts can switch between users.
              </p>
              <div className="mt-4 flex gap-2">
                <Button type="button" onClick={() => void auth.signInWithGoogle()}>Sign in</Button>
                <Button type="button" variant="outline" onClick={() => window.location.assign('/')}>Back to chat</Button>
              </div>
            </div>
          </main>
        ) : null}

        {auth.isLoading || !isSignedIn ? null : <main className="block flex-1 overflow-y-auto lg:grid lg:min-h-0 lg:grid-cols-[360px_1fr] lg:overflow-hidden">
          <section className="block border-b border-border lg:flex lg:min-h-0 lg:h-full lg:flex-col lg:border-b-0 lg:border-r">
            <div className="space-y-2 border-b border-border p-3">
              {showAdminChrome ? (
                <select
                  value={userFilter}
                  onChange={(event) => {
                    setUserFilter(event.target.value);
                    setSelectedId(null);
                    setDetail(null);
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:text-sm"
                  aria-label="Trace user filter"
                >
                  <option value={ALL_USERS}>All users</option>
                  {users.map((user) => {
                    const id = String(user.user_id || '');
                    if (!id) return null;
                    const label = user.user_email || id;
                    return (
                      <option key={id} value={id}>
                        {label} ({user.trace_count || 0})
                      </option>
                    );
                  })}
                </select>
              ) : null}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void loadTraces();
                    }}
                    placeholder="Search query"
                    className="pl-8"
                  />
                </div>
                <Button variant="outline" size="icon" onClick={() => void loadTraces()} aria-label="Refresh traces">
                  <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                </Button>
              </div>
            </div>
            {error ? <div className="border-b border-destructive/30 px-3 py-2 text-sm text-destructive">{error}</div> : null}
            {showAdminChrome && issueSummary ? (
              <div className="border-b border-border p-3">
                {qualityMatrix ? <QualityMatrixPanel matrix={qualityMatrix} onRefresh={() => void loadQualityMatrix()} compact /> : null}
                <CompactIssueSummary issueSummary={issueSummary} />
                <Disclosure
                  title={`Issues & ticker requests (${issueSummary.window_hours || 48}h)`}
                  className="overflow-hidden"
                  contentClassName="overflow-y-auto overscroll-contain p-3 lg:max-h-none lg:overflow-visible"
                  contentStyle={{ maxHeight: '280px' }}
                >
                  <div className="space-y-3">
                    <SummaryChips title="Issue counts" items={asArray(issueSummary.issueCounts).slice(0, 8)} />
                    <SummaryChips title="Ticker requests" items={asArray(issueSummary.tickerRequests).slice(0, 12)} />
                    <SummaryChips title="Unresolved ticker requests" items={asArray(issueSummary.unresolvedTickerRequests).slice(0, 12)} />
                    <SummaryChips title="Out-of-coverage" items={asArray(issueSummary.outOfUniverseRequests).slice(0, 8)} />
                    {asArray<Record<string, any>>(issueSummary.evalSuggestions).length > 0 ? (
                      <Disclosure title="Eval suggestions">
                        <div className="space-y-2">
                          {asArray<Record<string, any>>(issueSummary.evalSuggestions).slice(0, 5).map((item, index) => (
                            <div key={`${item.issueKey || index}`} className="rounded-md border border-border bg-background p-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold">{item.title}</span>
                                <Badge variant={item.priority === 'high' ? 'destructive' : 'outline'}>{item.count || 0}</Badge>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">{item.assertion}</div>
                            </div>
                          ))}
                        </div>
                      </Disclosure>
                    ) : null}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Recent examples
                      </div>
                      {asArray<Record<string, any>>(issueSummary.examples).slice(0, 6).map((item, index) => (
                        <button
                          key={`${item.engine_id || index}-${item.type || 'issue'}`}
                          type="button"
                          onClick={() => item.engine_id && setSelectedId(String(item.engine_id))}
                          className="w-full rounded-md border border-border bg-background px-2 py-2 text-left hover:bg-muted/60"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-medium">{item.label || item.type}</span>
                            <div className="flex shrink-0 items-center gap-1">
                              {item.error_class && item.error_class !== 'none' ? (
                                <Badge variant="secondary">{labelize(item.error_class)}</Badge>
                              ) : null}
                              <Badge variant={item.severity === 'high' ? 'destructive' : 'outline'}>{labelize(item.type || 'issue')}</Badge>
                            </div>
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">{preview(item.query || item.detail, 120)}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </Disclosure>
              </div>
            ) : null}
            <div className="border-b border-border p-3 lg:hidden">
              <Disclosure
                title={`Trace list (${traces.length})`}
                className="overflow-hidden"
                contentClassName="max-h-[42vh] overflow-y-auto overscroll-contain p-0"
              >
                <TraceRows traces={traces} selectedId={selectedId} isAdmin={showAdminChrome} onSelect={setSelectedId} />
              </Disclosure>
            </div>
            <div className="hidden min-h-0 flex-1 overflow-y-auto overscroll-contain lg:block">
              <TraceRows traces={traces} selectedId={selectedId} isAdmin={showAdminChrome} onSelect={setSelectedId} />
            </div>
          </section>

          <section className="overflow-visible border-t border-border lg:min-h-0 lg:border-t-0 lg:overflow-hidden">
            <ScrollArea className="h-auto lg:h-full">
              <div className="space-y-3 p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border/70 bg-card/70 px-3 py-2.5 shadow-sm">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Trace</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{detail?.engine?.id || selectedId}</span>
                      {detail?.engine?.created_at ? <span>{detail.engine.created_at}</span> : null}
                      {showAdminChrome && detail?.engine?.user_email ? <span>{detail.engine.user_email}</span> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant={audit.status === 'clean' ? 'secondary' : audit.status === 'needs_review' ? 'destructive' : 'outline'}>
                      {audit.status === 'clean' ? 'Clean' : audit.status === 'needs_review' ? 'Review' : 'Limited'}
                    </Badge>
                    <Badge variant="outline">{selectedTrace?.duration_ms ?? detail?.engine?.duration_ms ?? '-'} ms</Badge>
                  </div>
                </div>

                {detail ? (
                  <TraceView trace={buildUserTrace(detail)} />
                ) : (
                  <p className="text-sm text-muted-foreground">Select a trace to view it.</p>
                )}

                {false && (
                <TraceFlowPanel stages={traceStages} active={activeStage} onSelect={setActiveStage}>

                {activeStage === 'plan' ? (
                <TraceBlock title="Plan" icon={<Database className="h-4 w-4" />} embedded>
                  <div className="space-y-4">
                    {audit.flags.length > 0 ? (
                      <div className="space-y-2">
                        {audit.flags.slice(0, 8).map((flag, index) => (
                          <div key={`${flag.type}-${index}`} className="rounded-md border border-border bg-background p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">{flag.label}</span>
                              <Badge variant={flag.severity === 'high' ? 'destructive' : 'outline'}>{flag.type}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No obvious trace flags detected before retrieval.</p>
                    )}
                    {audit.evalIdeas.length > 0 ? (
                      <Disclosure title="Eval ideas from this trace">
                        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                          {audit.evalIdeas.map((idea) => <li key={idea}>{idea}</li>)}
                        </ul>
                      </Disclosure>
                    ) : null}
                  {asArray(detail?.router).map((router, index) => (
                    <div key={router.id || index} className="space-y-2">
                      <AskExplainerList asks={asArray(router.asks)} />
                      {router.reasoning_text ? <p className="text-sm text-muted-foreground">{preview(router.reasoning_text, 500)}</p> : null}
                      <Disclosure title="Raw router asks JSON">
                        <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{formatJson(router.asks || [])}</pre>
                      </Disclosure>
                    </div>
                  ))}
                  {asArray(detail?.router).length === 0 ? <p className="text-sm text-muted-foreground">No router plan recorded for this trace.</p> : null}
                  </div>
                </TraceBlock>
                ) : null}

                {activeStage === 'retrieve' ? (
                <TraceBlock title="Retrieve" icon={<Wrench className="h-4 w-4" />} embedded>
                  <div className="space-y-3">
                    <Bm25RetrievalCard />
                    {lanes.map((lane, index) => {
                      const events = toolEvents(asArray(lane.message_history));
                      const artifact = laneArtifact(lane);
                      const coverage = laneCoverage(lane);
                      const askObject = laneAskObject(lane);
                      const attachment = lane.analysis_attachment || artifact.analysisAttachment;
                      const modelSummary = lane.table_name === 'model_build' ? modelBuildSummary(lane) : null;
                      return (
                        <details key={lane.id || index} className="group overflow-hidden rounded-xl border border-border/70 bg-background/80 shadow-sm">
                          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 transition hover:bg-muted/35">
                            <div className="flex min-w-0 items-center gap-2">
                              <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                              <Badge variant={lane.table_name === 'model_build' ? 'default' : 'outline'}>{lane.table_name}</Badge>
                              <span className="truncate text-sm font-medium">{lane.lane_variable}</span>
                              {attachment ? <Badge variant="secondary">sent to analyst</Badge> : null}
                              {modelSummary?.template ? <Badge variant="outline">{modelSummary.template}</Badge> : null}
                              {modelSummary?.ticker ? <Badge variant="outline">{modelSummary.ticker}</Badge> : null}
                              {modelSummary ? <Badge variant={modelSummary.failed ? 'destructive' : 'secondary'}>{modelSummary.status}</Badge> : null}
                            </div>
                            <span className="shrink-0 text-xs text-muted-foreground">{lane.model}</span>
                          </summary>
                          <div className="border-t border-border/70 bg-muted/15 p-3 sm:p-4">
                          <LaneExplainer lane={lane} events={events} askObject={askObject} coverage={coverage} />
                          {asArray(lane.sql_queries).length > 0 ? (
                            <Disclosure title={`SQL queries (${asArray(lane.sql_queries).length})`} className="mt-3">
                              <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{asArray(lane.sql_queries).join('\n\n')}</pre>
                            </Disclosure>
                          ) : null}
                          {events.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              {events.map((event, eventIndex) => (
                                <div key={`${event.name}-${eventIndex}`} className="rounded-md bg-background px-3 py-2 ring-1 ring-border">
                                  <div className="text-xs font-semibold">{event.name}</div>
                                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{event.detail}</pre>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          <div className="mt-3 grid gap-3 lg:grid-cols-2">
                            {askObject ? (
                              <Disclosure title="Ask object">
                                <pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs">{formatJson(askObject)}</pre>
                              </Disclosure>
                            ) : null}
                            {coverage ? (
                              <Disclosure title="Coverage">
                                <pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs">{formatJson(coverage)}</pre>
                              </Disclosure>
                            ) : null}
                            {artifact && Object.keys(artifact).length > 0 ? (
                              <Disclosure title="Full execution artifact">
                                <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">{formatJson(artifact)}</pre>
                              </Disclosure>
                            ) : null}
                            {attachment ? (
                              <Disclosure title="Structured rows sent to analyst">
                                <div className="space-y-2">
                                  <p className="text-xs leading-relaxed text-muted-foreground">
                                    This lane produced an analyst table. The same CSV appears in the Write stage under Computed Data.
                                  </p>
                                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                                    {String(attachment.csv || '')}
                                  </pre>
                                </div>
                              </Disclosure>
                            ) : null}
                            {lane.system_prompt_text ? (
                              <Disclosure title={lane.table_name === 'model_build' ? 'Compute context/system prompt' : 'System prompt'}>
                                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{String(lane.system_prompt_text)}</pre>
                              </Disclosure>
                            ) : null}
                            {asArray(lane.message_history).length > 0 ? (
                              <Disclosure title="Raw message history">
                                <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">{formatJson(lane.message_history)}</pre>
                              </Disclosure>
                            ) : null}
                          </div>
                          </div>
                        </details>
                      );
                    })}
                    {lanes.length === 0 ? <p className="text-sm text-muted-foreground">No lane trace recorded.</p> : null}
                  </div>
                </TraceBlock>
                ) : null}

                {activeStage === 'compute' ? (
                <>
                <TraceBlock title="Execution Artifacts" icon={<Database className="h-4 w-4" />} embedded>
                  <div className="space-y-3">
                    {executionArtifacts.map((artifact, index) => (
                      <details key={artifact.variable || index} className="group rounded-md border border-border">
                        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                            <Badge variant={artifact.table === 'model_build' ? 'default' : 'outline'}>{artifact.table}</Badge>
                            <span className="truncate text-sm font-medium">{artifact.variable || artifact.ask}</span>
                          </div>
                          <Badge variant="secondary">{asArray(artifact.selected_tickers).join(', ') || 'artifact'}</Badge>
                        </summary>
                        <div className="border-t border-border p-3">
                          <p className="mb-3 text-sm">{artifact.resultSummary}</p>
                          <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{formatJson(artifact)}</pre>
                        </div>
                      </details>
                    ))}
                    {executionArtifacts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No execution artifacts recorded for this trace.</p>
                    ) : null}
                  </div>
                </TraceBlock>

                <TraceBlock title="Computed Tables" icon={<Database className="h-4 w-4" />} embedded>
                  <div className="space-y-3">
                    {computedTables.map((table, index) => (
                      <details key={table.id || index} className="group rounded-md border border-border">
                        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                            <span className="truncate text-sm font-medium">{table.title}</span>
                          </div>
                          <Badge variant="secondary">{asArray(table.rows).length} rows</Badge>
                        </summary>
                        <div className="border-t border-border p-3">
                          <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">{String(table.csv || '')}</pre>
                          {table.coverage ? (
                            <Disclosure title="Coverage">
                              <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">{formatJson(table.coverage)}</pre>
                            </Disclosure>
                          ) : null}
                        </div>
                      </details>
                    ))}
                    {computedTables.length === 0 ? <p className="text-sm text-muted-foreground">No computed tables recorded for this trace.</p> : null}
                  </div>
                </TraceBlock>
                </>
                ) : null}

                {activeStage === 'write' ? (
                <TraceBlock title="Write" icon={<Activity className="h-4 w-4" />} embedded>
                  {modulesFired.length > 0 ? (
                    <div className="mb-3 rounded-md border border-border/70 bg-background/80 p-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">Applied rule modules: </span>
                      {modulesFired.join(", ")}
                    </div>
                  ) : null}
                  {computedTables.length > 0 ? (
                    <Disclosure title={`Input object: structured tables (${computedTables.length})`} defaultOpen>
                      <ComputedTablesPreview tables={computedTables} />
                    </Disclosure>
                  ) : (
                    <p className="text-sm text-muted-foreground">No computed tables were stored in analystContext for this trace.</p>
                  )}
                  {analystInputMessage ? (
                    <Disclosure title="Input: analyst payload" defaultOpen>
                      <AnalystInputPacket text={analystInputMessage} analystContext={analyst?.analyst_context} />
                    </Disclosure>
                  ) : (
                    <p className="text-sm text-muted-foreground">No analyst input message recorded for this trace.</p>
                  )}
                  <Disclosure title="Output: answer" defaultOpen>
                    {analyst?.answer_text ? (
                      <MarkdownOutput text={String(analyst.answer_text)} />
                    ) : (
                      <p className="text-sm text-muted-foreground">No analyst output recorded for this trace.</p>
                    )}
                  </Disclosure>
                  {showAdminChrome ? (
                    <div className="mt-3 space-y-3">
                      <Disclosure title="System prompt">
                        <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                          {String(analyst?.system_prompt_text || '')}
                        </pre>
                      </Disclosure>
                      <Disclosure title="Stored analystContext JSON (debug)">
                        <pre className="max-h-[520px] overflow-auto rounded-md bg-muted p-3 text-xs">{formatJson(analyst?.analyst_context || {})}</pre>
                      </Disclosure>
                    </div>
                  ) : null}
                </TraceBlock>
                ) : null}

                {activeStage === 'verify' ? (
                <TraceBlock title="Verify Sources" icon={<FileText className="h-4 w-4" />} embedded>
                  <div className="space-y-4">
                    {surfacedSources.length > 0 ? (
                      <SourceGroup title="Final surfaced sources" sources={surfacedSources} />
                    ) : null}
                    {analystSources.length > 0 ? (
                      <SourceGroup title="Analyst cited sources" sources={analystSources} />
                    ) : null}
                    {sourceRows.length > 0 ? (
                      <Disclosure title={`Source log rows (${sourceRows.length})`}>
                        <div className="grid gap-2 md:grid-cols-2">
                          {sourceRows.map((source, index) => (
                            <SourceCard
                              key={source.id || index}
                              source={source}
                              meta={[
                                source.source_id ? `source_id=${source.source_id}` : null,
                                source.source_kind || 'source',
                                source.selection_stage || null,
                              ].filter(Boolean)}
                              actions={(
                                <>
                                  {Number(source.selected_for_analyst) === 1 ? <Badge variant="secondary">analyst</Badge> : null}
                                  {Number(source.selected_for_panel) === 1 ? <Badge variant="outline">panel</Badge> : null}
                                </>
                              )}
                            />
                          ))}
                        </div>
                      </Disclosure>
                    ) : null}
                    {surfacedSources.length === 0 && analystSources.length === 0 && sourceRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No sources recorded for this trace.</p>
                    ) : null}
                  </div>
                </TraceBlock>
                ) : null}
                </TraceFlowPanel>
                )}
              </div>
            </ScrollArea>
          </section>
        </main>}
      </div>
    </ThemeProvider>
  );
}

export function AdminDataQualityApp() {
  const auth = useAuth();
  const [matrix, setMatrix] = useState<QualityMatrix | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [detail, setDetail] = useState<QualityTickerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = String(auth.user?.email || '').trim().toLowerCase() === TRACE_ADMIN_EMAIL;
  const isSignedIn = Boolean(auth.user);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await auth.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [auth.getToken]);

  const loadMatrix = useCallback(async () => {
    if (!isSignedIn || !isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/data-quality/matrix?periods=12`, {
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load data quality matrix');
      setMatrix(json);
      const rows = asArray<{ ticker: string; status: 'green' | 'yellow' | 'red' }>(json.rows);
      if (!selectedTicker && rows.length > 0) {
        const firstProblem = rows.find((row) => row.status !== 'green') || rows[0];
        setSelectedTicker(firstProblem.ticker);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data quality matrix');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, isAdmin, isSignedIn, selectedTicker]);

  const loadTickerDetail = useCallback(async (ticker: string) => {
    if (!isSignedIn || !isAdmin) return;
    setDetailLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/data-quality/ticker/${encodeURIComponent(ticker)}?periods=12`, {
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load ticker detail');
      setDetail(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ticker detail');
    } finally {
      setDetailLoading(false);
    }
  }, [authHeaders, isAdmin, isSignedIn]);

  useEffect(() => {
    if (!auth.isLoading && isSignedIn && isAdmin) void loadMatrix();
  }, [auth.isLoading, isSignedIn, isAdmin, loadMatrix]);

  useEffect(() => {
    if (selectedTicker) void loadTickerDetail(selectedTicker);
  }, [selectedTicker, loadTickerDetail]);

  return (
    <ThemeProvider>
      <div className="flex min-h-[var(--app-height,100vh)] flex-col bg-background text-foreground">
        <header className="border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                <h1 className="text-base font-semibold">Database Health</h1>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">Admin operator view · ticker-period QC matrix</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => window.location.assign('/admin/traces')}>Traces</Button>
              <Button variant="outline" size="sm" onClick={() => window.location.assign('/docs#database')}>Docs</Button>
              <Button variant="outline" size="sm" onClick={() => window.location.assign('/')}>Chat</Button>
              <ThemeToggle />
            </div>
          </div>
        </header>

        {!auth.isLoading && !isSignedIn ? (
          <main className="flex flex-1 items-center justify-center p-6">
            <div className="w-full max-w-md rounded-md border border-border p-5">
              <h2 className="text-base font-semibold">Sign in to view database health</h2>
              <p className="mt-2 text-sm text-muted-foreground">Only admin accounts can view full corpus QC details.</p>
              <div className="mt-4 flex gap-2">
                <Button type="button" onClick={() => void auth.signInWithGoogle()}>Sign in</Button>
                <Button type="button" variant="outline" onClick={() => window.location.assign('/')}>Back to chat</Button>
              </div>
            </div>
          </main>
        ) : null}

        {!auth.isLoading && isSignedIn && !isAdmin ? (
          <main className="flex flex-1 items-center justify-center p-6">
            <div className="w-full max-w-md rounded-md border border-border p-5">
              <h2 className="text-base font-semibold">Admin access required</h2>
              <p className="mt-2 text-sm text-muted-foreground">Your account is not authorized to view this page.</p>
              <div className="mt-4">
                <Button type="button" variant="outline" onClick={() => window.location.assign('/')}>Back to chat</Button>
              </div>
            </div>
          </main>
        ) : null}

        {auth.isLoading || !isSignedIn || !isAdmin ? null : (
          <main className="grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_430px] lg:p-6">
            <section className="min-w-0 space-y-4">
              {error ? <div className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive">{error}</div> : null}
              {matrix ? (
                <QualityMatrixPanel
                  matrix={matrix}
                  onRefresh={() => void loadMatrix()}
                  selectedTicker={selectedTicker}
                  selectedPeriod={selectedPeriod}
                  onSelect={(ticker, period) => {
                    setSelectedTicker(ticker);
                    setSelectedPeriod(period);
                  }}
                />
              ) : (
                <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
                  {loading ? 'Loading database health...' : 'No matrix loaded.'}
                </div>
              )}
            </section>
            <aside className="min-w-0">
              <TickerDetailPanel detail={detail} selectedPeriod={selectedPeriod} loading={detailLoading} />
            </aside>
          </main>
        )}
      </div>
    </ThemeProvider>
  );
}

function MarkdownOutput({ text }: { text: string }) {
  return (
    <div className="max-h-[620px] overflow-auto rounded-md bg-muted p-4">
      <div className="prose prose-neutral dark:prose-invert prose-sm max-w-none overflow-x-auto prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-p:leading-relaxed prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-table:text-xs prose-th:border prose-th:border-border prose-th:bg-background prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {text}
        </ReactMarkdown>
      </div>
    </div>
  );
}

const ANALYST_PACKET_SECTIONS = [
  'USER QUERY',
  'ANSWER SCOPE',
  'FCFE ANSWER RULES',
  'CONTEXT COVERAGE',
  'RETRIEVAL SUMMARY',
  'OUT OF COVERAGE',
  'MISSING SCOPE',
  'APPLICABLE RULES',
  'DATA QUALITY WARNINGS',
  'EVIDENCE INDEX',
  'COMPUTED DATA',
  'DATA',
  'RETRIEVED DATA',
  'CALCULATED DATA',
  'SOURCES',
];

function parseAnalystPacket(text: string) {
  const lines = String(text || '').split('\n');
  const sections: Array<{ title: string; body: string }> = [];
  let current: { title: string; lines: string[] } | null = null;
  const headers = new Set(ANALYST_PACKET_SECTIONS);
  const normalizeLine = (line: string) => {
    const trimmed = line.trim();
    if (/^\[DATA\]$/i.test(trimmed)) return 'DATA';
    if (/^\[RETRIEVED DATA\]$/i.test(trimmed)) return 'RETRIEVED DATA';
    if (/^\[CALCULATED DATA\]$/i.test(trimmed)) return 'CALCULATED DATA';
    if (/^\[COMPUTED DATA\]$/i.test(trimmed)) return 'COMPUTED DATA';
    if (/^\[EVIDENCE INDEX\]$/i.test(trimmed)) return 'EVIDENCE INDEX';
    return trimmed;
  };

  for (const line of lines) {
    const trimmed = normalizeLine(line);
    if (headers.has(trimmed)) {
      if (current) sections.push({ title: current.title, body: current.lines.join('\n').trim() });
      current = { title: trimmed, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ title: current.title, body: current.lines.join('\n').trim() });

  return sections.length > 0 ? sections : [{ title: 'Analyst input', body: text }];
}

function countNonEmptyLines(body: string) {
  return body.split('\n').filter((line) => line.trim()).length;
}

function sectionSummary(title: string, body: string) {
  if (!body.trim()) return 'none';
  if (title === 'DATA' || title === 'RETRIEVED DATA' || title === 'CALCULATED DATA') {
    const tables = (body.match(/\[TABLE\s+\d+\]/g) || []).length;
    return tables ? `${tables} table${tables === 1 ? '' : 's'}` : `${body.split('\n').filter(Boolean).length} lines`;
  }
  if (title === 'SOURCES') {
    const sources = (body.match(/^══ \[\d+\]/gm) || []).length;
    return sources ? `${sources} source${sources === 1 ? '' : 's'}` : `${body.split('\n').filter(Boolean).length} lines`;
  }
  if (title === 'CONTEXT COVERAGE') {
    return `${body.split('\n').filter(Boolean).length} coverage line${body.split('\n').filter(Boolean).length === 1 ? '' : 's'}`;
  }
  if (title === 'EVIDENCE INDEX') {
    return `${body.split('\n').filter(Boolean).length} evidence line${body.split('\n').filter(Boolean).length === 1 ? '' : 's'}`;
  }
  if (title === 'APPLICABLE RULES') {
    return `${body.split('\n').filter(Boolean).length} rule line${body.split('\n').filter(Boolean).length === 1 ? '' : 's'}`;
  }
  return preview(body.replace(/\s+/g, ' '), 90);
}

function splitComputedTables(body: string) {
  const parts = body.split(/\n(?=\[TABLE\s+\d+\])/g).map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts : (body.trim() ? [body.trim()] : []);
}

function splitSources(body: string) {
  const parts = body.split(/\n(?=══ \[\d+\])/g).map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts : (body.trim() ? [body.trim()] : []);
}

function sourceKindLabel(sourceBlock: string, analystContext?: any) {
  const firstLine = sourceBlock.split('\n')[0] || '';
  const tag = firstLine.match(/^══ \[(\d+)\]/)?.[1];
  const contextSource = tag
    ? asArray(analystContext?.sources).find((source) => String(source?.tag || '') === tag)
    : null;
  if (contextSource?.contentKind === 'extraction') return 'extracted evidence';
  if (contextSource?.contentKind === 'raw_page') return 'raw page text';
  const text = sourceBlock.split('\n').slice(1).join('\n');
  if (/extracted evidence/i.test(firstLine)) return 'extracted evidence';
  if (/source page/i.test(firstLine)) return 'source page text';
  if (/\bsearch_text\b/i.test(text) || text.length < 800) return 'compact source text';
  return 'source text';
}

function AnalystSectionBody({ section, analystContext }: { section: { title: string; body: string }; analystContext?: any }) {
  const body = section.body || 'none';
  if (section.title === 'DATA' || section.title === 'RETRIEVED DATA' || section.title === 'CALCULATED DATA') {
    const tables = splitComputedTables(body);
    return (
      <div className="space-y-3">
        {tables.map((table, index) => {
          const [titleLine, ...rest] = table.split('\n');
          return (
            <div key={`${titleLine}-${index}`} className="rounded-md border border-border bg-background">
              <div className="border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
                {titleLine || `Table ${index + 1}`}
              </div>
              <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap p-3 text-xs leading-relaxed text-foreground/90">
                {rest.join('\n').trim() || table}
              </pre>
            </div>
          );
        })}
      </div>
    );
  }

  if (section.title === 'SOURCES') {
    const sources = splitSources(body);
    return (
      <div className="space-y-3">
        {sources.map((source, index) => {
          const [titleLine, ...rest] = source.split('\n');
          return (
            <div key={`${titleLine}-${index}`} className="rounded-md border border-border bg-background">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                <span className="text-xs font-semibold text-foreground">{titleLine || `Source ${index + 1}`}</span>
                <Badge variant="outline">{sourceKindLabel(source, analystContext)}</Badge>
              </div>
              <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap p-3 text-xs leading-relaxed text-foreground/90">
                {rest.join('\n').trim() || source}
              </pre>
            </div>
          );
        })}
      </div>
    );
  }

  if (section.title === 'RETRIEVAL SUMMARY') {
    return (
      <div className="space-y-2">
        <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-xs leading-relaxed text-foreground/90">
          {body}
        </pre>
      </div>
    );
  }

  return (
    <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-xs leading-relaxed text-foreground/90">
      {body}
    </pre>
  );
}

function AnalystInputPacket({ text, analystContext }: { text: string; analystContext?: any }) {
  const sections = parseAnalystPacket(text);
  const dataSections = sections.find(
    (section) => section.title === 'DATA' || section.title === 'COMPUTED DATA' || section.title === 'RETRIEVED DATA' || section.title === 'CALCULATED DATA',
  );
  const sources = sections.find((section) => section.title === 'SOURCES');
  const retrieval = sections.find((section) => section.title === 'RETRIEVAL SUMMARY');
  const rules = sections.find((section) => section.title === 'APPLICABLE RULES');
  const prettySectionTitle = (title: string) => {
    if (title === 'APPLICABLE RULES') return 'Applicable rules';
    if (title === 'EVIDENCE INDEX') return 'Evidence index';
    if (title === 'COMPUTED DATA') return 'Structured data packets';
    if (title === 'RETRIEVAL SUMMARY') return 'Source retrieval summary';
    if (title === 'DATA' || title === 'RETRIEVED DATA' || title === 'CALCULATED DATA') return 'Structured data packets';
    if (title === 'SOURCES') return 'Narrative evidence';
    return title;
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-2 text-xs leading-relaxed text-muted-foreground sm:grid-cols-3">
          <div className="rounded-md border border-border/70 bg-background/70 p-2">
            <span className="font-semibold text-foreground">Applied rule modules</span>
            <br />
            {rules ? `${countNonEmptyLines(rules.body)} lines` : 'none'}
          </div>
          <div className="rounded-md border border-border/70 bg-background/70 p-2">
            <span className="font-semibold text-foreground">Retrieval summary</span>
            <br />
            {retrieval ? `${countNonEmptyLines(retrieval.body)} lines of lane summaries` : 'none'}
          </div>
            <div className="rounded-md border border-border/70 bg-background/70 p-2">
            <span className="font-semibold text-foreground">Structured data</span>
            <br />
            {dataSections ? sectionSummary(dataSections.title, dataSections.body) : 'none'}
          </div>
          <div className="rounded-md border border-border/70 bg-background/70 p-2">
            <span className="font-semibold text-foreground">Narrative text</span>
            <br />
            {sources ? sectionSummary('SOURCES', sources.body) : 'none'}
          </div>
      </div>
      <div className="space-y-2">
        {sections.map((section, index) => (
          <Disclosure
            key={section.title}
            title={prettySectionTitle(section.title)}
            defaultOpen={index < 4 || section.title === 'DATA' || section.title === 'COMPUTED DATA' || section.title === 'RETRIEVED DATA' || section.title === 'CALCULATED DATA'}
            className="border-border bg-background"
            contentClassName="border-border bg-muted/20"
          >
            <AnalystSectionBody section={section} analystContext={analystContext} />
          </Disclosure>
        ))}
      </div>
    </div>
  );
}

function ComputedTablesPreview({ tables }: { tables: any[] }) {
  return (
    <div className="space-y-3">
      {tables.map((table, index) => (
        <div key={table.id || `${table.title || 'table'}-${index}`} className="rounded-md border border-border bg-background">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{table.title || `Table ${index + 1}`}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {asArray(table.rows).length} rows · {asArray(table.headers).length} columns
              </div>
            </div>
            <Badge variant="secondary">TABLE {index + 1}</Badge>
          </div>
          <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap p-3 text-xs leading-relaxed text-foreground/90">
            {String(table.csv || '')}
          </pre>
          {table.coverage ? (
            <Disclosure title="Coverage" className="mx-3 mb-3" contentClassName="bg-muted/20">
              <pre className="max-h-56 overflow-auto rounded-md bg-background p-3 text-xs">{formatJson(table.coverage)}</pre>
            </Disclosure>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function TraceRows({
  traces,
  selectedId,
  isAdmin,
  onSelect,
}: {
  traces: TraceSummary[];
  selectedId: string | null;
  isAdmin: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="divide-y divide-border">
      {traces.map((trace) => {
        const active = String(trace.id) === selectedId;
        return (
          <button
            key={String(trace.id)}
            type="button"
            onClick={() => onSelect(String(trace.id))}
            className={cn(
              'flex w-full flex-col gap-2 px-3 py-3 text-left transition-colors hover:bg-muted/60',
              active && 'bg-muted',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{preview(trace.query, 90)}</span>
              <Badge variant={trace.status === 'done' ? 'secondary' : 'outline'}>{trace.run_kind || 'run'}</Badge>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{trace.created_at}</span>
              <span>{trace.duration_ms ?? 0} ms</span>
              <span>{trace.iterations ?? 0} steps</span>
              {isAdmin && trace.user_email ? <span>{trace.user_email}</span> : null}
            </div>
          </button>
        );
      })}
      {traces.length === 0 ? (
        <div className="px-3 py-8 text-sm text-muted-foreground">
          No traces found for this view.
        </div>
      ) : null}
    </div>
  );
}

function TraceFlowPanel({
  stages,
  active,
  onSelect,
  children,
}: {
  stages: Array<{ id: TraceStageId; label: string; note: string; count: number; tone: 'good' | 'warn' | 'bad' | 'neutral' }>;
  active: TraceStageId | null;
  onSelect: (stage: TraceStageId | null) => void;
  children: ReactNode;
}) {
  const stageIo: Record<TraceStageId, { input: string; path: string; output: string }> = {
    plan: {
      input: 'User query',
      path: 'Router',
      output: 'Typed asks',
    },
    retrieve: {
      input: 'Typed asks',
      path: 'Structured and narrative lanes',
      output: 'Rows, pages, coverage',
    },
    compute: {
      input: 'Lane artifacts',
      path: 'Deterministic code',
      output: 'Tables and model artifacts',
    },
    write: {
      input: 'Analyst message',
      path: 'Answer model',
      output: 'Final answer',
    },
    verify: {
      input: 'Cited answer',
      path: 'Source selection',
      output: 'Source pages',
    },
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm">
      <div className="border-b border-border/70 bg-muted/20 p-2.5 sm:p-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <div>
            <h3 className="text-sm font-semibold">Trace chain</h3>
            <p className="text-xs text-muted-foreground">Choose one step to drill down. Click again to collapse.</p>
          </div>
          <Badge variant="outline">{stages.length} stages</Badge>
        </div>
        <div className="grid gap-2">
          {stages.map((stage, index) => {
            const selected = active === stage.id;
            return (
              <div
                key={stage.id}
                className={cn(
                  'overflow-hidden rounded-xl border transition',
                  selected ? 'border-primary/50 bg-primary/5 shadow-sm ring-1 ring-primary/15' : 'border-border/70 bg-background/55',
                )}
              >
              <button
                type="button"
                onClick={() => onSelect(selected ? null : stage.id)}
                className={cn(
                  'group grid w-full grid-cols-[1.75rem_minmax(0,1fr)_auto_auto] items-center gap-2 p-2.5 text-left transition',
                  selected ? 'bg-primary/10' : 'hover:bg-muted/45',
                )}
                aria-expanded={selected}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                    selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{stage.label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{stage.note}</span>
                </span>
                <StageCount stage={stage} />
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', selected && 'rotate-180 text-primary')} />
              </button>
              {selected ? (
                <div className="border-t border-primary/20 bg-background/75">
                  <div className="grid gap-2 px-3 py-2 text-xs sm:grid-cols-3">
                    <StageIoCell label="Input" value={stageIo[stage.id].input} />
                    <StageIoCell label="Code path" value={stageIo[stage.id].path} />
                    <StageIoCell label="Output" value={stageIo[stage.id].output} />
                  </div>
                  <div className="space-y-3 border-t border-border/70 bg-muted/10 p-3 sm:p-4">
                    {children}
                  </div>
                </div>
              ) : null}
              </div>
            );
          })}
        </div>
        {!active ? (
          <div className="mt-2 rounded-xl border border-dashed border-border bg-background/55 px-3 py-2 text-xs text-muted-foreground">
            No step is open. Start with Plan for routing, Retrieve for search, Compute for tables, Write for the answer, or Verify for source pages.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StageIoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-background/75 px-2.5 py-2">
      <div className="font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function StageCount({
  stage,
  large = false,
}: {
  stage: { count: number; tone: 'good' | 'warn' | 'bad' | 'neutral' };
  large?: boolean;
}) {
  return (
    <span className={cn(
      'shrink-0 rounded-full border font-semibold',
      large ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[11px]',
      stage.tone === 'bad' && 'border-destructive/40 bg-destructive/10 text-destructive',
      stage.tone === 'warn' && 'border-amber-400/50 bg-amber-400/10 text-amber-800 dark:text-amber-200',
      stage.tone === 'good' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      stage.tone === 'neutral' && 'border-border bg-background/70 text-muted-foreground',
    )}>
      {stage.count}
    </span>
  );
}

function Bm25RetrievalCard() {
  return (
    <details className="group overflow-hidden rounded-xl border border-primary/25 bg-primary/5 shadow-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 transition hover:bg-primary/10">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
            <span className="truncate text-sm font-semibold">BM25 retrieval choice</span>
            <Badge variant="secondary">BM25</Badge>
            <Badge variant="outline">FTS</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            Narrative retrieval stays lexical first: fast, inspectable, source-shaped, and tunable without an embedding dependency.
          </p>
        </div>
        <Badge variant="outline">design choice</Badge>
      </summary>
      <div className="grid gap-3 border-t border-primary/20 bg-background/80 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Retrieval discipline</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
            <li>Search text is curated around source pages, filings, announcements, and macro rows.</li>
            <li>BM25 scores are easy to inspect and tune through MATCH terms and corpus text.</li>
            <li>Embeddings remain an option, but they add another model dependency and a harder scoring surface.</li>
          </ul>
        </div>
        <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Example shape</div>
          <pre className="mt-2 max-h-44 overflow-auto rounded-md bg-muted p-3 text-xs">{`SELECT page_id, ticker, page_number,
       bm25(filings_fts_new) AS score
FROM filings_fts_new
WHERE filings_fts_new MATCH 'revenue margin profit'
ORDER BY score
LIMIT 12;`}</pre>
        </div>
      </div>
    </details>
  );
}

function AskExplainerList({ asks }: { asks: any[] }) {
  if (asks.length === 0) return <p className="text-sm text-muted-foreground">No typed asks recorded.</p>;
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {asks.map((ask, index) => {
        const summary = summarizeAsk(ask);
        return (
          <div key={`${summary.label}-${index}`} className="rounded-md border border-border/70 bg-background p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{index + 1}</Badge>
              <span className="text-sm font-semibold">{summary.label}</span>
            </div>
            {summary.goal ? <p className="mt-2 text-sm text-muted-foreground">{preview(summary.goal, 220)}</p> : null}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {summary.tickers.map((ticker) => <Badge key={ticker} variant="secondary">{ticker}</Badge>)}
              {summary.tables.map((table) => <Badge key={table} variant="outline">{table}</Badge>)}
              {summary.periods.map((period) => <Badge key={period} variant="outline">{period}</Badge>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LaneExplainer({ lane, events, askObject, coverage }: { lane: any; events: Array<{ name: string; detail: string }>; askObject: any; coverage: any }) {
  const ask = summarizeAsk(askObject || {});
  const tools = unique(events.map((event) => event.name).filter((name) => !name.endsWith('_result'))).slice(0, 8);
  const selectedTickers = unique([
    ...asArray(laneArtifact(lane).selected_tickers),
    ...asArray(coverage?.selected_tickers),
    ...ask.tickers,
  ]).slice(0, 8);
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{lane.table_name || 'lane'}</Badge>
        {lane.lane_variable ? <Badge variant="outline">{lane.lane_variable}</Badge> : null}
        {selectedTickers.map((ticker) => <Badge key={ticker} variant="outline">{ticker}</Badge>)}
      </div>
      <p className="mt-2 text-sm">{lane.result_summary || ask.goal || 'Lane recorded evidence for this stage.'}</p>
      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div className="rounded-md border border-border/70 bg-background p-2">
          <div className="font-semibold text-foreground">Evidence surface</div>
          <div className="mt-1">{lane.table_name || ask.tables.join(', ') || 'Not specified'}</div>
        </div>
        <div className="rounded-md border border-border/70 bg-background p-2">
          <div className="font-semibold text-foreground">Tool path</div>
          <div className="mt-1">{tools.length ? tools.join(' -> ') : 'No tool calls recorded'}</div>
        </div>
        <div className="rounded-md border border-border/70 bg-background p-2">
          <div className="font-semibold text-foreground">Coverage</div>
          <div className="mt-1">{coverage?.status || coverage?.coverage_status || `${selectedTickers.length} ticker(s)`}</div>
        </div>
      </div>
    </div>
  );
}

function TraceRunSummary({
  audit,
  routerCount,
  laneCount,
  tableCount,
  sourceCount,
  durationMs,
}: {
  audit: ReturnType<typeof traceAudit>;
  routerCount: number;
  laneCount: number;
  tableCount: number;
  sourceCount: number;
  durationMs?: number | string | null;
}) {
  const status = audit.status === 'clean' ? 'Clean' : audit.status === 'needs_review' ? 'Review' : 'Limited';
  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 p-3 shadow-sm sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Run Summary</h3>
          <p className="text-xs text-muted-foreground">High-level trace health before stage details.</p>
        </div>
        <Badge variant={audit.status === 'clean' ? 'secondary' : audit.status === 'needs_review' ? 'destructive' : 'outline'}>{status}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Metric label="Status" value={status} />
        <Metric label="Plan asks" value={routerCount} />
        <Metric label="Lanes" value={laneCount} />
        <Metric label="Tables" value={tableCount} />
        <Metric label="Sources" value={sourceCount} />
        <Metric label="Duration" value={typeof durationMs === 'number' ? `${durationMs} ms` : durationMs || '-'} />
      </div>
      {audit.flags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {audit.flags.slice(0, 4).map((flag, index) => (
            <Badge key={`${flag.type}-${index}`} variant={flag.severity === 'high' ? 'destructive' : 'outline'}>
              {flag.label}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/75 px-2 py-2">
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function CompactIssueSummary({ issueSummary }: { issueSummary: IssueSummary }) {
  const topIssues = asArray<{ key: string; count: number }>(issueSummary.issueCounts).slice(0, 3);
  return (
    <div className="mb-2 space-y-2">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Metric label="Traces" value={issueSummary.scanned?.engine_rows || 0} />
        <Metric label="Lanes" value={issueSummary.scanned?.lane_rows || 0} />
        <Metric label="Signals" value={asArray(issueSummary.examples).length} />
      </div>
      {topIssues.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {topIssues.map((item) => (
            <Badge key={item.key} variant="outline" className="max-w-full">
              <span className="max-w-[190px] truncate">{labelize(item.key)}: {item.count}</span>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function QualityMatrixPanel({
  matrix,
  onRefresh,
  compact = false,
  selectedTicker,
  selectedPeriod,
  onSelect,
}: {
  matrix: QualityMatrix;
  onRefresh: () => void;
  compact?: boolean;
  selectedTicker?: string | null;
  selectedPeriod?: string | null;
  onSelect?: (ticker: string, period: string) => void;
}) {
  const periods = asArray<string>(matrix.periods);
  const rows = asArray<{ ticker: string; status: 'green' | 'yellow' | 'red'; cells: QualityMatrixCell[] }>(matrix.rows);
  const summary = matrix.summary || {};
  if (compact) {
    return (
      <div className="mb-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Database className="h-3.5 w-3.5" />
            Database health
          </div>
          <Button variant="outline" size="icon" onClick={onRefresh} aria-label="Refresh database health">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          <Metric label="Tickers" value={summary.tickers || rows.length} />
          <Metric label="Red" value={summary.redCells || 0} />
          <Metric label="Yellow" value={summary.yellowCells || 0} />
          <Metric label="Flags" value={summary.flagCount || 0} />
        </div>
        <Button variant="outline" size="sm" className="w-full" onClick={() => window.location.assign('/admin/data-quality')}>
          Open full health view
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Ticker-period matrix</h2>
          <p className="text-xs text-muted-foreground">
            Green cells have no open QC flags. Yellow cells have warnings. Red cells have blockers.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
        <Metric label="Tickers" value={summary.tickers || rows.length} />
        <Metric label="Periods" value={summary.periods || periods.length} />
        <Metric label="Green" value={summary.greenCells || 0} />
        <Metric label="Red" value={summary.redCells || 0} />
        <Metric label="Yellow" value={summary.yellowCells || 0} />
      </div>
      <div className="rounded-md border border-border">
        <div className="max-h-[calc(100vh-260px)] overflow-auto">
          <table className="min-w-[980px] border-collapse text-xs">
            <thead className="sticky top-0 bg-background">
              <tr>
                <th className="sticky left-0 z-20 w-24 border-b border-r border-border bg-background px-2 py-2 text-left font-semibold">Ticker</th>
                {periods.map((period) => (
                  <th key={period} className="w-20 border-b border-r border-border px-2 py-2 text-center font-semibold">
                    {period.slice(2).replaceAll('-', '.')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ticker}>
                  <th className={cn(
                    'sticky left-0 z-10 border-b border-r border-border bg-background px-2 py-2 text-left font-semibold',
                    row.ticker === selectedTicker && 'bg-muted',
                  )}>
                    <span className="inline-flex items-center gap-1">
                      <span className={cn('h-2 w-2 rounded-full', statusDotClass(row.status))} />
                      {row.ticker}
                    </span>
                  </th>
                  {row.cells.map((cell) => (
                    <td key={`${row.ticker}-${cell.period_end}`} className="border-b border-r border-border p-1 text-center">
                      <QualityCell
                        cell={cell}
                        ticker={row.ticker}
                        active={row.ticker === selectedTicker && cell.period_end === selectedPeriod}
                        onSelect={() => onSelect?.(row.ticker, cell.period_end)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function QualityCell({
  cell,
  ticker,
  active,
  onSelect,
}: {
  cell: QualityMatrixCell;
  ticker: string;
  active?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'mx-auto block h-7 w-12 rounded-md ring-1 ring-border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        cell.status === 'green' && 'bg-emerald-500/85 hover:bg-emerald-500',
        cell.status === 'yellow' && 'bg-amber-400/90 hover:bg-amber-400',
        cell.status === 'red' && 'bg-red-500/85 hover:bg-red-500',
        active && 'ring-2 ring-primary',
      )}
      title={`${ticker} ${cell.period_end}: ${cell.status}${cell.flags.length ? `, ${cell.flags.length} flag(s)` : ''}`}
      aria-label={`${ticker} ${cell.period_end} ${cell.status}`}
    />
  );
}

function statusDotClass(status: 'green' | 'yellow' | 'red') {
  if (status === 'red') return 'bg-red-500';
  if (status === 'yellow') return 'bg-amber-400';
  return 'bg-emerald-500';
}

function TickerDetailPanel({
  detail,
  selectedPeriod,
  loading,
}: {
  detail: QualityTickerDetail | null;
  selectedPeriod: string | null;
  loading: boolean;
}) {
  if (loading && !detail) {
    return <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">Loading ticker detail...</div>;
  }
  if (!detail) {
    return <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">Select a ticker to inspect its QC path.</div>;
  }
  const cells = asArray<QualityMatrixCell>(detail.cells);
  const selectedCell = selectedPeriod
    ? cells.find((cell) => cell.period_end === selectedPeriod) || null
    : cells.find((cell) => cell.status !== 'green') || cells[0] || null;
  const flags = selectedCell ? asArray<QualityFlag>(selectedCell.flags) : [];
  const statements = asArray<NonNullable<QualityTickerDetail['statementCoverage']>[number]>(detail.statementCoverage)
    .filter((row) => !selectedCell || row.period_end === selectedCell.period_end);
  const docs = asArray<NonNullable<QualityTickerDetail['documents']>[number]>(detail.documents);
  const statementsPresent = unique(statements.map((row) => row.statement_type)).sort();
  const sectionsPresent = unique(statements.map((row) => row.section)).sort();
  const hasAllStatements = ['balance_sheet', 'cash_flow', 'profit_loss'].every((item) => statementsPresent.includes(item));
  const selectedStatus = selectedCell?.status || detail.summary?.status || 'green';

  return (
    <div className="sticky top-4 space-y-3">
      <div className="rounded-md border border-border bg-background p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className={cn('h-2.5 w-2.5 rounded-full', statusDotClass(detail.summary?.status || 'green'))} />
              <h2 className="text-lg font-semibold">{detail.ticker}</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {selectedCell ? `${selectedCell.period_end} selected` : 'Ticker overview'}
            </p>
          </div>
          <Badge variant={selectedStatus === 'red' ? 'destructive' : selectedStatus === 'yellow' ? 'outline' : 'secondary'}>
            {selectedStatus}
          </Badge>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          <Metric label="Green" value={detail.summary?.greenCells || 0} />
          <Metric label="Yellow" value={detail.summary?.yellowCells || 0} />
          <Metric label="Red" value={detail.summary?.redCells || 0} />
          <Metric label="Flags" value={detail.summary?.flagCount || 0} />
        </div>
      </div>

      <TraceBlock title="Selected Period Checks" icon={<CheckCircle2 className="h-4 w-4" />} defaultOpen>
        <div className="space-y-2">
          <CheckRow label="PL/BS/CF statement rows exist" passed={hasAllStatements} detail={statementsPresent.join(', ') || 'No statement rows found'} />
          <CheckRow label="At least one audited source file is linked" passed={statements.some((row) => Number(row.source_files || 0) > 0)} detail={`${statements.reduce((sum, row) => sum + Number(row.source_files || 0), 0)} source-file links`} />
          <CheckRow label="Consolidated or unconsolidated basis identified" passed={sectionsPresent.length > 0} detail={sectionsPresent.join(', ') || 'No basis found'} />
          <CheckRow label="No open QC flag for selected period" passed={flags.length === 0} detail={flags.length === 0 ? 'Clean for this period' : `${flags.length} open flag(s)`} />
        </div>
      </TraceBlock>

      <TraceBlock title="Open QC Flags" icon={<AlertTriangle className="h-4 w-4" />} defaultOpen>
        <div className="space-y-2">
          {flags.map((flag, index) => (
            <div key={flag.flag_id || index} className="rounded-md border border-border bg-background p-3">
              <div className="flex flex-wrap items-center gap-1">
                <Badge variant={flag.severity === 'blocker' ? 'destructive' : 'outline'}>{flag.severity}</Badge>
                {flag.failed_stage ? <Badge variant="secondary">{flag.failed_stage}</Badge> : null}
                {flag.affected_table ? <Badge variant="outline">{flag.affected_table}</Badge> : null}
              </div>
              <div className="mt-2 text-sm font-medium">{flag.rule || flag.metric || 'QC flag'}</div>
              <div className="mt-1 text-sm text-muted-foreground">{flag.message || 'Pipeline QC flagged this data point.'}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                {[flag.statement_type, flag.period_duration, flag.section, flag.metric, flag.basis].filter(Boolean).join(' / ')}
              </div>
            </div>
          ))}
          {flags.length === 0 ? <p className="text-sm text-muted-foreground">No open flags for this selected period.</p> : null}
        </div>
      </TraceBlock>

      <TraceBlock title="Statement Coverage" icon={<Database className="h-4 w-4" />}>
        <div className="max-h-72 overflow-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-1 pr-2">Statement</th>
                <th className="py-1 pr-2">Basis</th>
                <th className="py-1 pr-2">Duration</th>
                <th className="py-1 text-right">Rows</th>
              </tr>
            </thead>
            <tbody>
              {statements.map((row, index) => (
                <tr key={`${row.period_end}-${row.statement_type}-${row.section}-${row.period_duration}-${index}`} className="border-b border-border/60">
                  <td className="py-1 pr-2">{row.statement_type}</td>
                  <td className="py-1 pr-2">{row.section}</td>
                  <td className="py-1 pr-2">{row.period_duration}</td>
                  <td className="py-1 text-right">{row.rows || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {statements.length === 0 ? <p className="py-3 text-sm text-muted-foreground">No statement coverage rows for this period.</p> : null}
        </div>
      </TraceBlock>

      <TraceBlock title="Filing Documents" icon={<FileText className="h-4 w-4" />}>
        <div className="space-y-2">
          {docs.slice(0, 8).map((doc, index) => (
            <div key={`${doc.filing_period}-${doc.filing_type}-${index}`} className="rounded-md border border-border p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{doc.filing_period || doc.filing_year || 'Unknown period'}</span>
                <Badge variant="outline">{doc.filing_type || 'filing'}</Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {doc.pages || 0} pages · p{doc.first_page || 0} to p{doc.last_page || 0}
              </div>
            </div>
          ))}
          {docs.length === 0 ? <p className="text-sm text-muted-foreground">No document pages found for this ticker.</p> : null}
        </div>
      </TraceBlock>
    </div>
  );
}

function CheckRow({ label, passed, detail }: { label: string; passed: boolean; detail: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-background p-2">
      {passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />}
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function SummaryChips({ title, items }: { title: string; items: Array<{ key: string; count: number }> }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <Badge key={item.key} variant="outline" className="max-w-full">
            <span className="max-w-[180px] truncate sm:max-w-[240px]">{labelize(item.key)}: {item.count}</span>
          </Badge>
        ))}
      </div>
    </div>
  );
}

function labelize(value: unknown) {
  return String(value || '').replaceAll('_', ' ');
}

function Disclosure({
  title,
  children,
  defaultOpen = false,
  className,
  contentClassName,
  contentStyle,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
  contentStyle?: CSSProperties;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className={cn('group rounded-md border border-sky-500/35 bg-sky-500/10 dark:border-sky-400/30 dark:bg-sky-400/10', className)}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 transition hover:bg-sky-500/15 dark:hover:bg-sky-400/15">
        <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-200">{title}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-sky-700 transition-transform group-open:rotate-180 dark:text-sky-200" />
      </summary>
      <div className={cn('border-t border-sky-500/25 bg-background p-3', contentClassName)} style={contentStyle}>{children}</div>
    </details>
  );
}

function SourceGroup({ title, sources, defaultOpen = false }: { title: string; sources: any[]; defaultOpen?: boolean }) {
  return (
    <Disclosure title={`${title} (${sources.length})`} defaultOpen={defaultOpen}>
      <div className="grid gap-2 md:grid-cols-2">
        {sources.map((source, index) => (
          <SourceCard key={source?.id || source?.preview?.id || index} source={source} />
        ))}
      </div>
    </Disclosure>
  );
}

function SourceCard({ source, meta, actions }: { source: any; meta?: Array<string | null>; actions?: ReactNode }) {
  const href = sourceHref(source);
  const title = sourceTitle(source);
  const snippet = source?.snippet || source?.preview?.snippet;
  const defaultMeta = [`id=${source?.id || source?.preview?.id || '-'}`];
  return (
    <div className="rounded-xl border border-border/70 bg-background/85 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {href ? (
            <a href={href} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold text-foreground hover:text-primary hover:underline">
              {title}
            </a>
          ) : (
            <div className="truncate text-sm font-semibold text-foreground">{title}</div>
          )}
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {(meta && meta.length > 0 ? meta : defaultMeta).map((item) => item ? <span key={item} className="rounded-full bg-muted px-2 py-0.5">{item}</span> : null)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {href ? (
            <a href={href} target="_blank" rel="noreferrer" className="rounded-full border border-border bg-muted/40 p-2 text-foreground transition hover:border-primary/50 hover:text-primary" aria-label="Open source">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      </div>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="mt-2 block max-w-full truncate rounded-lg bg-muted/80 px-2 py-1.5 font-mono text-[11px] text-muted-foreground hover:text-primary">
          {href}
        </a>
      ) : null}
      {snippet ? <p className="mt-2 line-clamp-3 text-sm leading-5 text-muted-foreground">{snippet}</p> : null}
    </div>
  );
}

function TraceBlock({
  title,
  icon,
  children,
  defaultOpen = false,
  embedded = false,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (embedded) {
    return (
      <section className="space-y-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h3 className="truncate text-sm font-semibold">{title}</h3>
        </div>
        <div>{children}</div>
      </section>
    );
  }

  return (
    <details className="group rounded-md border border-border bg-background" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h3 className="truncate text-sm font-semibold">{title}</h3>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border p-3">{children}</div>
    </details>
  );
}
