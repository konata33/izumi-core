import type { RichRendererModule } from '@haklex/rich-compose';
import { codeBlockModule } from '@haklex/rich-compose/modules/code-block';
import { codeSnippetModule } from '@haklex/rich-compose/modules/code-snippet';

export const modules: RichRendererModule[] = [codeBlockModule, codeSnippetModule];
