import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { owners, posts } from '../database/schema.js';

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull().unique(),
    originalName: text('original_name').notNull(),
    contentType: text('content_type').notNull(),
    kind: text('kind').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    status: text('status').notNull().default('initiated'),
    publicUrl: text('public_url').notNull().unique(),
    width: integer('width'),
    height: integer('height'),
    thumbhash: text('thumbhash'),
    alt: text('alt'),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('media_assets_owner_created_index').on(table.ownerId, table.createdAt),
    index('media_assets_orphan_index').on(table.status, table.createdAt),
    check('media_assets_status_check', sql`${table.status} IN ('initiated', 'ready')`),
    check('media_assets_kind_check', sql`${table.kind} IN ('image', 'video')`),
    check('media_assets_byte_size_positive', sql`${table.byteSize} > 0`),
  ],
);

export const postMediaReferences = pgTable(
  'post_media_references',
  {
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'restrict' }),
  },
  (table) => [primaryKey({ columns: [table.postId, table.assetId] })],
);
