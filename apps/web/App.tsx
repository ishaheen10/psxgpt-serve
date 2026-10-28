import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { ThemeProvider } from './components/Theme';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import type { InfoPageId } from './components/Sidebar';
import { ChatInterface } from './components/ChatInterface';
import { SourcePanel, MobileSourcesSheet } from './components/SourcePanel';
import { useChat } from './hooks/useChat';
import { API_BASE_URL } from './hooks/useWebSocket';
import TickersModal from './components/TickersModal';
import { SignInDialog } from './components/SignInDialog';
import { ShareDialog } from './components/ShareDialog';
const SharedViewApp = lazy(() => import('./components/SharedViewApp').then(m => ({ default: m.SharedViewApp })));
const DocsApp = lazy(() => import('./components/DocsApp').then(m => ({ default: m.DocsApp })));
const DataHealthApp = lazy(() => import('./components/DataHealthApp').then(m => ({ default: m.DataHealthApp })));
const EquitiesReportApp = lazy(() => import('./components/EquitiesReportApp').then(m => ({ default: m.EquitiesReportApp })));
const AdminDataQualityApp = lazy(() => import('./components/AdminTracesApp').then(m => ({ default: m.AdminDataQualityApp })));
const AdminTracesApp = lazy(() => import('./components/AdminTracesApp').then(m => ({ default: m.AdminTracesApp })));
const UserTraceApp = lazy(() => import('./components/trace/UserTraceApp').then(m => ({ default: m.UserTraceApp })));
import { cn } from './types';
import { Button } from './components/ui';
import type { ChatMessage, SourcePreview } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// UI State Reducer
// ─────────────────────────────────────────────────────────────────────────────

interface UIState {
  tickersOpen: boolean;
  signInOpen: boolean;
  shareDialogOpen: boolean;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  sourcesDrawerOpen: boolean;
  sourcesCollapsed: boolean;
  sourcesHasUpdate: boolean;
  splitView: boolean;
  splitViewZoom: number;
  inputFocusTrigger: number;
  infoPage: InfoPageId | null;
  selectedSources: SourcePreview[] | null;
  selectedContext: string | null;
}

type UIAction =
  | { type: 'SET_TICKERS'; open: boolean }
  | { type: 'SET_SIGN_IN'; open: boolean }
  | { type: 'SET_SHARE_DIALOG'; open: boolean }
  | { type: 'SET_SIDEBAR'; open: boolean }
  | { type: 'TOGGLE_SIDEBAR_COLLAPSE' }
  | { type: 'SET_SIDEBAR_COLLAPSED'; collapsed: boolean }
  | { type: 'SET_SOURCES_DRAWER'; open: boolean }
  | { type: 'TOGGLE_SOURCES_COLLAPSE' }
  | { type: 'SET_SOURCES_HAS_UPDATE'; hasUpdate: boolean }
  | { type: 'TOGGLE_SPLIT_VIEW'; sidebarCollapsedMemory: boolean }
  | { type: 'EXIT_SPLIT_VIEW'; restoreCollapsed: boolean }
  | { type: 'SET_SPLIT_VIEW_ZOOM'; zoom: number }
  | { type: 'TRIGGER_INPUT_FOCUS' }
  | { type: 'SET_INFO_PAGE'; page: InfoPageId | null }
  | { type: 'SET_SELECTED_SOURCES'; sources: SourcePreview[] | null; context: string | null }
  | { type: 'CLEAR_OVERLAYS' };

