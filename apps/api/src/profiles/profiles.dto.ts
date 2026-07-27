import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsString,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ProfileLinkKind {
  Github = 'github',
  X = 'x',
}

export class ProfileAvatarDto {
  @ApiProperty({
    type: String,
    format: 'uri',
    example: 'https://assets.example.com/avatar.png',
  })
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  url!: string;

  @ApiProperty({ type: String, example: 'Konata33 的头像' })
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  alt!: string;
}

export class ProfileLinkDto {
  @ApiProperty({ enum: ProfileLinkKind, example: ProfileLinkKind.Github })
  @IsEnum(ProfileLinkKind)
  kind!: ProfileLinkKind;

  @ApiProperty({ type: String, format: 'uri', example: 'https://github.com/konata33' })
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  url!: string;
}

export class ReplaceProfileDto {
  @ApiProperty({ type: String, example: 'Konata' })
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  displayName!: string;

  @ApiProperty({ type: String, example: "Hello, I'm Konata." })
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  headline!: string;

  @ApiProperty({ type: String, example: 'A design-driven developer.' })
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  bio!: string;

  @ApiProperty({ type: () => ProfileAvatarDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ProfileAvatarDto)
  avatar!: ProfileAvatarDto;

  @ApiProperty({ type: () => ProfileLinkDto, isArray: true })
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ProfileLinkDto)
  links!: ProfileLinkDto[];
}

export class PublicProfileDto extends ReplaceProfileDto {}

export class OwnerProfileDto extends PublicProfileDto {
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class PublicProfileResponseDto {
  @ApiProperty({ type: () => PublicProfileDto })
  data!: PublicProfileDto;
}

export class OwnerProfileResponseDto {
  @ApiProperty({ type: () => OwnerProfileDto })
  data!: OwnerProfileDto;
}
