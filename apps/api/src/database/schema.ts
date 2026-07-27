import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const postStatusValues = ['draft', 'published'] as const;
export const postStatus = pgEnum('post_status', postStatusValues);
export const profileLinkKindValues = ['github', 'x'] as const;
export const profileLinkKind = pgEnum('profile_link_kind', profileLinkKindValues);

export const owners = pgTable(
  'owners',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
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
    uniqueIndex('owners_email_unique').on(table.email),
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
    excerpt: text('excerpt').notNull().default(''),
    section: text('section').notNull().default(''),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    readingMinutes: integer('reading_minutes').notNull().default(1),
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
    check(
      'posts_published_fields_present',
      sql`${table.status} <> 'published' OR (
        btrim(${table.title}) <> '' AND
        btrim(${table.slug}) <> '' AND
        btrim(${table.content}) <> '' AND
        btrim(${table.excerpt}) <> '' AND
        btrim(${table.section}) <> '' AND
        ${table.publishedAt} IS NOT NULL
      )`,
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
