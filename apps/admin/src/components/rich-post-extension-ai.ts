import { chatEditNodes } from '@haklex/rich-ext-chat/edit';

import '@haklex/rich-ext-chat/style.css';

// Agent diff nodes are review-only UI state and must never enter a post document.
export const nodes = chatEditNodes;
