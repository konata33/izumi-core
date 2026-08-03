import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { encryptSecret } from '../../src/ai/ai.crypto.js';
import { AiProviderClient, formatSseEvent } from '../../src/ai/ai-provider.client.js';
import { AiService } from '../../src/ai/ai.service.js';
import type { AiProviderConfig, AppConfig } from '../../src/config/app-config.js';
import type { LinkCardHttpClient } from '../../src/link-cards/pinned-http-client.js';
import { UrlSafetyPolicy } from '../../src/link-cards/url-safety.js';

function sseResponse(events: string[]): Response {
  return new Response(events.map((event) => `data: ${event}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const openAiProvider: AiProviderConfig = {
  providerType: 'openai-compatible',
  baseUrl: 'https://ai.example.test/v1',
  model: 'editor-model',
  apiKey: 'never-log-this-key',
};

describe('AI provider streaming', () => {
  it('normalizes OpenAI-compatible and Claude text deltas', async () => {
    const openAiFetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.messages[0]).toEqual({
        role: 'system',
        content: 'Current article context',
      });
      return sseResponse([
        JSON.stringify({ choices: [{ delta: { content: '静' } }] }),
        JSON.stringify({ choices: [{ delta: { content: '默' } }] }),
        '[DONE]',
      ]);
    });
    const openAi = new AiProviderClient(openAiFetch);
    const openAiChunks: string[] = [];
    for await (const chunk of openAi.streamCompletion(
      openAiProvider,
      [{ role: 'user', content: 'write' }],
      new AbortController().signal,
      'Current article context',
    )) {
      openAiChunks.push(chunk);
    }
    expect(openAiChunks.join('')).toBe('静默');

    const claude = new AiProviderClient(
      vi.fn(async () =>
        sseResponse([
          JSON.stringify({
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: '编辑' },
          }),
        ]),
      ),
    );
    const claudeChunks: string[] = [];
    for await (const chunk of claude.streamCompletion(
      { ...openAiProvider, providerType: 'claude' },
      [{ role: 'user', content: 'write' }],
      new AbortController().signal,
    )) {
      claudeChunks.push(chunk);
    }
    expect(claudeChunks).toEqual(['编辑']);
  });

  it('does not expose provider response bodies or credentials in errors', async () => {
    const client = new AiProviderClient(
      vi.fn(
        async () => new Response('upstream says never-log-this-key', { status: 401 }),
      ),
    );

    await expect(client.testConnection(openAiProvider)).rejects.toThrow(
      'AI provider returned HTTP 401',
    );
    await expect(client.testConnection(openAiProvider)).rejects.not.toThrow(
      'never-log-this-key',
    );
  });

  it('propagates aborts and emits valid normalized SSE envelopes', async () => {
    const client = new AiProviderClient(
      vi.fn(async (_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        });
      }),
    );
    const controller = new AbortController();
    const run = client
      .streamCompletion(
        openAiProvider,
        [{ role: 'user', content: 'write' }],
        controller.signal,
      )
      .next();
    controller.abort();

    await expect(run).rejects.toBeDefined();
    expect(formatSseEvent('error', { code: 'AI_RUN_FAILED' })).toBe(
      'event: error\ndata: {"code":"AI_RUN_FAILED"}\n\n',
    );
  });

  it('pins production provider requests to the address validated for that request', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const request = vi.fn<LinkCardHttpClient['request']>(async (target) => {
      expect(target.url.hostname).toBe('ai.example.test');
      expect(target.address).toBe('93.184.216.34');
      return new Response('{}');
    });
    const service = new AiService(
      {} as never,
      {
        nodeEnv: 'production',
        defaultAiProvider: openAiProvider,
      } as AppConfig,
      new UrlSafetyPolicy(lookup),
      { request },
    );

    await expect(service.testProvider('owner-1', 'environment')).resolves.toMatchObject(
      { ok: true },
    );
    // The native transport receives the resolved address and performs no
    // additional DNS lookup after the safety check.
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects owner BYOK localhost providers even outside production', async () => {
    const encryptionKey = randomBytes(32).toString('base64');
    const provider = {
      id: 'profile-1',
      ownerId: 'owner-1',
      name: 'Unsafe local profile',
      providerType: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'local',
      encryptedApiKey: encryptSecret('local-secret', encryptionKey),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const database = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [provider] }),
        }),
      }),
    };
    const request = vi.fn<LinkCardHttpClient['request']>();
    const service = new AiService(
      database as never,
      {
        nodeEnv: 'development',
        aiCredentialsEncryptionKey: encryptionKey,
      } as AppConfig,
      new UrlSafetyPolicy(),
      { request },
    );

    await expect(service.testProvider('owner-1', provider.id)).rejects.toMatchObject({
      code: 'AI_PROVIDER_URL_UNSAFE',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('pins owner BYOK requests in development after public DNS validation', async () => {
    const encryptionKey = randomBytes(32).toString('base64');
    const provider = {
      id: 'profile-1',
      ownerId: 'owner-1',
      name: 'Public profile',
      providerType: 'openai-compatible',
      baseUrl: 'http://ai.example.test/v1',
      model: 'editor',
      encryptedApiKey: encryptSecret('owner-secret', encryptionKey),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const database = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [provider] }),
        }),
      }),
    };
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const request = vi.fn<LinkCardHttpClient['request']>(async (target) => {
      expect(target.address).toBe('93.184.216.34');
      return new Response('{}');
    });
    const service = new AiService(
      database as never,
      {
        nodeEnv: 'development',
        aiCredentialsEncryptionKey: encryptionKey,
      } as AppConfig,
      new UrlSafetyPolicy(lookup),
      { request },
    );

    await expect(service.testProvider('owner-1', provider.id)).resolves.toMatchObject({
      ok: true,
    });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('AI provider profile validation', () => {
  it.each([{ name: '   ' }, { model: '\t' }, { apiKey: '\n' }])(
    'rejects a whitespace-only update field before persistence',
    async (input) => {
      const service = new AiService(
        {} as never,
        {} as AppConfig,
        new UrlSafetyPolicy(),
        { request: vi.fn() },
      );

      await expect(
        service.updateProvider('owner-1', 'profile-1', input),
      ).rejects.toMatchObject({
        code: 'AI_PROVIDER_FIELD_INVALID',
        status: 400,
      });
    },
  );
});
