import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';

import { tools as geneTools, handlers as geneHandlers } from './genes.js';
import { tools as sequenceTools, handlers as sequenceHandlers } from './sequences.js';
import { tools as variantTools, handlers as variantHandlers } from './variants.js';
import { tools as comparativeTools, handlers as comparativeHandlers } from './comparative.js';
import { tools as regulatoryTools, handlers as regulatoryHandlers } from './regulatory.js';
import { tools as annotationTools, handlers as annotationHandlers } from './annotations.js';
import { tools as speciesTools, handlers as speciesHandlers } from './species.js';

export const tools: Tool[] = [
  ...geneTools,
  ...sequenceTools,
  ...variantTools,
  ...comparativeTools,
  ...regulatoryTools,
  ...annotationTools,
  ...speciesTools,
];

export const handlers: Record<string, ToolHandler> = {
  ...geneHandlers,
  ...sequenceHandlers,
  ...variantHandlers,
  ...comparativeHandlers,
  ...regulatoryHandlers,
  ...annotationHandlers,
  ...speciesHandlers,
};
