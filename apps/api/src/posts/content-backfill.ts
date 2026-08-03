import type { Pool } from 'pg';

import { importMarkdownToRichDocument, type RichDocument } from './rich-content.js';

export interface ContentBackfillResult {
  converted: number;
  failed: number;
}

interface BackfillOptions {
  batchSize?: number;
  convert?: (markdown: string) => RichDocument;
}

/**
 * Completes the SQL migration's lossless placeholder phase with a real
 * Markdown-to-Lexical import. It never updates `content`: compatibility
 * Markdown remains byte-for-byte intact even when conversion fails.
 *
 * Rows marked failed are retried on the next invocation. The id cursor keeps a
 * failed row from being retried forever during the same invocation.
 */
export async function runPostContentBackfill(
  pool: Pool,
  options: BackfillOptions = {},
): Promise<ContentBackfillResult> {
  const batchSize = options.batchSize ?? 100;
  const convert = options.convert ?? importMarkdownToRichDocument;
  const result: ContentBackfillResult = { converted: 0, failed: 0 };
  let cursor = '';

  for (;;) {
    const rows = await pool.query<{ id: string; content: string }>(
      `SELECT id, content
       FROM posts
       WHERE content_migration_state <> 'native' AND id > $1
       ORDER BY id
       LIMIT $2`,
      [cursor, batchSize],
    );
    if (rows.rowCount === 0) break;

    for (const row of rows.rows) {
      cursor = row.id;
      const client = await pool.connect();
      try {
        const document = convert(row.content);
        await client.query('BEGIN');
        await client.query(
          `UPDATE posts
           SET document = $2::jsonb, content_migration_state = 'native'
           WHERE id = $1 AND content_migration_state <> 'native'`,
          [row.id, JSON.stringify(document)],
        );
        await client.query(
          `UPDATE post_publications
           SET document = $2::jsonb
           WHERE post_id = $1`,
          [row.id, JSON.stringify(document)],
        );
        await client.query('COMMIT');
        result.converted += 1;
      } catch {
        await client.query('ROLLBACK').catch(() => undefined);
        await client.query(
          `UPDATE posts
           SET content_migration_state = 'failed'
           WHERE id = $1 AND content_migration_state <> 'native'`,
          [row.id],
        );
        result.failed += 1;
      } finally {
        client.release();
      }
    }
  }

  return result;
}
