import { useEffect, useCallback, useRef, useState, type HTMLAttributes } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from './ui';
import { Card } from './ui';
import { cn } from '../types';
import {
  Filter,
  FileText,
  ChevronDown,
  Loader2,
  Check,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  X,
  Share2,
  ArrowRight,
  Download,
} from 'lucide-react';
import type {
  ChatMessage,
  DataAttachment,
  ThoughtProcessCheckpoint,
} from '../types';

interface MessageProps {
  message: ChatMessage;
  onOpenSources?: (messageId: string) => void;
  onFeedback?: (messageId: string, feedback: 'positive' | 'negative', comment?: string) => Promise<void>;
  onShare?: () => void;
  onSignUp?: () => void;
  onShowTickers?: () => void;
}

interface SourceRejectionSummary {
  id?: string | number;
  ticker?: string;
  filingPeriod?: string | null;
  statementType?: string | null;
}

function normalizeSourceRejections(value: unknown): SourceRejectionSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): SourceRejectionSummary | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const ticker =
        typeof record.ticker === 'string' && record.ticker.trim().length > 0
          ? record.ticker.trim()
          : null;
      if (!ticker) return null;
      const filingPeriod =
        typeof record.filingPeriod === 'string' && record.filingPeriod.trim().length > 0
          ? record.filingPeriod.trim()
          : null;
      const statementType =
        typeof record.statementType === 'string' && record.statementType.trim().length > 0
          ? record.statementType.trim()
          : undefined;
      const id =
        typeof record.id === 'string' || typeof record.id === 'number'
          ? record.id
          : undefined;
      return {
        id,
        ticker,
        filingPeriod,
        statementType,
      };
    })
    .filter((item): item is SourceRejectionSummary => item !== null);
}

const CHECKPOINT_STATUS_TEXT: Record<string, string> = {
  pending: 'Up next',
  running: 'In progress',
  passed: 'Complete',
  failed: 'Needs attention',
};

const CHECKPOINT_STATUS_COLOR: Record<string, string> = {
  pending: 'text-muted-foreground',
  running: 'text-amber-500 dark:text-amber-300',
  passed: 'text-emerald-500 dark:text-emerald-300',
  failed: 'text-destructive',
};

function CheckpointIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500 dark:text-amber-300" />;
  if (status === 'passed') return <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-300" />;
  if (status === 'failed') return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
  return <span className="block h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />;
}

