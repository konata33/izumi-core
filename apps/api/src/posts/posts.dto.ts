import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export enum PostStatus {
  Draft = 'draft',
  Published = 'published',
}

export class CreatePostDto {
  @ApiProperty({ type: String, example: 'A first post' })
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  title!: string;

  @ApiProperty({ type: String, example: 'a-first-post' })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @ApiProperty({
    type: String,
    example: 'The post body in the selected source format.',
  })
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  content!: string;

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
  @MinLength(1)
  @Matches(/\S/)
  content?: string;

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

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
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
    description: 'Canonical owner-authored Markdown source.',
  })
  content!: string;
}

export class PublicPostListResponseDto {
  @ApiProperty({ type: () => PublicPostSummaryDto, isArray: true })
  data!: PublicPostSummaryDto[];
}

export class PublicPostResponseDto {
  @ApiProperty({ type: () => PublicPostDetailDto })
  data!: PublicPostDetailDto;
}
