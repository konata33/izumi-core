import { describe, expect, it, vi } from 'vitest';

import { createIzumiClient, createIzumiPublicClient } from '../src/index.js';

describe('createIzumiClient', () => {
  it('unwraps the documented authentication envelope', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
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
        ),
    );
    const client = createIzumiClient({
      baseUrl: 'https://core.example.test/',
      fetch,
    });

    await expect(
      client.loginOwner({
        email: 'owner@example.com',
        password: 'correct-horse-battery-staple',
      }),
    ).resolves.toMatchObject({ accessToken: 'token-123' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('sends the bootstrap token only for owner setup', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.headers.get('x-izumi-setup-token')).toBe('bootstrap-token');
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

    await client.setupOwner(
      {
        email: 'owner@example.com',
        password: 'correct-horse-battery-staple',
      },
      'bootstrap-token',
    );
  });

  it('sends the owner token when saving an existing post', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.method).toBe('PATCH');
      expect(request.url).toBe('https://core.example.test/api/v1/posts/post-123');
      expect(request.headers.get('authorization')).toBe('Bearer owner-token');
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
