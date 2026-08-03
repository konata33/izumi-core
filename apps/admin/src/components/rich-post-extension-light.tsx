import { EmbedPlugin, embedEditNodes } from '@haklex/rich-ext-embed';
import { galleryEditNodes } from '@haklex/rich-ext-gallery/edit';
import { NestedDocPlugin, nestedDocEditNodes } from '@haklex/rich-ext-nested-doc';

import {
  PostReferenceNode,
  PostReferenceToolbarButton,
} from '@/components/post-reference-node';

import '@haklex/rich-ext-embed/style.css';
import '@haklex/rich-ext-gallery/style.css';
import '@haklex/rich-ext-nested-doc/style.css';

export const nodes = [
  ...embedEditNodes,
  ...galleryEditNodes,
  ...nestedDocEditNodes,
  PostReferenceNode,
];

export function Plugins() {
  return (
    <>
      <EmbedPlugin />
      <NestedDocPlugin />
    </>
  );
}

export function Toolbar() {
  return <PostReferenceToolbarButton />;
}
