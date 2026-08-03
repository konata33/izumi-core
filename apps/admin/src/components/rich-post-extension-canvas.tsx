import { ExcalidrawEditNode, ExcalidrawPlugin } from '@haklex/rich-ext-excalidraw';

import '@haklex/rich-ext-excalidraw/style.css';

export const nodes = [ExcalidrawEditNode];

export function Plugins() {
  return <ExcalidrawPlugin />;
}
