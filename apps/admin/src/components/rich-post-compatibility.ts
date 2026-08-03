import type { BuiltinNodeRenderer, RichRendererModule } from '@haklex/rich-compose';
import { CodeHighlightNode } from '@lexical/code-core';
import { MarkNode } from '@lexical/mark';
import { createElement } from 'react';

export const richPostCompatibilityNodes = [CodeHighlightNode, MarkNode];

export const richPostCompatibilityModule: RichRendererModule = {
  name: 'lexical-compatibility',
  nodes: richPostCompatibilityNodes,
};

export const richPostBuiltinNodeOverrides: Record<string, BuiltinNodeRenderer> = {
  mark: (_node, key, children) =>
    createElement('mark', { className: 'mx-rich-preview-mark', key }, children),
};
