import { Module } from '@nestjs/common';

import { PostsController } from './posts.controller.js';
import { PublicPostsController } from './public-posts.controller.js';
import { PostsService } from './posts.service.js';

@Module({
  controllers: [PostsController, PublicPostsController],
  providers: [PostsService],
})
export class PostsModule {}
