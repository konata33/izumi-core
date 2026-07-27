import path from 'node:path';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';

describe.runIf(integrationEnabled)('owner post API', () => {
  let app: NestFastifyApplication;
  let database: PostgreSqlContainer;
  let accessToken: string;
  let firstPostId: string;

  beforeAll(async () => {
    database = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = database.getConnectionUri();
    process.env.REDIS_URL = 'redis://127.0.0.1:6389';
    process.env.JWT_SECRET = 'test-only-secret-with-at-least-thirty-two-characters';
    process.env.JWT_EXPIRES_IN = '1h';
    process.env.OWNER_SETUP_TOKEN =
      'test-setup-token-with-at-least-thirty-two-characters';
    process.env.CORS_ORIGIN = 'http://localhost:5173';

    const { runMigrations } = await import('../../src/database/migrate.js');
    await runMigrations({
      databaseUrl: database.getConnectionUri(),
      migrationsFolder: path.resolve(process.cwd(), 'src/database/migrations'),
    });

    const { createApplication } = await import('../../src/application.js');
    app = await createApplication();
    await app.init();

    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      headers: {
        'x-izumi-setup-token': process.env.OWNER_SETUP_TOKEN,
      },
      payload: {
        email: 'owner@example.com',
        password: 'correct-horse-battery-staple',
      },
    });
    expect(setup.statusCode).toBe(201);
    accessToken = (setup.json() as { data: { accessToken: string } }).data.accessToken;
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  it('keeps an unconfigured public profile private by returning 404', async () => {
    const publicProfile = await app.inject({
      method: 'GET',
      url: '/api/v1/public/profile',
    });
    expect(publicProfile.statusCode).toBe(404);
    expect(publicProfile.json()).toMatchObject({
      error: { code: 'PROFILE_NOT_CONFIGURED' },
    });

    const ownerProfile = await app.inject({
      method: 'GET',
      url: '/api/v1/owner/profile',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(ownerProfile.statusCode).toBe(404);
    expect(ownerProfile.json()).toMatchObject({
      error: { code: 'PROFILE_NOT_CONFIGURED' },
    });
  });

  it('replaces the singleton profile and exposes only the public representation', async () => {
    const profile = {
      displayName: ' Konata ',
      headline: " Hello, I'm Konata. ",
      bio: ' A design-driven developer. ',
      avatar: {
        url: 'https://assets.example.com/izumi/avatar.png',
        alt: ' Konata33 的头像 ',
      },
      links: [
        { kind: 'x', url: 'https://x.com/Mrcat333' },
        { kind: 'github', url: 'https://github.com/konata33' },
      ],
    };
    const replaced = await app.inject({
      method: 'PUT',
      url: '/api/v1/owner/profile',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: profile,
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toMatchObject({
      data: {
        displayName: 'Konata',
        headline: "Hello, I'm Konata.",
        bio: 'A design-driven developer.',
        avatar: {
          url: 'https://assets.example.com/izumi/avatar.png',
          alt: 'Konata33 的头像',
        },
        links: [
          { kind: 'github', url: 'https://github.com/konata33' },
          { kind: 'x', url: 'https://x.com/Mrcat333' },
        ],
        updatedAt: expect.any(String),
      },
    });

    const ownerProfile = await app.inject({
      method: 'GET',
      url: '/api/v1/owner/profile',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(ownerProfile.statusCode).toBe(200);
    expect(ownerProfile.json()).toMatchObject({
      data: {
        displayName: 'Konata',
        links: [
          { kind: 'github', url: 'https://github.com/konata33' },
          { kind: 'x', url: 'https://x.com/Mrcat333' },
        ],
        updatedAt: expect.any(String),
      },
    });

    const publicProfile = await app.inject({
      method: 'GET',
      url: '/api/v1/public/profile',
    });
    expect(publicProfile.statusCode).toBe(200);
    expect(publicProfile.json()).toEqual({
      data: {
        displayName: 'Konata',
        headline: "Hello, I'm Konata.",
        bio: 'A design-driven developer.',
        avatar: {
          url: 'https://assets.example.com/izumi/avatar.png',
          alt: 'Konata33 的头像',
        },
        links: [
          { kind: 'github', url: 'https://github.com/konata33' },
          { kind: 'x', url: 'https://x.com/Mrcat333' },
        ],
      },
    });
    expect(publicProfile.json().data).not.toHaveProperty('updatedAt');

    const duplicateLink = await app.inject({
      method: 'PUT',
      url: '/api/v1/owner/profile',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        ...profile,
        links: [
          { kind: 'github', url: 'https://github.com/konata33' },
          { kind: 'github', url: 'https://github.com/another' },
        ],
      },
    });
    expect(duplicateLink.statusCode).toBe(400);
    expect(duplicateLink.json()).toMatchObject({
      error: { code: 'PROFILE_LINK_KIND_DUPLICATE' },
    });

    const invalidAvatar = await app.inject({
      method: 'PUT',
      url: '/api/v1/owner/profile',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        ...profile,
        avatar: { ...profile.avatar, url: 'http://assets.example.com/avatar.png' },
      },
    });
    expect(invalidAvatar.statusCode).toBe(400);
    expect(invalidAvatar.json()).toMatchObject({
      error: { code: 'PROFILE_FIELD_INVALID', details: { field: 'avatar.url' } },
    });

    const emptiedLinks = await app.inject({
      method: 'PUT',
      url: '/api/v1/owner/profile',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { ...profile, bio: 'A revised bio.', links: [] },
    });
    expect(emptiedLinks.statusCode).toBe(200);
    expect(emptiedLinks.json()).toMatchObject({
      data: { bio: 'A revised bio.', links: [] },
    });
  });

  it('creates and lists protected drafts', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        title: 'First post',
        slug: 'first-post',
        content: 'Independent content.',
      },
    });
    expect(created.statusCode).toBe(201);
    expect((created.json() as { data: { slug: string } }).data.slug).toBe('first-post');
    firstPostId = (created.json() as { data: { id: string } }).data.id;

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/posts?page=1&size=20',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { data: { total: number } }).data.total).toBe(1);

    const fetched = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${firstPostId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({
      data: { id: firstPostId, slug: 'first-post', status: 'draft' },
    });
  });

  it('enforces owner authentication and the documented list contract', async () => {
    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/api/v1/posts',
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });

    const secondDraft = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        title: 'Later draft',
        slug: 'later-draft',
        content: 'A deliberately separate draft.',
      },
    });
    expect(secondDraft.statusCode).toBe(201);

    const firstPage = await app.inject({
      method: 'GET',
      url: '/api/v1/posts?status=draft&page=1&size=1',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json()).toMatchObject({
      data: {
        page: 1,
        size: 1,
        total: 2,
        items: [{ slug: 'later-draft', status: 'draft', content: expect.any(String) }],
      },
    });

    const secondPage = await app.inject({
      method: 'GET',
      url: '/api/v1/posts?status=draft&page=2&size=1',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json()).toMatchObject({
      data: { page: 2, size: 1, total: 2, items: [{ slug: 'first-post' }] },
    });

    const invalidSize = await app.inject({
      method: 'GET',
      url: '/api/v1/posts?size=101',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(invalidSize.statusCode).toBe(400);
    expect(invalidSize.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
  });

  it('allows the admin browser to preflight bearer PATCH requests', async () => {
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/posts/example-id',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(preflight.headers['access-control-allow-methods']).toContain('PATCH');
    expect(preflight.headers['access-control-allow-headers']).toContain(
      'authorization',
    );
  });

  it('allows the admin browser to preflight bearer PUT requests', async () => {
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/owner/profile',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-methods']).toContain('PUT');
    expect(preflight.headers['access-control-allow-headers']).toContain(
      'authorization',
    );
  });

  it('serves only complete published content through the public contract', async () => {
    const emptyArchive = await app.inject({
      method: 'GET',
      url: '/api/v1/public/posts',
    });
    expect(emptyArchive.statusCode).toBe(200);
    expect(emptyArchive.json()).toEqual({ data: [] });

    const hiddenDraft = await app.inject({
      method: 'GET',
      url: '/api/v1/public/posts/first-post',
    });
    expect(hiddenDraft.statusCode).toBe(404);
    expect(hiddenDraft.json()).toMatchObject({
      error: { code: 'PUBLIC_POST_NOT_FOUND' },
    });

    const incompletePublication = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        title: 'Incomplete publication',
        slug: 'incomplete-publication',
        content: 'This cannot yet be published.',
        status: 'published',
      },
    });
    expect(incompletePublication.statusCode).toBe(400);
    expect(incompletePublication.json()).toMatchObject({
      error: { code: 'POST_PUBLISHING_INCOMPLETE' },
    });

    const content = '## 先让内容找到位置\n\n正文以 Markdown 保存。';
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        title: 'A public post',
        slug: 'a-public-post',
        content,
        excerpt: 'A concise editorial introduction.',
        section: 'Notes',
        tags: ['Writing', 'writing', ' website '],
        status: 'published',
      },
    });
    expect(created.statusCode).toBe(201);
    expect((created.json() as { data: { tags: string[] } }).data.tags).toEqual([
      'Writing',
      'website',
    ]);

    const collection = await app.inject({
      method: 'GET',
      url: '/api/v1/public/posts?limit=1',
    });
    expect(collection.statusCode).toBe(200);
    const summaries = collection.json() as {
      data: Array<{ slug: string; content?: string; readingMinutes: number }>;
    };
    expect(summaries.data).toHaveLength(1);
    expect(summaries.data[0]).toMatchObject({
      slug: 'a-public-post',
      readingMinutes: 1,
    });
    expect(summaries.data[0]).not.toHaveProperty('content');

    const laterPublication = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        title: 'A later public post',
        slug: 'a-later-public-post',
        content: 'Another independent article.',
        excerpt: 'A later editorial introduction.',
        section: 'Notes',
        tags: [],
        status: 'published',
      },
    });
    expect(laterPublication.statusCode).toBe(201);

    const orderedArchive = await app.inject({
      method: 'GET',
      url: '/api/v1/public/posts',
    });
    expect(orderedArchive.statusCode).toBe(200);
    expect(
      (orderedArchive.json() as { data: Array<{ slug: string }> }).data.map(
        (post) => post.slug,
      ),
    ).toEqual(['a-later-public-post', 'a-public-post']);

    const detail = await app.inject({
      method: 'GET',
      url: '/api/v1/public/posts/a-public-post',
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      data: {
        slug: 'a-public-post',
        content,
        tags: ['Writing', 'website'],
        readingMinutes: 1,
      },
    });
  });

  it('saves drafts, publishes complete posts, and preserves the first publication time', async () => {
    const emptyUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${firstPostId}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {},
    });
    expect(emptyUpdate.statusCode).toBe(400);
    expect(emptyUpdate.json()).toMatchObject({ error: { code: 'POST_UPDATE_EMPTY' } });

    const incompletePublication = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${firstPostId}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { status: 'published' },
    });
    expect(incompletePublication.statusCode).toBe(400);
    expect(incompletePublication.json()).toMatchObject({
      error: { code: 'POST_PUBLISHING_INCOMPLETE' },
    });

    const content = '字'.repeat(301);
    const published = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${firstPostId}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        content,
        excerpt: 'A draft can now be public.',
        section: 'Notes',
        tags: ['Writing', 'writing'],
        status: 'published',
      },
    });
    expect(published.statusCode).toBe(200);
    const firstPublishedAt = (published.json() as { data: { publishedAt: string } })
      .data.publishedAt;
    expect(published.json()).toMatchObject({
      data: {
        id: firstPostId,
        status: 'published',
        content,
        readingMinutes: 2,
        tags: ['Writing'],
      },
    });

    const publicDetail = await app.inject({
      method: 'GET',
      url: '/api/v1/public/posts/first-post',
    });
    expect(publicDetail.statusCode).toBe(200);
    expect(publicDetail.json()).toMatchObject({
      data: { content, readingMinutes: 2, publishedAt: firstPublishedAt },
    });

    const unpublished = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${firstPostId}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { status: 'draft' },
    });
    expect(unpublished.statusCode).toBe(200);
    expect(unpublished.json()).toMatchObject({
      data: { status: 'draft', publishedAt: firstPublishedAt },
    });

    const hiddenAgain = await app.inject({
      method: 'GET',
      url: '/api/v1/public/posts/first-post',
    });
    expect(hiddenAgain.statusCode).toBe(404);

    const republished = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${firstPostId}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { status: 'published' },
    });
    expect(republished.statusCode).toBe(200);
    expect(republished.json()).toMatchObject({
      data: { status: 'published', publishedAt: firstPublishedAt },
    });
  });

  it.each(['0', '-1', '1.5', '101', ''])(
    'returns the standard 400 envelope for an invalid public limit of %j',
    async (limit) => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/public/posts?limit=${limit}`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    },
  );
});
