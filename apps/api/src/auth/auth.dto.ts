import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class OwnerSetupDto {
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: 64,
    pattern: '^\\S+$',
    example: 'owner',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^\S+$/u, { message: 'username must not contain whitespace' })
  username!: string;

  @ApiProperty({
    type: String,
    minLength: 12,
    example: 'correct-horse-battery-staple',
  })
  @IsString()
  @MinLength(12)
  password!: string;
}

export class OwnerLoginDto {
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: 64,
    pattern: '^\\S+$',
    example: 'owner',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^\S+$/u, { message: 'username must not contain whitespace' })
  username!: string;

  @ApiProperty({
    type: String,
    minLength: 12,
    example: 'correct-horse-battery-staple',
  })
  @IsString()
  @MinLength(12)
  password!: string;
}

export class AuthTokenDto {
  @ApiProperty({ type: String })
  accessToken!: string;

  @ApiProperty({ type: String, example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ type: Number, example: 604800 })
  expiresIn!: number;
}

export class AuthTokenResponseDto {
  @ApiProperty({ type: () => AuthTokenDto })
  data!: AuthTokenDto;
}

export class OwnerAuthStatusDto {
  @ApiProperty({ type: Boolean, example: true })
  initialized!: boolean;

  @ApiPropertyOptional({
    type: String,
    example: 'owner',
    description: 'Present only after the singleton owner has been initialized.',
  })
  username?: string;
}

export class OwnerAuthStatusResponseDto {
  @ApiProperty({ type: () => OwnerAuthStatusDto })
  data!: OwnerAuthStatusDto;
}
