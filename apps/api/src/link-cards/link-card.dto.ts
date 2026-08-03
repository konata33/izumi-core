import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUrl } from 'class-validator';

export class ResolveLinkCardDto {
  @ApiProperty({ type: String, example: 'https://example.com/essay' })
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url!: string;
}

export class LinkCardDto {
  @ApiProperty({ type: String }) url!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) imageUrl!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) siteName!: string | null;
}

export class LinkCardResponseDto {
  @ApiProperty({ type: () => LinkCardDto }) data!: LinkCardDto;
}
