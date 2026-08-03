import createOpenApiClient from 'openapi-fetch';

import type { components, paths } from './openapi.js';

export type OwnerSetupInput = components['schemas']['OwnerSetupDto'];
export type OwnerLoginInput = components['schemas']['OwnerLoginDto'];
export type OwnerAuthStatus = components['schemas']['OwnerAuthStatusDto'];
export type AuthToken = components['schemas']['AuthTokenDto'];
export type CreatePostInput = components['schemas']['CreatePostDto'];
export type UpdatePostInput = components['schemas']['UpdatePostDto'];
export type Post = components['schemas']['PostDto'];
export type PostStatus = 'draft' | 'published';
export type ResolvePostReferencesInput =
  components['schemas']['ResolvePostReferencesDto'];
export type PublicPostReference = components['schemas']['PublicPostReferenceDto'];
export type PublicPostSummary = components['schemas']['PublicPostSummaryDto'];
export type PublicPost = components['schemas']['PublicPostDetailDto'];
export type ReplaceProfileInput = components['schemas']['ReplaceProfileDto'];
export type OwnerProfile = components['schemas']['OwnerProfileDto'];
export type PublicProfile = components['schemas']['PublicProfileDto'];

export type PostList = {
  items: Post[];
  page: number;
  size: number;
  total: number;
};

export type VersionedPost = {
  post: Post;
  etag: string;
};

export type IzumiClientOptions = {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  getAccessToken?: () => string | undefined | Promise<string | undefined>;
};

/**
 * The public site's server-only IZUMI_CORE_URL. It is the API prefix before
 * `/v1`, so Core's standard deployment uses `https://core.example.com/api`.
 */
export type IzumiPublicClientOptions = {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
};

export class IzumiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'IzumiRequestError';
  }
}

type ApiError = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

async function unwrap<T>(response: {
  data?: unknown;
  error?: unknown;
  response: Response;
}): Promise<T> {
  if (response.error !== undefined) {
    const body = response.error as ApiError;
    throw new IzumiRequestError(
      body.error?.message ?? 'Izumi Core request failed',
      response.response.status,
      body.error?.code,
      body.error?.details,
    );
  }

  const envelope = response.data as { data?: T } | undefined;
  if (!envelope || !('data' in envelope)) {
    throw new IzumiRequestError(
      'Izumi Core returned an invalid success response',
      response.response.status,
    );
  }

  return envelope.data as T;
}

async function unwrapHttpEnvelope<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = body as ApiError | undefined;
    throw new IzumiRequestError(
      error?.error?.message ?? 'Izumi Core request failed',
      response.status,
      error?.error?.code,
      error?.error?.details,
    );
  }

  const envelope = body as { data?: T } | undefined;
  if (!envelope || !('data' in envelope)) {
    throw new IzumiRequestError(
      'Izumi Core returned an invalid success response',
      response.status,
    );
  }

  return envelope.data as T;
}

async function unwrapVersionedPost(response: {
  data?: unknown;
  error?: unknown;
  response: Response;
}): Promise<VersionedPost> {
  const post = await unwrap<Post>(response);
  const etag = response.response.headers.get('etag');
  if (!etag) {
    throw new IzumiRequestError(
      'Izumi Core did not return the current post ETag',
      response.response.status,
    );
  }
  return { post, etag };
}

