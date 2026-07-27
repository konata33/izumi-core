import { ApiProperty } from '@nestjs/swagger';

export class HealthDataDto {
  @ApiProperty({ type: String, example: 'ok' })
  status!: 'ok';

  @ApiProperty({ type: String, format: 'date-time' })
  timestamp!: string;
}

export class HealthResponseDto {
  @ApiProperty({ type: () => HealthDataDto })
  data!: HealthDataDto;
}
