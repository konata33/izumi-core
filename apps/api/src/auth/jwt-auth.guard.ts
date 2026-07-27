import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';

import { ApiException } from '../common/api-exception.js';
import { AuthService } from './auth.service.js';

export type OwnerRequest = FastifyRequest & { ownerId?: string };

type JwtPayload = { sub?: string };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OwnerRequest>();
    const authorization = request.headers.authorization;
    const [scheme, token] = authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new ApiException(
        'AUTH_REQUIRED',
        'A bearer token is required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      if (!payload.sub || !(await this.authService.ownerExists(payload.sub))) {
        throw new Error('Unknown owner');
      }
      request.ownerId = payload.sub;
      return true;
    } catch {
      throw new ApiException(
        'AUTH_INVALID',
        'The bearer token is invalid or expired',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
