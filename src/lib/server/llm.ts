/**
 * ARC Lab — shared server-side LLM plumbing (SERVER ONLY).
 *
 * Provider order:
 *  1. z-ai-web-dev-sdk (works out of the box in the ARC Lab sandbox)
 *  2. any OpenAI-compatible endpoint via env vars (used on HuggingFace Spaces
 *     or self-hosted deployments):
 *       OPENAI_API_KEY   (required to enable)
 *       OPENAI_BASE_URL  (optional, default https://api.openai.com/v1)
 *       OPENAI_MODEL     (optional, default gpt-4o-mini)
 */

export async function llmChat(system: string, user: string, timeoutMs = 45_000): Promise<string> {
  // 1) z-ai-web-dev-sdk
  try {
    const { default: ZAI } = await import('z-ai-web-dev-sdk');
    const zai = await ZAI.create();
    const completion = (await Promise.race([
      zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: system },
          { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' },
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('llm-timeout')), timeoutMs)),
    ])) as { choices?: Array<{ message?: { content?: string } }> };
    const text = completion.choices?.[0]?.message?.content ?? '';
    if (text) return text;
  } catch {
    // fall through to the OpenAI-compatible adapter
  }

  // 2) OpenAI-compatible adapter (env-configured)
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('no-llm-adapter: set OPENAI_API_KEY (+ optional OPENAI_BASE_URL / OPENAI_MODEL) to enable LLM agents here');
  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.4,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`openai-compatible error ${res.status}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}
