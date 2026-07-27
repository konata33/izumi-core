import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentOwnerId } from '../auth/current-owner.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ApiErrorResponseDto } from '../common/openapi.js';
import {
  CreatePostDto,
  ListPostsQueryDto,
  PostListResponseDto,
  PostResponseDto,
  UpdatePostDto,
} from './posts.dto.js';
import { PostsService } from './posts.service.js';

@ApiTags('owner-posts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiExtraModels(ListPostsQueryDto)
@Controller('posts')
export class PostsController {
  constructor(@Inject(PostsService) private readonly postsService: PostsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a post as the owner' })
  @ApiBody({ type: CreatePostDto })
  @ApiCreatedResponse({ type: PostResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async create(
    @CurrentOwnerId() ownerId: string,
    @Body() input: CreatePostDto,
  ): Promise<PostResponseDto> {
    return { data: await this.postsService.create(ownerId, input) };
  }

  @Get()
  @ApiOperation({ summary: 'List the owner’s posts' })
  @ApiQuery({ name: 'page', type: Number, required: false, minimum: 1 })
  @ApiQuery({ name: 'size', type: Number, required: false, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'status', enum: ['draft', 'published'], required: false })
  @ApiOkResponse({ type: PostListResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  async list(
    @CurrentOwnerId() ownerId: string,
    @Query() query: ListPostsQueryDto,
  ): Promise<PostListResponseDto> {
    return {
      data: await this.postsService.list({
        ownerId,
        page: query.page,
        size: query.size,
        status: query.status,
      }),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one post as the owner' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: PostResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async findById(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
  ): Promise<PostResponseDto> {
    return { data: await this.postsService.findForOwner(ownerId, id) };
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Save a post or change its publication state as the owner',
    description:
      'The first draft-to-published transition records publishedAt; later edits and re-publication retain it.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: UpdatePostDto })
  @ApiOkResponse({ type: PostResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async update(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() input: UpdatePostDto,
  ): Promise<PostResponseDto> {
    return { data: await this.postsService.update(ownerId, id, input) };
  }
}
