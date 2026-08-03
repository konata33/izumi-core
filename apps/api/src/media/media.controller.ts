import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentOwnerId } from '../auth/current-owner.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
// DTO classes are required at runtime by Nest validation metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  FinalizeMediaUploadDto,
  InitiateMediaUploadDto,
  InitiateMediaUploadResponseDto,
  MediaAssetResponseDto,
} from './media.dto.js';
import { MediaService } from './media.service.js';

@ApiTags('owner-media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Post('uploads')
  @ApiOperation({ summary: 'Initiate a direct media upload' })
  @ApiCreatedResponse({ type: InitiateMediaUploadResponseDto })
  async initiate(
    @CurrentOwnerId() ownerId: string,
    @Body() input: InitiateMediaUploadDto,
  ): Promise<InitiateMediaUploadResponseDto> {
    return { data: await this.media.initiate(ownerId, input) };
  }

  @Post(':id/finalize')
  @ApiOperation({ summary: 'Verify and finalize an uploaded media object' })
  @ApiOkResponse({ type: MediaAssetResponseDto })
  async finalize(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() input: FinalizeMediaUploadDto,
  ): Promise<MediaAssetResponseDto> {
    return { data: await this.media.finalize(ownerId, id, input) };
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
