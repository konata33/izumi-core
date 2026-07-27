import { randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm';

import { ApiException } from '../common/api-exception.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { posts } from '../database/schema.js';
import { calculateReadingMinutes } from './content-metrics.js';
import type {
  CreatePostDto,
  PostDto,
  PostStatus,
  PublicPostDetailDto,
  PublicPostSummaryDto,
  UpdatePostDto,
} from './posts.dto.js';

type PostRecord = typeof posts.$inferSelect;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

function toPostDto(post: PostRecord): PostDto {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    content: post.content,
    excerpt: post.excerpt,
    section: post.section,
    tags: post.tags,
    readingMinutes: post.readingMinutes,
    status: post.status as PostStatus,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

function toPublicPostSummary(post: PostRecord): PublicPostSummaryDto {
  if (!post.publishedAt) {
    throw new Error(`Published post ${post.id} has no publication timestamp`);
  }

  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    publishedAt: post.publishedAt.toISOString(),
    readingMinutes: post.readingMinutes,
    section: post.section,
    tags: post.tags,
  };
}

function toPublicPostDetail(post: PostRecord): PublicPostDetailDto {
  return {
    ...toPublicPostSummary(post),
    content: post.content,
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

function requireNonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ApiException(
      'POST_FIELD_INVALID',
      `${field} must contain non-whitespace text`,
      HttpStatus.BAD_REQUEST,
      { field },
    );
  }
  return trimmed;
}

function assertPublishablePost(input: {
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

function hasUpdate(input: UpdatePostDto): boolean {
  return (
    input.title !== undefined ||
    input.slug !== undefined ||
    input.content !== undefined ||
    input.excerpt !== undefined ||
    input.section !== undefined ||
    input.tags !== undefined ||
    input.status !== undefined
  );
}

function isCompletePublicPost() {
  return and(
    eq(posts.status, 'published'),
    isNotNull(posts.publishedAt),
    sql`btrim(${posts.title}) <> ''`,
    sql`btrim(${posts.slug}) <> ''`,
    sql`btrim(${posts.content}) <> ''`,
    sql`btrim(${posts.excerpt}) <> ''`,
    sql`btrim(${posts.section}) <> ''`,
  );
}

@Injectable()
export class PostsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async create(ownerId: string, input: CreatePostDto): Promise<PostDto> {
    const now = new Date();
    const status = input.status ?? 'draft';
    const title = requireNonBlank(input.title, 'title');
    const content = requireNonBlank(input.content, 'content');
    const excerpt = input.excerpt?.trim() ?? '';
    const section = input.section?.trim() ?? '';
    const tags = normalizeTags(input.tags);

    if (status === 'published')
      assertPublishablePost({ title, slug: input.slug, content, excerpt, section });

    try {
      const [post] = await this.database
        .insert(posts)
        .values({
          id: randomUUID(),
          ownerId,
          title,
          slug: input.slug,
          content,
          excerpt,
          section,
          tags,
          readingMinutes: calculateReadingMinutes(content),
          status,
          publishedAt: status === 'published' ? now : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!post) throw new Error('Post creation returned no row');
      return toPostDto(post);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ApiException(
          'POST_SLUG_CONFLICT',
          'A post already uses this slug',
          HttpStatus.CONFLICT,
          { slug: input.slug },
        );
      }
      throw error;
    }
  }

  async list(input: {
    ownerId: string;
    page: number;
    size: number;
    status?: PostStatus;
  }): Promise<{ items: PostDto[]; page: number; size: number; total: number }> {
    const conditions = [eq(posts.ownerId, input.ownerId)];
    if (input.status) conditions.push(eq(posts.status, input.status));
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

  async update(ownerId: string, id: string, input: UpdatePostDto): Promise<PostDto> {
    if (!hasUpdate(input)) {
      throw new ApiException(
        'POST_UPDATE_EMPTY',
        'Provide at least one post field to update',
        HttpStatus.BAD_REQUEST,
      );
    }

    const existing = await this.findRecordForOwner(ownerId, id);
    const now = new Date();
    const title =
      input.title === undefined
        ? existing.title
        : requireNonBlank(input.title, 'title');
    const slug = input.slug ?? existing.slug;
    const content =
      input.content === undefined
        ? existing.content
        : requireNonBlank(input.content, 'content');
    const excerpt =
      input.excerpt === undefined ? existing.excerpt : input.excerpt.trim();
    const section =
      input.section === undefined ? existing.section : input.section.trim();
    const tags = input.tags === undefined ? existing.tags : normalizeTags(input.tags);
    const status = input.status ?? (existing.status as PostStatus);

    if (status === 'published') {
      assertPublishablePost({ title, slug, content, excerpt, section });
    }

    try {
      const [updated] = await this.database
        .update(posts)
        .set({
          title,
          slug,
          content,
          excerpt,
          section,
          tags,
          status,
          publishedAt:
            status === 'published'
              ? (existing.publishedAt ?? now)
              : existing.publishedAt,
          readingMinutes:
            input.content === undefined
              ? existing.readingMinutes
              : calculateReadingMinutes(content),
          updatedAt: now,
        })
        .where(and(eq(posts.id, id), eq(posts.ownerId, ownerId)))
        .returning();

      if (!updated) {
        throw new ApiException(
          'POST_NOT_FOUND',
          'Post not found',
          HttpStatus.NOT_FOUND,
        );
      }
      return toPostDto(updated);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ApiException(
          'POST_SLUG_CONFLICT',
          'A post already uses this slug',
          HttpStatus.CONFLICT,
          { slug },
        );
      }
      throw error;
    }
  }

  async listPublished(limit?: number): Promise<PublicPostSummaryDto[]> {
    const query = this.database
      .select()
      .from(posts)
      .where(isCompletePublicPost())
      .orderBy(desc(posts.publishedAt), desc(posts.createdAt), desc(posts.id));
    const rows = limit === undefined ? await query : await query.limit(limit);

    return rows.map(toPublicPostSummary);
  }

  async findPublishedBySlug(slug: string): Promise<PublicPostDetailDto> {
    const [post] = await this.database
      .select()
      .from(posts)
      .where(and(isCompletePublicPost(), eq(posts.slug, slug)))
      .limit(1);

    if (!post) {
      throw new ApiException(
        'PUBLIC_POST_NOT_FOUND',
        'Published post not found',
        HttpStatus.NOT_FOUND,
      );
    }

    return toPublicPostDetail(post);
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
}
