import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentOwnerId } from '../auth/current-owner.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import {
  StorageConnectionTestResponseDto,
  StorageSettingsResponseDto,
  UpdateStorageSettingsDto,
} from './media.dto.js';
import { MediaService } from './media.service.js';

@ApiTags('owner-storage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('storage/settings')
export class StorageController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Get()
  @ApiOperation({ summary: 'Get the current owner storage settings' })
  @ApiOkResponse({ type: StorageSettingsResponseDto })
  async get(@CurrentOwnerId() ownerId: string): Promise<StorageSettingsResponseDto> {
    return { data: await this.media.getStorageSettings(ownerId) };
  }

  @Put()
  @ApiOperation({ summary: 'Replace the current owner storage settings' })
  @ApiBody({ type: UpdateStorageSettingsDto })
  @ApiOkResponse({ type: StorageSettingsResponseDto })
  async update(
    @CurrentOwnerId() ownerId: string,
    @Body() input: UpdateStorageSettingsDto,
  ): Promise<StorageSettingsResponseDto> {
    return { data: await this.media.updateStorageSettings(ownerId, input) };
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test the saved storage settings' })
  @ApiOkResponse({ type: StorageConnectionTestResponseDto })
  async test(
    @CurrentOwnerId() ownerId: string,
  ): Promise<StorageConnectionTestResponseDto> {
    return { data: await this.media.testSavedStorage(ownerId) };
  }
}
