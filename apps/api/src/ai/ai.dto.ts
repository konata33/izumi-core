import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum AiProviderType {
  Claude = 'claude',
  OpenAiCompatible = 'openai-compatible',
}

export class CreateAiProviderProfileDto {
  @ApiProperty({ type: String, example: 'Claude editorial' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ type: String, enum: AiProviderType })
  @IsEnum(AiProviderType)
  providerType!: AiProviderType;

  @ApiProperty({ type: String, example: 'https://api.anthropic.com' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  baseUrl!: string;

  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  model!: string;

  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  apiKey!: string;
}

export class UpdateAiProviderProfileDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ type: String, enum: AiProviderType })
  @IsOptional()
  @IsEnum(AiProviderType)
  providerType?: AiProviderType;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  baseUrl?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  model?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Omit to preserve the current encrypted key.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  apiKey?: string;
}

export class AiProviderProfileDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, enum: AiProviderType })
  providerType!: AiProviderType;
  @ApiProperty({ type: String }) baseUrl!: string;
  @ApiProperty({ type: String }) model!: string;
  @ApiProperty({ type: String }) apiKeyMasked!: string;
  @ApiProperty({ type: String, enum: ['environment', 'owner'] })
  source!: 'environment' | 'owner';
  @ApiProperty({ type: Boolean }) readOnly!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updatedAt!: string | null;
}

export class AiProviderProfilesResponseDto {
  @ApiProperty({ type: () => AiProviderProfileDto, isArray: true })
  data!: AiProviderProfileDto[];
}

export class AiProviderProfileResponseDto {
  @ApiProperty({ type: () => AiProviderProfileDto })
  data!: AiProviderProfileDto;
}

export class AiConnectionTestDataDto {
  @ApiProperty({ type: Boolean }) ok!: boolean;
  @ApiProperty({ type: Number, minimum: 0 }) latencyMs!: number;
}

export class AiConnectionTestResponseDto {
  @ApiProperty({ type: () => AiConnectionTestDataDto })
  data!: AiConnectionTestDataDto;
}

export class CreateAiSessionDto {
  @ApiPropertyOptional({ type: String, example: '新对话' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Owner profile UUID or the literal "environment".',
  })
  @IsOptional()
  @IsString()
  providerProfileId?: string;
}

export class UpdateAiSessionDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;
}

export class StartAiRunDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  message!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  providerProfileId?: string;
}

export class RecordToolCallDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsString()
  @MinLength(1)
  runId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  toolCallId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  toolName!: string;

  @ApiProperty({ type: Object })
  @IsObject()
  payload!: Record<string, unknown>;
}

export class UpdateToolDecisionDto {
  @ApiProperty({ type: String, enum: ['accepted', 'rejected'] })
  @IsIn(['accepted', 'rejected'])
  decision!: 'accepted' | 'rejected';
}

export class AiMessageDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, enum: ['user', 'assistant'] })
  role!: 'user' | 'assistant';
  @ApiProperty({ type: String }) content!: string;
  @ApiProperty({ type: String, enum: ['complete', 'failed', 'cancelled'] })
  status!: 'complete' | 'failed' | 'cancelled';
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  runId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class AiToolDecisionDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) runId!: string;
  @ApiProperty({ type: String }) toolCallId!: string;
  @ApiProperty({ type: String }) toolName!: string;
  @ApiProperty({ type: Object }) payload!: Record<string, unknown>;
  @ApiProperty({ type: String, enum: ['pending', 'accepted', 'rejected'] })
  decision!: 'pending' | 'accepted' | 'rejected';
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  decidedAt!: string | null;
}

export class AiSessionDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) postId!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  providerProfileId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  activeRunId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: () => AiMessageDto, isArray: true }) messages!: AiMessageDto[];
  @ApiProperty({ type: () => AiToolDecisionDto, isArray: true })
  toolDecisions!: AiToolDecisionDto[];
}

export class AiSessionsResponseDto {
  @ApiProperty({ type: () => AiSessionDto, isArray: true }) data!: AiSessionDto[];
}

export class AiSessionResponseDto {
  @ApiProperty({ type: () => AiSessionDto }) data!: AiSessionDto;
}

export class AiToolDecisionResponseDto {
  @ApiProperty({ type: () => AiToolDecisionDto }) data!: AiToolDecisionDto;
}
