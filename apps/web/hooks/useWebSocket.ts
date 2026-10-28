import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisMetadata, DataAttachment, SourcePreview, StreamStatus } from '../types';

const DEFAULT_API_BASE = 'https://psxgpt-api-sqlite.isfandiyar-shaheen.workers.dev';
const API_BASE_URL = (import.meta.env.VITE_API_URL || DEFAULT_API_BASE).replace(/\/$/, '');
const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');

const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const POLL_INTERVAL_MS = 2000;

const STREAM_STATUSES: readonly StreamStatus[] = [
  'queued', 'extracting_tickers', 'verifying_tickers', 'running',
  'verifying_intent', 'searching', 'verifying_sources', 'streaming',
  'verifying_answer', 'done', 'failed', 'cancelled',
] as const;

function isStreamStatus(value: string): value is StreamStatus {
  return STREAM_STATUSES.includes(value as StreamStatus);
}

export interface WsMessageUpdate {
  messageId: string;
  content?: string;
  sources?: SourcePreview[];
  attachments?: DataAttachment[];
  status?: StreamStatus;
  metadata?: AnalysisMetadata;
}

export interface WsSessionUpdate {
  sessionId: string;
  deleted: boolean;
}

interface WsMessage {
  type: 'message_update' | 'session_update' | 'connected' | 'pong';
  messageId?: string;
  sessionId?: string;
  data?: {
    status?: string;
    content?: string;
    sources?: SourcePreview[];
    attachments?: DataAttachment[];
    metadata?: AnalysisMetadata;
    deleted?: boolean;
  };
}

interface UseWebSocketOptions {
  getToken: () => Promise<string>;
  onMessageUpdate?: (update: WsMessageUpdate) => void;
  onSessionUpdate?: (update: WsSessionUpdate) => void;
  enabled?: boolean;
}

export function useWebSocket({
  getToken,
  onMessageUpdate,
  onSessionUpdate,
  enabled = true,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_DELAY_MS);
  const [isConnected, setIsConnected] = useState(false);

  // Polling fallback state
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeMessageIdRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const pollMessage = useCallback(async (messageId: string) => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/messages/${messageId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) return;

      const data = await res.json();
      const status = data.metadata?.status;
      const derivedStatus = status && isStreamStatus(status) ? status : undefined;

      onMessageUpdate?.({
        messageId,
        content: data.content,
        sources: data.sources,
        attachments: data.attachments,
        status: derivedStatus,
        metadata: data.metadata,
      });

      // Stop polling when done, failed, or cancelled
      if (derivedStatus === 'done' || derivedStatus === 'failed' || derivedStatus === 'cancelled') {
        stopPolling();
        activeMessageIdRef.current = null;
      }
    } catch (error) {
      console.error('[Poll] Failed', error);
    }
  }, [getToken, onMessageUpdate, stopPolling]);

  const startPolling = useCallback((messageId: string) => {
    // Don't poll if WS is connected
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    stopPolling();
    activeMessageIdRef.current = messageId;

    // Poll immediately, then on interval
    void pollMessage(messageId);
    pollIntervalRef.current = setInterval(() => {
      void pollMessage(messageId);
    }, POLL_INTERVAL_MS);

    console.log('[Poll] Started for', messageId);
  }, [stopPolling, pollMessage]);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data) as WsMessage;

      if (msg.type === 'connected') {
        console.log('[WS] Connected');
        setIsConnected(true);
        reconnectDelayRef.current = RECONNECT_DELAY_MS;
        stopPolling(); // Stop polling when WS is back
        return;
      }

      if (msg.type === 'pong') return;

      if (msg.type === 'message_update' && msg.messageId && msg.data) {
        const { status, content, sources, attachments, metadata } = msg.data;
        const derivedStatus = status && isStreamStatus(status)
          ? status
          : metadata?.status && isStreamStatus(metadata.status)
            ? metadata.status
            : undefined;

        onMessageUpdate?.({
          messageId: msg.messageId,
          content,
          sources,
          attachments,
          status: derivedStatus,
          metadata,
        });
      }

      if (msg.type === 'session_update' && msg.sessionId && msg.data?.deleted) {
        onSessionUpdate?.({ sessionId: msg.sessionId, deleted: true });
      }
    } catch (error) {
      console.error('[WS] Parse error', error);
    }
  }, [onMessageUpdate, onSessionUpdate, stopPolling]);

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const token = await getToken();
    if (!token) {
      console.log('[WS] No token, skipping');
      return;
    }

    try {
      const ws = new WebSocket(`${WS_BASE_URL}/api/ws?token=${encodeURIComponent(token)}`);

      ws.onopen = () => console.log('[WS] Opened');
      ws.onmessage = handleMessage;

      ws.onclose = (event) => {
        console.log(`[WS] Closed: ${event.code}`);
        setIsConnected(false);
        wsRef.current = null;

        // Start polling fallback if there's an active message
        if (activeMessageIdRef.current) {
          startPolling(activeMessageIdRef.current);
        }

        // Schedule reconnect with exponential backoff
        if (!reconnectTimeoutRef.current && enabled) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            reconnectDelayRef.current = Math.min(
              reconnectDelayRef.current * 2,
              MAX_RECONNECT_DELAY_MS
            );
            void connect();
          }, reconnectDelayRef.current);
        }
      };

      ws.onerror = (error) => console.error('[WS] Error', error);
      wsRef.current = ws;
    } catch (error) {
      console.error('[WS] Connection failed', error);
    }
  }, [getToken, handleMessage, enabled, startPolling]);

  const disconnect = useCallback(() => {
    stopPolling();
    activeMessageIdRef.current = null;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, [stopPolling]);

  // Connect when enabled, disconnect when disabled
  useEffect(() => {
    if (enabled) {
      void connect();
    } else {
      disconnect();
    }
    return () => disconnect();
  }, [enabled, connect, disconnect]);

  // Reconnect on tab visibility
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && enabled && !isConnected) {
        console.log('[WS] Tab visible, reconnecting...');
        void connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [enabled, isConnected, connect]);

  // Track active message for polling
  const setActiveMessageId = useCallback((messageId: string | null) => {
    activeMessageIdRef.current = messageId;
    // If WS is disconnected and we have a message, start polling
    if (messageId && !isConnected) {
      startPolling(messageId);
    } else if (!messageId) {
      stopPolling();
    }
  }, [isConnected, startPolling, stopPolling]);

  return { isConnected, connect, disconnect, setActiveMessageId };
}

export { API_BASE_URL };
