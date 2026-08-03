import { randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';

import { ApiException } from '../common/api-exception.js';
import {
  DATABASE,
  type Database,
  type DatabaseTransaction,
} from '../database/database.module.js';
import { postPublications, posts } from '../database/schema.js';
import { extractMediaReferences } from '../media/media-references.js';
import { MediaService } from '../media/media.service.js';
import { calculateReadingMinutes } from './content-metrics.js';
import type {
  CreatePostDto,
  ForkWorkingCopyDto,
  PostContentMigrationState,
  PostDto,
  PostStatus,
  PublicPostDetailDto,
  PublicPostReferenceDto,
  PublicPostSummaryDto,
  UpdatePostDto,
} from './posts.dto.js';
import {
  assertRichDocument,
  createEmptyRichDocument,
  extractPostReferenceIds,
  inspectPublishableDocument,
  markdownToRichDocument,
  richDocumentToMarkdown,
  type RichDocument,
} from './rich-content.js';

type PostRecord = typeof posts.$inferSelect;
type PublicationRecord = typeof postPublications.$inferSelect;
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

function asRichDocument(value: Record<string, unknown>): RichDocument {
  assertRichDocument(value);
  return value;
}

function toPostDto(post: PostRecord): PostDto {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    content: post.content,
    document: asRichDocument(post.document),
    contentMigrationState: post.contentMigrationState as PostContentMigrationState,
    excerpt: post.excerpt,
    section: post.section,
    tags: post.tags,
    readingMinutes: post.readingMinutes,
    status: post.status as PostStatus,
    revision: post.revision,
    hasUnpublishedChanges: post.hasUnpublishedChanges,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

function toPublicPostSummary(publication: PublicationRecord): PublicPostSummaryDto {
  return {
    slug: publication.slug,
    title: publication.title,
    excerpt: publication.excerpt,
    publishedAt: publication.publishedAt.toISOString(),
    readingMinutes: publication.readingMinutes,
    section: publication.section,
    tags: publication.tags,
  };
}

function toPublicPostDetail(
  publication: PublicationRecord,
  references: PublicPostReferenceDto[],
): PublicPostDetailDto {
  return {
    ...toPublicPostSummary(publication),
    content: publication.content,
    document: asRichDocument(publication.document),
    references,
  };
}

function normalizeTags(tags: string[] | undefined): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const tag of tags ?? []) {
    const trimmed = tag.trim();
    if (!trimmed) {
      throw new ApiException(
        'POST_TAG_INVALID',
        'Tags must be non-empty strings after trimming',
        HttpStatus.BAD_REQUEST,
      );
    }

    const identity = trimmed.toLowerCase();
    if (!seen.has(identity)) {
      seen.add(identity);
      normalized.push(trimmed);
    }
  }

  return normalized;
}

function assertDocument(value: unknown): RichDocument {
  try {
    assertRichDocument(value);
    return value;
  } catch (error: unknown) {
    throw new ApiException(
      'POST_DOCUMENT_INVALID',
      error instanceof Error ? error.message : 'Invalid RichDocument',
      HttpStatus.BAD_REQUEST,
    );
  }
}

function resolveContent(
  input: { document?: RichDocument; content?: string },
  fallback?: { document: Record<string, unknown>; content: string },
): { document: RichDocument; content: string } {
  if (input.document !== undefined) {
    const document = assertDocument(input.document);
    return { document, content: richDocumentToMarkdown(document) };
  }

  if (input.content !== undefined) {
    const document = markdownToRichDocument(input.content);
    return { document, content: richDocumentToMarkdown(document) };
  }

  if (fallback) {
    return {
      document: asRichDocument(fallback.document),
      content: fallback.content,
    };
  }

  const document = createEmptyRichDocument();
  return { document, content: '' };
}

function assertPublishableFields(input: {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  section: string;
}): void {
  const fields = [
    ['title', input.title],
    ['slug', input.slug],
    ['content', input.content],
    ['excerpt', input.excerpt],
    ['section', input.section],
  ] as const;
  const missingFields = fields
    .filter(([, value]) => !value.trim())
    .map(([field]) => field);

  if (missingFields.length > 0) {
    throw new ApiException(
      'POST_PUBLISHING_INCOMPLETE',
      'Published posts require non-empty title, slug, content, excerpt, and section',
      HttpStatus.BAD_REQUEST,
      { fields: missingFields },
    );
  }
}

