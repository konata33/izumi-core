import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentOwnerId } from '../auth/current-owner.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ApiErrorResponseDto } from '../common/openapi.js';
import { OwnerProfileResponseDto, ReplaceProfileDto } from './profiles.dto.js';
import { ProfilesService } from './profiles.service.js';

@ApiTags('owner-profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('owner/profile')
export class OwnerProfileController {
  constructor(
    @Inject(ProfilesService) private readonly profilesService: ProfilesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get the owner-managed public profile' })
  @ApiOkResponse({ type: OwnerProfileResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async find(@CurrentOwnerId() ownerId: string): Promise<OwnerProfileResponseDto> {
    return { data: await this.profilesService.findForOwner(ownerId) };
  }

  @Put()
  @ApiOperation({ summary: 'Replace the owner-managed public profile' })
  @ApiBody({ type: ReplaceProfileDto })
  @ApiOkResponse({ type: OwnerProfileResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  async replace(
    @CurrentOwnerId() ownerId: string,
    @Body() input: ReplaceProfileDto,
  ): Promise<OwnerProfileResponseDto> {
    return { data: await this.profilesService.replace(ownerId, input) };
  }
}
