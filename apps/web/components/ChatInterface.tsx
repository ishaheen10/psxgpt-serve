import { useRef, useEffect, useCallback, useState } from 'react';
import { Send, Square } from 'lucide-react';
import { Button } from './ui';
import { Message } from './Message';
import type { ChatMessage } from '../types';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  input: string;
  isLoading: boolean;
  isGuest?: boolean;
  onInputChange: (value: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  onCancel?: () => void;
  onOpenSources?: (messageId: string) => void;
  onFeedback?: (messageId: string, feedback: 'positive' | 'negative', comment?: string) => Promise<void>;
  onShare?: () => void;
  onShowTickers?: () => void;
  focusTrigger?: number;
}

export function ChatInterface({
  messages,
  input,
  isLoading,
  isGuest = false,
  onInputChange,
  onSubmit,
  onCancel,
  onOpenSources,
  onFeedback,
  onShare,
  onShowTickers,
  focusTrigger = 0,
}: ChatInterfaceProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageMetricsRef = useRef<{ length: number; lastId: string | null }>({ length: 0, lastId: null });
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1] ?? null;
    const lastId = lastMessage?.id ?? null;
    const previous = messageMetricsRef.current;
    const hasNewMessage = messages.length > previous.length;
    const lastMessageChanged = lastId !== previous.lastId;

    if ((hasNewMessage || lastMessageChanged) && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: previous.length === 0 ? 'auto' : 'smooth' });
    }
    messageMetricsRef.current = { length: messages.length, lastId };
  }, [messages]);

  const updateFooterHeight = useCallback(() => {
    if (typeof document === 'undefined' || !footerRef.current) return;
    document.documentElement.style.setProperty('--chat-input-height', `${footerRef.current.offsetHeight}px`);
  }, []);

  const autoSizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = 220;
    const next = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${next}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    updateFooterHeight();
  }, [updateFooterHeight]);

  useEffect(() => { autoSizeTextarea(); }, [autoSizeTextarea, input]);

  useEffect(() => {
    if (!focusTrigger) return;
    textareaRef.current?.focus();
    textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focusTrigger]);

  useEffect(() => {
    const handleResize = () => { autoSizeTextarea(); updateFooterHeight(); };
    handleResize();
    const targets: EventTarget[] = [window];
    if (window.visualViewport) targets.push(window.visualViewport);
    targets.forEach((t) => t.addEventListener('resize', handleResize));
    return () => targets.forEach((t) => t.removeEventListener('resize', handleResize));
  }, [autoSizeTextarea, updateFooterHeight]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isGuest) return;
    // Allow submit while loading (for steering)
    onSubmit(e);
  };

  // Placeholder changes during loading to indicate steering is available
  const placeholder = isLoading
    ? 'Add a follow-up or redirect the research...'
    : 'Ask about PSX companies...';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2 sm:px-6 sm:pt-6" style={{ scrollPaddingTop: 'calc(var(--header-height,0px) + 12px)' }}>
        {messages.length === 0 ? (
          <WelcomeScreen />
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-0 sm:px-6">
            {messages.map((message, index) => {
              // Show share button only on the last completed assistant message
              const isLastAssistant = message.role === 'assistant' &&
                message.status === 'done' &&
                !messages.slice(index + 1).some(m => m.role === 'assistant' && m.status === 'done');
              return (
                <Message
                  key={message.id}
                  message={message}
                  onOpenSources={onOpenSources}
                  onFeedback={onFeedback}
                  onShare={isLastAssistant ? onShare : undefined}
                  onShowTickers={onShowTickers}
                />
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <footer ref={footerRef as React.RefObject<HTMLElement>} className="border-t border-border bg-background/95 backdrop-blur-md px-4 pb-[calc(0.6rem+env(safe-area-inset-bottom,0px))] pt-3 shadow-[0_-12px_40px_rgba(0,0,0,0.15)]">
        {isGuest ? (
          <div className="mx-auto w-full max-w-3xl">
            <div className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-2.5">
              <span className="text-sm text-muted-foreground">Login to query</span>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mx-auto w-full max-w-3xl">
            <div className="relative rounded-2xl border border-border/60 bg-muted/20 px-4 py-[6px] shadow-sm transition-all duration-200 focus-within:border-primary/50 focus-within:bg-background focus-within:shadow-lg focus-within:ring-2 focus-within:ring-primary/10">
              <textarea
                ref={textareaRef}
                rows={1}
                className="block h-8 w-full resize-none bg-transparent pr-10 text-base leading-6 placeholder:text-muted-foreground/60 focus-visible:outline-none sm:text-[15px]"
                placeholder={placeholder}
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
                  if (e.key === 'Escape') textareaRef.current?.blur();
                }}
              />
              {/* Hint text - fades on focus or input */}
              <span className={`pointer-events-none absolute right-12 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wide text-muted-foreground/50 transition-opacity ${isFocused || input ? 'opacity-0' : 'opacity-100'} hidden md:block`}>
                Shift + Enter for newline
              </span>
              {/* Buttons - pinned bottom right */}
              {/* During loading with no input: show Stop */}
              {/* With input: show Send (amber during loading for steering) */}
              {isLoading && !input.trim() ? (
                <Button type="button" size="icon" aria-label="Stop generation" onClick={onCancel} className="absolute bottom-2 right-2 h-6 w-6 rounded-lg bg-destructive hover:bg-destructive/90 transition-all hover:scale-105 active:scale-95">
                  <Square className="h-2.5 w-2.5 fill-current" />
                </Button>
              ) : (
                <Button type="submit" size="icon" aria-label={isLoading ? "Redirect research" : "Send message"} disabled={!input.trim()} className={`absolute bottom-2 right-2 h-6 w-6 rounded-lg transition-all hover:scale-105 active:scale-95 disabled:hover:scale-100 ${isLoading && input.trim() ? 'bg-amber-500 hover:bg-amber-600' : ''}`}>
                  <Send className="h-3 w-3" />
                </Button>
              )}
            </div>
          </form>
        )}
      </footer>
    </div>
  );
}

function WelcomeScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center space-y-8 text-center animate-in fade-in duration-500">
      {/* Animated flag with glow */}
      <div className="relative">
        <div className="absolute inset-0 blur-3xl bg-gradient-to-r from-green-500/20 to-white/10 rounded-full scale-150" />
        <span role="img" aria-label="Pakistan flag" className="relative text-7xl sm:text-8xl drop-shadow-lg animate-in zoom-in duration-300">
          🇵🇰
        </span>
      </div>

      {/* Title and subtitle */}
      <div className="space-y-3 px-4">
        <h2 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
          Welcome to psxGPT
        </h2>
        <p className="text-muted-foreground text-base sm:text-lg max-w-md">
          Research Pakistani companies from original reports and announcements.
        </p>
      </div>

      {/* Subtle hint */}
      <p className="text-xs text-muted-foreground/50 animate-in fade-in duration-500 delay-500">
        Follow the sources. Ask a follow-up. Build on what you find.
      </p>

      <div className="grid w-full max-w-md gap-2 px-4 text-left sm:grid-cols-2">
        <WelcomeLink href="/equities" label="Explore equities" detail="Start with sectors and tickers" />
        <WelcomeLink href="/?q=Which%20banks%20have%20the%20highest%20deposits%2C%20and%20how%20do%20their%20valuations%20compare%3F&run=1" label="Run a test query" detail="See retrieval, tables, and sources" />
        <WelcomeLink href="/docs#database" label="Check database" detail="Coverage and current cautions" />
        <WelcomeLink href="/docs#changelog" label="Read changelog" detail="What improved recently" />
      </div>
    </div>
  );
}

function WelcomeLink({ href, label, detail }: { href: string; label: string; detail: string }) {
  return (
    <a
      href={href}
      className="rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5 transition hover:border-primary/50 hover:bg-primary/5"
    >
      <span className="block text-sm font-semibold text-foreground">{label}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>
    </a>
  );
}
