import {
  createIzumiClient,
  IzumiRequestError,
  type AuthToken,
  type CreatePostInput,
  type OwnerAuthStatus,
  type Post,
  type PostList,
  type PostStatus,
  type PublicPostReference,
  type OwnerProfile,
  type PublicProfile,
  type ReplaceProfileInput,
  type UpdatePostInput,
} from '@izumi/sdk';
import type { SerializedEditorState } from 'lexical';

import {
  normalizeAiRunEvent,
  ServerSentEventParser,
  type NormalizedAiRunEvent,
} from '@/lib/sse';

export type {
  AuthToken,
  OwnerAuthStatus,
  OwnerProfile,
  Post,
  PostList,
  PostStatus,
  PublicPostReference,
  PublicProfile,
  ReplaceProfileInput,
};
export type PostInput = CreatePostInput;
export { IzumiRequestError as CoreRequestError };

export type RichDocument = SerializedEditorState;

export type RichPost = Omit<Post, 'content'> & {
  content: string;
  contentMigrationState: 'native' | 'pending' | 'failed';
  document: RichDocument;
  hasUnpublishedChanges: boolean;
  revision: number;
};

export type DraftPostInput = {
  title?: string;
  slug?: string;
  content?: string;
  document: RichDocument;
  excerpt?: string;
  section?: string;
  tags?: string[];
};

export type VersionedPost = {
  etag: string;
  post: RichPost;
};

export type MediaAsset = {
  id: string;
  originalName: string;
  contentType: string;
  kind: 'image' | 'video';
  byteSize: number;
  url: string;
  width?: number;
  height?: number;
  thumbhash?: string;
  alt?: string;
  finalizedAt?: string;
};

export type StorageMode = 'local' | 's3';

export type StorageSettings = {
  mode: StorageMode;
  localPublicBaseUrl: string;
  endpoint: string | null;
  region: string | null;
  bucket: string | null;
  accessKeyId: string | null;
  secretAccessKeyMasked: string | null;
  publicBaseUrl: string | null;
  forcePathStyle: boolean;
  updatedAt: string | null;
};

export type StorageSettingsInput = {
  mode: StorageMode;
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  publicBaseUrl?: string;
  forcePathStyle?: boolean;
};

type ApiMediaAsset = {
  id: string;
  originalName: string;
  contentType: string;
  kind: 'image' | 'video';
  byteSize: number;
  publicUrl: string;
  status: 'initiated' | 'ready';
  width: number | null;
  height: number | null;
  thumbhash: string | null;
  alt: string | null;
  finalizedAt: string | null;
};

function mapMediaAsset(asset: ApiMediaAsset): MediaAsset {
  return {
    id: asset.id,
    originalName: asset.originalName,
    contentType: asset.contentType,
    kind: asset.kind,
    byteSize: asset.byteSize,
    url: asset.publicUrl,
    ...(asset.width === null ? {} : { width: asset.width }),
    ...(asset.height === null ? {} : { height: asset.height }),
    ...(asset.thumbhash === null ? {} : { thumbhash: asset.thumbhash }),
    ...(asset.alt === null ? {} : { alt: asset.alt }),
    ...(asset.finalizedAt === null ? {} : { finalizedAt: asset.finalizedAt }),
  };
}

export type AiProviderType = 'claude' | 'openai-compatible';

export type AiProviderProfile = {
  id: string;
  name: string;
  providerType: AiProviderType;
  baseUrl: string;
  model: string;
  maskedApiKey: string;
  isEnvironment: boolean;
  readOnly: boolean;
  updatedAt?: string;
};

export type AiProviderInput = {
  name: string;
  providerType: AiProviderType;
  baseUrl: string;
  model: string;
  apiKey?: string;
};

export type AiSessionSummary = {
  id: string;
  postId: string;
  title: string;
  providerProfileId?: string;
  createdAt: string;
  updatedAt: string;
};

export type AiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'complete' | 'failed' | 'cancelled';
  runId?: string;
  createdAt: string;
};

export type AiSession = AiSessionSummary & {
  activeRunId?: string;
  messages: AiMessage[];
  toolDecisions: AiDocumentProposal[];
};

export type AiRunEvent = NormalizedAiRunEvent;

export type AiDocumentProposal = {
  id: string;
  runId: string;
  toolCallId: string;
  toolName: 'replace-document';
  payload: {
    kind: 'replace-document';
    before: RichDocument;
    after: RichDocument;
    summary: string;
  };
  decision: 'pending' | 'accepted' | 'rejected';
};

