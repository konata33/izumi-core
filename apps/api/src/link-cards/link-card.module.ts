import { Module } from '@nestjs/common';

import { InMemoryLinkCardCache, LINK_CARD_CACHE } from './link-card-cache.js';
import { LinkCardController } from './link-card.controller.js';
import { LinkCardService } from './link-card.service.js';
import { LINK_CARD_HTTP_CLIENT, PinnedHttpClient } from './pinned-http-client.js';
import { UrlSafetyPolicy } from './url-safety.js';

@Module({
  controllers: [LinkCardController],
  providers: [
    LinkCardService,
    UrlSafetyPolicy,
    { provide: LINK_CARD_CACHE, useClass: InMemoryLinkCardCache },
    { provide: LINK_CARD_HTTP_CLIENT, useClass: PinnedHttpClient },
  ],
  exports: [LinkCardService, LINK_CARD_CACHE, LINK_CARD_HTTP_CLIENT, UrlSafetyPolicy],
})
export class LinkCardModule {}
