import type { AiProviderConfig } from '../config/app-config.js';

type ChatMessage = Readonly<{ role: 'user' | 'assistant'; content: string }>;
export type AiFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

function endpoint(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}${suffix}`;
}

async function safeProviderError(response: Response): Promise<Error> {
  await response.body?.cancel().catch(() => undefined);
  return new Error(`AI provider returned HTTP ${response.status}`);
}

async function* parseSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/u);
      buffer = events.pop() ?? '';
      for (const event of events) {
        const data = event
          .split(/\r?\n/u)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) yield data;
      }
      if (done) break;
    }
    if (buffer) {
      const data = buffer
        .split(/\r?\n/u)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) yield data;
    }
  } finally {
    reader.releaseLock();
  }
}

function providerRequest(
  provider: AiProviderConfig,
  messages: readonly ChatMessage[],
  stream: boolean,
  system?: string,
): { url: string; headers: Record<string, string>; body: string } {
  if (provider.providerType === 'claude') {
    return {
      url: endpoint(provider.baseUrl, '/v1/messages'),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: stream ? 4_096 : 1,
        stream,
        system,
        messages,
      }),
    };
  }
  return {
    url: endpoint(provider.baseUrl, '/chat/completions'),
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: stream ? 4_096 : 1,
      stream,
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    }),
  };
}

export class AiProviderClient {
  constructor(private readonly fetchImplementation: AiFetch = fetch) {}

  async testConnection(
    provider: AiProviderConfig,
    signal?: AbortSignal,
  ): Promise<void> {
    const request = providerRequest(
      provider,
      [{ role: 'user', content: 'Reply with OK.' }],
      false,
    );
    const response = await this.fetchImplementation(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: signal ?? AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw await safeProviderError(response);
    await response.body?.cancel().catch(() => undefined);
  }

  async *streamCompletion(
    provider: AiProviderConfig,
    messages: readonly ChatMessage[],
    signal: AbortSignal,
    system?: string,
  ): AsyncGenerator<string> {
    const request = providerRequest(provider, messages, true, system);
    const response = await this.fetchImplementation(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal,
    });
    if (!response.ok) throw await safeProviderError(response);
    if (!response.body) throw new Error('AI provider returned no response body');

    for await (const data of parseSseData(response.body)) {
      if (data === '[DONE]') break;
      let event: unknown;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      if (provider.providerType === 'claude') {
        const candidate = event as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (
          candidate.type === 'content_block_delta' &&
          candidate.delta?.type === 'text_delta' &&
          candidate.delta.text
        ) {
          yield candidate.delta.text;
        }
      } else {
        const candidate = event as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const text = candidate.choices?.[0]?.delta?.content;
        if (text) yield text;
      }
    }
  }
}

export function formatSseEvent(
  event: 'meta' | 'delta' | 'done' | 'error',
  data: Record<string, unknown>,
): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
