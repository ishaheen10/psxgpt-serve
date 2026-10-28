/**
 * PSX API client — fetches prices and shares from dps.psx.com.pk.
 */

const PSX_TIMESERIES_URL = "https://dps.psx.com.pk/timeseries/eod";
const PSX_COMPANY_URL = "https://dps.psx.com.pk/company";
const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; PSXBot/1.0)",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};
const FETCH_TIMEOUT_MS = 8000;

export interface PricePoint {
  date: string;
  close: number;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { cf?: unknown } = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchPrices(symbol: string): Promise<PricePoint[]> {
  try {
    const resp = await fetchWithTimeout(`${PSX_TIMESERIES_URL}/${symbol}`, {
      headers: DEFAULT_HEADERS,
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!resp.ok) return [];

    const json = await resp.json() as { status: number; data?: number[][] };
    if (json.status !== 1 || !json.data) return [];

    const prices: PricePoint[] = [];
    for (const item of json.data) {
      if (item.length < 4) continue;
      const close = item[3];
      if (!close || close <= 0) continue;
      const d = new Date(item[0] * 1000);
      prices.push({
        date: d.toISOString().split("T")[0],
        close,
      });
    }

    prices.sort((a, b) => a.date.localeCompare(b.date));
    return prices;
  } catch (error) {
    console.error(`fetchPrices(${symbol}):`, error);
    return [];
  }
}

export async function fetchLatestPrice(symbol: string): Promise<PricePoint | null> {
  const prices = await fetchPrices(symbol);
  return prices.length > 0 ? prices[prices.length - 1] : null;
}

export async function fetchShares(ticker: string): Promise<number | null> {
  try {
    const resp = await fetchWithTimeout(`${PSX_COMPANY_URL}/${ticker}`, {
      headers: DEFAULT_HEADERS,
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!resp.ok) return null;

    const html = await resp.text();

    const primary = html.match(
      /stats_label">\s*Shares\s*<\/div>\s*<div[^>]*class="stats_value"[^>]*>\s*([\d,]+)\s*<\/div>/i
    );
    if (primary) {
      return parseInt(primary[1].replace(/,/g, ""), 10);
    }

    const fallback = html.match(/>Shares<[^>]*>[^<]*<[^>]*>([\d,]{7,})</i);
    if (fallback) {
      return parseInt(fallback[1].replace(/,/g, ""), 10);
    }

    const ffMatch = html.match(/Free\s*Float[^<]*<[^>]*>([\d,]+)</i);
    const pctMatch = html.match(/([\d.]+)\s*%\s*<\/div>/);
    if (ffMatch && pctMatch) {
      const freeFloat = parseInt(ffMatch[1].replace(/,/g, ""), 10);
      const pct = parseFloat(pctMatch[1]);
      if (pct > 0) {
        return Math.round(freeFloat / (pct / 100));
      }
    }

    return null;
  } catch (error) {
    console.error(`fetchShares(${ticker}):`, error);
    return null;
  }
}
