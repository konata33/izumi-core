import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../database/database.module.js';
import { HealthResponseDto } from './health.dto.js';

@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  @Get()
  @ApiOperation({ summary: 'Check API and database availability' })
  @ApiOkResponse({ type: HealthResponseDto })
  async getHealth(): Promise<HealthResponseDto> {
    await this.database.execute(sql`select 1`);

    return {
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
      },
    };
  }
}
