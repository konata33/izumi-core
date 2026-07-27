import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class OwnerSetupDto {
  @ApiProperty({ type: String, example: 'owner@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    type: String,
    minLength: 12,
    example: 'correct-horse-battery-staple',
  })
  @IsString()
  @MinLength(12)
  password!: string;
}

export class OwnerLoginDto extends OwnerSetupDto {}

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
