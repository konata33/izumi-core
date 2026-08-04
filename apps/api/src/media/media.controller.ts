import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { CurrentOwnerId } from '../auth/current-owner.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ApiException } from '../common/api-exception.js';
import { MediaAssetResponseDto } from './media.dto.js';
import { MediaService } from './media.service.js';

function multipartTextField(
  fields: Awaited<ReturnType<FastifyRequest['saveRequestFiles']>>[number]['fields'],
  name: string,
): string | undefined {
  const field = fields[name];
  if (!field || Array.isArray(field) || field.type !== 'field') return undefined;
  return typeof field.value === 'string' ? field.value : undefined;
}

function isMultipartFileTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'FST_REQ_FILE_TOO_LARGE'
  );
}

@ApiTags('owner-media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Post('uploads')
  @ApiOperation({ summary: 'Upload one ready media file through Core' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        alt: { type: 'string', maxLength: 1000 },
      },
    },
  })
  @ApiCreatedResponse({ type: MediaAssetResponseDto })
  async upload(
    @CurrentOwnerId() ownerId: string,
    @Req() request: FastifyRequest,
  ): Promise<MediaAssetResponseDto> {
    if (!request.isMultipart()) {
      throw new ApiException(
        'MEDIA_MULTIPART_REQUIRED',
        'Media uploads must use multipart/form-data',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    let files: Awaited<ReturnType<FastifyRequest['saveRequestFiles']>>;
    try {
      files = await request.saveRequestFiles();
    } catch (error) {
      if (!isMultipartFileTooLarge(error)) throw error;
      throw new ApiException(
        'MEDIA_TOO_LARGE',
        'The media file exceeds the configured byte limit',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    const file = files[0];
    if (files.length !== 1 || !file) {
      throw new ApiException(
        'MEDIA_FILE_REQUIRED',
        'Exactly one media file is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    return {
      data: await this.media.upload(ownerId, {
        filePath: file.filepath,
        fieldName: file.fieldname,
        originalName: file.filename,
        contentType: file.mimetype,
        alt: multipartTextField(file.fields, 'alt'),
      }),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a media asset owned by the current owner' })
  @ApiOkResponse({ type: MediaAssetResponseDto })
  async find(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
  ): Promise<MediaAssetResponseDto> {
    return { data: await this.media.find(ownerId, id) };
  }
}
