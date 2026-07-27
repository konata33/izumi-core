import { ApiProperty } from '@nestjs/swagger';

export class ErrorEnvelopeDto {
  @ApiProperty({ type: String, example: 'VALIDATION_ERROR' })
  code!: string;

  @ApiProperty({ type: String, example: 'Validation failed' })
  message!: string;

  @ApiProperty({
    type: Object,
    additionalProperties: true,
    example: { issues: ['email must be an email'] },
    required: false,
  })
  details?: unknown;

  @ApiProperty({ type: String, example: 'req-123' })
  requestId!: string;
}

export class ApiErrorResponseDto {
  @ApiProperty({ type: () => ErrorEnvelopeDto })
  error!: ErrorEnvelopeDto;
}