type ApiAiProviderProfile = {
  id: string;
  name: string;
  providerType: AiProviderType;
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  source: 'environment' | 'owner';
  readOnly: boolean;
  updatedAt: string | null;
};

type ApiAiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'complete' | 'failed' | 'cancelled';
  runId: string | null;
  createdAt: string;
};

type ApiAiSession = {
  id: string;
  postId: string;
  title: string;
  providerProfileId: string | null;
  activeRunId: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ApiAiMessage[];
  toolDecisions: AiDocumentProposal[];
};

function mapAiProvider(profile: ApiAiProviderProfile): AiProviderProfile {
  return {
    id: profile.id,
    name: profile.name,
    providerType: profile.providerType,
    baseUrl: profile.baseUrl,
    model: profile.model,
    maskedApiKey: profile.apiKeyMasked,
    isEnvironment: profile.source === 'environment',
    readOnly: profile.readOnly,
    ...(profile.updatedAt === null ? {} : { updatedAt: profile.updatedAt }),
  };
}

function mapAiSession(session: ApiAiSession): AiSession {
  return {
    id: session.id,
    postId: session.postId,
    title: session.title,
    ...(session.providerProfileId === null
      ? {}
      : { providerProfileId: session.providerProfileId }),
    ...(session.activeRunId === null ? {} : { activeRunId: session.activeRunId }),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      status: message.status,
      ...(message.runId === null ? {} : { runId: message.runId }),
      createdAt: message.createdAt,
    })),
    toolDecisions: session.toolDecisions,
  };
}

// Vite proxies /api to the matching Core port in development; production is
// already same-origin because Core serves the built Admin application.
const defaultCoreUrl = window.location.origin;
const baseUrl = (import.meta.env.VITE_CORE_API_URL || defaultCoreUrl).replace(
  /\/+$/,
  '',
);

function client(accessToken?: string) {
  return createIzumiClient({
    baseUrl,
    getAccessToken: () => accessToken,
  });
}

type ApiEnvelope<T> = { data: T };

function requestHeaders(accessToken: string, headers?: HeadersInit) {
  return {
    accept: 'application/json',
    authorization: `Bearer ${accessToken}`,
    ...headers,
  };
}

async function ownerRequest<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<{ data: T; etag?: string }> {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: requestHeaders(accessToken, init?.headers),
  });
  const body = (await response.json().catch(() => undefined)) as
    | ApiEnvelope<T>
    | { error?: { code?: string; message?: string; details?: unknown } }
    | undefined;

  if (!response.ok) {
    const error = body && 'error' in body ? body.error : undefined;
    throw new IzumiRequestError(
      error?.message ?? 'Izumi Core request failed',
      response.status,
      error?.code,
      error?.details,
    );
  }
  if (!body || !('data' in body)) {
    throw new IzumiRequestError(
      'Izumi Core returned an invalid success response',
      response.status,
    );
  }
  return { data: body.data, etag: response.headers.get('etag') ?? undefined };
}

async function ownerVoidRequest(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: requestHeaders(accessToken, init?.headers),
  });
  if (response.ok) return;
  const body = (await response.json().catch(() => undefined)) as
    { error?: { code?: string; message?: string; details?: unknown } } | undefined;
  throw new IzumiRequestError(
    body?.error?.message ?? 'Izumi Core request failed',
    response.status,
    body?.error?.code,
    body?.error?.details,
  );
}

function jsonBody(value: unknown): Pick<RequestInit, 'body' | 'headers'> {
  return {
    body: JSON.stringify(value),
    headers: { 'content-type': 'application/json' },
  };
}

function versioned(result: { data: RichPost; etag?: string }): VersionedPost {
  return {
    post: result.data,
    etag: result.etag ?? `W/"${result.data.revision}"`,
  };
}

