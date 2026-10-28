import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, Search, ShieldCheck } from 'lucide-react';
import { API_BASE_URL } from '../hooks/useWebSocket';
import { Badge, Button, Input } from './ui';
import { ThemeProvider, ThemeToggle } from './Theme';
import { cn } from '../types';

type HealthStatus = 'green' | 'yellow' | 'red';

type PublicHealthFlag = {
  severity?: 'warning' | 'blocker' | string;
  category?: string | null;
  affected_table?: string | null;
  period_end?: string | null;
  period_duration?: string | null;
  section?: string | null;
  metric?: string | null;
  message?: string | null;
};

type PublicHealthRow = {
  ticker: string;
  status: HealthStatus;
  earliest_period?: string | null;
  latest_period?: string | null;
  total_periods: number;
  green_periods: number;
  yellow_periods: number;
  red_periods: number;
  cautions: PublicHealthFlag[];
};

type PublicHealthPayload = {
  ok?: boolean;
  generatedAt?: string;
  corpus?: Array<{
    id?: string;
    label?: string;
    cadence?: string;
    rows?: number;
    tickers?: number;
    docs?: number;
    sourceType?: 'statement' | 'filing' | 'announcement' | 'macro' | string;
    description?: string;
  }>;
  summary?: {
    tickers?: number;
    recentPeriodsShown?: number;
    totalTickerPeriods?: number;
    earliestPeriod?: string | null;
    latestPeriod?: string | null;
    greenCells?: number;
    yellowCells?: number;
    redCells?: number;
    flagCount?: number;
    greenTickers?: number;
    yellowTickers?: number;
    redTickers?: number;
  };
  method?: string[];
  periods?: string[];
  rows?: PublicHealthRow[];
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function statusLabel(status: HealthStatus) {
  if (status === 'red') return 'Known issue';
  if (status === 'yellow') return 'Caution';
  return 'Clean';
}

function statusClasses(status: HealthStatus) {
  if (status === 'red') return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300';
  if (status === 'yellow') return 'border-amber-400/40 bg-amber-400/15 text-amber-800 dark:text-amber-200';
  return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
}

function dotClass(status: HealthStatus) {
  if (status === 'red') return 'bg-red-500';
  if (status === 'yellow') return 'bg-amber-400';
  return 'bg-emerald-500';
}

function pct(part: number, whole: number) {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

function countLabel(value?: number) {
  return typeof value === 'number' ? value.toLocaleString() : '-';
}

function publicFlagLabel(flag: PublicHealthFlag) {
  return [
    flag.period_end,
    flag.affected_table,
    flag.metric,
    flag.period_duration,
    flag.section,
  ].filter(Boolean).join(' / ');
}

export function DataHealthApp() {
  const [payload, setPayload] = useState<PublicHealthPayload | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`${API_BASE_URL}/api/data-health?periods=12`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load data health');
        if (alive) {
          setPayload(json);
          const first = asArray<PublicHealthRow>(json.rows).find((row) => row.status !== 'green')
            || asArray<PublicHealthRow>(json.rows)[0];
          setSelectedTicker(first?.ticker || null);
        }
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load data health');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const rows = asArray<PublicHealthRow>(payload?.rows);
  const summary = payload?.summary || {};
  const filteredRows = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return rows;
    return rows.filter((row) => row.ticker.includes(q));
  }, [query, rows]);
  const selected = rows.find((row) => row.ticker === selectedTicker) || filteredRows[0] || null;
  const totalCells = (summary.greenCells || 0) + (summary.yellowCells || 0) + (summary.redCells || 0);
  const corpus = asArray<NonNullable<PublicHealthPayload['corpus']>[number]>(payload?.corpus);

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <h1 className="text-base font-semibold">Database</h1>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">What psxGPT can retrieve and how the structured data is checked</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => window.location.assign('/equities')}>Equities</Button>
              <Button variant="outline" size="sm" onClick={() => window.location.assign('/docs')}>Docs</Button>
              <Button variant="outline" size="sm" onClick={() => window.location.assign('/')}>Chat</Button>
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-w-0 space-y-6">
            <div className="space-y-3">
              <Badge variant="secondary">Public corpus confidence view</Badge>
              <h2 className="text-3xl font-semibold tracking-normal sm:text-4xl">The database behind every answer.</h2>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                psxGPT retrieves from four source classes: structured statement data, filing pages, PSX
                announcements, and macro reports. The matrix below focuses on the structured ticker-period
                corpus because that is where arithmetic, period alignment, ratios, and market-data cautions
                can be checked deterministically.
              </p>
            </div>

            {error ? <div className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</div> : null}
            {loading ? <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">Loading health summary...</div> : null}

            {payload ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <SummaryCard label="Tickers covered" value={summary.tickers || 0} />
                  <SummaryCard label="Full ticker-period coverage" value={summary.totalTickerPeriods || totalCells} detail={`${summary.earliestPeriod || '-'} to ${summary.latestPeriod || '-'}`} />
                  <SummaryCard label="Clean parsed periods" value={pct(summary.greenCells || 0, totalCells)} detail={`${summary.greenCells || 0} of ${totalCells}`} />
                  <SummaryCard label="Caution periods" value={summary.yellowCells || 0} detail="Scoped warnings across full coverage" />
                  <SummaryCard label="Known issue periods" value={summary.redCells || 0} detail="Scoped blockers across full coverage" />
                </div>

                <div className="rounded-md border border-border p-4">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Served corpus</h3>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {corpus.map((item) => (
                      <div key={item.id || item.label} className="rounded-md border border-border bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium">{item.label || item.id}</div>
                          <Badge variant="secondary">{item.cadence || 'Corpus'}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span className="rounded-full border border-border px-2 py-1">{countLabel(item.rows)} rows</span>
                          {typeof item.tickers === 'number' ? <span className="rounded-full border border-border px-2 py-1">{countLabel(item.tickers)} tickers</span> : null}
                          {typeof item.docs === 'number' ? <span className="rounded-full border border-border px-2 py-1">{countLabel(item.docs)} docs/chapters</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-md border border-border p-4">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      <h3 className="text-sm font-semibold">QC method</h3>
                    </div>
                    <div className="mt-3 space-y-2">
                      {asArray<string>(payload.method).map((item) => (
                        <div key={item} className="flex gap-2 text-sm text-muted-foreground">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-md border border-border p-4">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold">How to read status</h3>
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <StatusExplain status="green" text="No open flags across the parsed periods for that ticker." />
                      <StatusExplain status="yellow" text="A specific metric or period has a caution. Other data can still be clean." />
                      <StatusExplain status="red" text="A blocker affects at least one scoped data slice, such as missing market data." />
                      <p className="pt-1 text-xs">
                        Announcement and macro rows are retrieval corpora. They are shown above as coverage surfaces,
                        but they do not enter this ticker-period arithmetic matrix.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-border">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
                    <div>
                      <h3 className="text-sm font-semibold">Ticker health</h3>
                      <p className="text-xs text-muted-foreground">Search a ticker and select it to see coverage depth and cautions we would disclose.</p>
                    </div>
                    <div className="relative w-full sm:w-64">
                      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ticker" className="pl-8" />
                    </div>
                  </div>
                  <div className="max-h-[520px] overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b border-border text-left">
                          <th className="px-3 py-2">Ticker</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Coverage</th>
                          <th className="px-3 py-2 text-right">Clean</th>
                          <th className="px-3 py-2 text-right">Cautions</th>
                          <th className="px-3 py-2 text-right">Known issues</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows.map((row) => (
                          <tr
                            key={row.ticker}
                            className={cn('cursor-pointer border-b border-border/60 hover:bg-muted/50', selected?.ticker === row.ticker && 'bg-muted')}
                            onClick={() => setSelectedTicker(row.ticker)}
                          >
                            <td className="px-3 py-2 font-semibold">{row.ticker}</td>
                            <td className="px-3 py-2">
                              <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', statusClasses(row.status))}>
                                <span className={cn('h-1.5 w-1.5 rounded-full', dotClass(row.status))} />
                                {statusLabel(row.status)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              <span>{row.total_periods || 0} periods</span>
                              <span className="block text-[11px]">{row.earliest_period || '-'} to {row.latest_period || '-'}</span>
                            </td>
                            <td className="px-3 py-2 text-right">{row.green_periods}</td>
                            <td className="px-3 py-2 text-right">{row.yellow_periods}</td>
                            <td className="px-3 py-2 text-right">{row.red_periods}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
          </section>

          <aside className="min-w-0">
            <div className="sticky top-4 rounded-md border border-border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{selected?.ticker || 'Ticker detail'}</h3>
                  <p className="text-xs text-muted-foreground">Cautions are scoped. A ticker can have warnings in one ratio while other data is clean.</p>
                </div>
                {selected ? (
                  <Badge variant={selected.status === 'red' ? 'destructive' : selected.status === 'yellow' ? 'outline' : 'secondary'}>
                    {statusLabel(selected.status)}
                  </Badge>
                ) : null}
              </div>
              {selected ? (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <SummaryCard label="Periods" value={selected.total_periods} compact />
                    <SummaryCard label="Clean" value={selected.green_periods} compact />
                    <SummaryCard label="Caution/Issue" value={`${selected.yellow_periods}/${selected.red_periods}`} compact />
                  </div>
                  <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
                    Parsed coverage: <span className="font-medium text-foreground">{selected.earliest_period || '-'}</span> to{' '}
                    <span className="font-medium text-foreground">{selected.latest_period || '-'}</span>.
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current cautions</h4>
                    {selected.cautions.length > 0 ? selected.cautions.map((flag, index) => (
                      <div key={`${flag.period_end}-${flag.metric}-${index}`} className="rounded-md border border-border p-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant={flag.severity === 'blocker' ? 'destructive' : 'outline'}>{flag.severity === 'blocker' ? 'Known issue' : 'Caution'}</Badge>
                          {flag.affected_table ? <Badge variant="secondary">{flag.affected_table}</Badge> : null}
                        </div>
                        <div className="mt-2 text-sm font-medium">{publicFlagLabel(flag) || 'Scoped data caution'}</div>
                        <p className="mt-1 text-sm text-muted-foreground">{flag.message || 'This data point has an open quality caution.'}</p>
                      </div>
                    )) : (
                      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                        No open cautions across the parsed periods currently summarized here.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">Select a ticker to view detail.</p>
              )}
            </div>
          </aside>
        </main>
      </div>
    </ThemeProvider>
  );
}

function SummaryCard({ label, value, detail, compact = false }: { label: string; value: string | number; detail?: string; compact?: boolean }) {
  return (
    <div className={cn('rounded-md border border-border bg-background', compact ? 'px-2 py-2' : 'p-4')}>
      <div className={cn('font-semibold', compact ? 'text-base' : 'text-2xl')}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {detail ? <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

function StatusExplain({ status, text }: { status: HealthStatus; text: string }) {
  return (
    <div className="flex gap-2">
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', dotClass(status))} />
      <span><strong className="text-foreground">{statusLabel(status)}:</strong> {text}</span>
    </div>
  );
}
