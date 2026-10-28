import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, X, ChevronLeft, ChevronRight, Search, MoreHorizontal, Loader2, Folder, FolderPlus } from 'lucide-react';
import { Button } from './ui';
import { ScrollArea } from './ui';
import { Avatar, AvatarFallback } from './ui';
import { Input } from './ui';
import type { ChatFolder, ChatHistoryItem } from '../types';
import { cn } from '../types';

export type InfoPageId = 'how-it-works' | 'data-collection' | 'terms' | 'about';

interface SidebarProps {
  user?: any;
  chats: ChatHistoryItem[];
  onNewChat: () => void;
  onSelectChat: (sessionId: string) => void;
  onDeleteChat: (sessionId: string) => void;
  searchSessions?: (query: string, folderId?: string | null) => Promise<ChatHistoryItem[]>;
  folders?: ChatFolder[];
  onCreateFolder?: (name: string) => Promise<ChatFolder | null>;
  onAssignChatFolder?: (sessionId: string, folderId: string | null) => Promise<boolean>;
  onDeleteFolder?: (folderId: string) => Promise<boolean>;
  disableNewChat?: boolean;
  variant?: 'desktop' | 'mobile';
  isOpen?: boolean;
  collapsed?: boolean;
  onClose?: () => void;
  onToggleCollapse?: () => void;
  onSelectInfoPage?: (pageId: InfoPageId) => void;
  selectedInfoPage?: InfoPageId | null;
  onSignIn?: () => void;
}

