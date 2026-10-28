import { FormEvent, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Mail, X } from 'lucide-react';
import { Button } from './ui';
import { Card } from './ui';
import { Input } from './ui';

function isInAppBrowser(): boolean {
  const ua = navigator.userAgent || (navigator as any).vendor || '';
  return /FBAN|FBAV|Instagram|Twitter|Line|WeChat|MicroMessenger|Snapchat|TikTok|LinkedInApp/i.test(ua);
}

interface SignInDialogProps {
  open: boolean;
  onClose: () => void;
  onGoogle: () => void;
  onSendEmail: (email: string) => Promise<void>;
}

export function SignInDialog({ open, onClose, onGoogle, onSendEmail }: SignInDialogProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [inAppBrowser, setInAppBrowser] = useState(false);

  useEffect(() => {
    setInAppBrowser(isInAppBrowser());
  }, []);

  useEffect(() => {
    if (!open) {
      setEmail('');
      setStatus('idle');
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const handleEmailSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim()) {
      setError('Enter a valid email to continue.');
      return;
    }
    setStatus('sending');
    setError(null);

    try {
      await onSendEmail(email.trim());
      setStatus('sent');
    } catch (err) {
      setStatus('idle');
      setError(err instanceof Error ? err.message : 'Unable to send magic link. Try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm px-4">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <Card className="relative w-full max-w-md space-y-5 border border-border/70 bg-background/95 p-6 shadow-2xl">
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-4 top-4"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>

        <div className="space-y-2 text-center">
          <h3 className="text-2xl font-semibold">Login to psxGPT</h3>
          <p className="text-sm text-muted-foreground">
            {inAppBrowser
              ? 'Sign in with your email to continue.'
              : 'Sign in with your email or Google account to continue.'}
          </p>
        </div>

        {!inAppBrowser && (
          <>
            <Button className="w-full" type="button" onClick={onGoogle} variant="secondary">
              Continue with Google
            </Button>

            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <span className="flex-1 border-t border-border/70" />
              <span>or</span>
              <span className="flex-1 border-t border-border/70" />
            </div>
          </>
        )}

        <form className="space-y-3" onSubmit={handleEmailSubmit}>
          <label className="text-sm font-medium text-foreground" htmlFor="magic-link-email">
            Email
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="magic-link-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={status === 'sending' || status === 'sent'}
            />
            <Button type="submit" disabled={status === 'sending' || status === 'sent'}>
              {status === 'sending' ? 'Sending...' : status === 'sent' ? 'Sent' : 'Login'}
            </Button>
          </div>
        </form>

        {status === 'sent' ? (
          <div className="flex items-start gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-600">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="space-y-1 text-left">
              <p className="font-semibold">Check your email</p>
              <p>
                Use the sign-in link we sent to your inbox to finish logging in.
              </p>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Mail className="h-4 w-4" />
          <span>Supabase Auth will email you a secure sign-in link.</span>
        </div>
      </Card>
    </div>
  );
}
