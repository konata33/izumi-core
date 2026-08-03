import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { owners, posts } from '../database/schema.js';

export const aiProviderTypeValues = ['claude', 'openai-compatible'] as const;
export const aiProviderType = pgEnum('ai_provider_type', aiProviderTypeValues);
export const aiMessageRoleValues = ['user', 'assistant'] as const;
export const aiMessageRole = pgEnum('ai_message_role', aiMessageRoleValues);
export const aiMessageStatusValues = ['complete', 'failed', 'cancelled'] as const;
export const aiMessageStatus = pgEnum('ai_message_status', aiMessageStatusValues);
export const aiToolDecisionValues = ['pending', 'accepted', 'rejected'] as const;
export const aiToolDecision = pgEnum('ai_tool_decision', aiToolDecisionValues);

export const aiProviderProfiles = pgTable(
  'ai_provider_profiles',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    providerType: aiProviderType('provider_type').notNull(),
    baseUrl: text('base_url').notNull(),
    model: text('model').notNull(),
    encryptedApiKey: text('encrypted_api_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('ai_provider_profiles_owner_name_unique').on(table.ownerId, table.name),
  ],
);

export const aiSessions = pgTable(
  'ai_sessions',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'cascade' }),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    providerProfileId: text('provider_profile_id').references(
      () => aiProviderProfiles.id,
      { onDelete: 'set null' },
    ),
    activeRunId: text('active_run_id'),
    activeRunStartedAt: timestamp('active_run_started_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('ai_sessions_post_updated_index').on(table.postId, table.updatedAt),
    check(
      'ai_sessions_active_run_pair_check',
      sql`(${table.activeRunId} IS NULL) = (${table.activeRunStartedAt} IS NULL)`,
    ),
  ],
);

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => aiSessions.id, { onDelete: 'cascade' }),
    runId: text('run_id'),
    role: aiMessageRole('role').notNull(),
    content: text('content').notNull(),
    status: aiMessageStatus('status').notNull().default('complete'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('ai_messages_session_created_index').on(table.sessionId, table.createdAt),
  ],
);

export const aiToolDecisions = pgTable(
  'ai_tool_decisions',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => aiSessions.id, { onDelete: 'cascade' }),
    runId: text('run_id').notNull(),
    toolCallId: text('tool_call_id').notNull(),
    toolName: text('tool_name').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    decision: aiToolDecision('decision').notNull().default('pending'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('ai_tool_decisions_session_call_unique').on(
      table.sessionId,
      table.toolCallId,
    ),
  ],
);
