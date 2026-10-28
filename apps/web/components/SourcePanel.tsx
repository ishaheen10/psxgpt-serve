import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Columns2, Copy, Eye, ExternalLink, FileText, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { Button } from './ui';
import { Badge } from './ui';
import { ScrollArea } from './ui';
import type { SourcePreview } from '../types';
import { cn } from '../types';

interface SourcePanelProps {
  sources: SourcePreview[];
  context?: string | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  showBadge?: boolean;
  splitView?: boolean;
  onToggleSplitView?: () => void;
  splitViewZoom?: number;
  onZoomChange?: (value: number) => void;
}

export function SourcePanel({
  sources,
  context,
  collapsed = false,
  onToggleCollapse,
  showBadge = false,
  splitView = false,
  onToggleSplitView,
  splitViewZoom = 80,
  onZoomChange,
}: SourcePanelProps) {
  const [contextCopied, setContextCopied] = useState(false);
  const hasSources = sources.length > 0;
  const groupedSources = useMemo(() => groupSources(sources), [sources]);
  const [openDesktopGroups, setOpenDesktopGroups] = useState<Set<string>>(() => new Set());
  const { splitSources, indexLookup } = useMemo(() => {
    const deduped: SourcePreview[] = [];
    const lookup: number[] = [];
    const keyMap = new Map<string, number>();

    sources.forEach((source, idx) => {
      const keyBase = source.pdfUrl || `${source.ticker}-${source.pageNumber ?? source.pageLabel ?? idx}`;
      const key = `${keyBase}`;
      let targetIndex = keyMap.get(key);
      if (targetIndex === undefined) {
        targetIndex = deduped.length;
        keyMap.set(key, targetIndex);
        deduped.push(source);
      }
      lookup[idx] = targetIndex;
    });

    return { splitSources: deduped, indexLookup: lookup };
  }, [sources]);
  const splitSourcesCount = splitSources.length;
  const panelWidthClass = splitView ? 'w-full' : 'w-[320px]';
  const listPaddingClass = splitView ? 'px-6' : 'px-4';
  const cardSpacingClass = splitView ? 'space-y-4' : 'space-y-2';
  const showDetails = !splitView;
  const canZoom = splitView && Boolean(onZoomChange);
  const displayZoom = Math.round(splitViewZoom);
  const MIN_ZOOM = 60;
  const MAX_ZOOM = 150;
  const ZOOM_STEP = 20;
  const canZoomOut = displayZoom > MIN_ZOOM;
  const canZoomIn = displayZoom < MAX_ZOOM;
  const [activeSplitIndex, setActiveSplitIndex] = useState(0);
  const activeSource = splitSourcesCount ? splitSources[Math.min(activeSplitIndex, splitSourcesCount - 1)] : null;
  const splitViewSrc = useMemo(() => {
    if (!activeSource?.pdfUrl || sourceKind(activeSource) === 'web') return null;
    const zoomFragment = `zoom=${displayZoom}`;
    const baseHasHash = activeSource.pdfUrl.includes('#');
    const joiner = baseHasHash ? '&' : '#';
    const hashParts = ['toolbar=0', 'navpanes=0', 'scrollbar=0', zoomFragment];
    if (activeSource.pageNumber && !baseHasHash) {
      hashParts.unshift(`page=${activeSource.pageNumber}`);
    }
    return `${activeSource.pdfUrl}${joiner}${hashParts.join('&')}`;
  }, [activeSource, displayZoom]);

  useEffect(() => {
    if (!splitSourcesCount) {
      setActiveSplitIndex(0);
      return;
    }
    setActiveSplitIndex((prev) => {
      if (prev >= splitSourcesCount) {
        return Math.max(0, splitSourcesCount - 1);
      }
      return prev;
    });
  }, [splitSourcesCount]);

  const handleDesktopCardSelect = (index: number) => {
    const targetIndex = indexLookup[index] ?? 0;
    setActiveSplitIndex(targetIndex);
    if (!splitView) {
      onToggleSplitView?.();
    }
  };

  const canPrevPage = activeSplitIndex > 0;
  const canNextPage = activeSplitIndex < splitSourcesCount - 1;
  const goPrevPage = () => setActiveSplitIndex((prev) => Math.max(0, prev - 1));
  const goNextPage = () => setActiveSplitIndex((prev) => Math.min(splitSourcesCount - 1, prev + 1));

  useEffect(() => {
    setContextCopied(false);
  }, [context]);

  useEffect(() => {
    setOpenDesktopGroups(defaultOpenGroups(groupedSources));
  }, [groupedSources]);

  const toggleDesktopGroup = (key: string) => {
    setOpenDesktopGroups((prev) => toggleGroupKey(prev, key));
  };

  const handleCopyContext = async () => {
    if (!context) return;
    try {
      await navigator.clipboard.writeText(context);
      setContextCopied(true);
      window.setTimeout(() => setContextCopied(false), 1500);
    } catch (error) {
      console.error('Failed to copy context', error);
    }
  };

  if (collapsed) {
    return (
      <aside className="hidden lg:flex w-12 flex-col items-center justify-between border-l bg-background/95 backdrop-blur-sm py-4 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          onClick={onToggleCollapse}
          aria-label="Expand sources"
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
        <div className="relative -rotate-90 text-xs font-semibold tracking-wide text-muted-foreground">
          Sources
          {showBadge && <span className="absolute -right-2 top-1 h-2 w-2 rounded-full bg-primary" />}
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        'hidden lg:flex min-h-0 flex-col border-l bg-background/95 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
        panelWidthClass,
        splitView && 'min-w-0',
      )}
    >
      <header className="border-b px-5 py-3">
        <div className="flex flex-nowrap items-center justify-between gap-2">
          <div className="flex flex-nowrap items-center gap-2 min-w-0">
            {onToggleSplitView && (
              <Button
                variant={splitView ? 'default' : 'ghost'}
                size="sm"
                onClick={onToggleSplitView}
                aria-pressed={splitView}
                className="gap-2"
              >
                <Columns2 className="h-4 w-4" />
                <span className="text-xs font-semibold">{splitView ? 'Exit split' : 'Split view'}</span>
              </Button>
            )}
            {splitView && splitSourcesCount ? (
              <div className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-1 text-xs font-semibold text-foreground">
                <span className="uppercase tracking-wide text-muted-foreground/90">Page</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={goPrevPage}
                  aria-label="Previous page"
                  disabled={!canPrevPage}
                >
                  <ChevronLeft className="h-3 w-3" />
                </Button>
                <span className="min-w-[4ch] text-center">
                  {splitSourcesCount ? `${activeSplitIndex + 1}/${splitSourcesCount}` : '0/0'}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={goNextPage}
                  aria-label="Next page"
                  disabled={!canNextPage}
                >
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            ) : null}
          </div>
          <div className="flex flex-nowrap items-center justify-end gap-1.5 min-w-0">
            {canZoom && (
              <div className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 px-2 py-1 text-xs">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => canZoomOut && onZoomChange?.(displayZoom - ZOOM_STEP)}
                  aria-label="Zoom out"
                  disabled={!canZoomOut}
                >
                  <span className="text-base leading-none">−</span>
                </Button>
                <span className="min-w-[3ch] text-center font-semibold">{displayZoom}%</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => canZoomIn && onZoomChange?.(displayZoom + ZOOM_STEP)}
                  aria-label="Zoom in"
                  disabled={!canZoomIn}
                >
                  <span className="text-base leading-none">+</span>
                </Button>
              </div>
            )}
            {context ? (
              <Button
                variant="ghost"
                size="sm"
                className={cn('gap-1 transition-colors', contextCopied && 'text-primary')}
                onClick={handleCopyContext}
              >
                <Copy className={cn('h-3.5 w-3.5 transition-transform', contextCopied && 'scale-110')} />
                <span className="text-xs font-semibold">
                  {contextCopied ? 'Context copied!' : 'Copy context'}
                </span>
              </Button>
            ) : null}
            {onToggleCollapse && (
              <Button variant="ghost" size="icon" onClick={onToggleCollapse} aria-label="Collapse sources">
                <PanelRightClose className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </header>

      {splitView && splitSourcesCount && splitViewSrc ? (
        <div className="px-5 py-4">
          <div className="relative h-[82vh] w-full overflow-hidden rounded-xl border border-border bg-background">
            <iframe
              key={`split-view-${activeSplitIndex}-${displayZoom}`}
              src={splitViewSrc}
              title={`${activeSource?.ticker || 'Source'} page preview`}
              className="h-full w-full"
            />

            {activeSource ? (
              <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                <span>{activeSource.ticker}</span>
                {activeSource.pageLabel ? (
                  <span className="ml-2 text-white/80">p.{activeSource.pageLabel}</span>
                ) : null}
              </div>
            ) : null}

            {activeSource?.pdfUrl && (
              <a
                href={activeSource.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-black/70 px-3 py-1 text-xs text-white transition-opacity hover:bg-black/80"
              >
                <ExternalLink className="h-3 w-3" />
                Open PDF
              </a>
            )}
          </div>
        </div>
      ) : null}

      {(!splitView || !hasSources) && (
        <ScrollArea className="flex-1 min-h-0">
          <div className={cn(cardSpacingClass, listPaddingClass, 'py-4')}>
            {hasSources ? (
              groupedSources.map((group) => (
                <SourceGroupSection
                  key={group.key}
                  group={group}
                  open={openDesktopGroups.has(group.key)}
                  onToggle={() => toggleDesktopGroup(group.key)}
                >
                  {group.sources.map(({ source, index }) => (
                    <SourceCard
                      key={`${source.id}-${source.pageLabel ?? 'page'}`}
                      source={source}
                      index={index}
                      showDetails={showDetails}
                      splitViewZoom={splitViewZoom}
                      onSelect={() => handleDesktopCardSelect(index)}
                    />
                  ))}
                </SourceGroupSection>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
                No source previews yet.
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </aside>
  );
}

interface MobileSourcesSheetProps {
  open: boolean;
  onClose: () => void;
  sources: SourcePreview[];
  context?: string | null;
}

export function MobileSourcesSheet({
  open,
  onClose,
  sources,
  context,
}: MobileSourcesSheetProps) {

  const hasSources = sources.length > 0;
  const groupedSources = useMemo(() => groupSources(sources), [sources]);
  const [openMobileGroups, setOpenMobileGroups] = useState<Set<string>>(() => new Set());
  const [isPagePeek, setIsPagePeek] = useState(false);
  const [activePeekIndex, setActivePeekIndex] = useState(0);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [contextCopied, setContextCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setIsPagePeek(false);
      setActivePeekIndex(0);
      return;
    }
    setOpenMobileGroups(defaultOpenGroups(groupedSources));
  }, [open, groupedSources]);

  const toggleMobileGroup = (key: string) => {
    setOpenMobileGroups((prev) => toggleGroupKey(prev, key));
  };

  useEffect(() => {
    if (!hasSources) {
      setOpenMobileGroups(new Set());
    }
  }, [hasSources]);

  useEffect(() => {
    setContextCopied(false);
  }, [context]);

  const handleCopyContext = async () => {
    if (!context) return;
    try {
      await navigator.clipboard.writeText(context);
      setContextCopied(true);
      window.setTimeout(() => setContextCopied(false), 1500);
    } catch (error) {
      console.error('Failed to copy context', error);
    }
  };

  useEffect(() => {
    if (!isPagePeek) return;
    const target = slideRefs.current[activePeekIndex];
    target?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [isPagePeek, activePeekIndex]);

  const openPeekAt = (index: number) => {
    setActivePeekIndex(index);
    setIsPagePeek(true);
  };

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 transition-opacity duration-300 ease-out lg:hidden',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm transition-opacity duration-300" onClick={onClose} aria-hidden="true" />
      <section
        className={cn(
          'absolute inset-x-0 bottom-0 max-h-[95vh] rounded-t-3xl border-t border-border bg-background shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
          open ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-5">
          <div className="mx-auto h-1.5 w-12 rounded-full bg-muted-foreground/40" />
          <header className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Sources</p>
              <p className="text-xs text-muted-foreground">
                {hasSources
                  ? isPagePeek
                    ? 'Swipe to preview pages'
                    : 'Tap Page to view'
                  : 'No source previews yet'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {context ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('rounded-full transition-colors', contextCopied && 'text-primary')}
                  onClick={handleCopyContext}
                  aria-label={contextCopied ? 'Context copied' : 'Copy context'}
                >
                  <Copy className={cn('h-4 w-4 transition-transform', contextCopied && 'scale-110')} />
                </Button>
              ) : null}
              <Button
                variant={isPagePeek ? 'default' : 'ghost'}
                size="sm"
                className="gap-1 rounded-full"
                onClick={() => setIsPagePeek((prev) => !prev)}
                aria-pressed={isPagePeek}
                disabled={!hasSources}
              >
                <Eye className="h-4 w-4" />
                <span className="text-xs font-semibold">Page Peek</span>
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close sources">
                <X className="h-5 w-5" />
              </Button>
            </div>
          </header>

          {isPagePeek ? (
            <div className="max-h-[70vh]">
              {hasSources ? (
                <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-6">
                  {sources.map((source, index) => (
                    <div
                      key={`${source.id}-${source.pageLabel ?? 'page'}`}
                      className="snap-center min-w-full"
                      ref={(el) => {
                        slideRefs.current[index] = el;
                      }}
                    >
                      <SourceCard
                        source={source}
                        index={index}
                        showDetails={false}
                        splitViewZoom={90}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-32 w-full items-center justify-center rounded-2xl border border-dashed bg-muted/30 px-6 text-sm text-muted-foreground">
                  No source previews yet.
                </div>
              )}
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              <div className="space-y-2 pb-6">
                {hasSources ? (
                  groupedSources.map((group) => (
                    <SourceGroupSection
                      key={group.key}
                      group={group}
                      open={openMobileGroups.has(group.key)}
                      onToggle={() => toggleMobileGroup(group.key)}
                    >
                      {group.sources.map(({ source, index }) => (
                        <SourceCard
                          key={`${source.id}-${source.pageLabel ?? 'page'}`}
                          source={source}
                          index={index}
                          onSelect={() => openPeekAt(index)}
                        />
                      ))}
                    </SourceGroupSection>
                  ))
                ) : (
                  <div className="flex h-32 w-full items-center justify-center rounded-2xl border border-dashed bg-muted/30 px-6 text-sm text-muted-foreground">
                    No source previews yet.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const EMPTY_META_VALUES = new Set(['none', 'null', 'n/a']);

type GroupedSource = { source: SourcePreview; index: number };
type SourceGroup = { key: string; title: string; sources: GroupedSource[] };

function defaultOpenGroups(groups: SourceGroup[]): Set<string> {
  if (groups.length <= 1) return new Set(groups.map((group) => group.key));
  return new Set(groups.slice(0, 1).map((group) => group.key));
}

function toggleGroupKey(prev: Set<string>, key: string): Set<string> {
  const next = new Set(prev);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function sourceKind(source: SourcePreview): string {
  if (String(source.id).startsWith('web:')) return 'web';
  if (source.sourceType === 'macro') return macroSourceKind(source);
  if (source.sourceType) return source.sourceType;
  if (/announcement/i.test(source.filingType || '')) return 'announcement';
  if (String(source.id).startsWith('direct:')) return 'statement';
  if (source.pdfUrl || source.thumbnailUrl) return 'filing';
  return 'unstructured';
}

function macroSourceKind(source: SourcePreview): string {
  const sourceDoc = String(source.sourceDoc || '').toLowerCase();
  const docType = String(source.docType || '').toLowerCase();
  if (sourceDoc === 'economic_survey_2025' || docType === 'economic_survey') return 'macro:economic_survey';
  if (sourceDoc === 'budget_2025_26' || docType === 'budget') return 'macro:budget';
  if (sourceDoc === 'sbp_annual_2025' || docType === 'sbp_report') return 'macro:sbp_report';

  const haystack = [
    source.pdfUrl,
    source.thumbnailUrl,
    sourceDoc,
    docType,
    source.ticker,
    source.filingType,
    source.snippet,
  ].filter(Boolean).join(' ').toLowerCase();
  if (haystack.includes('economic_survey') || haystack.includes('economic survey')) return 'macro:economic_survey';
  if (haystack.includes('budget')) return 'macro:budget';
  if (haystack.includes('sbp_annual') || haystack.includes('sbp report') || haystack.includes('sbp')) return 'macro:sbp_report';
  return 'macro';
}

function sourceGroupTitle(kind: string): string {
  if (kind === 'web') return 'Web sources';
  if (kind === 'statement') return 'Statements';
  if (kind === 'announcement') return 'Announcements';
  if (kind === 'macro:economic_survey') return 'Economic Survey';
  if (kind === 'macro:budget') return 'Budget';
  if (kind === 'macro:sbp_report') return 'SBP Report';
  if (kind === 'macro') return 'Macro';
  if (kind === 'filing') return 'Filings';
  return 'Unstructured text';
}

function groupSources(sources: SourcePreview[]) {
  const order = [
    'statement',
    'announcement',
    'macro:economic_survey',
    'macro:budget',
    'macro:sbp_report',
    'macro',
    'filing',
    'web',
    'unstructured',
  ];
  const groups = new Map<string, SourceGroup>();
  sources.forEach((source, index) => {
    const key = sourceKind(source);
    if (!groups.has(key)) groups.set(key, { key, title: sourceGroupTitle(key), sources: [] });
    groups.get(key)!.sources.push({ source, index });
  });
  return [...groups.values()].sort((a, b) => {
    const ai = order.indexOf(a.key);
    const bi = order.indexOf(b.key);
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
  });
}

function SourceGroupSection({
  group,
  open,
  onToggle,
  children,
}: {
  group: SourceGroup;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-muted/10">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="min-w-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {group.title}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          {group.sources.length}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        </span>
      </button>
      {open ? <div className="space-y-2 border-t border-border/60 p-2">{children}</div> : null}
    </section>
  );
}

function normalizeMeta(value?: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (EMPTY_META_VALUES.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

function normalizeSnippet(value?: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (EMPTY_META_VALUES.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

function SourceCard({
  source,
  index,
  showDetails = true,
  splitViewZoom = 80,
  onSelect,
}: {
  source: SourcePreview;
  index: number;
  showDetails?: boolean;
  splitViewZoom?: number;
  onSelect?: (source: SourcePreview, index: number) => void;
}) {
  const webSource = sourceKind(source) === 'web';
  if (webSource) showDetails = true;
  const filingPeriod = normalizeMeta(source.filingPeriod);
  const pageLabel = normalizeMeta(source.pageLabel);
  const sectionType = normalizeMeta(source.sectionType);
  const snippet = normalizeSnippet(source.snippet);
  const kindLabel = sourceGroupTitle(sourceKind(source)).replace(/s$/, '');
  const baseCardClasses = showDetails
    ? 'group relative flex gap-3 rounded-xl border border-border bg-card p-3 transition-all duration-200 hover:border-primary/40 hover:shadow-lg hover:-translate-y-0.5'
    : 'group relative rounded-xl border border-border bg-card p-2 transition-all duration-200 hover:border-primary/40 hover:shadow-xl hover:-translate-y-1';

  const thumbnailWrapperClasses = showDetails
    ? 'relative flex-shrink-0'
    : 'relative flex items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-muted';

  const thumbnailSizeClasses = showDetails ? 'h-14 w-10' : 'w-full';
  const renderPdf = !showDetails && Boolean(source.pdfUrl);

  const content = (
    <div className={baseCardClasses}>
      {/* Thumbnail */}
      <div className={thumbnailWrapperClasses}>
        {renderPdf && source.pdfUrl ? (
          <div className="relative flex w-full flex-col">
            <div className="relative h-[82vh] w-full overflow-hidden rounded-lg bg-background">
              <iframe
                key={`${source.id}-${splitViewZoom}`}
                src={`${source.pdfUrl}#toolbar=0&navpanes=0&scrollbar=0&zoom=${splitViewZoom}`}
                title={`${source.ticker} page preview`}
                className="h-full w-full"
              />
            </div>
            <div className="pointer-events-none absolute inset-0 rounded-lg border border-primary/60 opacity-0 transition-opacity group-hover:opacity-100" />
            <a
              href={source.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-black/70 px-3 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
            >
              <ExternalLink className="h-3 w-3" />
              Open PDF
            </a>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 py-3 text-xs text-white">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-wide">
                <span>{source.ticker}</span>
                {pageLabel && <span className="text-white/80">p.{pageLabel}</span>}
              </div>
              {filingPeriod && <p className="text-[11px] text-white/80">{filingPeriod}</p>}
            </div>
          </div>
        ) : source.thumbnailUrl ? (
          <div
            className={cn(
              'relative overflow-hidden rounded border border-border/50 bg-muted',
              thumbnailSizeClasses,
              showDetails ? undefined : 'p-2',
            )}
          >
            <img
              src={source.thumbnailUrl}
              alt={`${source.ticker} page ${source.pageLabel || ''}`}
              className={cn(
                showDetails
                  ? 'h-full w-full object-cover object-top'
                  : 'mx-auto max-h-[82vh] w-auto max-w-full object-contain bg-background',
              )}
              loading="lazy"
            />
            {/* Hover overlay */}
            <div className="absolute inset-0 flex items-center justify-center">
              <ExternalLink className="h-3.5 w-3.5 text-white opacity-0 transition-opacity group-hover:opacity-100 drop-shadow" />
            </div>
            {!showDetails && (
              <>
                <div className="pointer-events-none absolute inset-0 border border-primary/60 opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-3 text-xs text-white">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-wide">
                    <span>{source.ticker}</span>
                    {pageLabel && <span className="text-white/80">p.{pageLabel}</span>}
                  </div>
                  {filingPeriod && <p className="text-[11px] text-white/80">{filingPeriod}</p>}
                </div>
              </>
            )}
          </div>
        ) : (
          <div
            className={cn(
              'flex items-center justify-center rounded border border-dashed border-border/50 bg-muted/50',
              thumbnailSizeClasses,
            )}
          >
            <FileText className={cn('text-muted-foreground/50', showDetails ? 'h-5 w-5' : 'h-10 w-10')} />
          </div>
        )}
      </div>

      {/* Content */}
      {showDetails && (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
              <Badge variant="secondary" className="text-[10px] font-semibold uppercase tracking-wide">
                {source.ticker}
              </Badge>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {kindLabel}
              </span>
              {filingPeriod && <span className="text-muted-foreground">{filingPeriod}</span>}
              {pageLabel && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  p.{pageLabel}
                </span>
              )}
            </div>
          </div>

          {/* Section title */}
          {sectionType && (
            <p className="text-sm font-medium leading-snug capitalize line-clamp-1">{sectionType.replace(/_/g, ' ')}</p>
          )}

          {/* Snippet preview */}
          {snippet && <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2">{snippet}</p>}
        </div>
      )}
    </div>
  );

  if (source.pdfUrl) {
    if (onSelect && !webSource) {
      return (
        <button
          type="button"
          className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded-xl"
          onClick={() => onSelect(source, index)}
        >
          {content}
        </button>
      );
    }
    return (
      <a
        href={source.pdfUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
      >
        {content}
      </a>
    );
  }

  if (onSelect) {
    return (
      <button
        type="button"
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded-xl"
        onClick={() => onSelect(source, index)}
      >
        {content}
      </button>
    );
  }

  return content;
}
