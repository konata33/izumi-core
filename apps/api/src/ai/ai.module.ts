import { Module } from '@nestjs/common';

import { LinkCardModule } from '../link-cards/link-card.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';

@Module({
  imports: [LinkCardModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