export function Sidebar({
  user,
  chats,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  searchSessions,
  folders = [],
  onCreateFolder,
  onAssignChatFolder,
  onDeleteFolder,
  disableNewChat = false,
  variant = 'desktop',
  isOpen = true,
  collapsed = false,
  onClose,
  onToggleCollapse,
  onSelectInfoPage,
  selectedInfoPage = null,
  onSignIn,
}: SidebarProps) {
  const isMobile = variant === 'mobile';
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ChatHistoryItem[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderActionMessage, setFolderActionMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleClickAway = () => setOpenMenuId(null);
    if (openMenuId) {
      document.addEventListener('click', handleClickAway);
      return () => document.removeEventListener('click', handleClickAway);
    }
  }, [openMenuId]);

  // Keyboard shortcut: ⌘K or / to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (collapsed && onToggleCollapse) {
          onToggleCollapse();
          setTimeout(() => searchInputRef.current?.focus(), 180);
        } else {
          searchInputRef.current?.focus();
        }
      }
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        if (collapsed && onToggleCollapse) {
          onToggleCollapse();
          setTimeout(() => searchInputRef.current?.focus(), 180);
        } else {
          searchInputRef.current?.focus();
        }
      }
      // Escape to clear search
      if (e.key === 'Escape' && searchQuery) {
        setSearchQuery('');
        searchInputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [collapsed, onToggleCollapse, searchQuery]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setHasSearched(false);
    searchInputRef.current?.focus();
  }, []);

  // Debounced server-side search
  useEffect(() => {
    const query = searchQuery.trim();

    if (!query && !selectedFolderId) {
      setSearchResults([]);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }

    if (!searchSessions) return;

    setIsSearching(true);
    const timeoutId = setTimeout(async () => {
      try {
        const results = await searchSessions(query, selectedFolderId);
        setSearchResults(results);
        setHasSearched(Boolean(query) || Boolean(selectedFolderId));
      } catch (error) {
        console.error('[Sidebar] Search failed', error);
        setSearchResults([]);
        setHasSearched(true);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, searchSessions, selectedFolderId]);

  const isAuthenticated = Boolean(user);
  const canShowInfoCards = !collapsed || isMobile;

  const [showAllChats, setShowAllChats] = useState(false);

  // Reset to collapsed view when search query changes
  useEffect(() => {
    setShowAllChats(false);
  }, [searchQuery]);

  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) || null;
  const displayedChats = hasSearched || selectedFolderId ? searchResults : chats;
  const INITIAL_CHAT_LIMIT = 10;
  const visibleChats = showAllChats ? displayedChats : displayedChats.slice(0, INITIAL_CHAT_LIMIT);
  const hasMoreChats = displayedChats.length > INITIAL_CHAT_LIMIT;
  const informationItems: { id: InfoPageId; title: string; summary: string }[] = [
    {
      id: 'how-it-works',
      title: 'How psxGPT works?',
      summary: 'High-level overview of the psxGPT analysis engine and workflow.',
    },
    {
      id: 'data-collection',
      title: 'What data I collect?',
      summary: 'Details on data inputs, storage, and retention practices.',
    },
    {
      id: 'terms',
      title: 'What are the terms?',
      summary: 'Usage policy, disclaimers, and assumptions for beta access.',
    },
    {
      id: 'about',
      title: 'Who made psxGPT?',
      summary: 'Background on the builder and motivation for the product.',
    },
  ];

  const handleSelect = (sessionId: string) => {
    onSelectChat(sessionId);
    if (isMobile) {
      onClose?.();
    }
  };
  const handleCreateFolder = async () => {
    const name = folderName.trim();
    if (!name || !onCreateFolder) return;
    const folder = await onCreateFolder(name);
    if (folder?.id) {
      setSelectedFolderId(folder.id);
      setFolderName('');
      setCreatingFolder(false);
    }
  };

  const handleAssignFolder = async (sessionId: string, folderId: string | null) => {
    if (!onAssignChatFolder) return;
    setOpenMenuId(null);
    const ok = await onAssignChatFolder(sessionId, folderId);
    if (!ok) {
      setFolderActionMessage('Folder move failed. Please try again.');
      return;
    }
    const targetFolder = folderId ? folders.find((folder) => folder.id === folderId) || null : null;
    setFolderActionMessage(folderId && targetFolder ? `Moved to ${targetFolder.name}` : 'Removed from folder');
    setSearchResults((previous) => {
      const updated = previous.map((chat) =>
        chat.id === sessionId
          ? { ...chat, folderId, folderName: targetFolder?.name || null }
          : chat
      );
      return selectedFolderId ? updated.filter((chat) => chat.folderId === selectedFolderId) : updated;
    });
    if (hasSearched || selectedFolderId) {
      const results = await searchSessions?.(searchQuery.trim(), selectedFolderId);
      if (results) setSearchResults(results);
    }
  };

  const handleDeleteSelectedFolder = async () => {
    if (!selectedFolderId || !onDeleteFolder) return;
    const ok = await onDeleteFolder(selectedFolderId);
    if (ok) {
      setSelectedFolderId(null);
      setSearchResults([]);
      setHasSearched(Boolean(searchQuery.trim()));
    }
  };
  const widthClass = isMobile ? 'w-72 max-w-[90vw] rounded-r-2xl' : collapsed ? 'w-16' : 'w-64';

  const content = (
    <aside
      className={cn(
        'bg-sidebar/95 backdrop-blur-sm relative flex h-full flex-col transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
        widthClass,
        !isMobile && 'shadow-[1px_0_0_0_rgba(0,0,0,0.06)] dark:shadow-[1px_0_0_0_rgba(255,255,255,0.04)]'
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-sidebar-border px-4 py-3">
        <img src="/icon-transparent.svg" alt="psxGPT" className={cn("transition-all duration-300", collapsed && !isMobile ? "h-8 w-8" : "h-8 w-8")} />
        {isMobile ? (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close sidebar">
            <X className="h-4 w-4" />
          </Button>
        ) : (
          onToggleCollapse && (
            <Button variant="ghost" size="icon" onClick={onToggleCollapse} aria-label="Toggle sidebar">
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          )
        )}
      </div>

      <div className="border-b border-sidebar-border px-3 py-3">
        <div className="flex flex-col gap-2">
          <Button
            onClick={() => {
              if (!isAuthenticated) {
                onSignIn?.();
                return;
              }
              onNewChat();
            }}
            className={cn('w-full justify-start gap-2 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]', collapsed ? 'justify-center px-0' : 'px-4')}
            variant="outline"
            disabled={disableNewChat || !isAuthenticated}
            title={!isAuthenticated ? 'Sign in to start a chat' : collapsed ? 'New chat' : undefined}
          >
            <Plus className="h-4 w-4" />
            {!collapsed && 'New chat'}
          </Button>

          {isAuthenticated ? (
            collapsed ? (
              <Button
                variant="outline"
                className="justify-center"
                onClick={() => {
                  if (onToggleCollapse) {
                    onToggleCollapse();
                    setTimeout(() => searchInputRef.current?.focus(), 180);
                  }
                }}
                title="Search chats"
              >
                <Search className="h-4 w-4" />
              </Button>
            ) : (
              <div className="relative">
                {isSearching ? (
                  <Loader2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground animate-spin" />
                ) : (
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                )}
                <Input
                  ref={searchInputRef}
                  placeholder="Search chats + messages"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className={cn("pl-9 text-base md:text-sm", searchQuery && "pr-8")}
                />
                {searchQuery && (
                  <button
                    onClick={clearSearch}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )
          ) : null}
          {isAuthenticated && !collapsed ? (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedFolderId(null)}
                  className={cn(
                    'min-w-0 rounded-full border px-2.5 py-1 text-xs transition',
                    !selectedFolderId ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-sidebar-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  All chats
                </button>
                <button
                  type="button"
                  onClick={() => setCreatingFolder((value) => !value)}
                  className="rounded-full border border-sidebar-border p-1.5 text-muted-foreground transition hover:text-foreground"
                  title="New folder"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                </button>
              </div>
              {folders.length > 0 ? (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => setSelectedFolderId(folder.id)}
                      className={cn(
                        'flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition',
                        selectedFolderId === folder.id ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-sidebar-border text-muted-foreground hover:text-foreground'
                      )}
                      title={folder.name}
                    >
                      <Folder className="h-3 w-3" />
                      <span className="max-w-24 truncate">{folder.name}</span>
                      {typeof folder.chatCount === 'number' ? <span className="text-muted-foreground">{folder.chatCount}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              {creatingFolder ? (
                <div className="flex gap-1.5">
                  <Input
                    value={folderName}
                    onChange={(event) => setFolderName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void handleCreateFolder();
                      if (event.key === 'Escape') setCreatingFolder(false);
                    }}
                    placeholder="Folder name"
                    className="h-8 text-sm"
                    autoFocus
                  />
                  <Button size="sm" variant="outline" onClick={() => void handleCreateFolder()} disabled={!folderName.trim()}>
                    Add
                  </Button>
                </div>
              ) : null}
              {selectedFolder ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-sidebar-border/70 px-2 py-1 text-xs text-muted-foreground">
                  <span className="truncate">Viewing {selectedFolder.name}</span>
                  <button type="button" onClick={() => void handleDeleteSelectedFolder()} className="text-destructive hover:underline">
                    Delete
                  </button>
                </div>
              ) : null}
              {folderActionMessage ? (
                <div className={cn(
                  'rounded-md border px-2 py-1 text-xs',
                  folderActionMessage.includes('failed')
                    ? 'border-destructive/30 text-destructive'
                    : 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                )}>
                  {folderActionMessage}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <ScrollArea className={cn('flex-1', isMobile ? 'pr-1' : 'px-2')}>
        {isAuthenticated ? (
          visibleChats.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              {collapsed ? '—' : searchQuery ? 'No chats match your search' : 'No chat history yet'}
            </div>
          ) : (
            <div className="space-y-1 py-3">
              {(!collapsed || isMobile) && (
                <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
                  <span>{hasSearched ? (selectedFolder ? `${selectedFolder.name}` : 'Search results') : 'Recent chats'}</span>
                  {hasSearched && (
                    <span className="text-xs font-normal normal-case">
                      {displayedChats.length} {displayedChats.length === 1 ? 'result' : 'results'}
                    </span>
                  )}
                </div>
              )}
              {visibleChats.map((chat) => (
                <div key={chat.id} className="group relative px-2">
                  <div className="flex items-center">
                    <Button
                      variant="ghost"
                      className={cn(
                        'justify-start text-left font-normal overflow-hidden',
                        collapsed ? 'h-10 w-10 px-0' : 'h-auto py-2 pl-3 pr-2'
                      )}
                      title={chat.query || 'Untitled chat'}
                      onClick={() => handleSelect(chat.id)}
                    >
                      {collapsed ? (
                        <>
                          <span className="sr-only">{chat.query || 'Untitled chat'}</span>
                          <span aria-hidden="true" className="block h-4 w-4" />
                        </>
                      ) : (
                        <span className="min-w-0">
                          <span className="block text-sm line-clamp-2 break-words max-w-[180px]">{chat.query || 'Untitled chat'}</span>
                          {chat.matchSnippet ? (
                            <span className="mt-1 block max-w-[180px] truncate text-[11px] text-muted-foreground">
                              {chat.matchRole ? `${chat.matchRole}: ` : ''}{chat.matchSnippet}
                            </span>
                          ) : chat.folderName ? (
                            <span className="mt-1 flex max-w-[180px] items-center gap-1 truncate text-[11px] text-muted-foreground">
                              <Folder className="h-3 w-3" /> {chat.folderName}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </Button>

                    {!collapsed && (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenMenuId(openMenuId === chat.id ? null : chat.id);
                        }}
                        className={cn(
                          "ml-auto w-8 h-8 shrink-0 flex items-center justify-center rounded hover:bg-accent transition-opacity text-muted-foreground",
                          isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        )}
                        aria-label="Chat options"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {!collapsed && openMenuId === chat.id && (
                    <div className="absolute right-2 top-full mt-1 z-50 w-48 rounded-md border border-border bg-popover py-1 shadow-lg">
                      {folders.length > 0 ? (
                        <div className="border-b border-border pb-1">
                          <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Move to folder</div>
                          {folders.map((folder) => (
                            <button
                              key={folder.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleAssignFolder(chat.id, folder.id);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                            >
                              <Folder className="h-4 w-4" />
                              <span className="truncate">{folder.name}</span>
                            </button>
                          ))}
                          {chat.folderId ? (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleAssignFolder(chat.id, null);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
                            >
                              <X className="h-4 w-4" />
                              Remove from folder
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenMenuId(null);
                          onDeleteChat(chat.id);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!collapsed && hasMoreChats && (
                <button
                  onClick={() => setShowAllChats(!showAllChats)}
                  className="w-full px-2 py-2 text-xs text-muted-foreground hover:text-sidebar-foreground transition-colors"
                >
                  {showAllChats
                    ? 'Show less'
                    : `Show ${displayedChats.length - INITIAL_CHAT_LIMIT} more`}
                </button>
              )}
            </div>
          )
        ) : canShowInfoCards ? (
          <div className="space-y-2 py-5">
            {informationItems.map((item) => {
              const selected = selectedInfoPage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectInfoPage?.(item.id)}
                  className={cn(
                    'w-full rounded-xl border px-3 py-3 text-left transition text-sm',
                    selected
                      ? 'border-primary/70 bg-primary/5 text-sidebar-foreground'
                      : 'border-sidebar-border/60 bg-muted/30 text-muted-foreground hover:text-sidebar-foreground'
                  )}
                >
                  <div className="font-semibold">{item.title}</div>
                  <p className="mt-1 text-xs leading-snug">{item.summary}</p>
                </button>
              );
            })}
          </div>
        ) : null}
      </ScrollArea>

      {!isAuthenticated && (isMobile || !collapsed) ? (
        <div className="border-t border-sidebar-border px-3 py-4">
          <Button className="w-full" onClick={() => onSignIn?.()}>
            Login
          </Button>
        </div>
      ) : null}

      {isAuthenticated && (isMobile || !collapsed) && (() => {
        const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'User';
        const initials = displayName.charAt(0).toUpperCase();
        return (
          <div className="border-t border-sidebar-border px-3 py-3">
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium text-sidebar-foreground">{displayName}</p>
              </div>
            </div>
          </div>
        );
      })()}
    </aside>
  );

  if (isMobile) {
    return (
      <div
        className={cn(
          'fixed inset-0 z-40 transition-opacity duration-300 ease-out lg:hidden',
          isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <div className="absolute inset-0 bg-background/70 backdrop-blur-sm transition-opacity duration-300" onClick={onClose} aria-hidden="true" />
        <div
          className={cn(
            'absolute left-0 top-0 h-full transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
            isOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {content}
        </div>
      </div>
    );
  }

  return content;
}
