import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { CurrentOwnerId } from '../auth/current-owner.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ApiException } from '../common/api-exception.js';
import { ApiErrorResponseDto } from '../common/openapi.js';
import {
  CreatePostDto,
  ForkWorkingCopyDto,
  ListPostsQueryDto,
  PostListResponseDto,
  PostReferencesResponseDto,
  PostResponseDto,
  ResolvePostReferencesDto,
  UpdatePostDto,
} from './posts.dto.js';
import { formatPostEtag, PostsService } from './posts.service.js';

function parseRequiredIfMatch(value: string | undefined): number {
  if (!value) {
    throw new ApiException(
      'POST_PRECONDITION_REQUIRED',
      'If-Match is required when changing an existing post',
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }

  const match = /^(?:W\/)?"([1-9]\d*)"$/.exec(value.trim());
  if (!match) {
    throw new ApiException(
      'POST_PRECONDITION_INVALID',
      'If-Match must contain one post ETag such as W/"3"',
      HttpStatus.BAD_REQUEST,
    );
  }
  return Number(match[1]);
}

function respondWithPost(
  reply: FastifyReply,
  data: PostResponseDto['data'],
): PostResponseDto {
  reply.header('etag', formatPostEtag(data.revision));
  return { data };
}

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
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PostResponseDto> {
    return respondWithPost(reply, await this.postsService.create(ownerId, input));
  }

  @Get()
  @ApiOperation({ summary: 'List the owner’s posts' })
  @ApiQuery({ name: 'page', type: Number, required: false, minimum: 1 })
  @ApiQuery({ name: 'size', type: Number, required: false, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'status', enum: ['draft', 'published'], required: false })
  @ApiQuery({ name: 'q', type: String, required: false, maxLength: 200 })
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
        q: query.q,
      }),
    };
  }

  @Post('references/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve live publication snapshots for editor post references',
  })
  @ApiBody({ type: ResolvePostReferencesDto })
  @ApiOkResponse({ type: PostReferencesResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  async resolveReferences(
    @Body() input: ResolvePostReferencesDto,
  ): Promise<PostReferencesResponseDto> {
    return { data: await this.postsService.resolveLiveReferences(input.postIds) };
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
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PostResponseDto> {
    return respondWithPost(reply, await this.postsService.findForOwner(ownerId, id));
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Save the mutable working copy as the owner',
    description:
      'Uses optimistic concurrency. New clients should use the explicit publication commands instead of status.',
  })
  @ApiHeader({ name: 'If-Match', required: true, example: 'W/"3"' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: UpdatePostDto })
  @ApiOkResponse({ type: PostResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiResponse({ status: 412, type: ApiErrorResponseDto })
  @ApiResponse({ status: 428, type: ApiErrorResponseDto })
  async update(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() input: UpdatePostDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PostResponseDto> {
    return respondWithPost(
      reply,
      await this.postsService.update(ownerId, id, input, parseRequiredIfMatch(ifMatch)),
    );
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish the current working copy as a new snapshot' })
  @ApiHeader({ name: 'If-Match', required: true, example: 'W/"3"' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: PostResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiResponse({ status: 412, type: ApiErrorResponseDto })
  @ApiResponse({ status: 428, type: ApiErrorResponseDto })
  async publish(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PostResponseDto> {
    return respondWithPost(
      reply,
      await this.postsService.publish(ownerId, id, parseRequiredIfMatch(ifMatch)),
    );
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take the live snapshot offline without deleting it' })
  @ApiHeader({ name: 'If-Match', required: true, example: 'W/"3"' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: PostResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiResponse({ status: 412, type: ApiErrorResponseDto })
  @ApiResponse({ status: 428, type: ApiErrorResponseDto })
  async unpublish(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PostResponseDto> {
    return respondWithPost(
      reply,
      await this.postsService.unpublish(ownerId, id, parseRequiredIfMatch(ifMatch)),
    );
  }

  @Post(':id/discard-working-copy')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore the latest retained publication snapshot' })
  @ApiHeader({ name: 'If-Match', required: true, example: 'W/"3"' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: PostResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiResponse({ status: 412, type: ApiErrorResponseDto })
  @ApiResponse({ status: 428, type: ApiErrorResponseDto })
  async discardWorkingCopy(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PostResponseDto> {
    return respondWithPost(
      reply,
      await this.postsService.discardWorkingCopy(
        ownerId,
        id,
        parseRequiredIfMatch(ifMatch),
      ),
    );
  }

  @Post(':id/fork-working-copy')
  @ApiOperation({
    summary: 'Fork a working copy into a new draft',
    description:
      'Does not require If-Match so a client can preserve local edits after a revision conflict.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: ForkWorkingCopyDto })
  @ApiCreatedResponse({ type: PostResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async forkWorkingCopy(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() input: ForkWorkingCopyDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PostResponseDto> {
    return respondWithPost(
      reply,
      await this.postsService.forkWorkingCopy(ownerId, id, input),
    );
  }
}
