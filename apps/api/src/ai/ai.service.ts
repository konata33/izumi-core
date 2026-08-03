import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, lt, or } from 'drizzle-orm';

import { ApiException } from '../common/api-exception.js';
import {
  APP_CONFIG,
  type AiProviderConfig,
  type AppConfig,
} from '../config/app-config.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { posts } from '../database/schema.js';
import {
  LINK_CARD_HTTP_CLIENT,
  type LinkCardHttpClient,
} from '../link-cards/pinned-http-client.js';
import { UrlSafetyPolicy } from '../link-cards/url-safety.js';
import { decryptSecret, encryptSecret, maskSecret } from './ai.crypto.js';
import type {
  AiMessageDto,
  AiProviderProfileDto,
  AiProviderType,
  AiSessionDto,
  AiToolDecisionDto,
  CreateAiProviderProfileDto,
  CreateAiSessionDto,
  UpdateAiProviderProfileDto,
} from './ai.dto.js';
import { AiProviderClient, formatSseEvent } from './ai-provider.client.js';
import {
  aiMessages,
  aiProviderProfiles,
  aiSessions,
  aiToolDecisions,
} from './ai.schema.js';
import { buildBoundedHistory, buildPostContext } from './post-context.js';

type ProviderRecord = typeof aiProviderProfiles.$inferSelect;
type SessionRecord = typeof aiSessions.$inferSelect;
type MessageRecord = typeof aiMessages.$inferSelect;
type DecisionRecord = typeof aiToolDecisions.$inferSelect;

type ResolvedProvider = AiProviderConfig & {
  id: string;
  allowPrivateNetwork: boolean;
};
export const AI_ACTIVE_RUN_STALE_AFTER_MS = 30 * 60 * 1_000;

export function isActiveRunStale(
  session: Pick<SessionRecord, 'activeRunId' | 'activeRunStartedAt'>,
  now = new Date(),
): boolean {
  return (
    session.activeRunId !== null &&
    (session.activeRunStartedAt === null ||
      session.activeRunStartedAt.getTime() <=
        now.getTime() - AI_ACTIVE_RUN_STALE_AFTER_MS)
  );
}

function providerDto(provider: ProviderRecord, apiKey: string): AiProviderProfileDto {
  return {
    id: provider.id,
    name: provider.name,
    providerType: provider.providerType as AiProviderType,
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKeyMasked: maskSecret(apiKey),
    source: 'owner',
    readOnly: false,
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString(),
  };
}

function assertProviderText(input: {
  name?: string;
  model?: string;
  apiKey?: string;
}): void {
  if (
    [input.name, input.model, input.apiKey].some(
      (value) => value !== undefined && !value.trim(),
    )
  ) {
    throw new ApiException(
      'AI_PROVIDER_FIELD_INVALID',
      'Provider name, model, and API key must contain non-whitespace text',
      HttpStatus.BAD_REQUEST,
    );
  }
}

function messageDto(message: MessageRecord): AiMessageDto {
  return {
    id: message.id,
    role: message.role as 'user' | 'assistant',
    content: message.content,
    status: message.status as 'complete' | 'failed' | 'cancelled',
    runId: message.runId,
    createdAt: message.createdAt.toISOString(),
  };
}