export const core = {
  getOwnerAuthStatus() {
    return client().getOwnerAuthStatus();
  },

  setupOwner(input: { username: string; password: string }) {
    return client().setupOwner(input);
  },

  login(input: { username: string; password: string }) {
    return client().loginOwner(input);
  },

  listPosts(
    accessToken: string,
    options: { page: number; size: number; status?: PostStatus; q?: string },
  ) {
    return client(accessToken).listPosts(options);
  },

  getPost(accessToken: string, id: string) {
    return client(accessToken).getPost(id);
  },

  async getRichPost(accessToken: string, id: string): Promise<VersionedPost> {
    return versioned(
      await ownerRequest<RichPost>(accessToken, `/posts/${encodeURIComponent(id)}`),
    );
  },

  async resolvePostReferences(
    accessToken: string,
    postIds: string[],
    signal?: AbortSignal,
  ): Promise<PublicPostReference[]> {
    const response = await ownerRequest<PublicPostReference[]>(
      accessToken,
      '/posts/references/resolve',
      {
        method: 'POST',
        signal,
        ...jsonBody({ postIds }),
      },
    );
    return response.data;
  },

  publicPostUrl(slug: string) {
    return `${baseUrl}/api/v1/public/posts/${encodeURIComponent(slug)}`;
  },

  async createPostDraft(
    accessToken: string,
    input: DraftPostInput,
    signal?: AbortSignal,
  ): Promise<VersionedPost> {
    return versioned(
      await ownerRequest<RichPost>(accessToken, '/posts', {
        method: 'POST',
        signal,
        ...jsonBody(input),
      }),
    );
  },

  async savePostDraft(
    accessToken: string,
    id: string,
    input: DraftPostInput,
    etag: string,
    signal?: AbortSignal,
  ): Promise<VersionedPost> {
    return versioned(
      await ownerRequest<RichPost>(accessToken, `/posts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        signal,
        ...jsonBody(input),
        headers: {
          ...jsonBody(input).headers,
          'if-match': etag,
        },
      }),
    );
  },

  async publishPost(accessToken: string, id: string, etag: string) {
    return versioned(
      await ownerRequest<RichPost>(
        accessToken,
        `/posts/${encodeURIComponent(id)}/publish`,
        {
          method: 'POST',
          headers: { 'if-match': etag },
        },
      ),
    );
  },

  async unpublishPost(accessToken: string, id: string, etag: string) {
    return versioned(
      await ownerRequest<RichPost>(
        accessToken,
        `/posts/${encodeURIComponent(id)}/unpublish`,
        {
          method: 'POST',
          headers: { 'if-match': etag },
        },
      ),
    );
  },

  async discardWorkingCopy(accessToken: string, id: string, etag: string) {
    return versioned(
      await ownerRequest<RichPost>(
        accessToken,
        `/posts/${encodeURIComponent(id)}/discard-working-copy`,
        {
          method: 'POST',
          headers: { 'if-match': etag },
        },
      ),
    );
  },

  async forkWorkingCopy(accessToken: string, id: string, input: DraftPostInput) {
    return versioned(
      await ownerRequest<RichPost>(
        accessToken,
        `/posts/${encodeURIComponent(id)}/fork-working-copy`,
        {
          method: 'POST',
          ...jsonBody(input),
        },
      ),
    );
  },

  createPost(accessToken: string, input: PostInput) {
    return client(accessToken).createPost(input);
  },

  updatePost(accessToken: string, id: string, input: UpdatePostInput) {
    return client(accessToken).updatePost(id, input);
  },

  getOwnerProfile(accessToken: string) {
    return client(accessToken).getOwnerProfile();
  },

  getPublicProfile() {
    return client().getPublicProfile();
  },

  replaceProfile(accessToken: string, input: ReplaceProfileInput) {
    return client(accessToken).replaceProfile(input);
  },

  async uploadMedia(accessToken: string, file: File, metadata: { alt?: string } = {}) {
    const body = new FormData();
    if (metadata.alt) body.append('alt', metadata.alt);
    body.append('file', file);
    const asset = (
      await ownerRequest<ApiMediaAsset>(accessToken, '/media/uploads', {
        method: 'POST',
        body,
      })
    ).data;
    return mapMediaAsset(asset);
  },

  async getStorageSettings(accessToken: string) {
    return (await ownerRequest<StorageSettings>(accessToken, '/storage/settings')).data;
  },

  async updateStorageSettings(accessToken: string, input: StorageSettingsInput) {
    return (
      await ownerRequest<StorageSettings>(accessToken, '/storage/settings', {
        method: 'PUT',
        ...jsonBody(input),
      })
    ).data;
  },

  async testStorageSettings(accessToken: string) {
    return (
      await ownerRequest<{ ok: boolean; latencyMs: number; mode: StorageMode }>(
        accessToken,
        '/storage/settings/test',
        { method: 'POST' },
      )
    ).data;
  },

  async resolveLinkCard(accessToken: string, url: string) {
    return (
      await ownerRequest<{
        url: string;
        title: string;
        description?: string;
        imageUrl?: string;
        siteName?: string;
      }>(accessToken, '/link-cards/resolve', {
        method: 'POST',
        ...jsonBody({ url }),
      })
    ).data;
  },

  async listAiProviders(accessToken: string) {
    const profiles = (
      await ownerRequest<ApiAiProviderProfile[]>(accessToken, '/ai/providers')
    ).data;
    return profiles.map(mapAiProvider);
  },

  async createAiProvider(accessToken: string, input: AiProviderInput) {
    const profile = (
      await ownerRequest<ApiAiProviderProfile>(accessToken, '/ai/providers', {
        method: 'POST',
        ...jsonBody(input),
      })
    ).data;
    return mapAiProvider(profile);
  },

  async updateAiProvider(
    accessToken: string,
    id: string,
    input: Partial<AiProviderInput>,
  ) {
    const profile = (
      await ownerRequest<ApiAiProviderProfile>(
        accessToken,
        `/ai/providers/${encodeURIComponent(id)}`,
        { method: 'PATCH', ...jsonBody(input) },
      )
    ).data;
    return mapAiProvider(profile);
  },

  async deleteAiProvider(accessToken: string, id: string) {
    await ownerVoidRequest(accessToken, `/ai/providers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async testAiProvider(accessToken: string, id: string) {
    return (
      await ownerRequest<{ ok: boolean; latencyMs: number }>(
        accessToken,
        `/ai/providers/${encodeURIComponent(id)}/test`,
        { method: 'POST' },
      )
    ).data;
  },

  async listAiSessions(accessToken: string, postId: string) {
    const sessions = (
      await ownerRequest<ApiAiSession[]>(
        accessToken,
        `/ai/posts/${encodeURIComponent(postId)}/sessions`,
      )
    ).data;
    return sessions.map(mapAiSession);
  },

  async createAiSession(
    accessToken: string,
    postId: string,
    input: { title?: string; providerProfileId?: string } = {},
  ) {
    const session = (
      await ownerRequest<ApiAiSession>(
        accessToken,
        `/ai/posts/${encodeURIComponent(postId)}/sessions`,
        {
          method: 'POST',
          ...jsonBody({ ...input, title: input.title ?? '新的讨论' }),
        },
      )
    ).data;
    return mapAiSession(session);
  },

  async getAiSession(accessToken: string, sessionId: string) {
    const session = (
      await ownerRequest<ApiAiSession>(
        accessToken,
        `/ai/sessions/${encodeURIComponent(sessionId)}`,
      )
    ).data;
    return mapAiSession(session);
  },

  async renameAiSession(accessToken: string, sessionId: string, title: string) {
    const session = (
      await ownerRequest<ApiAiSession>(
        accessToken,
        `/ai/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'PATCH', ...jsonBody({ title }) },
      )
    ).data;
    return mapAiSession(session);
  },

  async deleteAiSession(accessToken: string, sessionId: string) {
    await ownerVoidRequest(
      accessToken,
      `/ai/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: 'DELETE',
      },
    );
  },

  async recordAiDocumentProposal(
    accessToken: string,
    sessionId: string,
    input: Omit<AiDocumentProposal, 'id' | 'decision'>,
  ) {
    return (
      await ownerRequest<AiDocumentProposal>(
        accessToken,
        `/ai/sessions/${encodeURIComponent(sessionId)}/tool-calls`,
        { method: 'POST', ...jsonBody(input) },
      )
    ).data;
  },

  async decideAiTool(
    accessToken: string,
    sessionId: string,
    decisionId: string,
    decision: 'accepted' | 'rejected',
  ) {
    return (
      await ownerRequest<AiDocumentProposal>(
        accessToken,
        `/ai/sessions/${encodeURIComponent(sessionId)}/tool-decisions/${encodeURIComponent(decisionId)}`,
        { method: 'PATCH', ...jsonBody({ decision }) },
      )
    ).data;
  },

  async *runAiSession(
    accessToken: string,
    sessionId: string,
    input: { message: string; providerProfileId?: string },
    signal?: AbortSignal,
  ): AsyncGenerator<AiRunEvent> {
    const response = await fetch(
      `${baseUrl}/api/v1/ai/sessions/${encodeURIComponent(sessionId)}/runs`,
      {
        method: 'POST',
        body: JSON.stringify(input),
        headers: requestHeaders(accessToken, {
          accept: 'text/event-stream',
          'content-type': 'application/json',
        }),
        signal,
      },
    );
    if (!response.ok || !response.body) {
      throw new IzumiRequestError('无法启动 AI 会话。', response.status);
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    const parser = new ServerSentEventParser();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const frame of parser.push(value)) {
        const event = normalizeAiRunEvent(frame);
        if (event) yield event;
      }
    }
    for (const frame of parser.finish()) {
      const event = normalizeAiRunEvent(frame);
      if (event) yield event;
    }
  },
};
