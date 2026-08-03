import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class InitiateMediaUploadDto {
  @ApiProperty({ example: 'quiet-room.webp' })
  @IsString()
  @MinLength(1)
  originalName!: string;

  @ApiProperty({ example: 'image/webp' })
  @IsString()
  contentType!: string;

  @ApiProperty({ type: Number, example: 238144 })
  @IsInt()
  @Min(1)
  byteSize!: number;
}

export class FinalizeMediaUploadDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  alt?: string;
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

export class InitiateMediaUploadDataDto {
  @ApiProperty({ type: () => MediaAssetDto }) asset!: MediaAssetDto;
  @ApiProperty({ type: String }) uploadUrl!: string;
  @ApiProperty({
    type: Object,
    description: 'Append these fields to multipart/form-data before the file field.',
  })
  uploadFields!: Record<string, string>;
  @ApiProperty({ type: Number, example: 900 }) expiresInSeconds!: number;
}

export class InitiateMediaUploadResponseDto {
  @ApiProperty({ type: () => InitiateMediaUploadDataDto })
  data!: InitiateMediaUploadDataDto;
}

export class MediaAssetResponseDto {
  @ApiProperty({ type: () => MediaAssetDto }) data!: MediaAssetDto;
}
