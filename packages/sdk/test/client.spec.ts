import { describe, expect, it, vi } from 'vitest';

import { createIzumiClient, createIzumiPublicClient } from '../src/index.js';
import type { paths } from '../src/openapi.js';

type StorageSettingsBody =
  paths['/api/v1/storage/settings']['put']['requestBody']['content']['application/json'];
type CreateAiSessionBody =
  paths['/api/v1/ai/posts/{postId}/sessions']['post']['requestBody']['content']['application/json'];
type StartAiRunBody =
  paths['/api/v1/ai/sessions/{id}/runs']['post']['requestBody']['content']['application/json'];

describe('generated owner configuration contracts', () => {
  it('keeps storage secrets and AI provider selection in request bodies', () => {
    const storage: StorageSettingsBody = {
      mode: 's3',
      secretAccessKey: 'write-only-secret',
    };
    const session: CreateAiSessionBody = { providerProfileId: 'provider-1' };
    const run: StartAiRunBody = {
      message: 'Revise this paragraph',
      providerProfileId: 'provider-1',
    };

    expect(storage.secretAccessKey).toBe('write-only-secret');
    expect(session.providerProfileId).toBe('provider-1');
    expect(run.providerProfileId).toBe('provider-1');
  });
});

describe('createIzumiClient', () => {
  it('reads whether the singleton owner has been initialized', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.method).toBe('GET');
      expect(request.url).toBe('https://core.example.test/api/v1/auth/status');
      return new Response(
        JSON.stringify({ data: { initialized: true, username: 'owner' } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    const client = createIzumiClient({
      baseUrl: 'https://core.example.test',
      fetch,
    });

    await expect(client.getOwnerAuthStatus()).resolves.toEqual({
      initialized: true,
      username: 'owner',
    });
  });

  it('unwraps the documented authentication envelope', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = new Request(input, init);
      const body = await request.json();
      expect(body).toEqual({
        username: 'owner',
        password: 'correct-horse-battery-staple',
      });
      expect(body).not.toHaveProperty('email');
      return new Response(
        JSON.stringify({
          data: {
            accessToken: 'token-123',
            tokenType: 'Bearer',
            expiresIn: 604800,
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    const client = createIzumiClient({
      baseUrl: 'https://core.example.test/',
      fetch,
    });

    await expect(
      client.loginOwner({
        username: 'owner',
        password: 'correct-horse-battery-staple',
      }),
    ).resolves.toMatchObject({ accessToken: 'token-123' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('sets up the owner without a deployment secret header', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.headers.has('x-izumi-setup-token')).toBe(false);
      expect(await request.json()).toEqual({
        username: 'owner',
        password: 'correct-horse-battery-staple',
      });
      return new Response(
        JSON.stringify({
          data: {
            accessToken: 'token-123',
            tokenType: 'Bearer',
            expiresIn: 604800,
          },
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    const client = createIzumiClient({
      baseUrl: 'https://core.example.test',
      fetch,
    });

    await client.setupOwner({
      username: 'owner',
      password: 'correct-horse-battery-staple',
    });
  });

  it('sends the owner token when saving an existing post', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === 'GET') {
        expect(request.headers.get('authorization')).toBe('Bearer owner-token');
        return new Response(
          JSON.stringify({
            data: {
              id: 'post-123',
              title: 'Existing title',
              slug: 'first-post',
              content: 'Markdown',
              excerpt: '',
              section: '',
              tags: [],
              readingMinutes: 1,
              status: 'draft',
              revision: 4,
              hasUnpublishedChanges: true,
              publishedAt: null,
              createdAt: '2026-07-21T00:00:00.000Z',
              updatedAt: '2026-07-21T00:00:00.000Z',
            },
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              etag: 'W/"4"',
            },
          },
        );
      }
      expect(request.method).toBe('PATCH');
      expect(request.url).toBe('https://core.example.test/api/v1/posts/post-123');
      expect(request.headers.get('authorization')).toBe('Bearer owner-token');
      expect(request.headers.get('if-match')).toBe('W/"4"');
      expect(await request.json()).toEqual({ title: 'Revised title' });
      return new Response(
        JSON.stringify({
          data: {
            id: 'post-123',
            title: 'Revised title',
            slug: 'first-post',
            content: 'Markdown',
            excerpt: '',
            section: '',
            tags: [],
            readingMinutes: 1,
            status: 'draft',
            publishedAt: null,
            createdAt: '2026-07-21T00:00:00.000Z',
            updatedAt: '2026-07-21T00:00:00.000Z',
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    const client = createIzumiClient({
      baseUrl: 'https://core.example.test',
      fetch,
      getAccessToken: () => 'owner-token',
    });

    await expect(
      client.updatePost('post-123', { title: 'Revised title' }),
    ).resolves.toMatchObject({
      id: 'post-123',
      title: 'Revised title',
    });
  });

  it('preserves the loaded ETag across the versioned owner post path', async () => {
    let revision = 4;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === 'GET') {
        return new Response(
          JSON.stringify({
            data: {
              id: 'post-123',
              title: 'Original title',
              slug: 'first-post',
              content: 'Markdown',
              excerpt: '',
              section: '',
              tags: [],
              readingMinutes: 1,
              status: 'draft',
              revision,
              hasUnpublishedChanges: true,
              publishedAt: null,
              createdAt: '2026-07-21T00:00:00.000Z',
              updatedAt: '2026-07-21T00:00:00.000Z',
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json', etag: `W/"${revision}"` },
          },
        );
      }

      expect(request.headers.get('if-match')).toBe('W/"4"');
      revision = 5;
      return new Response(
        JSON.stringify({
          data: {
            id: 'post-123',
            title: 'Revised title',
            slug: 'first-post',
            content: 'Markdown',
            excerpt: '',
            section: '',
            tags: [],
            readingMinutes: 1,
            status: 'draft',
            revision,
            hasUnpublishedChanges: true,
            publishedAt: null,
            createdAt: '2026-07-21T00:00:00.000Z',
            updatedAt: '2026-07-21T00:00:00.000Z',
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json', etag: 'W/"5"' },
        },
      );
    });
    const client = createIzumiClient({
      baseUrl: 'https://core.example.test',
      fetch,
      getAccessToken: () => 'owner-token',
    });

    const loaded = await client.getPostVersioned('post-123');
    await expect(
      client.updatePostVersioned(
        loaded.post.id,
        { title: 'Revised title' },
        loaded.etag,
      ),
    ).resolves.toMatchObject({
      post: { revision: 5, title: 'Revised title' },
      etag: 'W/"5"',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps latest-revision lookup explicit for legacy updates', async () => {
    const methods: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = new Request(input, init);
      methods.push(request.method);
      if (request.method === 'GET') {
        return new Response(JSON.stringify({ data: { id: 'post-123' } }), {
          status: 200,
          headers: { 'content-type': 'application/json', etag: 'W/"9"' },
        });
      }
      expect(request.headers.get('if-match')).toBe('W/"9"');
      return new Response(JSON.stringify({ data: { id: 'post-123' } }), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: 'W/"10"' },
      });
    });
    const client = createIzumiClient({
      baseUrl: 'https://core.example.test',
      fetch,
    });

    await expect(
      client.updatePostLegacy('post-123', { title: 'Legacy update' }),
    ).resolves.toMatchObject({ id: 'post-123' });
    expect(methods).toEqual(['GET', 'PATCH']);
  });

  it('resolves live post references in one authenticated request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.method).toBe('POST');
      expect(request.url).toBe(
        'https://core.example.test/api/v1/posts/references/resolve',
      );
      expect(request.headers.get('authorization')).toBe('Bearer owner-token');
      expect(await request.json()).toEqual({ postIds: ['post-1', 'post-2'] });
      return new Response(
        JSON.stringify({
          data: [{ postId: 'post-1', slug: 'first-post', title: 'First post' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const client = createIzumiClient({
      baseUrl: 'https://core.example.test',
      fetch,
      getAccessToken: () => 'owner-token',
    });

    await expect(
      client.resolvePostReferences({ postIds: ['post-1', 'post-2'] }),
    ).resolves.toEqual([{ postId: 'post-1', slug: 'first-post', title: 'First post' }]);
  });

  it('sends the complete profile and owner token when replacing the profile', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.method).toBe('PUT');
      expect(request.url).toBe('https://core.example.test/api/v1/owner/profile');
      expect(request.headers.get('authorization')).toBe('Bearer owner-token');
      expect(await request.json()).toEqual({
        displayName: 'Konata',
        headline: "Hello, I'm Konata.",
        bio: 'A design-driven developer.',
        avatar: {
          url: 'https://assets.example.test/avatar.png',
          alt: 'Konata avatar',
        },
        links: [{ kind: 'github', url: 'https://github.com/konata33' }],
      });
      return new Response(
        JSON.stringify({
          data: {
            displayName: 'Konata',
            headline: "Hello, I'm Konata.",
            bio: 'A design-driven developer.',
            avatar: {
              url: 'https://assets.example.test/avatar.png',
              alt: 'Konata avatar',
            },
            links: [{ kind: 'github', url: 'https://github.com/konata33' }],
            updatedAt: '2026-07-22T00:00:00.000Z',
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    const client = createIzumiClient({
      baseUrl: 'https://core.example.test',
      fetch,
      getAccessToken: () => 'owner-token',
    });

    await expect(
      client.replaceProfile({
        displayName: 'Konata',
        headline: "Hello, I'm Konata.",
        bio: 'A design-driven developer.',
        avatar: {
          url: 'https://assets.example.test/avatar.png',
          alt: 'Konata avatar',
        },
        links: [{ kind: 'github', url: 'https://github.com/konata33' }],
      }),
    ).resolves.toMatchObject({
      displayName: 'Konata',
      updatedAt: '2026-07-22T00:00:00.000Z',
    });
  });
});

describe('createIzumiPublicClient', () => {
  it('uses the API prefix before /v1 and unwraps public summaries', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      expect(String(input)).toBe(
        'https://core.example.test/api/v1/public/posts?limit=1',
      );
      return new Response(
        JSON.stringify({
          data: [
            {
              slug: 'first-post',
              title: 'First post',
              excerpt: 'An excerpt.',
              publishedAt: '2026-07-20T04:00:00.000Z',
              readingMinutes: 1,
              section: 'Notes',
              tags: [],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    const client = createIzumiPublicClient({
      baseUrl: 'https://core.example.test/api/',
      fetch,
    });

    await expect(client.getPosts(1)).resolves.toMatchObject([{ slug: 'first-post' }]);
  });

  it('encodes slugs and preserves Core error semantics', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      expect(String(input)).toBe(
        'https://core.example.test/api/v1/public/posts/missing%20post',
      );
      return new Response(
        JSON.stringify({
          error: { code: 'PUBLIC_POST_NOT_FOUND', message: 'Published post not found' },
        }),
        {
          status: 404,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    const client = createIzumiPublicClient({
      baseUrl: 'https://core.example.test/api',
      fetch,
    });

    await expect(client.getPostBySlug('missing post')).rejects.toMatchObject({
      status: 404,
      code: 'PUBLIC_POST_NOT_FOUND',
    });
  });

  it('uses the public profile endpoint and unwraps its data envelope', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      expect(String(input)).toBe('https://core.example.test/api/v1/public/profile');
      return new Response(
        JSON.stringify({
          data: {
            displayName: 'Konata',
            headline: "Hello, I'm Konata.",
            bio: 'A design-driven developer.',
            avatar: {
              url: 'https://assets.example.test/avatar.png',
              alt: 'Konata avatar',
            },
            links: [],
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    const client = createIzumiPublicClient({
      baseUrl: 'https://core.example.test/api',
      fetch,
    });

    await expect(client.getProfile()).resolves.toMatchObject({
      displayName: 'Konata',
      links: [],
    });
  });
});
