import type { Readable } from 'node:stream';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { CurrentOwnerId } from '../auth/current-owner.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
// DTO classes are required at runtime by Nest validation metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  AiConnectionTestResponseDto,
  AiProviderProfileResponseDto,
  AiProviderProfilesResponseDto,
  AiSessionResponseDto,
  AiSessionsResponseDto,
  AiToolDecisionResponseDto,
  CreateAiProviderProfileDto,
  CreateAiSessionDto,
  RecordToolCallDto,
  StartAiRunDto,
  UpdateAiProviderProfileDto,
  UpdateAiSessionDto,
  UpdateToolDecisionDto,
} from './ai.dto.js';
import { AiService } from './ai.service.js';

@ApiTags('owner-ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(@Inject(AiService) private readonly ai: AiService) {}

  @Get('providers')
  @ApiOkResponse({ type: AiProviderProfilesResponseDto })
  async listProviders(
    @CurrentOwnerId() ownerId: string,
  ): Promise<AiProviderProfilesResponseDto> {
    return { data: await this.ai.listProviders(ownerId) };
  }

  @Post('providers')
  @ApiCreatedResponse({ type: AiProviderProfileResponseDto })
  async createProvider(
    @CurrentOwnerId() ownerId: string,
    @Body() input: CreateAiProviderProfileDto,
  ): Promise<AiProviderProfileResponseDto> {
    return { data: await this.ai.createProvider(ownerId, input) };
  }

  @Patch('providers/:id')
  @ApiOkResponse({ type: AiProviderProfileResponseDto })
  async updateProvider(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() input: UpdateAiProviderProfileDto,
  ): Promise<AiProviderProfileResponseDto> {
    return { data: await this.ai.updateProvider(ownerId, id, input) };
  }

  @Delete('providers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async deleteProvider(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.ai.deleteProvider(ownerId, id);
  }

  @Post('providers/:id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AiConnectionTestResponseDto })
  async testProvider(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
  ): Promise<AiConnectionTestResponseDto> {
    return { data: await this.ai.testProvider(ownerId, id) };
  }

  @Get('posts/:postId/sessions')
  @ApiOkResponse({ type: AiSessionsResponseDto })
  async listSessions(
    @CurrentOwnerId() ownerId: string,
    @Param('postId') postId: string,
  ): Promise<AiSessionsResponseDto> {
    return { data: await this.ai.listSessions(ownerId, postId) };
  }

  @Post('posts/:postId/sessions')
  @ApiCreatedResponse({ type: AiSessionResponseDto })
  async createSession(
    @CurrentOwnerId() ownerId: string,
    @Param('postId') postId: string,
    @Body() input: CreateAiSessionDto,
  ): Promise<AiSessionResponseDto> {
    return { data: await this.ai.createSession(ownerId, postId, input) };
  }

  @Get('sessions/:id')
  @ApiOkResponse({ type: AiSessionResponseDto })
  async findSession(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
  ): Promise<AiSessionResponseDto> {
    return { data: await this.ai.findSession(ownerId, id) };
  }

  @Patch('sessions/:id')
  @ApiOkResponse({ type: AiSessionResponseDto })
  async renameSession(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() input: UpdateAiSessionDto,
  ): Promise<AiSessionResponseDto> {
    return { data: await this.ai.renameSession(ownerId, id, input.title) };
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async deleteSession(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.ai.deleteSession(ownerId, id);
  }

  @Post('sessions/:id/runs')
  @ApiOperation({ summary: 'Run the selected AI provider and stream normalized SSE' })
  @ApiProduces('text/event-stream')
  async startRun(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() input: StartAiRunDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const { runId, stream } = await this.ai.startRun(ownerId, id, input);
    reply.header('X-AI-Run-Id', runId);
    reply.header('Cache-Control', 'no-cache, no-transform');
    reply.header('Connection', 'keep-alive');
    reply.header('X-Accel-Buffering', 'no');
    const cancelOnDisconnect = () => {
      void this.ai.cancelRun(ownerId, id, runId).catch(() => undefined);
    };
    reply.raw.once('close', cancelOnDisconnect);
    stream.once('end', () => reply.raw.off('close', cancelOnDisconnect));
    return new StreamableFile(stream as Readable, { type: 'text/event-stream' });
  }

  @Post('sessions/:id/runs/:runId/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async cancelRun(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Param('runId') runId: string,
  ): Promise<void> {
    await this.ai.cancelRun(ownerId, id, runId);
  }

  @Patch('sessions/:id/tool-decisions/:decisionId')
  @ApiOkResponse({ type: AiToolDecisionResponseDto })
  async decideToolCall(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Param('decisionId') decisionId: string,
    @Body() input: UpdateToolDecisionDto,
  ): Promise<AiToolDecisionResponseDto> {
    return {
      data: await this.ai.decideToolCall(ownerId, id, decisionId, input.decision),
    };
  }

  @Post('sessions/:id/tool-calls')
  @ApiCreatedResponse({ type: AiToolDecisionResponseDto })
  async recordToolCall(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() input: RecordToolCallDto,
  ): Promise<AiToolDecisionResponseDto> {
    return {
      data: await this.ai.recordToolCall(ownerId, {
        sessionId: id,
        runId: input.runId,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        payload: input.payload,
      }),
    };
  }
}
