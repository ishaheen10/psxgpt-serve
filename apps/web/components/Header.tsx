import { useEffect, useRef } from 'react';
import { LayoutPanelLeft, LogOut } from 'lucide-react';
import { Button } from './ui';
import { ThemeToggle } from './Theme';
import { cn } from '../types';

interface HeaderProps {
  user: any;
  isGuest: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onToggleSidebar?: () => void;
}

export function Header({
  user,
  isGuest,
  onSignIn,
  onSignOut,
  onToggleSidebar,
}: HeaderProps) {
  const isAuthenticated = Boolean(user) && !isGuest;
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateHeight = () => {
      if (!headerRef.current) return;
      document.documentElement.style.setProperty('--header-height', `${headerRef.current.offsetHeight}px`);
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  let primaryLabel: string | null = null;
  let primaryAction: (() => void) | undefined;
  if (!isAuthenticated) {
    primaryLabel = 'Login';
    primaryAction = onSignIn;
  }

  return (
    <header
      ref={headerRef as React.RefObject<HTMLElement>}
      className="sticky top-0 z-20 border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur-md sm:px-6 sm:py-3"
    >
      <div className="flex items-center justify-between gap-1.5 overflow-hidden sm:gap-2">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          {onToggleSidebar ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="flex-shrink-0 rounded-full border border-border/70 bg-background/80 transition-all duration-200 hover:bg-amber-100 hover:text-amber-500 hover:scale-105 active:scale-95 dark:hover:bg-primary/10 dark:hover:text-primary sm:size-9"
              onClick={onToggleSidebar}
              aria-label="Toggle chat history"
            >
              <LayoutPanelLeft className="h-4 w-4 sm:h-5 sm:w-5" />
            </Button>
          ) : null}
          <QuickAction label="Equities" onClick={() => window.location.assign('/equities')} />
          <QuickAction label="Docs" onClick={() => window.location.assign('/docs')} />
        </div>

        <div className="flex flex-shrink-0 items-center gap-1 sm:gap-1.5">
          {primaryLabel ? (
            <Button
              variant="default"
              size="sm"
              onClick={primaryAction}
              disabled={!primaryAction}
              className="text-sm font-semibold flex transition-all duration-200 hover:scale-105 active:scale-95"
            >
              {primaryLabel}
            </Button>
          ) : null}
          <ThemeToggle />
          {isAuthenticated ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full border border-border/70 bg-background/70 transition-all duration-200 hover:bg-amber-100 hover:text-amber-500 hover:scale-105 active:scale-95 dark:hover:bg-primary/15 dark:hover:text-primary sm:size-9"
              onClick={onSignOut}
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function QuickAction({
  label,
  onClick,
  disabled = false,
  muted = false,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  muted?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled || muted}
      className={cn(
        'h-8 min-w-[58px] justify-center rounded-full border border-border/70 bg-muted/40 px-2.5 text-[11px] font-medium tracking-wide transition-all duration-200 sm:min-w-[84px] sm:px-3 sm:text-xs',
        muted ? 'opacity-50' : 'hover:text-amber-500 hover:scale-105 active:scale-95 dark:hover:text-primary',
      )}
    >
      {label}
    </Button>
  );
}
