import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const postStatusValues = ['draft', 'published'] as const;
export const postStatus = pgEnum('post_status', postStatusValues);
export const postContentMigrationStateValues = ['native', 'pending', 'failed'] as const;
export const postContentMigrationState = pgEnum(
  'post_content_migration_state',
  postContentMigrationStateValues,
);
export const profileLinkKindValues = ['github', 'x'] as const;
export const profileLinkKind = pgEnum('profile_link_kind', profileLinkKindValues);

export const owners = pgTable(
  'owners',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    singletonSlot: integer('singleton_slot').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('owners_username_unique').on(table.username),
    uniqueIndex('owners_singleton_unique').on(table.singletonSlot),
  ],
);

export const posts = pgTable(
  'posts',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    content: text('content').notNull(),
    document: jsonb('document').$type<Record<string, unknown>>().notNull(),
    contentMigrationState: postContentMigrationState('content_migration_state')
      .notNull()
      .default('native'),
    excerpt: text('excerpt').notNull().default(''),
    section: text('section').notNull().default(''),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    readingMinutes: integer('reading_minutes').notNull().default(1),
    revision: integer('revision').notNull().default(1),
    hasUnpublishedChanges: boolean('has_unpublished_changes').notNull().default(true),
    status: postStatus('status').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('posts_slug_unique').on(table.slug),
    index('posts_owner_created_at_index').on(table.ownerId, table.createdAt),
    index('posts_public_order_index').on(
      table.status,
      table.publishedAt,
      table.createdAt,
      table.id,
    ),
    check('posts_reading_minutes_positive', sql`${table.readingMinutes} >= 1`),
    check('posts_revision_positive', sql`${table.revision} >= 1`),
  ],
);

export const postPublications = pgTable(
  'post_publications',
  {
    id: text('id').primaryKey(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    sourceRevision: integer('source_revision').notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    content: text('content').notNull(),
    document: jsonb('document').$type<Record<string, unknown>>().notNull(),
    excerpt: text('excerpt').notNull(),
    section: text('section').notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    readingMinutes: integer('reading_minutes').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    isLive: boolean('is_live').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('post_publications_one_live_per_post_unique')
      .on(table.postId)
      .where(sql`${table.isLive} = true`),
    uniqueIndex('post_publications_live_slug_unique')
      .on(table.slug)
      .where(sql`${table.isLive} = true`),
    index('post_publications_public_order_index').on(
      table.isLive,
      table.publishedAt,
      table.createdAt,
      table.id,
    ),
    index('post_publications_post_history_index').on(table.postId, table.createdAt),
    check(
      'post_publications_source_revision_positive',
      sql`${table.sourceRevision} >= 1`,
    ),
    check(
      'post_publications_fields_present',
      sql`btrim(${table.title}) <> '' AND
        btrim(${table.slug}) <> '' AND
        btrim(${table.content}) <> '' AND
        btrim(${table.excerpt}) <> '' AND
        btrim(${table.section}) <> ''`,
    ),
    check(
      'post_publications_reading_minutes_positive',
      sql`${table.readingMinutes} >= 1`,
    ),
  ],
);

export const profiles = pgTable(
  'profiles',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'restrict' }),
    singletonSlot: integer('singleton_slot').notNull().default(1),
    displayName: text('display_name').notNull(),
    headline: text('headline').notNull(),
    bio: text('bio').notNull(),
    avatarUrl: text('avatar_url').notNull(),
    avatarAlt: text('avatar_alt').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('profiles_singleton_unique').on(table.singletonSlot),
    check(
      'profiles_fields_present',
      sql`btrim(${table.displayName}) <> '' AND
        btrim(${table.headline}) <> '' AND
        btrim(${table.bio}) <> '' AND
        btrim(${table.avatarUrl}) <> '' AND
        btrim(${table.avatarAlt}) <> ''`,
    ),
  ],
);

export const profileLinks = pgTable(
  'profile_links',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    kind: profileLinkKind('kind').notNull(),
    url: text('url').notNull(),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.kind] })],
);
