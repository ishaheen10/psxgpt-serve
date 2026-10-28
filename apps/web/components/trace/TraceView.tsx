import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../types';
import { formatJson, type TraceCard, type TraceStage, type TraceStageId, type UserTrace } from './model';

// Presentational trace explorer. Stage rail (Plan → Retrieve → Compute → Write →
// Verify) + per-stage cards with a Raw-JSON toggle, SQL, computed tables, the
// answer, and source links. Responsive: rail on top (mobile) / left (desktop).

const STAGE_COPY: Record<TraceStageId, string> = {
  plan: 'The question becomes typed retrieval asks before anything is fetched.',
  retrieve: 'Each lane runs its SQL or BM25 and records the route. The rows it returns are post-processed into the computed tables in the next step — the analyst never sees the SQL or the raw rows.',
  compute: 'Model-visible tables are shown first. Artifact cards show the retrieval or compute lane that shaped AnalystContext: runtime input, query/code, output, coverage, and extracted evidence.',
  write: 'The analyst LLM is called once with the system prompt and one assembled user message. The block below is that message, verbatim — computed tables as CSV plus source text.',
  verify: 'The source pages behind the answer — each one openable.',
};

function badgeTone(label: string): string {
  if (/clean|final|answer|deterministic|passed/i.test(label)) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (/skipped|debug/i.test(label)) return 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  if (/failed|missing|error/i.test(label)) return 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400';
  return 'border-primary/30 bg-primary/10 text-primary';
}

function stageDot(tone: TraceStage['tone'], active: boolean): string {
  if (active) return 'bg-primary text-primary-foreground';
  if (tone === 'bad') return 'bg-red-500/15 text-red-600 dark:text-red-400';
  if (tone === 'warn') return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
  return 'bg-muted text-muted-foreground';
}

function hasVisibleOutput(card: TraceCard): boolean {
  return Boolean(card.table || card.csv || card.answer || card.source || card.code || (card.blocks && card.blocks.length > 0));
}

