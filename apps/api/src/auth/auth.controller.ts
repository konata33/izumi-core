import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ApiErrorResponseDto } from '../common/openapi.js';
import { AuthTokenResponseDto, OwnerLoginDto, OwnerSetupDto } from './auth.dto.js';
import { AuthService } from './auth.service.js';

@ApiTags('owner-auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('setup')
  @ApiOperation({ summary: 'Configure the one Izumi owner' })
  @ApiHeader({ name: 'x-izumi-setup-token', required: true })
  @ApiBody({ type: OwnerSetupDto })
  @ApiCreatedResponse({ type: AuthTokenResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async setup(
    @Body() input: OwnerSetupDto,
    @Headers('x-izumi-setup-token') setupToken: string | undefined,
  ): Promise<AuthTokenResponseDto> {
    return { data: await this.authService.setupOwner(input, setupToken) };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in as the Izumi owner' })
  @ApiBody({ type: OwnerLoginDto })
  @ApiOkResponse({ type: AuthTokenResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  async login(@Body() input: OwnerLoginDto): Promise<AuthTokenResponseDto> {
    return { data: await this.authService.login(input) };
  }
}
