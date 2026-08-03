import { Module } from '@nestjs/common';

import { LinkCardModule } from '../link-cards/link-card.module.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { StorageController } from './storage.controller.js';

@Module({
  imports: [LinkCardModule],
  controllers: [MediaController, StorageController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
