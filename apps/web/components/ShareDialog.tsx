import { useEffect, useState } from 'react';
import { Check, Copy, Link, X, Loader2 } from 'lucide-react';
import { Button } from './ui';
import { Card } from './ui';
import { Input } from './ui';

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  onShare: () => Promise<string | null>;
}

function normalizeShareUrl(url: string): string {
  return url.replace('/#/s/', '/s/');
}

export function ShareDialog({ open, onClose, onShare }: ShareDialogProps) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setShareUrl(null);
      setStatus('idle');
      setCopied(false);
      return;
    }

    // Generate share URL when dialog opens
    const generateUrl = async () => {
      setStatus('loading');
      try {
        const url = await onShare();
        if (url) {
          setShareUrl(normalizeShareUrl(url));
          setStatus('ready');
        } else {
          setStatus('error');
        }
      } catch {
        setStatus('error');
      }
    };

    generateUrl();
  }, [open, onShare]);

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!open) return null;

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
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Link className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-2xl font-semibold">Share this conversation</h3>
          <p className="text-sm text-muted-foreground">
            Anyone with this link can view this conversation.
          </p>
        </div>

        {status === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Creating share link...</span>
          </div>
        )}

        {status === 'ready' && shareUrl && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={shareUrl}
                readOnly
                className="flex-1 bg-muted/50 text-sm"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button
                onClick={handleCopy}
                variant={copied ? 'default' : 'secondary'}
                className="min-w-[100px] transition-all"
              >
                {copied ? (
                  <>
                    <Check className="mr-1.5 h-4 w-4" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-1.5 h-4 w-4" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-center text-sm text-destructive">
            Failed to create share link. Please try again.
          </div>
        )}
      </Card>
    </div>
  );
}