function Card({ card, defaultOpen, showRaw }: { card: TraceCard; defaultOpen: boolean; showRaw: boolean }) {
  return (
    <details open={defaultOpen} className="group overflow-hidden rounded-xl border border-border bg-card/60">
      <summary className="flex cursor-pointer list-none items-start gap-2 p-3.5 transition hover:bg-muted/30 sm:p-4">
        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm font-semibold text-foreground">{card.title}</div>
          {card.subtitle ? <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{card.subtitle}</div> : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {(card.badges || []).filter(Boolean).map((b, i) => (
            <span key={`${b}-${i}`} className={cn('rounded-full border px-2 py-0.5 text-[10.5px] font-semibold', badgeTone(b))}>{b}</span>
          ))}
          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground group-open:hidden">Details</span>
        </div>
      </summary>
      <div className="space-y-3 border-t border-border/60 p-3.5 sm:p-4">
        {card.answer ? (
          <div className="whitespace-pre-wrap rounded-lg border-l-2 border-primary/50 bg-primary/5 p-3 text-sm leading-relaxed text-foreground">
            {card.answer}
          </div>
        ) : null}
        {card.table ? (
          <div className="space-y-1.5">
            {card.tableNote ? <div className="text-[11px] text-muted-foreground">{card.tableNote}</div> : null}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>{card.table[0].map((h, i) => (
                    <th key={i} className="border-b border-border bg-muted/40 px-2.5 py-1.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {card.table.slice(1).map((row, ri) => (
                    <tr key={ri}>{row.map((cell, ci) => (
                      <td key={ci} className="border-b border-border/60 px-2.5 py-1.5 text-foreground">{cell}</td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {card.csv ? (
          <div>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Full CSV output</div>
            <pre className="max-h-[32rem] overflow-auto whitespace-pre rounded-lg bg-foreground/[0.06] p-3 font-mono text-[11.5px] leading-relaxed text-foreground"><code>{card.csv}</code></pre>
          </div>
        ) : null}
        {card.rows && card.rows.length > 0 ? (
          <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {card.rows.map(([k, v], i) => (
              <div key={i} className="flex gap-2 rounded-md bg-muted/30 px-2.5 py-1.5 text-xs">
                <dt className="shrink-0 font-medium text-muted-foreground">{k}</dt>
                <dd className="min-w-0 break-words text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {card.code ? (
          <div>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">SQL</div>
            <pre className="max-h-72 overflow-auto rounded-lg bg-foreground/[0.06] p-3 font-mono text-[11.5px] leading-relaxed text-foreground"><code>{card.code}</code></pre>
          </div>
        ) : null}
        {card.source ? (
          <a href={card.source} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-xs text-primary hover:border-primary/50">
            <span className="min-w-0 truncate font-mono text-muted-foreground">{card.source}</span>
            <span className="shrink-0 font-semibold">Open ↗</span>
          </a>
        ) : null}
        {(card.blocks || []).map((block, i) => (
          <details key={i} open={block.open} className="rounded-lg border border-border/60">
            <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{block.label}</summary>
            <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap border-t border-border/60 p-3 font-mono text-[11px] leading-relaxed text-foreground"><code>{block.text}</code></pre>
          </details>
        ))}
        {showRaw && card.raw !== undefined ? (
          <details className="rounded-lg border border-border/60">
            <summary className="cursor-pointer px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Raw JSON</summary>
            <pre className="max-h-80 overflow-auto border-t border-border/60 p-3 font-mono text-[11px] leading-relaxed text-foreground"><code>{formatJson(card.raw)}</code></pre>
          </details>
        ) : null}
      </div>
    </details>
  );
}

export function TraceView({ trace }: { trace: UserTrace }) {
  const [active, setActive] = useState<TraceStageId>('plan');
  const [showRaw, setShowRaw] = useState(false);
  const stage = useMemo(() => trace.stages.find((s) => s.id === active) || trace.stages[0], [trace.stages, active]);

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* Stage rail */}
      <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-2xl border border-border bg-card/60 p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Query trace</div>
          {trace.query ? <h1 className="mt-1.5 text-base font-semibold leading-snug text-foreground">{trace.query}</h1> : null}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              { v: trace.runStats.duration, l: 'duration' },
              { v: String(trace.runStats.lanes), l: 'work items' },
              { v: String(trace.runStats.sources), l: 'sources' },
            ].map((s) => (
              <div key={s.l} className="rounded-lg border border-border bg-background/50 px-2 py-1.5 text-center">
                <div className="text-sm font-semibold text-foreground">{s.v}</div>
                <div className="text-[10px] text-muted-foreground">{s.l}</div>
              </div>
            ))}
          </div>
          <nav className="mt-3 flex flex-wrap gap-1.5 lg:flex-col lg:gap-1">
            {trace.stages.map((s, i) => {
              const isActive = s.id === active;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActive(s.id)}
                  className={cn(
                    'flex grow items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition lg:grow-0',
                    isActive ? 'border-primary/50 bg-primary/5' : 'border-border/60 bg-background/40 hover:bg-muted/40 lg:border-transparent lg:bg-transparent',
                  )}
                >
                  <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', stageDot(s.tone, isActive))}>{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">{s.label}</span>
                    <span className="hidden text-[11px] text-muted-foreground lg:block">{s.note}</span>
                  </span>
                  <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{s.count}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Stage panel */}
      <section className="min-w-0">
        <div className="rounded-2xl border border-border bg-card/40 p-4 shadow-sm sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Step {trace.stages.findIndex((s) => s.id === active) + 1} · {stage.label}
              </div>
              <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">{stage.note || STAGE_COPY[stage.id]}</p>
            </div>
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-primary/50"
            >
              {showRaw ? 'Hide raw' : 'Raw'}
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {stage.cards.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Nothing recorded for this stage.
              </div>
            ) : (
              stage.cards.map((card, i) => (
                <Card key={i} card={card} defaultOpen={card.defaultOpen ?? hasVisibleOutput(card)} showRaw={showRaw} />
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
