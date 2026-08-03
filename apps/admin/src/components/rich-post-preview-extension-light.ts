import type { RichRendererModule } from '@haklex/rich-compose';
import { embedModule } from '@haklex/rich-compose/modules/embed';
import { galleryModule } from '@haklex/rich-compose/modules/gallery';
import { nestedDocModule } from '@haklex/rich-compose/modules/nested-doc';

export const modules: RichRendererModule[] = [
  embedModule,
  galleryModule,
  nestedDocModule,
];
