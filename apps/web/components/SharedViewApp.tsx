import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { ThemeProvider, ThemeToggle } from './Theme';
import { Message } from './Message';
import { SourcePanel, MobileSourcesSheet } from './SourcePanel';
import { SignInDialog } from './SignInDialog';
import { Button } from './ui';
import { useSharedConversation } from '../hooks/useSharedConversation';
import { useAuth } from '../hooks/useAuth';
import { API_BASE_URL } from '../hooks/useWebSocket';
import { cn } from '../types';
import type { ChatMessage, SourcePreview } from '../types';

interface SharedViewAppProps {
  shareId: string;
}

// UI State for shared view
interface SharedUIState {
  signInOpen: boolean;
  sourcesDrawerOpen: boolean;
  sourcesPanelOpen: boolean;
  splitView: boolean;
  splitViewZoom: number;
  selectedSources: SourcePreview[] | null;
  selectedContext: string | null;
}

type SharedUIAction =
  | { type: 'SET_SIGN_IN'; open: boolean }
  | { type: 'SET_SOURCES_DRAWER'; open: boolean }
  | { type: 'SET_SOURCES_PANEL'; open: boolean }
  | { type: 'TOGGLE_SPLIT_VIEW' }
  | { type: 'EXIT_SPLIT_VIEW' }
  | { type: 'SET_SPLIT_VIEW_ZOOM'; zoom: number }
  | { type: 'SET_SELECTED_SOURCES'; sources: SourcePreview[] | null; context: string | null };

const initialUIState: SharedUIState = {
  signInOpen: false,
  sourcesDrawerOpen: false,
  sourcesPanelOpen: true,  // Default open
  splitView: false,
  splitViewZoom: 80,
  selectedSources: null,
  selectedContext: null,
};

function uiReducer(state: SharedUIState, action: SharedUIAction): SharedUIState {
  switch (action.type) {
    case 'SET_SIGN_IN':
      return { ...state, signInOpen: action.open };
    case 'SET_SOURCES_DRAWER':
      return { ...state, sourcesDrawerOpen: action.open };
    case 'SET_SOURCES_PANEL':
      return { ...state, sourcesPanelOpen: action.open, splitView: action.open ? state.splitView : false };
    case 'TOGGLE_SPLIT_VIEW':
      return { ...state, splitView: !state.splitView, sourcesPanelOpen: true };
    case 'EXIT_SPLIT_VIEW':
      return { ...state, splitView: false, sourcesPanelOpen: false };
    case 'SET_SPLIT_VIEW_ZOOM':
      return { ...state, splitViewZoom: Math.min(150, Math.max(60, Math.round(action.zoom))) };
    case 'SET_SELECTED_SOURCES':
      return { ...state, selectedSources: action.sources, selectedContext: action.context };
    default:
      return state;
  }
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);

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

