import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { ApiErrorResponseDto } from '../common/openapi.js';
import {
  PublicPostListResponseDto,
  PublicPostResponseDto,
  PublicPostsQueryDto,
} from './posts.dto.js';
import { PostsService } from './posts.service.js';

@ApiTags('public-content')
@ApiExtraModels(PublicPostsQueryDto)
@Controller('public/posts')
export class PublicPostsController {
  constructor(@Inject(PostsService) private readonly postsService: PostsService) {}

  @Get()
  @ApiOperation({
    summary: 'List published post summaries',
    description: 'Returns every published post when limit is omitted.',
  })
  @ApiQuery({ name: 'limit', type: Number, required: false, minimum: 1, maximum: 100 })
  @ApiOkResponse({ type: PublicPostListResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  async list(@Query() query: PublicPostsQueryDto): Promise<PublicPostListResponseDto> {
    return { data: await this.postsService.listPublished(query.limit) };
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get one published post by slug' })
  @ApiParam({ name: 'slug', type: String, example: 'make-room-for-a-slower-entry' })
  @ApiOkResponse({ type: PublicPostResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async findBySlug(@Param('slug') slug: string): Promise<PublicPostResponseDto> {
    return { data: await this.postsService.findPublishedBySlug(slug) };
  }
}