const initialUIState: UIState = {
  tickersOpen: false,
  signInOpen: false,
  shareDialogOpen: false,
  sidebarOpen: false,
  sidebarCollapsed: false,
  sourcesDrawerOpen: false,
  sourcesCollapsed: false,
  sourcesHasUpdate: false,
  splitView: false,
  splitViewZoom: 80,
  inputFocusTrigger: 0,
  infoPage: null,
  selectedSources: null,
  selectedContext: null,
};

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'SET_TICKERS':
      return { ...state, tickersOpen: action.open };
    case 'SET_SIGN_IN':
      return { ...state, signInOpen: action.open };
    case 'SET_SHARE_DIALOG':
      return { ...state, shareDialogOpen: action.open };
    case 'SET_SIDEBAR':
      return { ...state, sidebarOpen: action.open };
    case 'TOGGLE_SIDEBAR_COLLAPSE':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
    case 'SET_SIDEBAR_COLLAPSED':
      return { ...state, sidebarCollapsed: action.collapsed };
    case 'SET_SOURCES_DRAWER':
      return { ...state, sourcesDrawerOpen: action.open };
    case 'TOGGLE_SOURCES_COLLAPSE':
      return { ...state, sourcesCollapsed: !state.sourcesCollapsed };
    case 'SET_SOURCES_HAS_UPDATE':
      return { ...state, sourcesHasUpdate: action.hasUpdate };
    case 'TOGGLE_SPLIT_VIEW':
      if (state.splitView) {
        return { ...state, splitView: false, splitViewZoom: 80 };
      }
      return { ...state, splitView: true, sidebarCollapsed: true, sourcesCollapsed: false, splitViewZoom: 80 };
    case 'EXIT_SPLIT_VIEW':
      return { ...state, splitView: false, sidebarCollapsed: action.restoreCollapsed, splitViewZoom: 80 };
    case 'SET_SPLIT_VIEW_ZOOM':
      return { ...state, splitViewZoom: Math.min(150, Math.max(60, Math.round(action.zoom))) };
    case 'TRIGGER_INPUT_FOCUS':
      return { ...state, inputFocusTrigger: state.inputFocusTrigger + 1 };
    case 'SET_INFO_PAGE':
      return { ...state, infoPage: action.page };
    case 'SET_SELECTED_SOURCES':
      return { ...state, selectedSources: action.sources, selectedContext: action.context };
    case 'CLEAR_OVERLAYS':
      return { ...state, sidebarOpen: false, sourcesDrawerOpen: false };
    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useReducer((_: boolean, v: boolean) => v, false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isDesktop;
}

function useAppHeight() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;

    const update = () => {
      const viewport = window.visualViewport;
      const height = (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0);
      root.style.setProperty('--app-height', `${height}px`);
    };

    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);

    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);
}

// Hash-based routing for shared conversation URLs
function useSharedViewRoute() {
  const [sharedId, setSharedId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkHash = () => {
      const hash = window.location.hash;
      // Match both legacy #/s/abc123xy links and path-based /s/abc123xy links.
      const match = hash.match(/^#\/s\/([a-z0-9]+)$/i) || window.location.pathname.match(/^\/s\/([a-z0-9]+)$/i);
      setSharedId(match ? match[1] : null);
    };

    checkHash();
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  }, []);

  return sharedId;
}

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  return <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}><Application /></Suspense>;
}

function Application() {
  // Check if viewing a shared conversation URL
  const sharedId = useSharedViewRoute();

  // Public docs page at /docs (path-based; Cloudflare Pages SPA fallback serves index.html)
  if (typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/docs') {
    return <DocsApp />;
  }

  if (typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/data-health') {
    return <DataHealthApp />;
  }

  if (typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/equities') {
    return <EquitiesReportApp />;
  }

  if (typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/admin/traces') {
    return <AdminTracesApp />;
  }

  // User-facing trace page at /trace/:engineId (owner-accessible)
  if (typeof window !== 'undefined' && /^\/trace\/[^/]+$/.test(window.location.pathname.replace(/\/+$/, ''))) {
    return <UserTraceApp />;
  }

  if (typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/admin/data-quality') {
    return <AdminDataQualityApp />;
  }

  if (sharedId) {
    return <SharedViewApp shareId={sharedId} />;
  }

  return <MainApp />;
}

