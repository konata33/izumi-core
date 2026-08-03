import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
// DTO classes are required at runtime by Nest validation metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { LinkCardResponseDto, ResolveLinkCardDto } from './link-card.dto.js';
import { LinkCardService } from './link-card.service.js';

@ApiTags('owner-link-cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('link-cards')
export class LinkCardController {
  constructor(@Inject(LinkCardService) private readonly linkCards: LinkCardService) {}

  @Post('resolve')
  @ApiOperation({ summary: 'Resolve and cache safe metadata for a link card' })
  @ApiOkResponse({ type: LinkCardResponseDto })
  async resolve(@Body() input: ResolveLinkCardDto): Promise<LinkCardResponseDto> {
    return { data: await this.linkCards.resolve(input.url) };
  }
}
