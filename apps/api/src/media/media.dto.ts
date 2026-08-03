import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum StorageMode {
  Local = 'local',
  S3 = 's3',
}

export class MediaAssetDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) originalName!: string;
  @ApiProperty({ type: String }) contentType!: string;
  @ApiProperty({ enum: ['image', 'video'] }) kind!: 'image' | 'video';
  @ApiProperty({ type: Number }) byteSize!: number;
  @ApiProperty({ type: String }) publicUrl!: string;
  @ApiProperty({ enum: ['initiated', 'ready'] }) status!: 'initiated' | 'ready';
  @ApiPropertyOptional({ type: Number, nullable: true }) width!: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) height!: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) thumbhash!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) alt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  finalizedAt!: string | null;
}

export class MediaAssetResponseDto {
  @ApiProperty({ type: () => MediaAssetDto }) data!: MediaAssetDto;
}

export class UpdateStorageSettingsDto {
  @ApiProperty({ enum: StorageMode })
  @IsEnum(StorageMode)
  mode!: StorageMode;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  endpoint?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  region?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  bucket?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  accessKeyId?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Required for the first S3 save; omit to preserve the saved secret.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  secretAccessKey?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  publicBaseUrl?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  forcePathStyle?: boolean;
}

export class StorageSettingsDto {
  @ApiProperty({ enum: StorageMode }) mode!: StorageMode;
  @ApiProperty({ type: String }) localPublicBaseUrl!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) endpoint!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) region!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) bucket!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) accessKeyId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  secretAccessKeyMasked!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) publicBaseUrl!: string | null;
  @ApiProperty({ type: Boolean }) forcePathStyle!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updatedAt!: string | null;
}

export class StorageSettingsResponseDto {
  @ApiProperty({ type: () => StorageSettingsDto }) data!: StorageSettingsDto;
}

export class StorageConnectionTestDto {
  @ApiProperty({ type: Boolean }) ok!: boolean;
  @ApiProperty({ type: Number, minimum: 0 }) latencyMs!: number;
  @ApiProperty({ enum: StorageMode }) mode!: StorageMode;
}

export class StorageConnectionTestResponseDto {
  @ApiProperty({ type: () => StorageConnectionTestDto })
  data!: StorageConnectionTestDto;
}
