import { useEffect, useState } from 'react';
import { API_BASE_URL } from './useWebSocket';
import type { ChatMessage, SourcePreview } from '../types';
import { parseAttachments } from './attachmentParsing';

interface SharedConversationData {
  title: string;
  messages: ChatMessage[];
  sharedAt: string;
  messageCount: number;
}

export function useSharedConversation(shareId: string) {
  const [data, setData] = useState<SharedConversationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shareId) {
      setLoading(false);
      setError('Invalid share ID');
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`${API_BASE_URL}/api/shared/${shareId}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(res.status === 404 ? 'Conversation not found' : 'Failed to load conversation');
        }
        return res.json();
      })
      .then((rawData) => {
        // Transform API response to ChatMessage format
        const messages: ChatMessage[] = (rawData.messages || []).map((m: any) => {
          const previews: SourcePreview[] | undefined = m.sources || undefined;
          const metadata = m.metadata || undefined;

          return {
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content || '',
            status: metadata?.status || 'done',
            analysisMetadata: metadata,
            sourcePreviews: previews,
            sourceCount: previews?.length,
            attachments: parseAttachments(metadata?.attachments),
            timestamp: new Date(m.created_at),
          };
        });

        setData({
          title: rawData.title,
          messages,
          sharedAt: rawData.sharedAt,
          messageCount: rawData.messageCount,
        });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load conversation');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [shareId]);

  return { data, loading, error };
}
