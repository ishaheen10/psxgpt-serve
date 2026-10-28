import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from './useWebSocket';

export interface TickerEntry {
  Symbol: string;
  'Company Name': string;
  Industry: string;
}

let cachedTickers: TickerEntry[] | null = null;

export function useTickerLookup() {
  const [tickers, setTickers] = useState<TickerEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTickers = useCallback(async () => {
    if (cachedTickers) {
      setTickers(cachedTickers);
      return cachedTickers;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/tickers`);
      if (!response.ok) {
        throw new Error(`Failed to load tickers (${response.status})`);
      }
      const data = (await response.json()) as TickerEntry[];
      cachedTickers = data;
      setTickers(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to fetch tickers';
      setError(message);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const searchTickers = useCallback(
    (query: string) => {
      if (!query.trim()) return tickers;
      const normalized = query.toLowerCase().trim();
      return tickers.filter((ticker) =>
        ticker.Symbol.toLowerCase().includes(normalized) ||
        ticker['Company Name'].toLowerCase().includes(normalized) ||
        ticker.Industry.toLowerCase().includes(normalized),
      );
    },
    [tickers],
  );

  useEffect(() => {
    void fetchTickers();
  }, [fetchTickers]);

  return {
    tickers,
    isLoading,
    error,
    fetchTickers,
    searchTickers,
  };
}