export function createIzumiClient(options: IzumiClientOptions) {
  const client = createOpenApiClient<paths>({
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
    fetch: options.fetch,
  });

  async function authorizationHeaders(): Promise<Record<string, string>> {
    const token = await options.getAccessToken?.();
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  async function resolvePostEtag(
    id: string,
    headers: Record<string, string>,
    etag?: string,
  ): Promise<string> {
    if (etag) return etag;

    // Preserve the pre-ETag SDK call shape for existing consumers. New
    // editors should pass the ETag they originally loaded; legacy callers
    // first read the latest revision and retain their prior last-write-wins
    // behavior without bypassing the server's concurrency contract.
    const current = await client.GET('/api/v1/posts/{id}', {
      headers,
      params: { path: { id } },
    });
    return (await unwrapVersionedPost(current)).etag;
  }

  async function patchPost(
    id: string,
    input: UpdatePostInput,
    etag: string,
    headers: Record<string, string>,
  ) {
    return client.PATCH('/api/v1/posts/{id}', {
      body: input,
      headers,
      params: {
        header: { 'If-Match': etag },
        path: { id },
      },
    });
  }

  return {
    getOwnerAuthStatus: async (): Promise<OwnerAuthStatus> =>
      unwrap<OwnerAuthStatus>(await client.GET('/api/v1/auth/status')),

    setupOwner: async (
      input: OwnerSetupInput,
      setupToken: string,
    ): Promise<AuthToken> =>
      unwrap<AuthToken>(
        await client.POST('/api/v1/auth/setup', {
          body: input,
          params: {
            header: { 'x-izumi-setup-token': setupToken },
          },
        }),
      ),

    loginOwner: async (input: OwnerLoginInput): Promise<AuthToken> =>
      unwrap<AuthToken>(
        await client.POST('/api/v1/auth/login', {
          body: input,
        }),
      ),

    createPost: async (input: CreatePostInput): Promise<Post> =>
      unwrap<Post>(
        await client.POST('/api/v1/posts', {
          body: input,
          headers: await authorizationHeaders(),
        }),
      ),

    createPostVersioned: async (input: CreatePostInput): Promise<VersionedPost> =>
      unwrapVersionedPost(
        await client.POST('/api/v1/posts', {
          body: input,
          headers: await authorizationHeaders(),
        }),
      ),

    getPost: async (id: string): Promise<Post> =>
      unwrap<Post>(
        await client.GET('/api/v1/posts/{id}', {
          headers: await authorizationHeaders(),
          params: { path: { id } },
        }),
      ),

    getPostVersioned: async (id: string): Promise<VersionedPost> =>
      unwrapVersionedPost(
        await client.GET('/api/v1/posts/{id}', {
          headers: await authorizationHeaders(),
          params: { path: { id } },
        }),
      ),

    updatePostVersioned: async (
      id: string,
      input: UpdatePostInput,
      etag: string,
    ): Promise<VersionedPost> =>
      unwrapVersionedPost(
        await patchPost(id, input, etag, await authorizationHeaders()),
      ),

    updatePostLegacy: async (id: string, input: UpdatePostInput): Promise<Post> => {
      const headers = await authorizationHeaders();
      const etag = await resolvePostEtag(id, headers);
      return unwrap<Post>(await patchPost(id, input, etag, headers));
    },

    updatePost: async (
      id: string,
      input: UpdatePostInput,
      etag?: string,
    ): Promise<Post> => {
      const headers = await authorizationHeaders();
      const ifMatch = await resolvePostEtag(id, headers, etag);
      return unwrap<Post>(await patchPost(id, input, ifMatch, headers));
    },

    listPosts: async (options?: {
      page?: number;
      q?: string;
      size?: number;
      status?: PostStatus;
    }): Promise<PostList> =>
      unwrap<PostList>(
        await client.GET('/api/v1/posts', {
          headers: await authorizationHeaders(),
          params: { query: options },
        }),
      ),

    resolvePostReferences: async (
      input: ResolvePostReferencesInput,
    ): Promise<PublicPostReference[]> =>
      unwrap<PublicPostReference[]>(
        await client.POST('/api/v1/posts/references/resolve', {
          body: input,
          headers: await authorizationHeaders(),
        }),
      ),

    getOwnerProfile: async (): Promise<OwnerProfile> =>
      unwrap<OwnerProfile>(
        await client.GET('/api/v1/owner/profile', {
          headers: await authorizationHeaders(),
        }),
      ),

    getPublicProfile: async (): Promise<PublicProfile> =>
      unwrap<PublicProfile>(await client.GET('/api/v1/public/profile')),

    replaceProfile: async (input: ReplaceProfileInput): Promise<OwnerProfile> =>
      unwrap<OwnerProfile>(
        await client.PUT('/api/v1/owner/profile', {
          body: input,
          headers: await authorizationHeaders(),
        }),
      ),
  };
}

export function createIzumiPublicClient(options: IzumiPublicClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetcher = options.fetch ?? globalThis.fetch;

  async function get<T>(path: string, limit?: number): Promise<T> {
    const url = new URL(`${baseUrl}${path}`);
    if (limit !== undefined) url.searchParams.set('limit', String(limit));

    return unwrapHttpEnvelope<T>(
      await fetcher(url, {
        headers: { accept: 'application/json' },
      }),
    );
  }

  return {
    getPosts: (limit?: number): Promise<PublicPostSummary[]> =>
      get<PublicPostSummary[]>('/v1/public/posts', limit),

    getPostBySlug: (slug: string): Promise<PublicPost> =>
      get<PublicPost>(`/v1/public/posts/${encodeURIComponent(slug)}`),

    getProfile: (): Promise<PublicProfile> => get<PublicProfile>('/v1/public/profile'),
  };
}
