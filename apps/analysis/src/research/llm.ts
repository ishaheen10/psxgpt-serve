import type { Env } from "../types";
import type { Message, ModelResponse, StreamedResponse } from "../compat/types";

export const MODEL_ROUTER = "gemini-3.1-flash-lite";
export const MODEL_ANALYST = "deepseek-v4-pro";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

async function gemini(
  env: Env,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GEMINI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.GEMINI_MODEL || MODEL_ROUTER,
        reasoning_effort: "minimal",
        ...body,
      }),
      signal,
    });
    if (response.ok) return response.json();
    if (attempt >= 2 || (response.status !== 429 && response.status < 500))
      throw new Error(
        `Research provider unavailable (${response.status}). Please retry.`,
      );
    await response.body?.cancel();
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const cancel = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(
        () => {
          signal?.removeEventListener("abort", cancel);
          resolve();
        },
        750 * (attempt + 1),
      );
      signal?.addEventListener("abort", cancel, { once: true });
    });
  }
}

export async function callModel(
  env: Env,
  _model: string,
  messages: Message[],
  signal?: AbortSignal,
  options?: { responseFormat?: "json_object" },
): Promise<ModelResponse> {
  const payload = await gemini(
    env,
    {
      messages,
      temperature: 0.1,
      stream: false,
      ...(options?.responseFormat
        ? { response_format: { type: options.responseFormat } }
        : {}),
    },
    signal,
  );
  return {
    content: String(payload.choices?.[0]?.message?.content || ""),
    reasoning: "",
    inputTokens: payload.usage?.prompt_tokens || 0,
    outputTokens: payload.usage?.completion_tokens || 0,
  };
}

export async function callDeepSeekStreaming(
  env: Env,
  messages: Message[],
  tools: readonly Record<string, unknown>[],
  _model: string,
  _onReasoning?: (text: string) => Promise<void>,
  onContent?: (text: string) => Promise<void>,
  signal?: AbortSignal,
): Promise<StreamedResponse> {
  if (tools.length) {
    const payload = await gemini(
      env,
      { messages, tools, tool_choice: "required", stream: false },
      signal,
    );
    const message = payload.choices?.[0]?.message;
    return {
      content: String(message?.content || ""),
      reasoning: "",
      toolCalls: (message?.tool_calls || []).filter(
        (t: any) => t.id && t.function?.name,
      ),
      inputTokens: payload.usage?.prompt_tokens || 0,
      outputTokens: payload.usage?.completion_tokens || 0,
    };
  }
  if (!env.DEEPSEEK_API_KEY)
    throw new Error("The answer provider is not configured.");
  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_ANALYST_MODEL || MODEL_ANALYST,
      messages,
      stream: true,
      thinking: { type: "disabled" },
      max_tokens: 8000,
    }),
    signal,
  });
  if (!response.ok)
    throw new Error(
      `Answer provider unavailable (${response.status}). Please retry.`,
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No answer stream received.");
  let content = "",
    inputTokens = 0,
    outputTokens = 0,
    buffer = "",
    finished = false;
  const decoder = new TextDecoder();
  const consume = async (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") {
      finished = true;
      return;
    }
    const chunk = JSON.parse(data);
    if (chunk.error) throw new Error("Answer stream interrupted.");
    inputTokens = chunk.usage?.prompt_tokens || inputTokens;
    outputTokens = chunk.usage?.completion_tokens || outputTokens;
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason === "length")
      throw new Error("Answer reached its output limit.");
    // Private reasoning is neither retained nor sent to the browser.
    if (choice?.delta?.content) {
      content += choice.delta.content;
      await onContent?.(content);
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) await consume(line);
    }
    if (buffer.trim()) await consume(buffer);
    if (!finished) throw new Error("Answer stream ended before completion.");
    return { content, reasoning: "", toolCalls: [], inputTokens, outputTokens };
  } finally {
    await reader.cancel().catch(() => {});
  }
}
