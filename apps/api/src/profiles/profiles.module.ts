import { Module } from '@nestjs/common';

import { OwnerProfileController } from './owner-profile.controller.js';
import { ProfilesService } from './profiles.service.js';
import { PublicProfileController } from './public-profile.controller.js';

@Module({
  controllers: [OwnerProfileController, PublicProfileController],
  providers: [ProfilesService],
})
export class ProfilesModule {}
