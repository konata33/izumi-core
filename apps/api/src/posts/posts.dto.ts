import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import type { RichDocument } from './rich-content.js';

export enum PostStatus {
  Draft = 'draft',
  Published = 'published',
}

export enum PostContentMigrationState {
  Native = 'native',
  Pending = 'pending',
  Failed = 'failed',
}

export class CreatePostDto {
  @ApiPropertyOptional({
    type: String,
    example: 'A first post',
    description: 'May be omitted for a newly-created draft shell.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  title?: string;

  @ApiPropertyOptional({
    type: String,
    example: 'a-first-post',
    description: 'Generated for a draft when omitted.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug?: string;

  @ApiPropertyOptional({
    type: String,
    example: 'Compatibility Markdown for legacy clients.',
    description:
      'Imported into a RichDocument when document is omitted. When document is supplied, the server derives this field.',
  })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({
    type: Object,
    additionalProperties: true,
    description: 'Canonical serialized Lexical editor state.',
  })
  @IsOptional()
  @IsObject()
  document?: RichDocument;

  @ApiPropertyOptional({
    type: String,
    example: 'A short editorial introduction.',
    description: 'Required and non-empty when creating a published post.',
  })
  @IsOptional()
  @IsString()
  excerpt?: string;

  @ApiPropertyOptional({
    type: String,
    example: 'Notes',
    description: 'Required and non-empty when creating a published post.',
  })
  @IsOptional()
  @IsString()
  section?: string;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    example: ['writing', 'website'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    enum: PostStatus,
    default: PostStatus.Draft,
    required: false,
  })
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;
}

export class UpdatePostDto {
  @ApiPropertyOptional({ type: String, example: 'A revised title' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  title?: string;

  @ApiPropertyOptional({ type: String, example: 'a-revised-slug' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug?: string;

  @ApiPropertyOptional({ type: String, example: 'Updated canonical Markdown.' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({
    type: Object,
    additionalProperties: true,
    description:
      'Canonical serialized Lexical editor state. The server derives compatibility Markdown from it.',
  })
  @IsOptional()
  @IsObject()
  document?: RichDocument;

  @ApiPropertyOptional({
    type: String,
    description: 'May be empty on a draft; must be non-empty when publishing.',
  })
  @IsOptional()
  @IsString()
  excerpt?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'May be empty on a draft; must be non-empty when publishing.',
  })
  @IsOptional()
  @IsString()
  section?: string;

  @ApiPropertyOptional({ type: String, isArray: true, example: ['writing', 'website'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ enum: PostStatus })
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;
}

export class ListPostsQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size = 20;

  @ApiPropertyOptional({ enum: PostStatus })
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;

  @ApiPropertyOptional({ type: String, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}

export class PostDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  title!: string;

  @ApiProperty({ type: String })
  slug!: string;

  @ApiProperty({ type: String })
  content!: string;

  @ApiProperty({
    type: Object,
    additionalProperties: true,
    description: 'Canonical serialized Lexical editor state.',
  })
  document!: RichDocument;

  @ApiProperty({ enum: PostContentMigrationState })
  contentMigrationState!: PostContentMigrationState;

  @ApiProperty({ type: String })
  excerpt!: string;

  @ApiProperty({ type: String })
  section!: string;

  @ApiProperty({ type: String, isArray: true })
  tags!: string[];

  @ApiProperty({ type: Number, minimum: 1 })
  readingMinutes!: number;

  @ApiProperty({ enum: PostStatus })
  status!: PostStatus;

  @ApiProperty({ type: Number, minimum: 1 })
  revision!: number;

  @ApiProperty({ type: Boolean })
  hasUnpublishedChanges!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  publishedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class PostResponseDto {
  @ApiProperty({ type: () => PostDto })
  data!: PostDto;
}

export class PostListDataDto {
  @ApiProperty({ type: () => PostDto, isArray: true })
  items!: PostDto[];

  @ApiProperty({ type: Number, minimum: 1 })
  page!: number;

  @ApiProperty({ type: Number, minimum: 1 })
  size!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  total!: number;
}

export class PostListResponseDto {
  @ApiProperty({ type: () => PostListDataDto })
  data!: PostListDataDto;
}

export class PublicPostsQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PublicPostSummaryDto {
  @ApiProperty({ type: String, example: 'make-room-for-a-slower-entry' })
  slug!: string;

  @ApiProperty({ type: String, example: '为一座个人网站留出缓慢的入口' })
  title!: string;

  @ApiProperty({ type: String, example: '首页不必像一条不断催促的时间线。' })
  excerpt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-07-20T04:00:00.000Z',
  })
  publishedAt!: string;

  @ApiProperty({ type: Number, minimum: 1, example: 4 })
  readingMinutes!: number;

  @ApiProperty({ type: String, example: '思考' })
  section!: string;

  @ApiProperty({ type: String, isArray: true, example: ['网站', '写作'] })
  tags!: string[];
}

export class PublicPostDetailDto extends PublicPostSummaryDto {
  @ApiProperty({
    type: String,
    example: '## 先让内容找到位置\n\n正文以 Markdown 保存。',
    description: 'Compatibility Markdown derived from the RichDocument.',
  })
  content!: string;

  @ApiProperty({
    type: Object,
    additionalProperties: true,
    description: 'Canonical serialized Lexical editor state.',
  })
  document!: RichDocument;

  @ApiProperty({ type: () => PublicPostReferenceDto, isArray: true })
  references!: PublicPostReferenceDto[];
}

export class PublicPostReferenceDto {
  @ApiProperty({ type: String, format: 'uuid' })
  postId!: string;

  @ApiProperty({ type: String })
  slug!: string;

  @ApiProperty({ type: String })
  title!: string;
}

export class ResolvePostReferencesDto {
  @ApiProperty({ type: String, isArray: true, maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(64, { each: true })
  postIds!: string[];
}

export class PostReferencesResponseDto {
  @ApiProperty({ type: () => PublicPostReferenceDto, isArray: true })
  data!: PublicPostReferenceDto[];
}

export class ForkWorkingCopyDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ type: Object, additionalProperties: true })
  @IsOptional()
  @IsObject()
  document?: RichDocument;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  excerpt?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  section?: string;

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class PublicPostListResponseDto {
  @ApiProperty({ type: () => PublicPostSummaryDto, isArray: true })
  data!: PublicPostSummaryDto[];
}

export class PublicPostResponseDto {
  @ApiProperty({ type: () => PublicPostDetailDto })
  data!: PublicPostDetailDto;
}
