import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApiErrorResponseDto } from '../common/openapi.js';
import { PublicProfileResponseDto } from './profiles.dto.js';
import { ProfilesService } from './profiles.service.js';

@ApiTags('public-profile')
@Controller('public/profile')
export class PublicProfileController {
  constructor(
    @Inject(ProfilesService) private readonly profilesService: ProfilesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get the configured public profile' })
  @ApiOkResponse({ type: PublicProfileResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async find(): Promise<PublicProfileResponseDto> {
    return { data: await this.profilesService.findPublic() };
  }
}
