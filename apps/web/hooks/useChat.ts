function isOlderResearchUpdate(current: unknown, incoming: unknown): boolean {
  const a = (current as {research?: {id?: string;revision?: number}})?.research;
  const b = (incoming as {research?: {id?: string;revision?: number}})?.research;
  return !!a?.id && a.id === b?.id && (a.revision || 0) > (b.revision || 0);
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { useWebSocket, API_BASE_URL, type WsMessageUpdate, type WsSessionUpdate } from './useWebSocket';
import type { AnalysisMetadata, ChatMessage, SourcePreview, StreamStatus } from '../types';
import { parseAttachments } from './attachmentParsing';

function normalizeShareUrl(url: string): string {
  return url.replace('/#/s/', '/s/');
}

// Fire-and-forget event logging for funnel analysis
async function logEvent(
  getToken: () => Promise<string>,
  eventType: string,
  eventData?: Record<string, unknown>,
  sessionId?: string
) {
  try {
    const token = await getToken();
    fetch(`${API_BASE_URL}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ event_type: eventType, event_data: eventData, session_id: sessionId }),
    }).catch(() => {}); // Ignore errors - don't block user flow
  } catch {
    // Ignore - analytics should never break the app
  }
}

function parseSourcePreviews(value: unknown): SourcePreview[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value as SourcePreview[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseMetadata(value: unknown): AnalysisMetadata | undefined {
  if (!value) return undefined;
  let normalized = value;
  if (typeof value === 'string') {
    try {
      normalized = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return typeof normalized === 'object' && normalized !== null
    ? (normalized as AnalysisMetadata)
    : undefined;
}

export function useChat() {
  const auth = useAuth();
  const { user, getToken, isAnonymous, betaAccessGranted, hasActiveSubscription } = auth;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState('');
  const [sourcePreviews, setSourcePreviews] = useState<SourcePreview[]>([]);
  const sessionIdRef = useRef<string>(crypto.randomUUID());

  // Track active message ID for polling fallback
  const activeMessageIdRef = useRef<string | null>(null);

  const handleMessageUpdate = useCallback((update: WsMessageUpdate) => {
    const { messageId, content, sources, attachments, status, metadata } = update;

    // Parse attachments from metadata if not provided directly (for polling fallback)
    const parsedAttachments = attachments ?? parseAttachments(metadata?.attachments);

    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && !isOlderResearchUpdate(m.analysisMetadata, metadata)
          ? {
              ...m,
              content: content ?? m.content,
              sourcePreviews: sources ?? m.sourcePreviews,
              sourceCount: sources?.length ?? m.sourceCount,
              attachments: parsedAttachments ?? m.attachments,
              status: status ?? m.status,
              analysisMetadata: metadata ?? m.analysisMetadata,
            }
          : m
      )
    );

    if (sources?.length) setSourcePreviews(sources);
    // Only reset loading if THIS is the message we're tracking
    if (status === 'done' || status === 'failed' || status === 'cancelled') {
      if (messageId === activeMessageIdRef.current) {
        setIsLoading(false);
        activeMessageIdRef.current = null;
      }
    }
  }, []);

  const handleSessionUpdate = useCallback((update: WsSessionUpdate) => {
    if (update.deleted) setSessions((prev) => prev.filter((s) => s.id !== update.sessionId));
  }, []);

  const { isConnected: wsConnected, setActiveMessageId } = useWebSocket({
    getToken,
    onMessageUpdate: handleMessageUpdate,
    onSessionUpdate: handleSessionUpdate,
    enabled: Boolean(user),
  });

  // Sync active message ID with WebSocket for polling fallback
  useEffect(() => {
    setActiveMessageId(activeMessageIdRef.current);
  }, [wsConnected, setActiveMessageId]);

  const loadSessions = useCallback(async () => {
    if (!user) { setSessions([]); return; }
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setSessions((await res.json()) ?? []);
    } catch (error) {
      console.error('[Chat] Load sessions failed', error);
    }
  }, [user, getToken]);

  const loadFolders = useCallback(async () => {
    if (!user) { setFolders([]); return; }
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/folders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setFolders((await res.json()) ?? []);
    } catch (error) {
      console.error('[Chat] Load folders failed', error);
    }
  }, [user, getToken]);

  const createFolder = useCallback(async (name: string): Promise<any | null> => {
    if (!user) return null;
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return null;
      const folder = await res.json();
      await loadFolders();
      return folder;
    } catch (error) {
      console.error('[Chat] Create folder failed', error);
      return null;
    }
  }, [user, getToken, loadFolders]);

  const assignChatFolder = useCallback(async (sessionId: string, folderId: string | null): Promise<boolean> => {
    if (!user) return false;
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/folder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ folderId }),
      });
      if (!res.ok) return false;
      await Promise.all([loadSessions(), loadFolders()]);
      return true;
    } catch (error) {
      console.error('[Chat] Assign folder failed', error);
      return false;
    }
  }, [user, getToken, loadSessions, loadFolders]);

  const deleteFolder = useCallback(async (folderId: string): Promise<boolean> => {
    if (!user) return false;
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/folders/${folderId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return false;
      await Promise.all([loadSessions(), loadFolders()]);
      return true;
    } catch (error) {
      console.error('[Chat] Delete folder failed', error);
      return false;
    }
  }, [user, getToken, loadSessions, loadFolders]);

  // Search sessions across ALL chat history (server-side search)
  const searchSessions = useCallback(async (query: string, folderId?: string | null): Promise<any[]> => {
    if (!user) return [];
    try {
      const token = await getToken();
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (folderId) params.set('folder', folderId);
      const url = params.size ? `${API_BASE_URL}/api/sessions?${params.toString()}` : `${API_BASE_URL}/api/sessions`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) return (await res.json()) ?? [];
      return [];
    } catch (error) {
      console.error('[Chat] Search sessions failed', error);
      return [];
    }
  }, [user, getToken]);

  useEffect(() => {
    if (user) {
      void loadSessions();
      void loadFolders();
    } else {
      setSessions([]);
      setFolders([]);
    }
  }, [user, loadSessions, loadFolders]);

  const openChat = useCallback(async (sessionId: string) => {
    if (!user) return;
    sessionIdRef.current = sessionId;
    setIsLoading(true);
    activeMessageIdRef.current = null;
    setActiveMessageId(null);

    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) { setIsLoading(false); return; }

      const data = await res.json();
      const loadedMessages: ChatMessage[] = (data || []).map((row: any) => {
        const previews = parseSourcePreviews(row.sources);
        const metadata = parseMetadata(row.metadata);
        const attachments = parseAttachments(metadata?.attachments);
        return {
          id: row.id,
          role: row.role,
          content: row.content || '',
          status: metadata?.status,
          analysisMetadata: metadata,
          sourcePreviews: previews,
          sourceCount: previews?.length,
          attachments,
          timestamp: new Date(row.created_at),
        };
      });

      setMessages(loadedMessages);
      setIsLoading(false);

      const lastWithSources = [...loadedMessages].reverse().find((m) => m.role === 'assistant' && m.sourcePreviews?.length);
      setSourcePreviews(lastWithSources?.sourcePreviews ?? []);

      // Check if there's an in-progress message to track
      const lastAssistant = loadedMessages.filter((m) => m.role === 'assistant').pop();
      if (lastAssistant?.status && !['done', 'failed'].includes(lastAssistant.status)) {
        setIsLoading(true);
        activeMessageIdRef.current = lastAssistant.id;
        setActiveMessageId(lastAssistant.id);
      }
    } catch (error) {
      console.error('[Chat] Open chat failed', error);
      setIsLoading(false);
    }
  }, [user, getToken, setActiveMessageId]);

  const newChat = useCallback(() => {
    sessionIdRef.current = crypto.randomUUID();
    setMessages([]);
    setSourcePreviews([]);
    setIsLoading(false);
    activeMessageIdRef.current = null;
    setActiveMessageId(null);
  }, [setActiveMessageId]);

  const deleteChat = useCallback(async (sessionId: string) => {
    if (!user) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        await loadSessions();
        if (sessionIdRef.current === sessionId) newChat();
      }
    } catch (error) {
      console.error('[Chat] Delete failed', error);
    }
  }, [user, getToken, loadSessions, newChat]);

  const isGuest = !user;

  const submitPrompt = useCallback(async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question || !user) return;

    // Check if we're steering (sending while a request is in progress)
    let steerContext: string | undefined;
    const steeringMessageId = activeMessageIdRef.current;
    if (isLoading && steeringMessageId) {
      // Find the in-progress message and capture its thinking
      const inProgressMsg = messages.find(m => m.id === steeringMessageId);
      const meta = inProgressMsg?.analysisMetadata;
      const thinking = typeof meta?.thinking === 'string' ? meta.thinking : undefined;
      const structuredThinking = typeof meta?.structuredThinking === 'string' ? meta.structuredThinking : undefined;
      const unstructuredThinking = typeof meta?.unstructuredThinking === 'string' ? meta.unstructuredThinking : undefined;
      const laneThinkingEntries =
        meta?.laneThinking && typeof meta.laneThinking === 'object'
          ? Object.entries(meta.laneThinking as Record<string, unknown>)
              .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
          : [];
      if (thinking) {
        steerContext = thinking;
      } else if (laneThinkingEntries.length > 0) {
        steerContext = laneThinkingEntries
          .map(([lane, laneThought]) => `## ${lane}\n${laneThought}`)
          .join('\n\n');
      } else if (structuredThinking || unstructuredThinking) {
        steerContext = [
          structuredThinking ? `## Structured Scout\n${structuredThinking}` : null,
          unstructuredThinking ? `## Unstructured Scout\n${unstructuredThinking}` : null,
        ].filter(Boolean).join('\n\n');
      }

      // Cancel the current request with specific message ID
      try {
        const token = await getToken();
        await fetch(`${API_BASE_URL}/api/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ message_id: steeringMessageId }),
        });
      } catch (e) {
        console.error('[Chat] Cancel for steer failed', e);
      }

      // Mark the old message as cancelled
      setMessages((prev) =>
        prev.map((m) =>
          m.id === steeringMessageId
            ? { ...m, status: 'cancelled' as StreamStatus, content: m.content || '(Redirected by user)' }
            : m
        )
      );
    }

    // Log query attempt FIRST (before any async that could fail)
    logEvent(getToken, 'query_started', { query: question, steered: !!steerContext }, sessionIdRef.current);

    setInput('');
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: question, timestamp: new Date() }]);
    setIsLoading(true);
    setSourcePreviews([]);

    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          user_prompt: question,
          session_id: sessionIdRef.current,
          steer_context: steerContext,  // Include Scout's reasoning so far if steering
        }),
      });

      if (!res.ok) {
        let errorMessage = 'Generation failed';
        try {
          const details = await res.json();
          if (details?.error && typeof details.error === 'string') errorMessage = details.error;
        } catch {}
        throw new Error(errorMessage);
      }

      const { sessionId, assistantMessageId } = await res.json();
      if (sessionId) sessionIdRef.current = sessionId;

      // Track for polling fallback
      activeMessageIdRef.current = assistantMessageId;
      setActiveMessageId(assistantMessageId);

      setMessages((prev) => [...prev, { id: assistantMessageId, role: 'assistant', content: '', status: 'queued' as StreamStatus, timestamp: new Date() }]);
      void loadSessions();
    } catch (error) {
      console.error('[Chat] Submit failed', error);
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: error instanceof Error ? error.message : 'Failed to generate response.', status: 'failed' as StreamStatus, timestamp: new Date() }]);
      setIsLoading(false);
      activeMessageIdRef.current = null;
      setActiveMessageId(null);
    }
  }, [user, getToken, loadSessions, setActiveMessageId, isLoading, messages]);

  const handleSubmit = useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault();
    await submitPrompt(input);
  }, [input, submitPrompt]);

  const cancelRequest = useCallback(async () => {
    if (!user || !isLoading) return;

    const cancelledMessageId = activeMessageIdRef.current;

    // Always reset local UI state immediately so user can unstick
    setIsLoading(false);
    activeMessageIdRef.current = null;
    setActiveMessageId(null);

    // Mark the message as cancelled in the UI
    if (cancelledMessageId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === cancelledMessageId
            ? { ...m, status: 'cancelled' as StreamStatus }
            : m
        )
      );

      // Notify backend with specific message ID
      try {
        const token = await getToken();
        await fetch(`${API_BASE_URL}/api/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ message_id: cancelledMessageId }),
        });
      } catch (error) {
        console.error('[Chat] Cancel request failed', error);
      }
    }
  }, [user, isLoading, getToken, setActiveMessageId]);

  // Share current session - creates a public shareable link
  const shareSession = useCallback(async (): Promise<string | null> => {
    if (!user || !sessionIdRef.current) return null;

    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionIdRef.current}/share`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        console.error('[Chat] Share failed', res.status);
        return null;
      }

      const payload = await res.json();
      if (typeof payload?.canonicalShareUrl === 'string') return normalizeShareUrl(payload.canonicalShareUrl);
      if (typeof payload?.shareUrl === 'string') return normalizeShareUrl(payload.shareUrl);
      if (typeof payload?.shareId === 'string') return `${window.location.origin}/s/${payload.shareId}`;
      return null;
    } catch (error) {
      console.error('[Chat] Share failed', error);
      return null;
    }
  }, [user, getToken]);

  // Import a shared conversation into user's account
  const importSharedConversation = useCallback(async (shareId: string): Promise<string | null> => {
    if (!user) return null;

    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/sessions/import/${shareId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        console.error('[Chat] Import failed', res.status);
        return null;
      }

      const { sessionId } = await res.json();

      // Open the newly imported session
      if (sessionId) {
        await openChat(sessionId);
        await loadSessions();
      }

      return sessionId;
    } catch (error) {
      console.error('[Chat] Import failed', error);
      return null;
    }
  }, [user, getToken, openChat, loadSessions]);

  return {
    messages, input, setInput, isLoading, handleSubmit, submitPrompt, cancelRequest, sourcePreviews,
    sourceContext: null as string | null,
    chats: sessions, folders, openChat, newChat, deleteChat, searchSessions, createFolder, assignChatFolder, deleteFolder,
    user, isGuest, isAnonymousUser: isAnonymous, betaAccessGranted, hasActiveSubscription,
    signInWithGoogle: auth.signInWithGoogle, sendMagicLink: auth.sendMagicLink, signOut: auth.signOut,
    wsConnected,
    getAccessToken: getToken,
    shareSession,
    importSharedConversation,
  };
}