function MainApp() {
  const chat = useChat();
  const [ui, dispatch] = useReducer(uiReducer, initialUIState);
  const sidebarCollapsedMemory = useRef(false);
  const queryPrefillAppliedRef = useRef(false);
  const queryAutoRunAppliedRef = useRef(false);
  const isDesktop = useIsDesktop();
  useAppHeight();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const prompt = url.searchParams.get('q');
    if (!prompt?.trim()) return;
    const cleanPrompt = prompt.trim();
    const shouldRun = url.searchParams.get('run') === '1';

    if (!queryPrefillAppliedRef.current) {
      queryPrefillAppliedRef.current = true;
      chat.setInput(cleanPrompt);
      dispatch({ type: 'TRIGGER_INPUT_FOCUS' });
      if (!shouldRun) {
        url.searchParams.delete('q');
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      }
    }

    if (shouldRun && chat.user && !chat.isGuest && !queryAutoRunAppliedRef.current) {
      queryAutoRunAppliedRef.current = true;
      void chat.submitPrompt(cleanPrompt);
      url.searchParams.delete('q');
      url.searchParams.delete('run');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [chat]);

  // Derived values
  const panelSources = ui.selectedSources ?? chat.sourcePreviews;
  const panelContext = ui.selectedContext ?? chat.sourceContext ?? null;
  const hasReferenceData = panelSources.length > 0;

  const chatHistory = useMemo(
    () =>
      chat.chats.map((c: any) => ({
        id: typeof c.session_id === 'string' ? c.session_id : c.id,
        query: typeof c.query === 'string' ? c.query : (typeof c.prompt === 'string' ? c.prompt : 'Untitled chat'),
        createdAt: c.createdAt ?? c.created_at,
        messageCount: c.messageCount,
        folderId: c.folderId ?? null,
        folderName: c.folderName ?? null,
        matchRole: c.matchRole ?? null,
        matchSnippet: c.matchSnippet ?? null,
      })),
    [chat.chats],
  );

  // ────────────────────────────────────────────────────────────────
  // Effects
  // ────────────────────────────────────────────────────────────────

  // Import shared conversation after authentication
  useEffect(() => {
    if (!chat.user) return;

    const pendingShareId = localStorage.getItem('pendingSharedImport');
    if (!pendingShareId) return;

    // Clear immediately to prevent re-importing
    localStorage.removeItem('pendingSharedImport');

    // Clear the hash route to go to main app
    if (window.location.hash.startsWith('#/s/')) {
      window.location.hash = '';
    }

    // Import the shared conversation
    chat.importSharedConversation(pendingShareId).then((sessionId) => {
      if (sessionId) {
        console.log('[App] Imported shared conversation into session:', sessionId);
      }
    });
  }, [chat.user, chat.importSharedConversation]);

  // Open a session that was imported via "Continue conversation" (logged-in user flow)
  useEffect(() => {
    if (!chat.user) return;

    const pendingSessionId = localStorage.getItem('pendingOpenSession');
    if (!pendingSessionId) return;

    localStorage.removeItem('pendingOpenSession');
    console.log('[App] Opening imported session:', pendingSessionId);
    chat.openChat(pendingSessionId);
  }, [chat.user, chat.openChat]);

  // Exit split view when conditions change
  useEffect(() => {
    if ((!isDesktop || !hasReferenceData) && ui.splitView) {
      dispatch({ type: 'EXIT_SPLIT_VIEW', restoreCollapsed: sidebarCollapsedMemory.current });
    }
  }, [isDesktop, hasReferenceData, ui.splitView]);

  // Clear source overrides when sources change
  useEffect(() => {
    dispatch({ type: 'SET_SELECTED_SOURCES', sources: null, context: null });
  }, [chat.sourcePreviews, chat.sourceContext]);

  // Close overlays on desktop
  useEffect(() => {
    if (isDesktop) dispatch({ type: 'CLEAR_OVERLAYS' });
  }, [isDesktop]);

  // Mobile sources badge
  useEffect(() => {
    if (isDesktop || !hasReferenceData) {
      dispatch({ type: 'SET_SOURCES_HAS_UPDATE', hasUpdate: false });
    } else {
      dispatch({ type: 'SET_SOURCES_HAS_UPDATE', hasUpdate: !ui.sourcesDrawerOpen });
    }
  }, [isDesktop, hasReferenceData, ui.sourcesDrawerOpen]);

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────

  const handleSignInClick = useCallback(() => dispatch({ type: 'SET_SIGN_IN', open: true }), []);
  const handleSignOutClick = useCallback(() => void chat.signOut?.(), [chat]);
  const handleShowTickers = useCallback(() => dispatch({ type: 'SET_TICKERS', open: true }), []);
  const handleShareClick = useCallback(() => dispatch({ type: 'SET_SHARE_DIALOG', open: true }), []);

  const handleGoogleSignIn = useCallback(() => {
    dispatch({ type: 'SET_SIGN_IN', open: false });
    chat.signInWithGoogle();
  }, [chat]);

  const handleMagicLink = useCallback((email: string) => chat.sendMagicLink(email), [chat]);

  const triggerComposerFocus = useCallback(() => dispatch({ type: 'TRIGGER_INPUT_FOCUS' }), []);

  const toggleSplitView = useCallback(() => {
    if (!ui.splitView) {
      sidebarCollapsedMemory.current = ui.sidebarCollapsed;
    }
    dispatch({ type: 'TOGGLE_SPLIT_VIEW', sidebarCollapsedMemory: sidebarCollapsedMemory.current });
  }, [ui.splitView, ui.sidebarCollapsed]);

  const openSourcesPanel = useCallback(() => {
    if (isDesktop) {
      dispatch({ type: 'TOGGLE_SOURCES_COLLAPSE' });
    } else {
      dispatch({ type: 'SET_SOURCES_DRAWER', open: true });
    }
  }, [isDesktop]);

  const extractMessageContext = (message?: ChatMessage) => {
    if (!message?.analysisMetadata) return null;
    const raw = message.analysisMetadata['retrievalContext'];
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  };

  const handleOpenSources = useCallback(
    (messageId: string) => {
      const target = chat.messages.find(
        (m) => m.id === messageId && m.role === 'assistant' && (m.sourcePreviews?.length ?? 0) > 0,
      );
      if (!target?.sourcePreviews?.length) return;
      dispatch({ type: 'SET_SELECTED_SOURCES', sources: target.sourcePreviews, context: extractMessageContext(target) });
      openSourcesPanel();
    },
    [chat.messages, openSourcesPanel],
  );

  const handleSidebarToggle = useCallback(() => {
    if (isDesktop) {
      dispatch({ type: 'TOGGLE_SIDEBAR_COLLAPSE' });
    } else {
      dispatch({ type: 'SET_SIDEBAR', open: true });
    }
  }, [isDesktop]);

  const handleNewChat = useCallback(
    (options?: { closeSidebar?: boolean }) => {
      dispatch({ type: 'SET_INFO_PAGE', page: null });
      chat.newChat();
      triggerComposerFocus();
      if (options?.closeSidebar) dispatch({ type: 'SET_SIDEBAR', open: false });
    },
    [chat, triggerComposerFocus],
  );

  const handleSelectChat = useCallback(
    (sessionId: string) => {
      dispatch({ type: 'SET_INFO_PAGE', page: null });
      chat.openChat(sessionId);
    },
    [chat],
  );

  const handleSelectInfoPage = useCallback(
    (pageId: InfoPageId) => {
      dispatch({ type: 'SET_INFO_PAGE', page: ui.infoPage === pageId ? null : pageId });
      if (!isDesktop) dispatch({ type: 'SET_SIDEBAR', open: false });
    },
    [ui.infoPage, isDesktop],
  );

  const handleFeedback = useCallback(
    async (messageId: string, feedback: 'positive' | 'negative', comment?: string) => {
      if (!chat.user) return;
      const token = await chat.getAccessToken?.();
      if (!token) return;

      const res = await fetch(`${API_BASE_URL}/api/messages/${messageId}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ feedback, comment }),
      });

      if (!res.ok) {
        throw new Error('Failed to submit feedback');
      }
    },
    [chat.user, chat.getAccessToken],
  );

  // ────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────

  return (
    <ThemeProvider>
      <div className="relative flex h-[var(--app-height,100vh)] bg-background">
        {/* Desktop Sidebar */}
        {isDesktop && (
          <div className={cn(
            "hidden lg:flex h-full transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
            ui.sidebarCollapsed ? "w-[72px]" : "w-64"
          )}>
            <Sidebar
              user={chat.user || undefined}
              chats={chat.user ? chatHistory : []}
              onNewChat={() => handleNewChat()}
              onSelectChat={handleSelectChat}
              onDeleteChat={chat.deleteChat}
              searchSessions={chat.searchSessions}
              folders={chat.folders || []}
              onCreateFolder={chat.createFolder}
              onAssignChatFolder={chat.assignChatFolder}
              onDeleteFolder={chat.deleteFolder}
              variant="desktop"
              collapsed={ui.sidebarCollapsed}
              onToggleCollapse={() => dispatch({ type: 'TOGGLE_SIDEBAR_COLLAPSE' })}
              onSelectInfoPage={handleSelectInfoPage}
              selectedInfoPage={ui.infoPage}
              onSignIn={handleSignInClick}
            />
          </div>
        )}

        {/* Mobile Sidebar */}
        {!isDesktop && (
          <Sidebar
            user={chat.user || undefined}
            chats={chat.user ? chatHistory : []}
            onNewChat={() => handleNewChat({ closeSidebar: true })}
            onSelectChat={handleSelectChat}
            onDeleteChat={chat.deleteChat}
            searchSessions={chat.searchSessions}
            folders={chat.folders || []}
            onCreateFolder={chat.createFolder}
            onAssignChatFolder={chat.assignChatFolder}
            onDeleteFolder={chat.deleteFolder}
            variant="mobile"
            isOpen={ui.sidebarOpen}
            onClose={() => dispatch({ type: 'SET_SIDEBAR', open: false })}
            onSelectInfoPage={handleSelectInfoPage}
            selectedInfoPage={ui.infoPage}
            onSignIn={handleSignInClick}
          />
        )}

        {/* Main Content */}
        <div className={cn(
          'flex-1 overflow-hidden min-w-0',
          ui.splitView ? 'lg:grid lg:grid-cols-2 lg:divide-x lg:divide-border' : 'flex',
        )}>
          <div className="flex flex-1 flex-col min-h-0 min-w-0">
            <Header
              user={chat.user}
              isGuest={chat.isGuest}
              onSignIn={handleSignInClick}
              onSignOut={handleSignOutClick}
              onToggleSidebar={handleSidebarToggle}
            />

            <div className="flex-1 overflow-hidden">
              {ui.infoPage ? (
                <InformationContent page={ui.infoPage} onClose={() => dispatch({ type: 'SET_INFO_PAGE', page: null })} />
              ) : (
                <ChatInterface
                  messages={chat.messages}
                  input={chat.input}
                  isLoading={chat.isLoading}
                  isGuest={chat.isGuest}
                  onInputChange={chat.setInput}
                  onSubmit={chat.handleSubmit}
                  onCancel={chat.cancelRequest}
                  onOpenSources={handleOpenSources}
                  onFeedback={handleFeedback}
                  onShare={chat.user && !chat.isGuest ? handleShareClick : undefined}
                  onShowTickers={handleShowTickers}
                  focusTrigger={ui.inputFocusTrigger}
                />
              )}
            </div>
          </div>

          {hasReferenceData && (
            <SourcePanel
              sources={panelSources}
              context={panelContext}
              collapsed={ui.sourcesCollapsed}
              onToggleCollapse={() => dispatch({ type: 'TOGGLE_SOURCES_COLLAPSE' })}
              showBadge={ui.sourcesHasUpdate}
              splitView={ui.splitView}
              onToggleSplitView={toggleSplitView}
              splitViewZoom={ui.splitViewZoom}
              onZoomChange={(z) => dispatch({ type: 'SET_SPLIT_VIEW_ZOOM', zoom: z })}
            />
          )}
        </div>

        {/* Modals */}
        <TickersModal open={ui.tickersOpen} onClose={() => dispatch({ type: 'SET_TICKERS', open: false })} />
        <SignInDialog
          open={ui.signInOpen}
          onClose={() => dispatch({ type: 'SET_SIGN_IN', open: false })}
          onGoogle={handleGoogleSignIn}
          onSendEmail={handleMagicLink}
        />
        <ShareDialog
          open={ui.shareDialogOpen}
          onClose={() => dispatch({ type: 'SET_SHARE_DIALOG', open: false })}
          onShare={chat.shareSession}
        />
        <MobileSourcesSheet
          open={ui.sourcesDrawerOpen && hasReferenceData}
          onClose={() => dispatch({ type: 'SET_SOURCES_DRAWER', open: false })}
          sources={panelSources}
          context={panelContext}
        />
      </div>
    </ThemeProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Info Pages
// ─────────────────────────────────────────────────────────────────────────────

const informationPageContent: Record<
  InfoPageId,
  { title: string; lead: string; sections: { heading: string; body: ReactNode }[] }
> = {
  'how-it-works': {
    title: 'How psxGPT works',
    lead: 'psxGPT is a source-grounded research engine for PSX equities: the corpus is curated before you ask, the query engine retrieves from that corpus, and every serious answer should leave a source trail.',
    sections: [
      {
        heading: 'Curated research stack',
        body: 'PSX annual and quarterly reports, filing pages, ticker-specific exchange announcements, macro reports, ratios, quality flags, and market data are normalized into the serving database. Each source is cleaned, tagged, and linked back to the exact statement row, filing page, announcement, or macro page that fed the answer.',
      },
      {
        heading: 'Retrieval and reasoning loop',
        body: 'When you ask a question, the router turns it into typed asks: tickers, tables, statement types, periods, concepts, and dependencies. Structured lanes query statement, ratio, and market tables. Narrative lanes use BM25 full-text search over compact search summaries written during the pipeline review pass, then shape and extract the best pages before the analyst writes.',
      },
      {
        heading: 'Why constrained context matters',
        body: 'psxGPT researches original company filings, PSX notices and economic documents, with dated market snapshots. Open the source pages to inspect the evidence, then follow up to refine the question. Progress shows what was searched and read.',
      },
      {
        heading: 'How failures improve it',
        body: 'A bad answer is classified as a routing, retrieval, data, compute, or synthesis failure. The fix path is to inspect the trace, repair the earliest broken artifact or serving rule, add an eval when the behavior should not regress, and record the change in the changelog.',
      },
    ],
  },
  'data-collection': {
    title: 'What data I collect',
    lead: 'To make psxGPT less glitchy, I log the question you ask, the answer you saw, and which audited documents powered it—nothing more.',
    sections: [
      {
        heading: 'Your questions & responses',
        body: 'I keep the text of your query, the structured reply psxGPT generated, and any follow-up you send. This helps me reproduce issues and see which prompts need clearer explanations or better formatting.',
      },
      {
        heading: 'Source trail',
        body: 'Alongside each answer I log which filing, ticker, and period were referenced so I can confirm the right PDF snippet was used. If a filing is missing or mis-tagged, the log tells me exactly what to fix.',
      },
      {
        heading: 'Performance notes',
        body: 'I record basic timing info (how long retrieval or streaming took) and whether the system had to retry. These signals surface slowdowns before they become outages.',
      },
      {
        heading: 'Privacy commitments',
        body: 'There is no ad tracking, no sale of usage data, and no scraping of sensitive uploads. Beyond your Supabase-auth email, I only store the minimal logs above, and you can ask for deletion whenever you like.',
      },
    ],
  },
  terms: {
    title: 'Terms for using psxGPT',
    lead: 'These lightweight terms cover the invite-only beta: psxGPT is an informational research companion, not a broker or advisor, and I may pause access to keep the community healthy.',
    sections: [
      {
        heading: 'Informational use only',
        body: 'psxGPT summarizes public filings and audited statements. It cannot guarantee completeness, does not replace licensed professionals, and should always be cross-checked with the cited source before you act on it.',
      },
      {
        heading: 'Fair usage & security',
        body: 'Beta accounts have daily query caps, and automated scraping, credential sharing, or attempts to reverse engineer the stack may lead to suspension. Cloudflare, Supabase auth, and encrypted storage protect the service, but you remain responsible for keeping your devices secure.',
      },
      {
        heading: 'Data handling & consent',
        body: 'Continuing to use psxGPT means you consent to the telemetry described in the Information tab so I can maintain uptime. I do not store passwords or sell personal data, and you can request deletion or export of your account at any point.',
      },
    ],
  },
  about: {
    title: 'Who made psxGPT',
    lead: 'psxGPT started with a simple question: how do I surface the absolute most relevant source in the shortest possible time for a given question and present its analysis elegantly?',
    sections: [
      {
        heading: 'Founder background',
        body: 'I am an analyst at heart. Most of my career was spent on M&A deals, teaching financial modeling, and helping build a tower-sharing company, with a few crazy startup experiments along the way. Two years ago I fell for programming; psxGPT now fuses that love of modeling and code, and honestly feels like a video game.',
      },
      {
        heading: 'The end game',
        body: 'I am building a system that improves itself with every query. Staying solo lets me own every step—from downloading PDFs to pinpointing exactly when a pipeline failed and how to heal it. I will keep running workshops so analysts can build similar stacks. The destination is a self-healing research engine and a community of savvy, long-term equity investors.',
      },
      {
        heading: 'Roadmap & community',
        body: 'The focus is a simpler research workspace: reliable source pages, small research questions, useful answers and evidence that carries into follow-ups. Precomputed ratios and financial models are bypassed so the source context stays visible and easier to maintain.',
      },
      {
        heading: 'Reach out',
        body: (
          <>
            <a href="https://www.linkedin.com/in/isfandiyar-shaheen-3a56a92/" className="underline underline-offset-2" target="_blank" rel="noreferrer">LinkedIn</a>
            {' · '}
            <a href="https://twitter.com/AsfiShaheen" className="underline underline-offset-2" target="_blank" rel="noreferrer">Twitter</a>
            {' · '}
            <a href="mailto:asfi@psxgpt.com" className="underline underline-offset-2">asfi@psxgpt.com</a>
          </>
        ),
      },
    ],
  },
};

function InformationContent({ page, onClose }: { page: InfoPageId; onClose: () => void }) {
  const content = informationPageContent[page];
  if (!content) return null;

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Information</p>
            <h1 className="mt-2 text-3xl font-semibold text-foreground">{content.title}</h1>
            <p className="mt-3 text-base text-muted-foreground">{content.lead}</p>
          </div>
          <Button variant="outline" onClick={onClose}>Back to chat</Button>
        </div>

        <div className="space-y-5">
          {content.sections.map((section) => (
            <section key={section.heading} className="rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-foreground">{section.heading}</h2>
              <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{section.body}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
