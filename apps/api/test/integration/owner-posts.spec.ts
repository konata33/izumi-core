import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { JwtService } from '@nestjs/jwt';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { compare, hash } from 'bcryptjs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';

describe.runIf(integrationEnabled)('owner post API', () => {
  let app: NestFastifyApplication;
  let database: PostgreSqlContainer;
  let accessToken: string;
  let firstPostId: string;
  let firstPostEtag: string;

  beforeAll(async () => {
    database = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = database.getConnectionUri();
    process.env.REDIS_URL = 'redis://127.0.0.1:6389';
    process.env.JWT_SECRET = 'test-only-secret-with-at-least-thirty-two-characters';
    process.env.JWT_EXPIRES_IN = '1h';
    process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
    process.env.CORS_ORIGIN = 'http://localhost:5173';

    const { runMigrations } = await import('../../src/database/migrate.js');
    await runMigrations({
      databaseUrl: database.getConnectionUri(),
      migrationsFolder: path.resolve(process.cwd(), 'src/database/migrations'),
    });

    const { createApplication } = await import('../../src/application.js');
    app = await createApplication();
    await app.init();

    const beforeSetup = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/status',
    });
    expect(beforeSetup.statusCode).toBe(200);
    expect(beforeSetup.json()).toEqual({ data: { initialized: false } });

    const setupRequests = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/setup',
        payload: {
          username: 'konata',
          password: 'correct-horse-battery-staple',
        },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/setup',
        payload: {
          username: 'other-owner',
          password: 'correct-horse-battery-staple',
        },
      }),
    ]);
    expect(setupRequests.map(({ statusCode }) => statusCode).sort()).toEqual([
      201, 409,
    ]);
    const cleanupPool = new Pool({
      connectionString: database.getConnectionUri(),
      max: 1,
    });
    await cleanupPool.query('DELETE FROM owners');
    await cleanupPool.end();

    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: {
        username: 'konata',
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

  it('authenticates with username only and keeps legacy subject tokens valid', async () => {
    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/status',
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({
      data: { initialized: true, username: 'konata' },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'KONATA',
        password: 'correct-horse-battery-staple',
      },
    });
    expect(login.statusCode).toBe(200);

    const loginToken = (login.json() as { data: { accessToken: string } }).data
      .accessToken;
    const payload = JSON.parse(
      Buffer.from(loginToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({ sub: expect.any(String) });
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('username');

    const incorrectPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'konata',
        password: 'this-password-is-wrong',
      },
    });
    expect(incorrectPassword.statusCode).toBe(401);
    expect(incorrectPassword.json()).toMatchObject({
      error: { code: 'INVALID_CREDENTIALS' },
    });

    const legacyToken = await new JwtService().signAsync(
      { email: 'owner@example.com' },
      {
        secret: process.env.JWT_SECRET,
        subject: String(payload.sub),
        expiresIn: '1h',
      },
    );
    const legacyRequest = await app.inject({
      method: 'GET',
      url: '/api/v1/posts',
      headers: { authorization: `Bearer ${legacyToken}` },
    });
    expect(legacyRequest.statusCode).toBe(200);
  });

  it('rejects legacy email fields and repeated owner setup', async () => {
    const legacyLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'owner@example.com',
        password: 'correct-horse-battery-staple',
      },
    });
    expect(legacyLogin.statusCode).toBe(400);
    expect(legacyLogin.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });

    const repeatedSetup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: {
        username: 'another-owner',
        password: 'correct-horse-battery-staple',
      },
    });
    expect(repeatedSetup.statusCode).toBe(409);
    expect(repeatedSetup.json()).toMatchObject({
      error: { code: 'OWNER_ALREADY_CONFIGURED' },
    });
  });

  it('migrates the existing owner username without losing related content', async () => {
    const pool = new Pool({ connectionString: database.getConnectionUri(), max: 1 });
    const schemaName = 'auth_migration_fixture';
    const existingPassword = 'existing-owner-password';
    const existingPasswordHash = await hash(existingPassword, 4);

    try {
      await pool.query(`CREATE SCHEMA "${schemaName}"`);
      await pool.query(`SET search_path TO "${schemaName}"`);
      await pool.query(`
        CREATE TABLE owners (
          id text PRIMARY KEY,
          email text NOT NULL,
          password_hash text NOT NULL,
          singleton_slot integer NOT NULL DEFAULT 1
        );
        CREATE UNIQUE INDEX owners_email_unique ON owners(email);
        CREATE UNIQUE INDEX owners_singleton_unique ON owners(singleton_slot);
        CREATE TABLE posts (
          id text PRIMARY KEY,
          owner_id text NOT NULL REFERENCES owners(id),
          title text NOT NULL
        );
        CREATE TABLE profiles (
          id text PRIMARY KEY,
          owner_id text NOT NULL REFERENCES owners(id),
          display_name text NOT NULL
        );
      `);
      await pool.query(
        `INSERT INTO owners (id, email, password_hash)
         VALUES ('owner-1', 'Konata@example.com', $1)`,
        [existingPasswordHash],
      );
      await pool.query(`
        INSERT INTO posts (id, owner_id, title) VALUES
          ('post-1', 'owner-1', 'Existing post');
        INSERT INTO profiles (id, owner_id, display_name) VALUES
          ('profile-1', 'owner-1', 'Konata');
      `);

      const migration = await readFile(
        path.resolve(process.cwd(), 'src/database/migrations/0003_smooth_bromley.sql'),
        'utf8',
      );
      for (const statement of migration.split('--> statement-breakpoint')) {
        if (statement.trim()) await pool.query(statement);
      }

      const owner = await pool.query<{
        username: string;
        password_hash: string;
      }>('SELECT username, password_hash FROM owners WHERE id = $1', ['owner-1']);
      expect(owner.rows[0]).toEqual({
        username: 'konata',
        password_hash: existingPasswordHash,
      });
      expect(await compare(existingPassword, owner.rows[0]!.password_hash)).toBe(true);
      expect(
        (
          await pool.query<{ count: string }>(
            'SELECT count(*) FROM posts WHERE owner_id = $1',
            ['owner-1'],
          )
        ).rows[0]?.count,
      ).toBe('1');
      expect(
        (
          await pool.query<{ count: string }>(
            'SELECT count(*) FROM profiles WHERE owner_id = $1',
            ['owner-1'],
          )
        ).rows[0]?.count,
      ).toBe('1');
      expect(
        (
          await pool.query<{ count: string }>(
            `SELECT count(*) FROM information_schema.columns
             WHERE table_schema = $1 AND table_name = 'owners' AND column_name = 'email'`,
            [schemaName],
          )
        ).rows[0]?.count,
      ).toBe('0');
    } finally {
      await pool.query('RESET search_path').catch(() => undefined);
      await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await pool.end();
    }
  });

  it('backfills legacy Markdown without overwriting it and retries failed conversions', async () => {
    const pool = new Pool({ connectionString: database.getConnectionUri(), max: 1 });
    const schemaName = 'post_content_migration_fixture';
    const publishedContent = '# Published heading\n\nOriginal **Markdown**.';
    const draftContent = '## Draft heading\n\n- one\n- two';
    const failingContent = '# CONVERSION_FAIL\n\nKeep this source exactly.';

    try {
      await pool.query(`CREATE SCHEMA "${schemaName}"`);
      await pool.query(`SET search_path TO "${schemaName}"`);
      await pool.query(`
        CREATE TABLE posts (
          id text PRIMARY KEY,
          owner_id text NOT NULL,
          title text NOT NULL,
          slug text NOT NULL,
          content text NOT NULL,
          excerpt text NOT NULL DEFAULT '',
          section text NOT NULL DEFAULT '',
          tags text[] NOT NULL DEFAULT ARRAY[]::text[],
          reading_minutes integer NOT NULL DEFAULT 1,
          status text NOT NULL DEFAULT 'draft',
          published_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT posts_published_fields_present CHECK (
            status <> 'published' OR (
              btrim(title) <> '' AND btrim(slug) <> '' AND
              btrim(content) <> '' AND btrim(excerpt) <> '' AND
              btrim(section) <> '' AND published_at IS NOT NULL
            )
          )
        );
      `);
      await pool.query(
        `INSERT INTO posts (
          id, owner_id, title, slug, content, excerpt, section, status, published_at
        ) VALUES
          ('legacy-published', 'owner-1', 'Published', 'published', $1,
           'Published excerpt', 'Notes', 'published', now()),
          ('legacy-draft', 'owner-1', 'Draft', 'draft', $2, '', '', 'draft', NULL),
          ('legacy-failure', 'owner-1', 'Failure', 'failure', $3, '', '', 'draft', NULL)`,
        [publishedContent, draftContent, failingContent],
      );

      const migration = (
        await readFile(
          path.resolve(
            process.cwd(),
            'src/database/migrations/0004_tough_mister_fear.sql',
          ),
          'utf8',
        )
      ).replaceAll('"public".', `"${schemaName}".`);
      for (const statement of migration.split('--> statement-breakpoint')) {
        if (statement.trim()) await pool.query(statement);
      }

      const afterSql = await pool.query<{
        content: string;
        content_migration_state: string;
        document: { root: { children: Array<{ children?: Array<{ text: string }> }> } };
      }>(
        `SELECT content, content_migration_state, document
         FROM posts WHERE id = 'legacy-failure'`,
      );
      expect(afterSql.rows[0]?.content).toBe(failingContent);
      expect(afterSql.rows[0]?.content_migration_state).toBe('pending');
      expect(afterSql.rows[0]?.document.root.children[0]?.children?.[0]?.text).toBe(
        failingContent,
      );

      const { runPostContentBackfill } =
        await import('../../src/posts/content-backfill.js');
      const { importMarkdownToRichDocument } =
        await import('../../src/posts/rich-content.js');
      const firstRun = await runPostContentBackfill(pool, {
        convert: (markdown) => {
          if (markdown.includes('CONVERSION_FAIL')) {
            throw new Error('Deliberate conversion failure');
          }
          return importMarkdownToRichDocument(markdown);
        },
      });
      expect(firstRun).toEqual({ converted: 2, failed: 1 });

      const migrated = await pool.query<{
        id: string;
        content: string;
        content_migration_state: string;
        document: { root: { children: Array<{ type: string }> } };
      }>(
        `SELECT id, content, content_migration_state, document
         FROM posts ORDER BY id`,
      );
      expect(
        migrated.rows.map(({ id, content, content_migration_state }) => ({
          id,
          content,
          content_migration_state,
        })),
      ).toEqual([
        {
          id: 'legacy-draft',
          content: draftContent,
          content_migration_state: 'native',
        },
        {
          id: 'legacy-failure',
          content: failingContent,
          content_migration_state: 'failed',
        },
        {
          id: 'legacy-published',
          content: publishedContent,
          content_migration_state: 'native',
        },
      ]);
      expect(
        migrated.rows.find((row) => row.id === 'legacy-published')?.document.root
          .children[0]?.type,
      ).toBe('heading');
      expect(
        migrated.rows.find((row) => row.id === 'legacy-failure')?.document.root
          .children[0]?.type,
      ).toBe('paragraph');

      const publication = await pool.query<{
        content: string;
        document: { root: { children: Array<{ type: string }> } };
      }>(
        `SELECT content, document FROM post_publications
         WHERE post_id = 'legacy-published' AND is_live = true`,
      );
      expect(publication.rows[0]?.content).toBe(publishedContent);
      expect(publication.rows[0]?.document.root.children[0]?.type).toBe('heading');

      expect(await runPostContentBackfill(pool)).toEqual({
        converted: 1,
        failed: 0,
      });
      expect(await runPostContentBackfill(pool)).toEqual({
        converted: 0,
        failed: 0,
      });
      const retried = await pool.query<{
        content: string;
        content_migration_state: string;
      }>(
        `SELECT content, content_migration_state
         FROM posts WHERE id = 'legacy-failure'`,
      );
      expect(retried.rows[0]).toEqual({
        content: failingContent,
        content_migration_state: 'native',
      });
    } finally {
      await pool.query('RESET search_path').catch(() => undefined);
      await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await pool.end();
    }
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
    expect(created.headers.etag).toBe('W/"1"');
    expect((created.json() as { data: { slug: string } }).data.slug).toBe('first-post');
    firstPostId = (created.json() as { data: { id: string } }).data.id;
    firstPostEtag = String(created.headers.etag);

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
    expect(fetched.headers.etag).toBe(firstPostEtag);
    expect(fetched.json()).toMatchObject({
      data: {
        id: firstPostId,
        slug: 'first-post',
        status: 'draft',
        revision: 1,
        hasUnpublishedChanges: true,
        contentMigrationState: 'native',
        document: { root: { type: 'root' } },
      },
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

    const searchedAcrossPages = await app.inject({
      method: 'GET',
      url: '/api/v1/posts?status=draft&q=FIRST&page=1&size=1',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(searchedAcrossPages.statusCode).toBe(200);
    expect(searchedAcrossPages.json()).toMatchObject({
      data: { page: 1, size: 1, total: 1, items: [{ slug: 'first-post' }] },
    });

    const escapedWildcard = await app.inject({
      method: 'GET',
      url: '/api/v1/posts?q=%25',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(escapedWildcard.statusCode).toBe(200);
    expect(escapedWildcard.json()).toMatchObject({ data: { total: 0, items: [] } });

    const invalidSize = await app.inject({
      method: 'GET',
      url: '/api/v1/posts?size=101',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(invalidSize.statusCode).toBe(400);
    expect(invalidSize.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });

    const invalidQuery = await app.inject({
      method: 'GET',
      url: `/api/v1/posts?q=${'a'.repeat(201)}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(invalidQuery.statusCode).toBe(400);
    expect(invalidQuery.json()).toMatchObject({
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
        'access-control-request-headers': 'authorization,content-type,if-match',
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
    expect(preflight.headers['access-control-allow-headers']).toContain('if-match');
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

  it('uses ETags, isolates working drafts, and retains publication snapshots', async () => {
    const emptyUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${firstPostId}`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'if-match': firstPostEtag,
      },
      payload: {},
    });
    expect(emptyUpdate.statusCode).toBe(400);
    expect(emptyUpdate.json()).toMatchObject({ error: { code: 'POST_UPDATE_EMPTY' } });

    const missingPrecondition = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${firstPostId}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { title: 'Must not be written' },
    });
    expect(missingPrecondition.statusCode).toBe(428);
    expect(missingPrecondition.json()).toMatchObject({
      error: { code: 'POST_PRECONDITION_REQUIRED' },
    });

    const incompletePublication = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${firstPostId}/publish`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'if-match': firstPostEtag,
      },
    });
    expect(incompletePublication.statusCode).toBe(400);
    expect(incompletePublication.json()).toMatchObject({
      error: { code: 'POST_PUBLISHING_INCOMPLETE' },
    });

    const content = '字'.repeat(301);
    const saved = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${firstPostId}`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'if-match': firstPostEtag,
      },
      payload: {
        content,
        excerpt: 'A draft can now be public.',
        section: 'Notes',
        tags: ['Writing', 'writing'],
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers.etag).toBe('W/"2"');
    expect(saved.json()).toMatchObject({
      data: {
        id: firstPostId,
        status: 'draft',
        revision: 2,
        hasUnpublishedChanges: true,
        content,
        readingMinutes: 2,
        tags: ['Writing'],
      },
    });

    const staleSave = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${firstPostId}`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'if-match': firstPostEtag,
      },
      payload: { title: 'Stale title' },
    });
    expect(staleSave.statusCode).toBe(412);
    expect(staleSave.json()).toMatchObject({
      error: {
        code: 'POST_REVISION_CONFLICT',
        details: { currentRevision: 2, currentEtag: 'W/"2"' },
      },
    });

    const published = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${firstPostId}/publish`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'if-match': String(saved.headers.etag),
      },
    });
    expect(published.statusCode).toBe(200);
    expect(published.headers.etag).toBe('W/"3"');
    const firstPublishedAt = (published.json() as { data: { publishedAt: string } })
      .data.publishedAt;
    expect(published.json()).toMatchObject({
      data: {
        id: firstPostId,
        status: 'published',
        revision: 3,
        hasUnpublishedChanges: false,
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

    const changedWorkingCopy = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${firstPostId}`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'if-match': String(published.headers.etag),
      },
      payload: {
        title: 'Unpublished revision',
        content: 'This text must remain private until the next publish.',
      },
    });
    expect(changedWorkingCopy.statusCode).toBe(200);
    expect(changedWorkingCopy.headers.etag).toBe('W/"4"');
    expect(changedWorkingCopy.json()).toMatchObject({
      data: {
        status: 'published',
        revision: 4,
        hasUnpublishedChanges: true,
      },
    });

    const stillOldPublicDetail = await app.inject({
      method: 'GET',
      url: '/api/v1/public/posts/first-post',
    });
    expect(stillOldPublicDetail.statusCode).toBe(200);
    expect(stillOldPublicDetail.json()).toMatchObject({
      data: { title: 'First post', content },
    });

    const conflictFork = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${firstPostId}/fork-working-copy`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        title: 'Recovered local draft',
        slug: 'recovered-local-draft',
        content: 'Unsaved local content.',
      },
    });
    expect(conflictFork.statusCode).toBe(201);
    expect(conflictFork.headers.etag).toBe('W/"1"');
    expect(conflictFork.json()).toMatchObject({
      data: {
        title: 'Recovered local draft',
        status: 'draft',
        revision: 1,
        hasUnpublishedChanges: true,
      },
    });

    const discarded = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${firstPostId}/discard-working-copy`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'if-match': String(changedWorkingCopy.headers.etag),
      },
    });
    expect(discarded.statusCode).toBe(200);
    expect(discarded.headers.etag).toBe('W/"5"');
    expect(discarded.json()).toMatchObject({
      data: {
        title: 'First post',
        content,
        status: 'published',
        revision: 5,
        hasUnpublishedChanges: false,
      },
    });

    const unpublished = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${firstPostId}/unpublish`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'if-match': String(discarded.headers.etag),
      },
    });
    expect(unpublished.statusCode).toBe(200);
    expect(unpublished.headers.etag).toBe('W/"6"');
    expect(unpublished.json()).toMatchObject({
      data: {
        status: 'draft',
        revision: 6,
        hasUnpublishedChanges: false,
        publishedAt: firstPublishedAt,
      },
    });

    const hiddenAgain = await app.inject({
      method: 'GET',
      url: '/api/v1/public/posts/first-post',
    });
    expect(hiddenAgain.statusCode).toBe(404);

    const restoredOfflineSnapshot = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${firstPostId}/discard-working-copy`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'if-match': String(unpublished.headers.etag),
      },
    });
    expect(restoredOfflineSnapshot.statusCode).toBe(200);
    expect(restoredOfflineSnapshot.headers.etag).toBe('W/"7"');
    expect(restoredOfflineSnapshot.json()).toMatchObject({
      data: { status: 'draft', content, publishedAt: firstPublishedAt },
    });

    const republished = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${firstPostId}/publish`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'if-match': String(restoredOfflineSnapshot.headers.etag),
      },
    });
    expect(republished.statusCode).toBe(200);
    expect(republished.headers.etag).toBe('W/"8"');
    expect(republished.json()).toMatchObject({
      data: {
        status: 'published',
        revision: 8,
        hasUnpublishedChanges: false,
        publishedAt: firstPublishedAt,
      },
    });
  });

  it('rejects unsafe nodes and resolves only live post references', async () => {
    const unsafeDocument = {
      root: {
        children: [{ text: 'unsafe content', type: 'dynamic', version: 1 }],
        direction: null,
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    };
    const unsafeDraft = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        title: 'Unsafe document',
        slug: 'unsafe-document',
        document: unsafeDocument,
        excerpt: 'An unsafe document fixture.',
        section: 'Tests',
      },
    });
    expect(unsafeDraft.statusCode).toBe(201);
    const unsafeData = unsafeDraft.json() as {
      data: { id: string; revision: number };
    };

    const rejectedPublication = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${unsafeData.data.id}/publish`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'if-match': String(unsafeDraft.headers.etag),
      },
    });
    expect(rejectedPublication.statusCode).toBe(400);
    expect(rejectedPublication.json()).toMatchObject({
      error: {
        code: 'POST_DOCUMENT_UNPUBLISHABLE',
        details: {
          issues: [
            {
              path: 'root.children[0]',
              type: 'dynamic',
              reason: 'prohibited',
            },
          ],
        },
      },
    });

    const referenceDocument = {
      root: {
        children: [{ postId: firstPostId, type: 'post-reference', version: 1 }],
        direction: null,
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    };
    const referencingDraft = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        title: 'A referencing post',
        slug: 'a-referencing-post',
        document: referenceDocument,
        excerpt: 'References an existing live article.',
        section: 'Tests',
      },
    });
    expect(referencingDraft.statusCode).toBe(201);
    const referencingId = (referencingDraft.json() as { data: { id: string } }).data.id;

    const referencingPublication = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${referencingId}/publish`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'if-match': String(referencingDraft.headers.etag),
      },
    });
    expect(referencingPublication.statusCode).toBe(200);

    const publicReference = await app.inject({
      method: 'GET',
      url: '/api/v1/public/posts/a-referencing-post',
    });
    expect(publicReference.statusCode).toBe(200);
    expect(publicReference.json()).toMatchObject({
      data: {
        document: referenceDocument,
        references: [{ postId: firstPostId, slug: 'first-post', title: 'First post' }],
      },
    });

    const protectedResolution = await app.inject({
      method: 'POST',
      url: '/api/v1/posts/references/resolve',
      payload: { postIds: [firstPostId] },
    });
    expect(protectedResolution.statusCode).toBe(401);
    const oversizedResolution = await app.inject({
      method: 'POST',
      url: '/api/v1/posts/references/resolve',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { postIds: Array.from({ length: 101 }, () => firstPostId) },
    });
    expect(oversizedResolution.statusCode).toBe(400);
    const invalidResolutionItems = await Promise.all(
      [{ postIds: [''] }, { postIds: ['x'.repeat(65)] }, { postIds: [42] }].map(
        (payload) =>
          app.inject({
            method: 'POST',
            url: '/api/v1/posts/references/resolve',
            headers: { authorization: `Bearer ${accessToken}` },
            payload,
          }),
      ),
    );
    expect(invalidResolutionItems.map(({ statusCode }) => statusCode)).toEqual([
      400, 400, 400,
    ]);

    const firstWorkingCopy = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${firstPostId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const changedWorkingCopy = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${firstPostId}`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'if-match': String(firstWorkingCopy.headers.etag),
      },
      payload: {
        title: 'Unpublished working title',
        slug: 'unpublished-working-slug',
      },
    });
    expect(changedWorkingCopy.statusCode).toBe(200);

    const missingPostId = '00000000-0000-4000-8000-000000000000';
    const resolvedForPreview = await app.inject({
      method: 'POST',
      url: '/api/v1/posts/references/resolve',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        postIds: [referencingId, firstPostId, missingPostId, referencingId],
      },
    });
    expect(resolvedForPreview.statusCode).toBe(200);
    expect(resolvedForPreview.json()).toEqual({
      data: [
        {
          postId: referencingId,
          slug: 'a-referencing-post',
          title: 'A referencing post',
        },
        { postId: firstPostId, slug: 'first-post', title: 'First post' },
      ],
    });

    const takenOffline = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${firstPostId}/unpublish`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'if-match': String(changedWorkingCopy.headers.etag),
      },
    });
    expect(takenOffline.statusCode).toBe(200);
    const resolvedAfterUnpublish = await app.inject({
      method: 'POST',
      url: '/api/v1/posts/references/resolve',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { postIds: [firstPostId] },
    });
    expect(resolvedAfterUnpublish.statusCode).toBe(200);
    expect(resolvedAfterUnpublish.json()).toEqual({ data: [] });

    const missingReferenceDocument = {
      ...referenceDocument,
      root: {
        ...referenceDocument.root,
        children: [
          {
            postId: missingPostId,
            type: 'post-reference',
            version: 1,
          },
        ],
      },
    };
    const missingReferenceDraft = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        title: 'Missing reference',
        slug: 'missing-reference',
        document: missingReferenceDocument,
        excerpt: 'References an unavailable article.',
        section: 'Tests',
      },
    });
    const missingReferenceId = (
      missingReferenceDraft.json() as { data: { id: string } }
    ).data.id;
    const missingReferencePublication = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${missingReferenceId}/publish`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'if-match': String(missingReferenceDraft.headers.etag),
      },
    });
    expect(missingReferencePublication.statusCode).toBe(400);
    expect(missingReferencePublication.json()).toMatchObject({
      error: {
        code: 'POST_REFERENCE_UNAVAILABLE',
        details: {
          postIds: [missingPostId],
        },
      },
    });
  });

  it('publishes only finalized canonical media and records the snapshot references', async () => {
    const pool = new Pool({ connectionString: database.getConnectionUri(), max: 1 });
    const publicUrl = 'https://assets.example.test/owners/owner/media-publication.webp';
    const assetId = 'media-publication-asset';
    try {
      const owner = await pool.query<{ id: string }>('SELECT id FROM owners LIMIT 1');
      const ownerId = owner.rows[0]!.id;
      await pool.query(
        `INSERT INTO media_assets (
          id, owner_id, object_key, original_name, content_type, kind,
          byte_size, status, public_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'initiated', $8)`,
        [
          assetId,
          ownerId,
          `owners/${ownerId}/${assetId}.webp`,
          'media-publication.webp',
          'image/webp',
          'image',
          128,
          publicUrl,
        ],
      );

      const imageDocument = {
        root: {
          children: [
            {
              altText: 'A quiet editorial illustration',
              height: 720,
              src: publicUrl,
              type: 'image',
              version: 1,
              width: 1280,
            },
          ],
          direction: null,
          format: '',
          indent: 0,
          type: 'root',
          version: 1,
        },
      };
      const draft = await app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          title: 'Media publication',
          slug: 'media-publication',
          document: imageDocument,
          excerpt: 'Verifies finalized media publication.',
          section: 'Tests',
        },
      });
      expect(draft.statusCode).toBe(201);
      const postId = (draft.json() as { data: { id: string } }).data.id;

      const initiatedPublication = await app.inject({
        method: 'POST',
        url: `/api/v1/posts/${postId}/publish`,
        headers: {
          authorization: `Bearer ${accessToken}`,
          'if-match': String(draft.headers.etag),
        },
      });
      expect(initiatedPublication.statusCode).toBe(400);
      expect(initiatedPublication.json()).toMatchObject({
        error: {
          code: 'MEDIA_NOT_PUBLISHABLE',
          details: { publicUrls: [publicUrl] },
        },
      });

      await pool.query(
        `UPDATE media_assets
         SET status = 'ready', finalized_at = now()
         WHERE id = $1`,
        [assetId],
      );
      const published = await app.inject({
        method: 'POST',
        url: `/api/v1/posts/${postId}/publish`,
        headers: {
          authorization: `Bearer ${accessToken}`,
          'if-match': String(draft.headers.etag),
        },
      });
      expect(published.statusCode).toBe(200);

      const references = await pool.query<{
        post_id: string;
        asset_id: string;
      }>(
        `SELECT post_id, asset_id
         FROM post_media_references
         WHERE post_id = $1`,
        [postId],
      );
      expect(references.rows).toEqual([{ post_id: postId, asset_id: assetId }]);

      const missingAltDraft = await app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          title: 'Media without alt',
          slug: 'media-without-alt',
          document: {
            ...imageDocument,
            root: {
              ...imageDocument.root,
              children: [
                {
                  ...imageDocument.root.children[0],
                  altText: '',
                },
              ],
            },
          },
          excerpt: 'This publication must be rejected.',
          section: 'Tests',
        },
      });
      expect(missingAltDraft.statusCode).toBe(201);
      const missingAltPostId = (missingAltDraft.json() as { data: { id: string } }).data
        .id;
      const missingAltPublication = await app.inject({
        method: 'POST',
        url: `/api/v1/posts/${missingAltPostId}/publish`,
        headers: {
          authorization: `Bearer ${accessToken}`,
          'if-match': String(missingAltDraft.headers.etag),
        },
      });
      expect(missingAltPublication.statusCode).toBe(400);
      expect(missingAltPublication.json()).toMatchObject({
        error: { code: 'MEDIA_ALT_REQUIRED' },
      });
    } finally {
      await pool.end();
    }
  });

  it.each([
    [
      'unsafe link protocol',
      'unsafe-link-protocol',
      {
        children: [],
        direction: null,
        format: '',
        indent: 0,
        type: 'link',
        url: 'javascript:alert(1)',
        version: 1,
      },
      'link',
    ],
    [
      'mismatched embed source',
      'mismatched-embed-source',
      {
        source: 'youtube',
        type: 'embed',
        url: 'https://x.com/izumi/status/123',
        version: 1,
      },
      'embed',
    ],
  ])(
    'rejects %s at the publication boundary',
    async (_caseName, slug, node, nodeType) => {
      const document = {
        root: {
          children: [node],
          direction: null,
          format: '',
          indent: 0,
          type: 'root',
          version: 1,
        },
      };
      const draft = await app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          title: `Rejected ${slug}`,
          slug,
          document,
          excerpt: 'This URL-bearing node must not be published.',
          section: 'Tests',
        },
      });
      expect(draft.statusCode).toBe(201);
      const postId = (draft.json() as { data: { id: string } }).data.id;

      const publication = await app.inject({
        method: 'POST',
        url: `/api/v1/posts/${postId}/publish`,
        headers: {
          authorization: `Bearer ${accessToken}`,
          'if-match': String(draft.headers.etag),
        },
      });
      expect(publication.statusCode).toBe(400);
      expect(publication.json()).toMatchObject({
        error: {
          code: 'POST_DOCUMENT_UNPUBLISHABLE',
          details: {
            issues: [
              {
                path: 'root.children[0]',
                type: nodeType,
                reason: 'invalid',
              },
            ],
          },
        },
      });
    },
  );

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

  it('accepts a body-first draft when the title is omitted', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        document: {
          root: {
            children: [
              {
                children: [{ type: 'text', text: '先写正文', version: 1 }],
                type: 'paragraph',
                version: 1,
              },
            ],
            type: 'root',
            version: 1,
          },
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      data: { title: '', content: '先写正文', status: 'draft' },
    });
  });
});
