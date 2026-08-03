import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { encryptSecret } from '../../src/ai/ai.crypto.js';
import { AiService } from '../../src/ai/ai.service.js';
import type { AppConfig } from '../../src/config/app-config.js';
import { UrlSafetyPolicy } from '../../src/link-cards/url-safety.js';

const now = new Date('2026-08-03T00:00:00.000Z');

function ownerProvider(encryptionKey: string) {
  return {
    id: 'provider-1',
    ownerId: 'owner-1',
    name: 'Writing model',
    providerType: 'openai-compatible',
    baseUrl: 'https://ai.example.test/v1',
    model: 'editor-model',
    encryptedApiKey: encryptSecret('owner-secret', encryptionKey),
    createdAt: now,
    updatedAt: now,
  };
}

const publicDns = new UrlSafetyPolicy(
  vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
);

describe('AI session provider selection', () => {
  it('rejects deleting a provider that is still bound to a session', async () => {
    const encryptionKey = randomBytes(32).toString('base64');
    const provider = ownerProvider(encryptionKey);
    const selectedRows = [[provider], [{ id: 'session-1' }]];
    let selectCall = 0;
    const deleteProvider = vi.fn();
    const database = {
      select: () => {
        const rows = selectedRows[selectCall++] ?? [];
        return {
          from: () => ({
            where: () => ({ limit: async () => rows }),
          }),
        };
      },
      delete: deleteProvider,
    };
    const service = new AiService(
      database as never,
      { nodeEnv: 'development' } as AppConfig,
      publicDns,
      { request: vi.fn() },
    );

    await expect(service.deleteProvider('owner-1', provider.id)).rejects.toMatchObject({
      code: 'AI_PROVIDER_IN_USE',
      status: 409,
    });
    expect(deleteProvider).not.toHaveBeenCalled();
  });

  it('uses the first owner provider when no environment provider exists', async () => {
    const encryptionKey = randomBytes(32).toString('base64');
    const provider = ownerProvider(encryptionKey);
    const rows: unknown[][] = [
      [{ id: 'post-1' }],
      [{ id: provider.id }],
      [provider],
      [],
      [],
    ];
    let selectCall = 0;
    let insertedSession: Record<string, unknown> | undefined;
    const database = {
      select: () => {
        const call = selectCall++;
        const selectedRows = rows[call] ?? [];
        return {
          from: () => ({
            where: () => ({
              limit: async () => selectedRows,
              orderBy: () =>
                call === 1
                  ? { limit: async () => selectedRows }
                  : Promise.resolve(selectedRows),
            }),
          }),
        };
      },
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          insertedSession = values;
          return {
            returning: async () => [
              {
                ...values,
                activeRunId: null,
                activeRunStartedAt: null,
              },
            ],
          };
        },
      }),
    };
    const service = new AiService(
      database as never,
      {
        nodeEnv: 'development',
        aiCredentialsEncryptionKey: encryptionKey,
      } as AppConfig,
      publicDns,
      { request: vi.fn() },
    );

    const session = await service.createSession('owner-1', 'post-1', {});

    expect(insertedSession?.providerProfileId).toBe(provider.id);
    expect(session.providerProfileId).toBe(provider.id);
  });

  it('persists a run-time provider override on the session', async () => {
    const encryptionKey = randomBytes(32).toString('base64');
    const provider = ownerProvider(encryptionKey);
    const existingSession = {
      id: 'session-1',
      ownerId: 'owner-1',
      postId: 'post-1',
      title: 'Draft edits',
      providerProfileId: null,
      activeRunId: null,
      activeRunStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const selectedRows = [[existingSession], [provider]];
    let selectCall = 0;
    let claimedValues: Record<string, unknown> | undefined;
    const database = {
      select: () => {
        const rows = selectedRows[selectCall++] ?? [];
        return {
          from: () => ({
            where: () => ({ limit: async () => rows }),
          }),
        };
      },
      update: () => ({
        set: (values: Record<string, unknown>) => {
          claimedValues = values;
          return {
            where: () => ({
              returning: async () => [{ ...existingSession, ...values }],
            }),
          };
        },
      }),
      insert: () => ({ values: async () => undefined }),
    };
    const service = new AiService(
      database as never,
      {
        nodeEnv: 'development',
        aiCredentialsEncryptionKey: encryptionKey,
      } as AppConfig,
      publicDns,
      { request: vi.fn() },
    );

    const { stream } = await service.startRun('owner-1', existingSession.id, {
      message: 'Tighten this paragraph',
      providerProfileId: provider.id,
    });
    stream.destroy();

    expect(claimedValues?.providerProfileId).toBe(provider.id);
  });
});