export function SharedViewApp({ shareId }: SharedViewAppProps) {
  const { data, loading, error } = useSharedConversation(shareId);
  const auth = useAuth();
  const [ui, dispatch] = useReducer(uiReducer, initialUIState);
  const [importing, setImporting] = useState(false);
  const isDesktop = useIsDesktop();
  useAppHeight();

  // Handle "Continue conversation" for logged-in users
  const handleContinueConversation = useCallback(async () => {
    if (!auth.user || importing) return;
    setImporting(true);
    try {
      const token = await auth.getToken();
      const res = await fetch(`${API_BASE_URL}/api/sessions/import/${shareId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const { sessionId } = await res.json();
        // Store sessionId so the app opens it after redirect
        if (sessionId) {
          localStorage.setItem('pendingOpenSession', sessionId);
        }
        // Navigate to main app (clean redirect, not hash change + reload)
        window.location.href = window.location.origin;
      } else {
        console.error('[SharedView] Import failed', res.status);
        setImporting(false);
      }
    } catch (err) {
      console.error('[SharedView] Import failed', err);
      setImporting(false);
    }
  }, [auth, shareId, importing]);

  // Get sources from the last assistant message
  const latestSources = useMemo(() => {
    if (!data?.messages) return [];
    const lastAssistant = [...data.messages].reverse().find(
      (m) => m.role === 'assistant' && m.sourcePreviews?.length
    );
    return lastAssistant?.sourcePreviews ?? [];
  }, [data?.messages]);

  const panelSources = ui.selectedSources ?? latestSources;
  const hasReferenceData = panelSources.length > 0;

  const extractMessageContext = (message?: ChatMessage) => {
    if (!message?.analysisMetadata) return null;
    const raw = message.analysisMetadata['retrievalContext'];
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  };

  const handleOpenSources = useCallback(
    (messageId: string) => {
      if (!data?.messages) return;
      const target = data.messages.find(
        (m) => m.id === messageId && m.role === 'assistant' && (m.sourcePreviews?.length ?? 0) > 0
      );
      if (!target?.sourcePreviews?.length) return;
      dispatch({ type: 'SET_SELECTED_SOURCES', sources: target.sourcePreviews, context: extractMessageContext(target) });
      if (isDesktop) {
        // Open/expand sources panel on desktop (user can click source to enter split view)
        dispatch({ type: 'SET_SOURCES_PANEL', open: true });
      } else {
        dispatch({ type: 'SET_SOURCES_DRAWER', open: true });
      }
    },
    [data?.messages, isDesktop]
  );

  const handleSignInClick = useCallback(() => {
    // Save shareId so we can import the conversation after auth
    localStorage.setItem('pendingSharedImport', shareId);
    dispatch({ type: 'SET_SIGN_IN', open: true });
  }, [shareId]);

  const handleGoogleSignIn = useCallback(() => {
    dispatch({ type: 'SET_SIGN_IN', open: false });
    // Clear hash before OAuth redirect so MainApp renders on return
    window.location.hash = '';
    auth.signInWithGoogle();
  }, [auth]);

  const handleMagicLink = useCallback((email: string) => auth.sendMagicLink(email), [auth]);

  const goToHome = () => {
    window.location.hash = '';
    window.location.reload();
  };

  // Loading state
  if (loading) {
    return (
      <ThemeProvider>
        <div className="flex h-[var(--app-height,100vh)] items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-4 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p>Loading shared conversation...</p>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  // Error state
  if (error || !data) {
    return (
      <ThemeProvider>
        <div className="flex h-[var(--app-height,100vh)] flex-col items-center justify-center bg-background px-4">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <h1 className="text-2xl font-semibold">Conversation not found</h1>
            <p className="text-muted-foreground max-w-md">
              This shared conversation may have been removed or the link is invalid.
            </p>
            <Button onClick={goToHome} className="mt-4">
              Go to psxGPT
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <div className="relative flex h-[var(--app-height,100vh)] flex-col bg-background">
        {/* Header */}
        <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-md sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span role="img" aria-label="Pakistan flag" className="text-2xl">🇵🇰</span>
              <h1 className="text-lg font-semibold">Shared from psxGPT</h1>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <ThemeToggle />
              {auth.user ? (
                <Button onClick={handleContinueConversation} size="sm" disabled={importing}>
                  {importing ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    'Continue conversation'
                  )}
                </Button>
              ) : (
                <Button onClick={handleSignInClick} size="sm">
                  Sign up free
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* Main content - match main app layout exactly */}
        <div className={cn(
          'flex-1 overflow-hidden min-w-0',
          ui.splitView ? 'lg:grid lg:grid-cols-2 lg:divide-x lg:divide-border' : 'flex',
        )}>
          {/* Messages */}
          <div className="flex flex-1 flex-col min-h-0 min-w-0">
            <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4 sm:px-6">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
                {data.messages.map((message, index) => {
                  // Show CTA on the last assistant message (sign up for guests, continue for logged in)
                  const isLastAssistant = message.role === 'assistant' &&
                    !data.messages.slice(index + 1).some(m => m.role === 'assistant');
                  const showCTA = isLastAssistant && !auth.user;
                  return (
                    <Message
                      key={message.id}
                      message={message}
                      onOpenSources={handleOpenSources}
                      onSignUp={showCTA ? handleSignInClick : undefined}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Sources panel (desktop) - matches main app behavior */}
          {isDesktop && hasReferenceData && (
            <SourcePanel
              sources={panelSources}
              context={ui.selectedContext}
              collapsed={!ui.sourcesPanelOpen}
              onToggleCollapse={() => dispatch({ type: 'SET_SOURCES_PANEL', open: !ui.sourcesPanelOpen })}
              showBadge={false}
              splitView={ui.splitView}
              onToggleSplitView={() => dispatch({ type: 'TOGGLE_SPLIT_VIEW' })}
              splitViewZoom={ui.splitViewZoom}
              onZoomChange={(z) => dispatch({ type: 'SET_SPLIT_VIEW_ZOOM', zoom: z })}
            />
          )}
        </div>

        {/* Mobile sources sheet */}
        <MobileSourcesSheet
          open={ui.sourcesDrawerOpen && hasReferenceData}
          onClose={() => dispatch({ type: 'SET_SOURCES_DRAWER', open: false })}
          sources={panelSources}
          context={ui.selectedContext}
        />

        {/* Sign-in dialog */}
        <SignInDialog
          open={ui.signInOpen}
          onClose={() => dispatch({ type: 'SET_SIGN_IN', open: false })}
          onGoogle={handleGoogleSignIn}
          onSendEmail={handleMagicLink}
        />
      </div>
    </ThemeProvider>
  );
}
