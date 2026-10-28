import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { API_BASE_URL } from '../../hooks/useWebSocket';
import { useAuth } from '../../hooks/useAuth';
import { ThemeProvider, ThemeToggle } from '../Theme';
import { Button } from '../ui';
import { buildUserTrace } from './model';
import { SAMPLE_DETAIL } from './sample';
import { TraceView } from './TraceView';

function engineIdFromPath(): string {
  if (typeof window === 'undefined') return '';
  const m = window.location.pathname.match(/^\/trace\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; detail: Record<string, unknown> };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-md sm:px-6">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
            <a href="/" className="flex items-center gap-2.5">
              <img src="/icon-transparent.svg" alt="psxGPT" className="h-8 w-8" />
              <span className="text-sm font-semibold tracking-wide">psxGPT · trace</span>
            </a>
            <div className="flex items-center gap-1.5">
              <ThemeToggle />
              <Button asChild variant="outline" size="sm">
                <a href="/" className="flex items-center gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Open psxGPT
                </a>
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </ThemeProvider>
  );
}

export function UserTraceApp() {
  const auth = useAuth();
  const getToken = auth.getToken;
  const engineId = useMemo(engineIdFromPath, []);
  const isDemo = engineId === 'demo';
  const signedIn = Boolean(auth.user) && !auth.isAnonymous;
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(async () => {
    if (!engineId) {
      setState({ kind: 'error', message: 'No trace id in the URL.' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/admin/traces/${encodeURIComponent(engineId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 401 || res.status === 403) {
        setState({ kind: 'signedOut' });
        return;
      }
      const json = await res.json();
      if (!res.ok || !json.ok || !json.trace) {
        setState({ kind: 'error', message: json.error || 'This trace was not found, or it belongs to another account.' });
        return;
      }
      setState({ kind: 'ok', detail: json.trace });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load the trace.' });
    }
  }, [engineId, getToken]);

  useEffect(() => {
    if (isDemo) return;
    if (auth.isLoading) return;
    if (!signedIn) {
      setState({ kind: 'signedOut' });
      return;
    }
    void load();
  }, [isDemo, auth.isLoading, signedIn, load]);

  if (isDemo) {
    return (
      <Shell>
        <div className="mb-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Example trace — rendered from a sample payload through the same path as a real run. Your own answers link to their real trace from the chat.
        </div>
        <TraceView trace={buildUserTrace(SAMPLE_DETAIL)} />
      </Shell>
    );
  }

  if (auth.isLoading || state.kind === 'loading') {
    return (
      <Shell>
        <div className="rounded-2xl border border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">Loading trace…</div>
      </Shell>
    );
  }

  if (state.kind === 'signedOut') {
    return (
      <Shell>
        <div className="mx-auto max-w-md rounded-2xl border border-border bg-card/60 p-8 text-center">
          <h1 className="text-lg font-semibold">Sign in to view this trace</h1>
          <p className="mt-2 text-sm text-muted-foreground">A query trace is private to the account that ran it.</p>
          <Button type="button" className="mt-4" onClick={() => void auth.signInWithGoogle()}>Sign in</Button>
        </div>
      </Shell>
    );
  }

  if (state.kind === 'error') {
    return (
      <Shell>
        <div className="mx-auto max-w-md rounded-2xl border border-destructive/30 bg-card/60 p-8 text-center">
          <h1 className="text-lg font-semibold">Trace unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
          <Button type="button" variant="outline" className="mt-4" onClick={() => void load()}>Try again</Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <TraceView trace={buildUserTrace(state.detail)} />
    </Shell>
  );
}
