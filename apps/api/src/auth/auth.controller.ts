import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ApiErrorResponseDto } from '../common/openapi.js';
import {
  AuthTokenResponseDto,
  OwnerAuthStatusResponseDto,
  OwnerLoginDto,
  OwnerSetupDto,
} from './auth.dto.js';
import { AuthService } from './auth.service.js';

const ownerSetupValidation = new ValidationPipe({
  expectedType: OwnerSetupDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@ApiTags('owner-auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get the singleton owner authentication status' })
  @ApiOkResponse({ type: OwnerAuthStatusResponseDto })
  async status(): Promise<OwnerAuthStatusResponseDto> {
    return { data: await this.authService.getOwnerAuthStatus() };
  }

  @Post('setup')
  @ApiOperation({ summary: 'Configure the one Izumi owner' })
  @ApiBody({ type: OwnerSetupDto })
  @ApiCreatedResponse({ type: AuthTokenResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async setup(
    @Body(ownerSetupValidation) input: OwnerSetupDto,
  ): Promise<AuthTokenResponseDto> {
    return { data: await this.authService.setupOwner(input) };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in as the Izumi owner' })
  @ApiBody({ type: OwnerLoginDto })
  @ApiOkResponse({ type: AuthTokenResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  async login(
    @Body(
      new ValidationPipe({
        expectedType: OwnerLoginDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    input: OwnerLoginDto,
  ): Promise<AuthTokenResponseDto> {
    return { data: await this.authService.login(input) };
  }
}