function hasContentUpdate(input: UpdatePostDto): boolean {
  return (
    input.title !== undefined ||
    input.slug !== undefined ||
    input.content !== undefined ||
    input.document !== undefined ||
    input.excerpt !== undefined ||
    input.section !== undefined ||
    input.tags !== undefined
  );
}

function hasUpdate(input: UpdatePostDto): boolean {
  return hasContentUpdate(input) || input.status !== undefined;
}

function preconditionFailed(currentRevision: number): ApiException {
  return new ApiException(
    'POST_REVISION_CONFLICT',
    'The post has changed since this working copy was loaded',
    HttpStatus.PRECONDITION_FAILED,
    {
      currentRevision,
      currentEtag: formatPostEtag(currentRevision),
    },
  );
}

export function formatPostEtag(revision: number): string {
  return `W/"${revision}"`;
}

@Injectable()
export class PostsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  async create(ownerId: string, input: CreatePostDto): Promise<PostDto> {
    const now = new Date();
    const id = randomUUID();
    const status = input.status ?? 'draft';
    const title = input.title?.trim() ?? '';
    const slug = input.slug ?? `draft-${id}`;
    const excerpt = input.excerpt?.trim() ?? '';
    const section = input.section?.trim() ?? '';
    const tags = normalizeTags(input.tags);
    const resolved = resolveContent(input);

    if (status === 'published') {
      assertPublishableFields({
        title,
        slug,
        content: resolved.content,
        excerpt,
        section,
      });
    }

