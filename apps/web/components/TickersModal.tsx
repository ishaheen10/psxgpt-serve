import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Search, X } from 'lucide-react';
import { useTickerLookup } from '../hooks/useTickerLookup';
import { Button } from './ui';
import { Input } from './ui';
import { Card } from './ui';

interface TickersModalProps {
  open: boolean;
  onClose: () => void;
}

export default function TickersModal({ open, onClose }: TickersModalProps) {
  const { tickers, isLoading, error, fetchTickers, searchTickers } = useTickerLookup();
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCopied(null);
    void fetchTickers();
  }, [open, fetchTickers]);

  const filtered = useMemo(() => {
    if (!query.trim()) return tickers;
    return searchTickers(query);
  }, [query, searchTickers, tickers]);

  const handleCopy = async (symbol: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(symbol);
      setCopied(symbol);
      setTimeout(() => setCopied((current) => (current === symbol ? null : current)), 1500);
    } catch {
      /* ignore */
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm px-4">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <Card className="relative w-full max-w-3xl border border-border/80 bg-background/95 p-5 shadow-2xl">
        <header className="flex items-center justify-between border-b border-border/70 pb-3">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">PSX tickers</h2>
              <p className="text-xs text-muted-foreground">Search the KSE-100 symbols and copy any ticker.</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close tickers list">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="mt-4 space-y-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by ticker, company, or industry"
          />
          <div className="rounded-lg border border-border/70 bg-muted/30 max-h-[60vh] overflow-y-auto">
            <div className="divide-y divide-border/60">
                {isLoading ? (
                  <div className="p-4 text-sm text-muted-foreground">Loading tickers…</div>
                ) : error ? (
                  <div className="p-4 text-sm text-destructive">{error}</div>
                ) : filtered.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">No tickers match “{query}”.</div>
                ) : (
                  filtered.map((ticker) => (
                    <button
                      key={ticker.Symbol}
                      type="button"
                      onClick={() => handleCopy(ticker.Symbol)}
                      className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition hover:bg-background"
                    >
                      <div>
                        <div className="font-semibold tracking-wide text-sm uppercase">{ticker.Symbol}</div>
                        <p className="text-sm text-foreground">{ticker['Company Name']}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{ticker.Industry}</p>
                      </div>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        {copied === ticker.Symbol ? (
                          <>
                            <Check className="h-4 w-4 text-primary" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4" />
                            Copy
                          </>
                        )}
                      </span>
                    </button>
                  ))
                )}
              </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
