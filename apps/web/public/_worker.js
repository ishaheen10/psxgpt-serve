const API_BASE_URL = "https://psxgpt-api-sqlite.isfandiyar-shaheen.workers.dev";
const SHARE_PATH_RE = /^\/s\/([23456789abcdefghjkmnpqrstuvwxyz]{8,32})$/i;

const DEFAULT_META = {
  title: "psxGPT - AI Assistant for PSX",
  description:
    "AI-powered financial analysis for Pakistan Stock Exchange companies. Get instant insights from audited financial statements.",
  image: "https://psxgpt.com/icon.png?v=3",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function compactText(value, maxLength) {
  const compact = String(value ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`>#~-]+/g, " ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\[[^\]]{1,60}\]/g, "")
    .trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function stripAnswerMarkers(value) {
  return String(value ?? "")
    .replace(/USED_TABLE_TAGS:\s*\[[^\]]*\]/gi, "")
    .replace(/USED_SOURCE_TAGS:\s*\[[^\]]*\]/gi, "");
}

function buildShareMeta(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const firstUser = messages.find((message) => message?.role === "user" && message?.content);
  const firstAssistant = messages.find((message) => message?.role === "assistant" && message?.content);

  const question = compactText(firstUser?.content || payload?.title || "Shared psxGPT conversation", 110);
  const answerPreview = compactText(stripAnswerMarkers(firstAssistant?.content), 220);

  return {
    title: question ? `psxGPT report: ${question}` : DEFAULT_META.title,
    description:
      answerPreview ||
      (question ? `Shared psxGPT analysis for: ${question}` : DEFAULT_META.description),
    image: DEFAULT_META.image,
  };
}

function renderShareHtml({ shareId, requestUrl, meta }) {
  const appUrl = `${requestUrl.origin}/#/s/${shareId}`;
  const canonicalUrl = `${requestUrl.origin}/s/${shareId}`;
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const image = escapeHtml(meta.image);
  const canonical = escapeHtml(canonicalUrl);
  const app = escapeHtml(appUrl);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <meta name="title" content="${title}" />
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${image}" />
    <meta property="twitter:card" content="summary" />
    <meta property="twitter:url" content="${canonical}" />
    <meta property="twitter:title" content="${title}" />
    <meta property="twitter:description" content="${description}" />
    <meta property="twitter:image" content="${image}" />
    <script>window.location.replace(${JSON.stringify(appUrl)});</script>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${description}</p>
      <p><a href="${app}">Open this psxGPT report</a></p>
    </main>
  </body>
</html>`;
}

async function handleSharedPreview(request, env) {
  const requestUrl = new URL(request.url);
  const match = requestUrl.pathname.match(SHARE_PATH_RE);
  if (!match) return fetchAssetOrAppShell(request, env);

  const shareId = match[1].toLowerCase();
  let meta = DEFAULT_META;

  try {
    const apiBase = env.API_BASE_URL || (requestUrl.hostname.endsWith('psxgpt-serve-test.pages.dev')
      ? 'https://psxgpt-serve-test.isfandiyar-shaheen.workers.dev' : API_BASE_URL);
    const response = await fetch(`${apiBase}/api/shared/${shareId}`, {
      headers: { Accept: "application/json" },
    });
    if (response.ok) {
      meta = buildShareMeta(await response.json());
    }
  } catch {
    meta = DEFAULT_META;
  }

  return new Response(renderShareHtml({ shareId, requestUrl, meta }), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

async function fetchAssetOrAppShell(request, env) {
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404) return response;

  const requestUrl = new URL(request.url);
  const isDocumentRequest = (request.headers.get("accept") || "").includes("text/html");
  const hasFileExtension = /\.[^/]+$/.test(requestUrl.pathname);
  if (!isDocumentRequest || hasFileExtension || requestUrl.pathname.startsWith("/api/")) {
    return response;
  }

  const indexUrl = new URL("/", request.url);
  return env.ASSETS.fetch(new Request(indexUrl, request));
}

export default {
  fetch(request, env) {
    return handleSharedPreview(request, env);
  },
};
