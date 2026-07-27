import { randomUUID, timingSafeEqual } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { ApiException } from '../common/api-exception.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { owners } from '../database/schema.js';
import type { AuthTokenDto, OwnerLoginDto, OwnerSetupDto } from './auth.dto.js';

type OwnerRecord = typeof owners.$inferSelect;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  async setupOwner(
    input: OwnerSetupDto,
    setupToken: string | undefined,
  ): Promise<AuthTokenDto> {
    if (!this.isSetupTokenValid(setupToken)) {
      throw new ApiException(
        'SETUP_TOKEN_INVALID',
        'The owner setup token is invalid',
        HttpStatus.FORBIDDEN,
      );
    }

    const email = input.email.trim().toLowerCase();

    try {
      const [owner] = await this.database
        .insert(owners)
        .values({
          id: randomUUID(),
          email,
          passwordHash: await hash(input.password, 12),
        })
        .returning();

      if (!owner) throw new Error('Owner creation returned no row');
      return this.issueToken(owner);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ApiException(
          'OWNER_ALREADY_CONFIGURED',
          'An owner has already been configured',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async login(input: OwnerLoginDto): Promise<AuthTokenDto> {
    const email = input.email.trim().toLowerCase();
    const [owner] = await this.database
      .select()
      .from(owners)
      .where(eq(owners.email, email))
      .limit(1);

    if (!owner || !(await compare(input.password, owner.passwordHash))) {
      throw new ApiException(
        'INVALID_CREDENTIALS',
        'Email or password is incorrect',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return this.issueToken(owner);
  }

  async ownerExists(ownerId: string): Promise<boolean> {
    const [owner] = await this.database
      .select({ id: owners.id })
      .from(owners)
      .where(eq(owners.id, ownerId))
      .limit(1);
    return owner !== undefined;
  }

  private async issueToken(owner: OwnerRecord): Promise<AuthTokenDto> {
    const accessToken = await this.jwt.signAsync(
      { email: owner.email },
      {
        subject: owner.id,
        expiresIn: this.config.jwtExpiresInSeconds,
      },
    );

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.jwtExpiresInSeconds,
    };
  }

  private isSetupTokenValid(candidate: string | undefined): boolean {
    if (!candidate) return false;

    const expected = Buffer.from(this.config.ownerSetupToken);
    const actual = Buffer.from(candidate);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