    try {
      return await this.database.transaction(async (tx) => {
        const [post] = await tx
          .insert(posts)
          .values({
            id,
            ownerId,
            title,
            slug,
            content: resolved.content,
            document: resolved.document as unknown as Record<string, unknown>,
            contentMigrationState: 'native',
            excerpt,
            section,
            tags,
            readingMinutes: calculateReadingMinutes(resolved.content),
            revision: 1,
            hasUnpublishedChanges: status !== 'published',
            status,
            publishedAt: status === 'published' ? now : null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        if (!post) throw new Error('Post creation returned no row');
        if (status === 'published') {
          await this.validatePublication(tx, post);
          await this.insertPublication(tx, post, now);
        }
        return toPostDto(post);
      });
    } catch (error: unknown) {
      this.rethrowSlugConflict(error, slug);
    }
  }

  async list(input: {
    ownerId: string;
    page: number;
    size: number;
    status?: PostStatus;
    q?: string;
  }): Promise<{ items: PostDto[]; page: number; size: number; total: number }> {
    const conditions = [eq(posts.ownerId, input.ownerId)];
    if (input.status) conditions.push(eq(posts.status, input.status));
    const query = input.q?.trim();
    if (query) {
      const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(sql<boolean>`concat_ws(
        ' ',
        ${posts.title},
        ${posts.slug},
        ${posts.excerpt},
        ${posts.section},
        array_to_string(${posts.tags}, ' ')
      ) ILIKE ${pattern}`);
    }
    const where = and(...conditions);
    const offset = (input.page - 1) * input.size;

    const [rows, totalRows] = await Promise.all([
      this.database
        .select()
        .from(posts)
        .where(where)
        .orderBy(desc(posts.createdAt))
        .limit(input.size)
        .offset(offset),
      this.database.select({ value: count() }).from(posts).where(where),
    ]);

    return {
      items: rows.map(toPostDto),
      page: input.page,
      size: input.size,
      total: Number(totalRows[0]?.value ?? 0),
    };
  }

  async findForOwner(ownerId: string, id: string): Promise<PostDto> {
    return toPostDto(await this.findRecordForOwner(ownerId, id));
  }

  async update(
    ownerId: string,
    id: string,
    input: UpdatePostDto,
    expectedRevision: number,
  ): Promise<PostDto> {
    if (!hasUpdate(input)) {
      throw new ApiException(
        'POST_UPDATE_EMPTY',
        'Provide at least one post field to update',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      return await this.database.transaction(async (tx) => {
        const existing = await this.findRecordForOwnerInTransaction(tx, ownerId, id);
        if (existing.revision !== expectedRevision) {
          throw preconditionFailed(existing.revision);
        }

        const now = new Date();
        const title = input.title === undefined ? existing.title : input.title.trim();
        const slug = input.slug ?? existing.slug;
        const resolved = resolveContent(input, existing);
        const excerpt =
          input.excerpt === undefined ? existing.excerpt : input.excerpt.trim();
        const section =
          input.section === undefined ? existing.section : input.section.trim();
        const tags =
          input.tags === undefined ? existing.tags : normalizeTags(input.tags);
        const requestedStatus = input.status ?? (existing.status as PostStatus);
        const nextRevision = existing.revision + 1;
        const contentChanged = hasContentUpdate(input);

        const [updated] = await tx
          .update(posts)
          .set({
            title,
            slug,
            content: resolved.content,
            document: resolved.document as unknown as Record<string, unknown>,
            contentMigrationState:
              input.content !== undefined || input.document !== undefined
                ? 'native'
                : existing.contentMigrationState,
            excerpt,
            section,
            tags,
            revision: nextRevision,
            hasUnpublishedChanges: contentChanged
              ? true
              : existing.hasUnpublishedChanges,
            readingMinutes:
              input.content === undefined && input.document === undefined
                ? existing.readingMinutes
                : calculateReadingMinutes(resolved.content),
            updatedAt: now,
          })
          .where(
            and(
              eq(posts.id, id),
              eq(posts.ownerId, ownerId),
              eq(posts.revision, expectedRevision),
            ),
          )
          .returning();

        if (!updated) {
          const current = await this.findRecordForOwnerInTransaction(tx, ownerId, id);
          throw preconditionFailed(current.revision);
        }

        if (input.status === undefined) return toPostDto(updated);

        if (requestedStatus === 'published') {
          return toPostDto(await this.publishRecord(tx, updated, now, false));
        }

        return toPostDto(
          await this.unpublishRecord(tx, updated, contentChanged, now, false),
        );
      });
    } catch (error: unknown) {
      this.rethrowSlugConflict(error, input.slug);
    }
  }

  async publish(
    ownerId: string,
    id: string,
    expectedRevision: number,
  ): Promise<PostDto> {
    try {
      return await this.database.transaction(async (tx) => {
        const existing = await this.findRecordForOwnerInTransaction(tx, ownerId, id);
        if (existing.revision !== expectedRevision) {
          throw preconditionFailed(existing.revision);
        }
        return toPostDto(await this.publishRecord(tx, existing, new Date()));
      });
    } catch (error: unknown) {
      this.rethrowSlugConflict(error);
    }
  }

  async unpublish(
    ownerId: string,
    id: string,
    expectedRevision: number,
  ): Promise<PostDto> {
    return this.database.transaction(async (tx) => {
      const existing = await this.findRecordForOwnerInTransaction(tx, ownerId, id);
      if (existing.revision !== expectedRevision) {
        throw preconditionFailed(existing.revision);
      }
      if (existing.status === 'draft') return toPostDto(existing);
      return toPostDto(await this.unpublishRecord(tx, existing, false, new Date()));
    });
  }

  async discardWorkingCopy(
    ownerId: string,
    id: string,
    expectedRevision: number,
  ): Promise<PostDto> {
    return this.database.transaction(async (tx) => {
      const existing = await this.findRecordForOwnerInTransaction(tx, ownerId, id);
      if (existing.revision !== expectedRevision) {
        throw preconditionFailed(existing.revision);
      }

      const [publication] = await tx
        .select()
        .from(postPublications)
        .where(eq(postPublications.postId, id))
        .orderBy(desc(postPublications.createdAt), desc(postPublications.id))
        .limit(1);

      if (!publication) {
        throw new ApiException(
          'POST_PUBLICATION_MISSING',
          'The post has no published snapshot to restore',
          HttpStatus.CONFLICT,
        );
      }

      const [restored] = await tx
        .update(posts)
        .set({
          title: publication.title,
          slug: publication.slug,
          content: publication.content,
          document: publication.document,
          contentMigrationState: 'native',
          excerpt: publication.excerpt,
          section: publication.section,
          tags: publication.tags,
          readingMinutes: publication.readingMinutes,
          revision: existing.revision + 1,
          hasUnpublishedChanges: false,
          status: publication.isLive ? 'published' : 'draft',
          publishedAt: publication.publishedAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(posts.id, id),
            eq(posts.ownerId, ownerId),
            eq(posts.revision, expectedRevision),
          ),
        )
        .returning();

      if (!restored) {
        const current = await this.findRecordForOwnerInTransaction(tx, ownerId, id);
        throw preconditionFailed(current.revision);
      }
      return toPostDto(restored);
    });
  }

  async forkWorkingCopy(
    ownerId: string,
    id: string,
    input: ForkWorkingCopyDto,
  ): Promise<PostDto> {
    const source = await this.findRecordForOwner(ownerId, id);
    const forkId = randomUUID();
    const now = new Date();
    const title = input.title === undefined ? source.title : input.title.trim();
    const slug = input.slug ?? `${source.slug}-copy-${forkId.slice(0, 8)}`;
    const resolved = resolveContent(input, source);

    try {
      const [forked] = await this.database
        .insert(posts)
        .values({
          id: forkId,
          ownerId,
          title,
          slug,
          content: resolved.content,
          document: resolved.document as unknown as Record<string, unknown>,
          contentMigrationState: 'native',
          excerpt: input.excerpt === undefined ? source.excerpt : input.excerpt.trim(),
          section: input.section === undefined ? source.section : input.section.trim(),
          tags: input.tags === undefined ? source.tags : normalizeTags(input.tags),
          readingMinutes: calculateReadingMinutes(resolved.content),
          revision: 1,
          hasUnpublishedChanges: true,
          status: 'draft',
          publishedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!forked) throw new Error('Post fork returned no row');
      return toPostDto(forked);
    } catch (error: unknown) {
      this.rethrowSlugConflict(error, slug);
    }
  }

  async listPublished(limit?: number): Promise<PublicPostSummaryDto[]> {
    const query = this.database
      .select()
      .from(postPublications)
      .where(eq(postPublications.isLive, true))
      .orderBy(
        desc(postPublications.publishedAt),
        desc(postPublications.createdAt),
        desc(postPublications.id),
      );
    const rows = limit === undefined ? await query : await query.limit(limit);

    return rows.map(toPublicPostSummary);
  }

  async findPublishedBySlug(slug: string): Promise<PublicPostDetailDto> {
    const [publication] = await this.database
      .select()
      .from(postPublications)
      .where(and(eq(postPublications.isLive, true), eq(postPublications.slug, slug)))
      .limit(1);

    if (!publication) {
      throw new ApiException(
        'PUBLIC_POST_NOT_FOUND',
        'Published post not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const references = await this.resolveLiveReferences(
      extractPostReferenceIds(asRichDocument(publication.document)),
    );
    return toPublicPostDetail(publication, references);
  }

  async resolveLiveReferences(
    referenceIds: string[],
  ): Promise<PublicPostReferenceDto[]> {
    if (referenceIds.length === 0) return [];

    const uniqueIds = [...new Set(referenceIds)];
    const rows = await this.database
      .select({
        postId: postPublications.postId,
        slug: postPublications.slug,
        title: postPublications.title,
      })
      .from(postPublications)
      .where(
        and(
          eq(postPublications.isLive, true),
          inArray(postPublications.postId, uniqueIds),
        ),
      );
    const byId = new Map(rows.map((row) => [row.postId, row]));
    return uniqueIds.flatMap((id) => {
      const reference = byId.get(id);
      return reference ? [reference] : [];
    });
  }

  private async publishRecord(
    tx: DatabaseTransaction,
    existing: PostRecord,
    now: Date,
    incrementRevision = true,
  ): Promise<PostRecord> {
    const mediaAssetIds = await this.validatePublication(tx, existing);

    await tx
      .update(postPublications)
      .set({ isLive: false })
      .where(
        and(
          eq(postPublications.postId, existing.id),
          eq(postPublications.isLive, true),
        ),
      );

    await this.insertPublication(tx, existing, now);

    const [published] = await tx
      .update(posts)
      .set({
        status: 'published',
        publishedAt: existing.publishedAt ?? now,
        revision: incrementRevision ? existing.revision + 1 : existing.revision,
        hasUnpublishedChanges: false,
        updatedAt: now,
      })
      .where(
        and(
          eq(posts.id, existing.id),
          eq(posts.ownerId, existing.ownerId),
          eq(posts.revision, existing.revision),
        ),
      )
      .returning();

    if (!published) {
      const current = await this.findRecordForOwnerInTransaction(
        tx,
        existing.ownerId,
        existing.id,
      );
      throw preconditionFailed(current.revision);
    }
    await this.media.replacePostReferencesInTransaction(tx, existing.id, mediaAssetIds);
    return published;
  }

  private async unpublishRecord(
    tx: DatabaseTransaction,
    existing: PostRecord,
    contentChanged: boolean,
    now: Date,
    incrementRevision = true,
  ): Promise<PostRecord> {
    await tx
      .update(postPublications)
      .set({ isLive: false })
      .where(
        and(
          eq(postPublications.postId, existing.id),
          eq(postPublications.isLive, true),
        ),
      );

    const [unpublished] = await tx
      .update(posts)
      .set({
        status: 'draft',
        revision: incrementRevision ? existing.revision + 1 : existing.revision,
        hasUnpublishedChanges: contentChanged,
        updatedAt: now,
      })
      .where(
        and(
          eq(posts.id, existing.id),
          eq(posts.ownerId, existing.ownerId),
          eq(posts.revision, existing.revision),
        ),
      )
      .returning();

    if (!unpublished) {
      const current = await this.findRecordForOwnerInTransaction(
        tx,
        existing.ownerId,
        existing.id,
      );
      throw preconditionFailed(current.revision);
    }
    return unpublished;
  }

  private async validatePublication(
    tx: DatabaseTransaction,
    post: PostRecord,
  ): Promise<string[]> {
    const document = asRichDocument(post.document);
    const issues = inspectPublishableDocument(document);
    if (issues.length > 0) {
      throw new ApiException(
        'POST_DOCUMENT_UNPUBLISHABLE',
        'The post contains prohibited or unsupported rich-content nodes',
        HttpStatus.BAD_REQUEST,
        { issues },
      );
    }
    assertPublishableFields(post);

    const mediaReferences = extractMediaReferences(document);
    const missingAlt = mediaReferences.filter(
      (reference) =>
        (reference.nodeType === 'image' || reference.nodeType === 'gallery') &&
        !reference.alt,
    );
    if (missingAlt.length > 0) {
      throw new ApiException(
        'MEDIA_ALT_REQUIRED',
        'Published images require meaningful alternative text',
        HttpStatus.BAD_REQUEST,
        {
          publicUrls: [...new Set(missingAlt.map(({ publicUrl }) => publicUrl))],
        },
      );
    }
    const mediaAssetIds = await this.media.assertPublishableReferences(
      post.ownerId,
      mediaReferences,
      tx,
    );

    const referenceIds = extractPostReferenceIds(document);
    if (referenceIds.includes(post.id)) {
      throw new ApiException(
        'POST_REFERENCE_INVALID',
        'A post cannot reference itself',
        HttpStatus.BAD_REQUEST,
        { postId: post.id },
      );
    }
    if (referenceIds.length === 0) return mediaAssetIds;

    const liveReferences = await tx
      .select({ postId: postPublications.postId })
      .from(postPublications)
      .where(
        and(
          eq(postPublications.isLive, true),
          inArray(postPublications.postId, referenceIds),
        ),
      );
    const liveIds = new Set(liveReferences.map((reference) => reference.postId));
    const unavailablePostIds = referenceIds.filter((id) => !liveIds.has(id));
    if (unavailablePostIds.length > 0) {
      throw new ApiException(
        'POST_REFERENCE_UNAVAILABLE',
        'Every referenced post must have a live publication',
        HttpStatus.BAD_REQUEST,
        { postIds: unavailablePostIds },
      );
    }
    return mediaAssetIds;
  }

  private async insertPublication(
    tx: DatabaseTransaction,
    post: PostRecord,
    now: Date,
  ): Promise<void> {
    await tx.insert(postPublications).values({
      id: randomUUID(),
      postId: post.id,
      sourceRevision: post.revision,
      title: post.title,
      slug: post.slug,
      content: post.content,
      document: post.document,
      excerpt: post.excerpt,
      section: post.section,
      tags: post.tags,
      readingMinutes: post.readingMinutes,
      publishedAt: post.publishedAt ?? now,
      isLive: true,
      createdAt: now,
    });
  }

  private async findRecordForOwner(ownerId: string, id: string): Promise<PostRecord> {
    const [post] = await this.database
      .select()
      .from(posts)
      .where(and(eq(posts.id, id), eq(posts.ownerId, ownerId)))
      .limit(1);

    if (!post) {
      throw new ApiException('POST_NOT_FOUND', 'Post not found', HttpStatus.NOT_FOUND);
    }
    return post;
  }

  private async findRecordForOwnerInTransaction(
    tx: DatabaseTransaction,
    ownerId: string,
    id: string,
  ): Promise<PostRecord> {
    const [post] = await tx
      .select()
      .from(posts)
      .where(and(eq(posts.id, id), eq(posts.ownerId, ownerId)))
      .limit(1);

    if (!post) {
      throw new ApiException('POST_NOT_FOUND', 'Post not found', HttpStatus.NOT_FOUND);
    }
    return post;
  }

  private rethrowSlugConflict(error: unknown, slug?: string): never {
    if (isUniqueViolation(error)) {
      throw new ApiException(
        'POST_SLUG_CONFLICT',
        'A post already uses this slug',
        HttpStatus.CONFLICT,
        slug ? { slug } : undefined,
      );
    }
    throw error;
  }
}