function ThoughtProcessPanel({
  checkpoints,
  live = false,
  defaultOpen = false,
}: {
  checkpoints: ThoughtProcessCheckpoint[];
  live?: boolean;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [now, setNow] = useState(Date.now());
  const mountedAt = useRef(Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);
  const started = checkpoints.map(c => c.startedAt ? Date.parse(c.startedAt) : NaN).filter(Number.isFinite);
  const seconds = Math.max(0, Math.floor((now - (started.length ? Math.min(...started) : mountedAt.current)) / 1000));
  if (!checkpoints || checkpoints.length === 0) return null;

  const activeStep = live
    ? checkpoints.find((cp) => cp.status === 'running')
    : undefined;

  return (
    <div className="mb-4 rounded-2xl border border-border/60 bg-background/80 shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3"
      >
        <div className="flex items-center gap-2 text-left">
          {live ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" /> : null}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {live ? `Research in progress · ${seconds}s` : 'Research progress'}
            </p>
            <p className="text-xs text-muted-foreground">
              {activeStep ? activeStep.label : live ? 'Finding sources and preparing your answer…' : 'Steps taken to produce this response.'}
            </p>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {isOpen ? (
        <div className="border-t border-border/60 px-4 py-3">
          <div className="space-y-3">
            {checkpoints.map((checkpoint) => {
              const status = checkpoint.status ?? 'pending';
              const statusLabel = CHECKPOINT_STATUS_TEXT[status] ?? status;
              const colorClass = CHECKPOINT_STATUS_COLOR[status] ?? 'text-muted-foreground';
              return (
                <div key={checkpoint.id} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                    <CheckpointIcon status={status} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm font-medium ${status === 'pending' ? 'text-muted-foreground' : 'text-foreground'}`}>
                        {checkpoint.label}
                      </p>
                      <span className={`shrink-0 text-xs font-semibold ${colorClass}`}>{statusLabel}</span>
                    </div>
                    {checkpoint.detail ? (
                      <p className="mt-1 text-xs text-muted-foreground whitespace-pre-line">
                        {checkpoint.detail}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ThinkingPanel({
  thinking,
  isStreaming,
  title,
}: {
  thinking?: string;
  isStreaming?: boolean;
  title?: string;
}) {
  const [isOpen, setIsOpen] = useState(true);
  if (!thinking) return null;

  return (
    <div className="mb-5 border-l-2 border-muted-foreground/20 pl-4">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-2 hover:text-muted-foreground transition-colors"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
        {title ?? (isStreaming ? 'Thinking…' : 'Thought process')}
      </button>
      {isOpen && (
        <div className="text-xs text-muted-foreground leading-relaxed prose prose-xs prose-neutral dark:prose-invert max-w-none [&_p]:my-1.5 [&_p]:text-xs [&_p]:text-muted-foreground [&_strong]:text-muted-foreground [&_code]:text-[10px] [&_code]:px-1 [&_code]:py-0.5">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {thinking}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function ProgressPanel({
  step,
  laneStatus,
  isQueued,
}: {
  step?: string;
  laneStatus: Record<string, unknown>;
  isQueued?: boolean;
}) {
  const laneEntries = Object.entries(laneStatus)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
    .slice(0, 4);
  const label = step && step.trim().length > 0
    ? step.trim()
    : isQueued
      ? 'Waiting in queue...'
      : 'Working...';

  return (
    <div className="mb-4 rounded-lg border border-border/60 bg-background/70 px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{label}</p>
          {laneEntries.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {laneEntries.map(([laneKey, laneStep]) => (
                <span key={laneKey} className="max-w-full truncate">
                  <span className="font-medium text-muted-foreground/80">{laneKey}</span>: {laneStep}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function Message({ message, onOpenSources, onFeedback, onShare, onSignUp, onShowTickers }: MessageProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOutputCopied, setIsOutputCopied] = useState(false);
  const [feedbackState, setFeedbackState] = useState<'positive' | 'negative' | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const totalSources = message.sourceCount ?? message.sourcePreviews?.length ?? 0;
  const hasSources = totalSources > 0;
  const checkpoints = message.analysisMetadata?.checkpoints ?? [];
  const hasCheckpoints = checkpoints.length > 0;
  const thinking = typeof message.analysisMetadata?.thinking === 'string' ? message.analysisMetadata.thinking : undefined;
  const structuredThinking =
    typeof message.analysisMetadata?.structuredThinking === 'string'
      ? message.analysisMetadata.structuredThinking
      : undefined;
  const unstructuredThinking =
    typeof message.analysisMetadata?.unstructuredThinking === 'string'
      ? message.analysisMetadata.unstructuredThinking
      : undefined;
  const laneThinkingEntries =
    message.analysisMetadata?.laneThinking && typeof message.analysisMetadata.laneThinking === 'object'
      ? Object.entries(message.analysisMetadata.laneThinking as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
      : [];
  const laneStatusByKey =
    message.analysisMetadata?.laneStatus && typeof message.analysisMetadata.laneStatus === 'object'
      ? (message.analysisMetadata.laneStatus as Record<string, unknown>)
      : {};
  const hasSplitThinking = Boolean(structuredThinking || unstructuredThinking || laneThinkingEntries.length > 0);
  const effectiveThinking = hasSplitThinking ? undefined : thinking;
  const isProcessing = message.status && message.status !== 'done' && message.status !== 'failed' && message.status !== 'cancelled';
  const isQueued = message.status === 'queued';
  const isStreaming = isProcessing;
  const progressStep = typeof message.analysisMetadata?.step === 'string' ? message.analysisMetadata.step : undefined;
  const showLoadingIndicator = isProcessing && !effectiveThinking && !hasSplitThinking && !message.content;
  const sourceRejections = normalizeSourceRejections(message.analysisMetadata?.sourceRejections);
  const rejectedTotal =
    typeof message.analysisMetadata?.sourceRejectionsTotal === 'number'
      ? message.analysisMetadata?.sourceRejectionsTotal
      : sourceRejections.length;
  const sourceReviewDetailRaw =
    typeof message.analysisMetadata?.sourceReviewDetail === 'string'
      ? message.analysisMetadata?.sourceReviewDetail
      : null;
  const sourceReviewDetail =
    sourceReviewDetailRaw && sourceReviewDetailRaw.trim().length > 0
      ? sourceReviewDetailRaw.trim()
      : null;
  const rejectionPreview = sourceRejections.slice(0, 3);
  const remainingRejections = Math.max(0, rejectedTotal - rejectionPreview.length);
  const showSourceRejections = rejectedTotal > 0;
  const [isSourcePanelOpen, setIsSourcePanelOpen] = useState(false);

  const handleCopyOutput = useCallback(async () => {
    const root = contentRef.current;
    if (!root) return;

    // Clone and remove buttons (e.g., "Copy table" buttons) before extracting text
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('button').forEach((btn) => btn.remove());

    const text = clone.innerText?.trim();
    if (!text) return;
    const html = clone.innerHTML;
    try {
      if (html && typeof ClipboardItem !== 'undefined') {
        const blobHtml = new Blob([html], { type: 'text/html' });
        const blobText = new Blob([text], { type: 'text/plain' });
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': blobHtml,
            'text/plain': blobText,
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setIsOutputCopied(true);
      window.setTimeout(() => setIsOutputCopied(false), 1500);
    } catch (error) {
      console.error('Failed to copy response', error);
    }
  }, []);

  const handleThumbsUp = useCallback(async () => {
    if (!onFeedback || feedbackState === 'positive') return;
    setFeedbackState('positive');
    try {
      await onFeedback(message.id, 'positive');
    } catch {
      setFeedbackState(null);
    }
  }, [onFeedback, message.id, feedbackState]);

  const handleThumbsDown = useCallback(() => {
    if (feedbackState === 'negative') return;
    setShowFeedbackModal(true);
  }, [feedbackState]);

  const handleSubmitNegativeFeedback = useCallback(async () => {
    if (!onFeedback) return;
    setIsSubmittingFeedback(true);
    try {
      await onFeedback(message.id, 'negative', feedbackComment.trim() || undefined);
      setFeedbackState('negative');
      setShowFeedbackModal(false);
      setFeedbackComment('');
    } catch {
      // Keep modal open on error
    } finally {
      setIsSubmittingFeedback(false);
    }
  }, [onFeedback, message.id, feedbackComment]);

  if (message.role === 'user') {
    return (
      <div className="w-full py-4 animate-in slide-in-from-bottom-4 fade-in duration-300">
        <div className="mx-auto max-w-3xl px-2 sm:px-4">
          <div className="flex justify-end">
            <div className="max-w-[95%] rounded-2xl bg-primary/10 px-4 py-3 text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words sm:max-w-[85%] shadow-sm">
              {message.content}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-muted/30 py-6 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="mx-auto w-full max-w-3xl px-2 sm:px-6">
        <div className="prose prose-neutral dark:prose-invert prose-sm max-w-none overflow-x-hidden prose-p:leading-relaxed">
          {isProcessing ? (
            hasCheckpoints ? (
              <ThoughtProcessPanel checkpoints={checkpoints} live defaultOpen />
            ) : (
              <ProgressPanel step={progressStep} laneStatus={laneStatusByKey} isQueued={isQueued} />
            )
          ) : null}
          {showLoadingIndicator && !hasCheckpoints ? (
            <div className="space-y-4 py-3 animate-in fade-in duration-300">
              {/* Loading indicator with status */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-[3px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-[loading-dot_1.4s_ease-in-out_infinite]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-[loading-dot_1.4s_ease-in-out_0.2s_infinite]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-[loading-dot_1.4s_ease-in-out_0.4s_infinite]" />
                </div>
                <span className="text-sm text-muted-foreground">
                  {progressStep || (isQueued ? 'Waiting in queue...' : 'Searching source documents...')}
                </span>
              </div>
              {/* Skeleton shimmer */}
              <div className="space-y-2">
                <div className="h-4 bg-muted/50 rounded-lg w-3/4 animate-pulse" />
                <div className="h-4 bg-muted/50 rounded-lg w-full animate-pulse" />
                <div className="h-4 bg-muted/50 rounded-lg w-5/6 animate-pulse" />
              </div>
            </div>
          ) : null}
          {structuredThinking ? (
            <ThinkingPanel
              thinking={structuredThinking}
              isStreaming={isStreaming}
              title={isStreaming ? 'Structured Scout (live)' : 'Structured Scout'}
            />
          ) : null}
          {unstructuredThinking ? (
            <ThinkingPanel
              thinking={unstructuredThinking}
              isStreaming={isStreaming}
              title={isStreaming ? 'Unstructured Scout (live)' : 'Unstructured Scout'}
            />
          ) : null}
          {laneThinkingEntries.map(([laneKey, laneThought]) => {
            const laneStatus = typeof laneStatusByKey[laneKey] === 'string' ? String(laneStatusByKey[laneKey]) : '';
            const title = laneStatus
              ? `${laneKey} (${laneStatus})`
              : laneKey;
            return (
              <ThinkingPanel
                key={laneKey}
                thinking={laneThought}
                isStreaming={isStreaming}
                title={isStreaming ? `${title} (live)` : title}
              />
            );
          })}
          {effectiveThinking ? <ThinkingPanel thinking={effectiveThinking} isStreaming={isStreaming} /> : null}
          {hasCheckpoints && !isProcessing ? (
            <div className="mb-4">
              <ThoughtProcessPanel checkpoints={checkpoints} />
            </div>
          ) : null}
          {showSourceRejections ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 shadow-sm">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-semibold"
                onClick={() => setIsSourcePanelOpen((prev) => !prev)}
              >
                <div className="flex items-center gap-2 text-left">
                  <Filter className="h-4 w-4" />
                  <span>Filtered out {rejectedTotal} page{rejectedTotal === 1 ? '' : 's'}</span>
                </div>
                <ChevronDown
                  className={`h-4 w-4 transition ${isSourcePanelOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {isSourcePanelOpen && rejectionPreview.length > 0 ? (
                <div className="border-t border-amber-200/70 px-4 py-3">
                  <ul className="space-y-1 text-xs text-amber-900/80">
                    {rejectionPreview.map((rejection) => (
                      <li key={`${rejection.id ?? `${rejection.ticker}-${rejection.filingPeriod ?? 'period'}`}`}>
                        <span className="font-semibold text-amber-900">{rejection.ticker}</span>
                        {rejection.filingPeriod ? <span className="ml-1 text-amber-900/70">({rejection.filingPeriod})</span> : null}
                        {rejection.statementType ? (
                          <span className="ml-1 uppercase tracking-wide text-amber-900/70">{rejection.statementType}</span>
                        ) : null}
                      </li>
                    ))}
                    {remainingRejections > 0 ? (
                      <li className="text-amber-900/60">+{remainingRejections} more…</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          {message.content ? (
            <>
              <div ref={contentRef}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    table: (props) => <CopyableTable {...props} />,
                    thead: (props) => <thead className="bg-muted" {...props} />,
                    tbody: (props) => <tbody className="divide-y divide-border" {...props} />,
                    th: (props) => (
                      <th className="px-4 py-2.5 text-left text-sm font-semibold text-foreground" {...props} />
                    ),
                    td: (props) => (
                      <td className="px-4 py-2.5 text-sm text-muted-foreground align-top" {...props} />
                    ),
                    h1: (props) => <h1 className="mt-6 mb-4 text-2xl font-bold text-foreground scroll-m-20" {...props} />,
                    h2: (props) => <h2 className="mt-5 mb-3 text-xl font-semibold text-foreground scroll-m-20" {...props} />,
                    h3: (props) => <h3 className="mt-4 mb-2 text-lg font-semibold text-foreground scroll-m-20" {...props} />,
                    h4: (props) => <h4 className="mt-3 mb-2 text-base font-semibold text-foreground scroll-m-20" {...props} />,
                    ul: (props) => <ul className="ml-4 my-3 list-disc space-y-1 text-foreground" {...props} />,
                    ol: (props) => <ol className="ml-4 my-3 list-decimal space-y-1 text-foreground" {...props} />,
                    li: (props) => <li className="leading-relaxed text-foreground" {...props} />,
                    p: (props) => <p className="my-3 leading-7 text-foreground" {...props} />,
                    code: ({ className, children, ...props }) => {
                      const isInline = !className;
                      if (isInline) {
                        return (
                          <code
                            className="relative rounded border border-border bg-muted px-[0.4rem] py-[0.2rem] font-mono text-sm text-foreground"
                            {...props}
                          >
                            {children}
                          </code>
                        );
                      }
                      return (
                        <Card className="my-4 overflow-hidden">
                          <code className="block bg-muted/50 p-4 font-mono text-sm leading-relaxed text-foreground overflow-x-auto" {...props}>
                            {children}
                          </code>
                        </Card>
                      );
                    },
                    pre: ({ children }) => <>{children}</>,
                    a: ({ href, children, ...props }) => {
                      // Intercept action links to trigger in-app actions
                      if (href === '#open-tickers') {
                        return (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              onShowTickers?.();
                            }}
                            className="text-blue-600 dark:text-blue-400 font-medium underline underline-offset-4 transition-colors hover:text-blue-800 dark:hover:text-blue-300 cursor-pointer"
                          >
                            {children}
                          </button>
                        );
                      }
                      return (
                        <a
                          href={href}
                          className="text-blue-600 dark:text-blue-400 font-medium underline underline-offset-4 transition-colors hover:text-blue-800 dark:hover:text-blue-300"
                          target="_blank"
                          rel="noopener noreferrer"
                          {...props}
                        >
                          {children}
                        </a>
                      );
                    },
                    img: () => null,
                    blockquote: (props) => (
                      <blockquote className="my-4 border-l-4 border-primary pl-4 italic text-muted-foreground" {...props} />
                    ),
                    hr: () => <hr className="my-6 border-border" />,
                    strong: (props) => <strong className="font-semibold text-foreground" {...props} />,
                    em: (props) => <em className="italic text-foreground" {...props} />,
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            </>
          ) : null}
          {/* Render data attachments */}
          {message.attachments?.length ? (
            <div className="mt-4 space-y-3">
              <div className="space-y-2">
                {message.attachments.map((attachment, index) => {
                  const hasCalculatedAttachment = message.attachments?.some((item) => item.lineage?.kind === 'calculated' || item.id.includes('calculation'));
                  const defaultOpen = attachment.lineage?.kind === 'calculated' || attachment.id.includes('calculation') || (!hasCalculatedAttachment && index === 0);
                  return (
                    <AttachmentPanel
                      key={attachment.id}
                      attachment={attachment}
                      defaultOpen={defaultOpen}
                    />
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground italic">
                Disclaimer: Values in CSV downloads are reported in the units supplied by the retrieved tables. Periods shown correspond to Calendar Quarters, not Fiscal Quarters.
              </p>
            </div>
          ) : null}
        </div>

        {message.content ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-background/80 backdrop-blur-sm px-4 py-3 shadow-sm">
            {hasSources ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full text-xs transition-all duration-200 hover:scale-105 active:scale-95"
                onClick={() => onOpenSources?.(message.id)}
                disabled={!onOpenSources}
              >
                <FileText className="mr-2 h-3.5 w-3.5" />
                View sources
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={`rounded-full text-xs transition-all duration-200 hover:scale-105 active:scale-95 ${isOutputCopied ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400' : ''}`}
              onClick={handleCopyOutput}
            >
              {isOutputCopied ? (
                <span className="flex items-center gap-1">
                  <span className="animate-check-appear">✓</span> Copied
                </span>
              ) : 'Copy output'}
            </Button>
            {onShare ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full text-xs transition-all duration-200 hover:scale-105 active:scale-95"
                onClick={onShare}
              >
                <Share2 className="mr-1.5 h-3 w-3" />
                Share
              </Button>
            ) : null}
            {onSignUp ? (
              <Button
                type="button"
                variant="default"
                size="sm"
                className="rounded-full text-xs transition-all duration-200 hover:scale-105 active:scale-95"
                onClick={onSignUp}
              >
                Continue chat
                <ArrowRight className="ml-1.5 h-3 w-3" />
              </Button>
            ) : null}
            {hasSources ? (
              <span className="text-xs text-muted-foreground">
                {totalSources} {totalSources === 1 ? 'source' : 'sources'}
              </span>
            ) : null}
            {/* Context compression notification */}
            {message.analysisMetadata?.historyWasCompressed && message.status === 'done' ? (
              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                Older messages summarized
              </span>
            ) : null}
            {/* Context usage indicator - shows remaining conversation context (excludes reasoning tokens) */}
            {typeof message.analysisMetadata?.conversationContextPercent === 'number' && message.status === 'done' ? (
              <span className="text-[10px] text-muted-foreground/60 font-mono">
                {100 - (message.analysisMetadata.conversationContextPercent as number)}% context left
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={`rounded-full transition-all duration-200 ${feedbackState === 'positive' ? 'text-emerald-500 bg-emerald-500/10 animate-success-pop' : 'text-muted-foreground hover:text-foreground hover:scale-110'}`}
                onClick={handleThumbsUp}
                disabled={!onFeedback || feedbackState === 'positive'}
                title="Good response"
              >
                <ThumbsUp className={`h-3.5 w-3.5 transition-transform ${feedbackState === 'positive' ? 'scale-110' : ''}`} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={`rounded-full transition-all duration-200 ${feedbackState === 'negative' ? 'text-destructive bg-destructive/10 animate-success-pop' : 'text-muted-foreground hover:text-foreground hover:scale-110'}`}
                onClick={handleThumbsDown}
                disabled={!onFeedback || feedbackState === 'negative'}
                title="Bad response"
              >
                <ThumbsDown className={`h-3.5 w-3.5 transition-transform ${feedbackState === 'negative' ? 'scale-110' : ''}`} />
              </Button>
            </div>
          </div>
        ) : null}

        {message.status === 'failed' ? (
          <p className="mt-3 text-xs text-destructive">Failed to generate response. Please try again.</p>
        ) : null}
        {message.status === 'cancelled' ? (
          <p className="mt-3 text-xs text-muted-foreground">Request was cancelled.</p>
        ) : null}

        {showFeedbackModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowFeedbackModal(false)}>
            <div className="mx-4 w-full max-w-md rounded-2xl bg-background p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">What went wrong?</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full"
                  onClick={() => setShowFeedbackModal(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <textarea
                className="w-full rounded-xl border border-border bg-muted/30 p-3 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none sm:text-sm"
                rows={4}
                placeholder="Please describe the issue (optional)..."
                value={feedbackComment}
                onChange={(e) => setFeedbackComment(e.target.value)}
                autoFocus
              />
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFeedbackModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSubmitNegativeFeedback}
                  disabled={isSubmittingFeedback}
                >
                  {isSubmittingFeedback ? 'Submitting...' : 'Submit'}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

      </div>
    </div>
  );
}

function AttachmentPanel({ attachment, defaultOpen }: { attachment: DataAttachment; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const rowCount = attachment.rows.length;
  const previewRows = attachment.rows.slice(0, 12);
  const isCalculated = attachment.lineage?.kind === 'calculated' || attachment.id.includes('calculation');

  return (
    <div className={cn(
      'overflow-hidden rounded-xl border bg-background/85 shadow-sm',
      isCalculated ? 'border-emerald-500/30' : 'border-border/70',
    )}>
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={open ? 'Collapse table' : 'Expand table'}
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', open ? 'rotate-0' : '-rotate-90')} />
        </button>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium leading-snug text-foreground">{attachment.title}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{rowCount} rows</span>
            {isCalculated ? (
              <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                calculation
              </span>
            ) : null}
          </div>
          {attachment.lineage?.summary ? (
            <p className="mt-1 text-xs leading-snug text-muted-foreground">{attachment.lineage.summary}</p>
          ) : null}
        </button>
        <AttachmentDownload attachment={attachment} />
      </div>

      {open ? (
        <div className="border-t border-border/70 bg-muted/20 px-3 py-3">
          <div
            className="overflow-x-auto rounded-lg border border-border/60 bg-background"
            style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain' }}
          >
            <table className="min-w-full text-left text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  {attachment.headers.map((header) => (
                    <th key={header} className="whitespace-nowrap px-3 py-2 font-medium">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, rowIndex) => (
                  <tr key={`${attachment.id}-${rowIndex}`} className="border-t border-border/50">
                    {attachment.headers.map((header, cellIndex) => (
                      <td key={`${header}-${cellIndex}`} className="max-w-[220px] whitespace-nowrap px-3 py-2 text-foreground">
                        {row[cellIndex] === null || row[cellIndex] === undefined ? <span className="text-muted-foreground">-</span> : String(row[cellIndex])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rowCount > previewRows.length ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing first {previewRows.length} rows. Download CSV for the full table.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AttachmentDownload({ attachment }: { attachment: DataAttachment }) {
  const handleDownload = useCallback(() => {
    const blob = new Blob([attachment.csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${attachment.title.replace(/[^a-z0-9]/gi, '_')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [attachment.csv, attachment.title]);

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      aria-label={`Download ${attachment.title}`}
      title={`Download ${attachment.title}`}
    >
      <Download className="h-3.5 w-3.5" />
    </button>
  );
}

function CopyableTable({ style, ...props }: HTMLAttributes<HTMLTableElement>) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const table = tableRef.current;
    if (!table) return;

    const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
      Array.from(row.querySelectorAll('th,td')).map((cell) => cell.textContent?.trim() ?? ''),
    );
    if (rows.length === 0) return;

    try {
      await navigator.clipboard.writeText(rows.map((cells) => cells.join('\t')).join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error('Failed to copy table', error);
    }
  }, []);

  return (
    <div
      className="my-4 overflow-x-auto rounded-xl border border-border/60 bg-card/80 shadow-sm touch-pan-x"
      style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain' }}
    >
      <div className="flex justify-end px-3 pt-3">
        <Button type="button" variant="ghost" size="sm" className="rounded-full text-xs" onClick={handleCopy}>
          {copied ? 'Copied ✓' : 'Copy table'}
        </Button>
      </div>
      <table
        ref={tableRef}
        className="w-full divide-y divide-border"
        style={{ minWidth: 'max-content', ...style }}
        {...props}
      />
    </div>
  );
}
