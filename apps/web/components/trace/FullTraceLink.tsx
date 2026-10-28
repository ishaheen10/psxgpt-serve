import { useState } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../../hooks/useWebSocket';
import { getAccessToken } from '../../hooks/useAuth';
import { cn } from '../../types';

// A stable "View trace" button. Renders unconditionally (no auth hook, no
// subscription, no re-render churn — that was the flicker), and resolves the
// answer's engine/trace id only on click, then opens /trace/:id.
export function FullTraceLink({ messageId, className }: { messageId?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!messageId) return null;

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setError('Sign in to view the trace');
        return;
      }
      const res = await fetch(`${API_BASE_URL}/api/admin/traces?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      const traces: Array<Record<string, unknown>> = Array.isArray(json?.traces) ? json.traces : [];
      const match = traces.find((t) => String(t.message_id ?? '') === String(messageId));
      const id = match?.id;
      if (id != null && String(id)) {
        window.location.assign(`/trace/${encodeURIComponent(String(id))}`);
        return;
      }
      setError('No trace recorded for this answer');
    } catch {
      setError('Could not open the trace');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/50 hover:text-foreground disabled:opacity-60',
        className,
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
      {error ?? (busy ? 'Opening trace…' : 'View trace')}
    </button>
  );
}