function decisionDto(decision: DecisionRecord): AiToolDecisionDto {
  return {
    id: decision.id,
    runId: decision.runId,
    toolCallId: decision.toolCallId,
    toolName: decision.toolName,
    payload: decision.payload,
    decision: decision.decision as 'pending' | 'accepted' | 'rejected',
    decidedAt: decision.decidedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class AiService {
  private readonly activeRuns = new Map<string, AbortController>();

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(UrlSafetyPolicy) private readonly urlSafety: UrlSafetyPolicy,
    @Inject(LINK_CARD_HTTP_CLIENT)
    private readonly pinnedHttp: LinkCardHttpClient,
  ) {}

  async listProviders(ownerId: string): Promise<AiProviderProfileDto[]> {
    const providers = await this.database
      .select()
      .from(aiProviderProfiles)
      .where(eq(aiProviderProfiles.ownerId, ownerId))
      .orderBy(asc(aiProviderProfiles.name));
    const result: AiProviderProfileDto[] = [];
    if (this.config.defaultAiProvider) {
      result.push({
        id: 'environment',
        name: 'Environment default',
        providerType: this.config.defaultAiProvider.providerType as AiProviderType,
        baseUrl: this.config.defaultAiProvider.baseUrl,
        model: this.config.defaultAiProvider.model,
        apiKeyMasked: maskSecret(this.config.defaultAiProvider.apiKey),
        source: 'environment',
        readOnly: true,
        createdAt: null,
        updatedAt: null,
      });
    }
    for (const provider of providers) {
      result.push(providerDto(provider, this.decrypt(provider.encryptedApiKey)));
    }
    return result;
  }

  async createProvider(
    ownerId: string,
    input: CreateAiProviderProfileDto,
  ): Promise<AiProviderProfileDto> {
    assertProviderText(input);
    await this.assertBaseUrl(input.baseUrl, false);
    const now = new Date();
    const [created] = await this.database
      .insert(aiProviderProfiles)
      .values({
        id: randomUUID(),
        ownerId,
        name: input.name.trim(),
        providerType: input.providerType,
        baseUrl: input.baseUrl.replace(/\/+$/u, ''),
        model: input.model.trim(),
        encryptedApiKey: this.encrypt(input.apiKey),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!created) throw new Error('AI provider creation returned no row');
    return providerDto(created, input.apiKey);
  }

  async updateProvider(
    ownerId: string,
    id: string,
    input: UpdateAiProviderProfileDto,
  ): Promise<AiProviderProfileDto> {
    if (id === 'environment') {
      throw new ApiException(
        'AI_PROVIDER_READ_ONLY',
        'The environment provider is read-only',
        HttpStatus.BAD_REQUEST,
      );
    }
    assertProviderText(input);
    const existing = await this.findProviderRecord(ownerId, id);
    const baseUrl = input.baseUrl ?? existing.baseUrl;
    await this.assertBaseUrl(baseUrl, false);
    const apiKey = input.apiKey ?? this.decrypt(existing.encryptedApiKey);
    const [updated] = await this.database
      .update(aiProviderProfiles)
      .set({
        name: input.name?.trim() ?? existing.name,
        providerType: input.providerType ?? existing.providerType,
        baseUrl: baseUrl.replace(/\/+$/u, ''),
        model: input.model?.trim() ?? existing.model,
        encryptedApiKey:
          input.apiKey === undefined
            ? existing.encryptedApiKey
            : this.encrypt(input.apiKey),
        updatedAt: new Date(),
      })
      .where(
        and(eq(aiProviderProfiles.id, id), eq(aiProviderProfiles.ownerId, ownerId)),
      )
      .returning();
    if (!updated) throw new Error('AI provider update returned no row');
    return providerDto(updated, apiKey);
  }

  async deleteProvider(ownerId: string, id: string): Promise<void> {
    if (id === 'environment') {
      throw new ApiException(
        'AI_PROVIDER_READ_ONLY',
        'The environment provider is read-only',
        HttpStatus.BAD_REQUEST,
      );
    }
    const [deleted] = await this.database
      .delete(aiProviderProfiles)
      .where(
        and(eq(aiProviderProfiles.id, id), eq(aiProviderProfiles.ownerId, ownerId)),
      )
      .returning({ id: aiProviderProfiles.id });
    if (!deleted) this.providerNotFound();
  }

  async testProvider(
    ownerId: string,
    id: string,
  ): Promise<{ ok: boolean; latencyMs: number }> {
    const provider = await this.resolveProvider(ownerId, id);
    const startedAt = Date.now();
    try {
      await this.providerClientFor(provider).testConnection(provider);
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch {
      throw new ApiException(
        'AI_PROVIDER_UNAVAILABLE',
        'The AI provider connection test failed',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  async createSession(
    ownerId: string,
    postId: string,
    input: CreateAiSessionDto,
  ): Promise<AiSessionDto> {
    await this.assertPostOwnership(ownerId, postId);
    const providerProfileId =
      input.providerProfileId === 'environment' ? null : input.providerProfileId;
    if (input.providerProfileId) {
      await this.resolveProvider(ownerId, input.providerProfileId);
    }
    const now = new Date();
    const [session] = await this.database
      .insert(aiSessions)
      .values({
        id: randomUUID(),
        ownerId,
        postId,
        title: input.title?.trim() || '新对话',
        providerProfileId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!session) throw new Error('AI session creation returned no row');
    return this.hydrateSession(session);
  }

  async listSessions(ownerId: string, postId: string): Promise<AiSessionDto[]> {
    await this.assertPostOwnership(ownerId, postId);
    const sessions = await this.database
      .select()
      .from(aiSessions)
      .where(and(eq(aiSessions.ownerId, ownerId), eq(aiSessions.postId, postId)))
      .orderBy(desc(aiSessions.updatedAt));
    return Promise.all(sessions.map((session) => this.hydrateSession(session)));
  }

  async findSession(ownerId: string, id: string): Promise<AiSessionDto> {
    return this.hydrateSession(await this.findSessionRecord(ownerId, id));
  }

  async renameSession(
    ownerId: string,
    id: string,
    title: string,
  ): Promise<AiSessionDto> {
    const [updated] = await this.database
      .update(aiSessions)
      .set({ title: title.trim(), updatedAt: new Date() })
      .where(and(eq(aiSessions.id, id), eq(aiSessions.ownerId, ownerId)))
      .returning();
    if (!updated) this.sessionNotFound();
    return this.hydrateSession(updated!);
  }

  async deleteSession(ownerId: string, id: string): Promise<void> {
    const session = await this.findSessionRecord(ownerId, id);
    if (session.activeRunId) {
      await this.cancelRun(ownerId, id, session.activeRunId);
    }
    await this.database
      .delete(aiSessions)
      .where(and(eq(aiSessions.id, id), eq(aiSessions.ownerId, ownerId)));
  }

  async startRun(
    ownerId: string,
    sessionId: string,
    input: { message: string; providerProfileId?: string },
  ): Promise<{ runId: string; stream: Readable }> {
    const message = input.message.trim();
    if (!message) {
      throw new ApiException(
        'AI_MESSAGE_EMPTY',
        'AI messages must contain non-whitespace text',
        HttpStatus.BAD_REQUEST,
      );
    }
    const existing = await this.findSessionRecord(ownerId, sessionId);
    const providerId =
      input.providerProfileId ?? existing.providerProfileId ?? 'environment';
    const provider = await this.resolveProvider(ownerId, providerId);
    const runId = randomUUID();
    const now = new Date();
    const staleBefore = new Date(now.getTime() - AI_ACTIVE_RUN_STALE_AFTER_MS);
    const [claimed] = await this.database
      .update(aiSessions)
      .set({ activeRunId: runId, activeRunStartedAt: now, updatedAt: now })
      .where(
        and(
          eq(aiSessions.id, sessionId),
          eq(aiSessions.ownerId, ownerId),
          or(
            isNull(aiSessions.activeRunId),
            isNull(aiSessions.activeRunStartedAt),
            lt(aiSessions.activeRunStartedAt, staleBefore),
          ),
        ),
      )
      .returning();
    if (!claimed) {
      throw new ApiException(
        'AI_RUN_ALREADY_ACTIVE',
        'This AI session already has an active run',
        HttpStatus.CONFLICT,
      );
    }

    const userMessageId = randomUUID();
    try {
      if (isActiveRunStale(existing, now) && existing.activeRunId) {
        await this.database.insert(aiMessages).values({
          id: randomUUID(),
          sessionId,
          runId: existing.activeRunId,
          role: 'assistant',
          content: '',
          status: 'failed',
          createdAt: now,
        });
      }
      await this.database.insert(aiMessages).values({
        id: userMessageId,
        sessionId,
        runId,
        role: 'user',
        content: message,
        status: 'complete',
        createdAt: now,
      });
    } catch (error) {
      await this.releaseRun(ownerId, sessionId, runId);
      throw error;
    }

    const controller = new AbortController();
    this.activeRuns.set(runId, controller);
    return {
      runId,
      stream: Readable.from(
        this.executeRun(ownerId, claimed, provider, runId, controller),
      ),
    };
  }

  async cancelRun(ownerId: string, sessionId: string, runId: string): Promise<void> {
    const session = await this.findSessionRecord(ownerId, sessionId);
    if (session.activeRunId !== runId) {
      throw new ApiException(
        'AI_RUN_NOT_ACTIVE',
        'The requested AI run is not active',
        HttpStatus.CONFLICT,
      );
    }
    this.activeRuns.get(runId)?.abort();
    await this.releaseRun(ownerId, sessionId, runId);
  }

  async recordToolCall(
    ownerId: string,
    input: {
      sessionId: string;
      runId: string;
      toolCallId: string;
      toolName: string;
      payload: Record<string, unknown>;
    },
  ): Promise<AiToolDecisionDto> {
    const session = await this.findSessionRecord(ownerId, input.sessionId);
    const [completedMessage] = await this.database
      .select({ id: aiMessages.id })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.sessionId, input.sessionId),
          eq(aiMessages.runId, input.runId),
          eq(aiMessages.role, 'assistant'),
          eq(aiMessages.status, 'complete'),
        ),
      )
      .limit(1);
    if (session.activeRunId !== input.runId && !completedMessage) {
      throw new ApiException(
        'AI_RUN_NOT_FOUND',
        'Tool calls must belong to an active or completed run',
        HttpStatus.CONFLICT,
      );
    }
    const [record] = await this.database
      .insert(aiToolDecisions)
      .values({ id: randomUUID(), ...input })
      .returning();
    if (!record) throw new Error('AI tool decision creation returned no row');
    return decisionDto(record);
  }

  async decideToolCall(
    ownerId: string,
    sessionId: string,
    decisionId: string,
    decision: 'accepted' | 'rejected',
  ): Promise<AiToolDecisionDto> {
    await this.findSessionRecord(ownerId, sessionId);
    const [updated] = await this.database
      .update(aiToolDecisions)
      .set({ decision, decidedAt: new Date() })
      .where(
        and(
          eq(aiToolDecisions.id, decisionId),
          eq(aiToolDecisions.sessionId, sessionId),
          eq(aiToolDecisions.decision, 'pending'),
        ),
      )
      .returning();
    if (!updated) {
      throw new ApiException(
        'AI_TOOL_DECISION_UNAVAILABLE',
        'The tool result was not found or has already been decided',
        HttpStatus.CONFLICT,
      );
    }
    return decisionDto(updated);
  }

  private async *executeRun(
    ownerId: string,
    session: SessionRecord,
    provider: ResolvedProvider,
    runId: string,
    controller: AbortController,
  ): AsyncGenerator<string> {
    yield formatSseEvent('meta', { runId });
    let assistantContent = '';
    try {
      const history = await this.database
        .select()
        .from(aiMessages)
        .where(
          and(eq(aiMessages.sessionId, session.id), eq(aiMessages.status, 'complete')),
        )
        .orderBy(desc(aiMessages.createdAt))
        .limit(40);
      const [post] = await this.database
        .select({
          title: posts.title,
          document: posts.document,
          content: posts.content,
        })
        .from(posts)
        .where(and(eq(posts.id, session.postId), eq(posts.ownerId, ownerId)))
        .limit(1);
      if (!post) throw new Error('AI session post is unavailable');
      for await (const text of this.providerClientFor(provider).streamCompletion(
        provider,
        buildBoundedHistory(
          history.map((message) => ({
            role: message.role as 'user' | 'assistant',
            content: message.content,
          })),
        ),
        controller.signal,
        buildPostContext(post),
      )) {
        assistantContent += text;
        yield formatSseEvent('delta', { text });
      }
      if (!assistantContent.trim()) {
        throw new Error('AI provider completed without content');
      }
      const messageId = randomUUID();
      await this.database.insert(aiMessages).values({
        id: messageId,
        sessionId: session.id,
        runId,
        role: 'assistant',
        content: assistantContent,
        status: 'complete',
      });
      await this.releaseRun(ownerId, session.id, runId);
      yield formatSseEvent('done', { runId, messageId });
    } catch {
      const cancelled = controller.signal.aborted;
      await this.database
        .insert(aiMessages)
        .values({
          id: randomUUID(),
          sessionId: session.id,
          runId,
          role: 'assistant',
          content: '',
          status: cancelled ? 'cancelled' : 'failed',
        })
        .catch(() => undefined);
      await this.releaseRun(ownerId, session.id, runId).catch(() => undefined);
      yield formatSseEvent('error', {
        runId,
        code: cancelled ? 'AI_RUN_CANCELLED' : 'AI_RUN_FAILED',
        message: cancelled
          ? 'The AI run was cancelled'
          : 'The AI provider stream failed',
      });
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  private async hydrateSession(session: SessionRecord): Promise<AiSessionDto> {
    const [messages, decisions] = await Promise.all([
      this.database
        .select()
        .from(aiMessages)
        .where(eq(aiMessages.sessionId, session.id))
        .orderBy(asc(aiMessages.createdAt)),
      this.database
        .select()
        .from(aiToolDecisions)
        .where(eq(aiToolDecisions.sessionId, session.id))
        .orderBy(asc(aiToolDecisions.createdAt)),
    ]);
    return {
      id: session.id,
      postId: session.postId,
      title: session.title,
      providerProfileId: session.providerProfileId,
      activeRunId: session.activeRunId,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      messages: messages.map(messageDto),
      toolDecisions: decisions.map(decisionDto),
    };
  }

  private async resolveProvider(
    ownerId: string,
    id: string,
  ): Promise<ResolvedProvider> {
    if (id === 'environment') {
      if (!this.config.defaultAiProvider) this.providerNotFound();
      const allowPrivateNetwork = this.config.nodeEnv !== 'production';
      await this.assertBaseUrl(
        this.config.defaultAiProvider!.baseUrl,
        allowPrivateNetwork,
      );
      return {
        id,
        ...this.config.defaultAiProvider!,
        allowPrivateNetwork,
      };
    }
    const record = await this.findProviderRecord(ownerId, id);
    await this.assertBaseUrl(record.baseUrl, false);
    return {
      id: record.id,
      providerType: record.providerType as AiProviderConfig['providerType'],
      baseUrl: record.baseUrl,
      model: record.model,
      apiKey: this.decrypt(record.encryptedApiKey),
      allowPrivateNetwork: false,
    };
  }

  private async assertBaseUrl(
    value: string,
    allowPrivateNetwork: boolean,
  ): Promise<void> {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new ApiException(
        'AI_PROVIDER_URL_INVALID',
        'AI provider URLs must use HTTP(S)',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (this.config.nodeEnv === 'production' && url.protocol !== 'https:') {
      throw new ApiException(
        'AI_PROVIDER_URL_INSECURE',
        'Production AI providers must use HTTPS',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (allowPrivateNetwork) return;
    try {
      await this.urlSafety.assertSafe(value);
    } catch {
      throw new ApiException(
        'AI_PROVIDER_URL_UNSAFE',
        'The AI provider URL must resolve to a public network address',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private providerClientFor(provider: ResolvedProvider): AiProviderClient {
    if (provider.allowPrivateNetwork) return new AiProviderClient(fetch);
    return new AiProviderClient(async (input, init) => {
      const target = await this.urlSafety.resolveSafe(input.toString());
      const headers = new Headers(init?.headers);
      const normalizedHeaders: Record<string, string> = {};
      headers.forEach((value, name) => {
        normalizedHeaders[name] = value;
      });
      if (init?.body !== undefined && typeof init.body !== 'string') {
        throw new Error('AI provider request body must be a string');
      }
      return this.pinnedHttp.request(target, {
        method: init?.method ?? 'GET',
        headers: normalizedHeaders,
        body: init?.body,
        signal: init?.signal ?? undefined,
      });
    });
  }

  private encrypt(value: string): string {
    if (!this.config.aiCredentialsEncryptionKey) {
      throw new ApiException(
        'AI_BYOK_DISABLED',
        'Owner AI credentials are disabled until an encryption key is configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return encryptSecret(value, this.config.aiCredentialsEncryptionKey);
  }

  private decrypt(value: string): string {
    if (!this.config.aiCredentialsEncryptionKey) {
      throw new ApiException(
        'AI_BYOK_DISABLED',
        'Owner AI credentials cannot be read without the configured encryption key',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return decryptSecret(value, this.config.aiCredentialsEncryptionKey);
  }

  private async findProviderRecord(
    ownerId: string,
    id: string,
  ): Promise<ProviderRecord> {
    if (id === 'environment') this.providerNotFound();
    const [provider] = await this.database
      .select()
      .from(aiProviderProfiles)
      .where(
        and(eq(aiProviderProfiles.id, id), eq(aiProviderProfiles.ownerId, ownerId)),
      )
      .limit(1);
    if (!provider) this.providerNotFound();
    return provider!;
  }

  private async findSessionRecord(ownerId: string, id: string): Promise<SessionRecord> {
    const [session] = await this.database
      .select()
      .from(aiSessions)
      .where(and(eq(aiSessions.id, id), eq(aiSessions.ownerId, ownerId)))
      .limit(1);
    if (!session) this.sessionNotFound();
    return session!;
  }

  private async assertPostOwnership(ownerId: string, postId: string): Promise<void> {
    const [post] = await this.database
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.ownerId, ownerId)))
      .limit(1);
    if (!post) {
      throw new ApiException('POST_NOT_FOUND', 'Post not found', HttpStatus.NOT_FOUND);
    }
  }

  private async releaseRun(
    ownerId: string,
    sessionId: string,
    runId: string,
  ): Promise<void> {
    await this.database
      .update(aiSessions)
      .set({
        activeRunId: null,
        activeRunStartedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiSessions.id, sessionId),
          eq(aiSessions.ownerId, ownerId),
          eq(aiSessions.activeRunId, runId),
        ),
      );
  }

  private providerNotFound(): never {
    throw new ApiException(
      'AI_PROVIDER_NOT_FOUND',
      'AI provider profile not found',
      HttpStatus.NOT_FOUND,
    );
  }

  private sessionNotFound(): never {
    throw new ApiException(
      'AI_SESSION_NOT_FOUND',
      'AI session not found',
      HttpStatus.NOT_FOUND,
    );
  }
}
