import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolHandler } from '../../../types.js';

import { tools as compoundTools, handlers as compoundHandlers } from './compounds.js';
import { tools as targetTools, handlers as targetHandlers } from './targets.js';
import { tools as activityTools, handlers as activityHandlers } from './activities.js';
import { tools as drugTools, handlers as drugHandlers } from './drugs.js';
import { tools as propertyTools, handlers as propertyHandlers } from './properties.js';
import { tools as advancedTools, handlers as advancedHandlers } from './advanced.js';

export const tools: Tool[] = [
  ...compoundTools,
  ...targetTools,
  ...activityTools,
  ...drugTools,
  ...propertyTools,
  ...advancedTools,
];

export const handlers: Record<string, ToolHandler> = {
  ...compoundHandlers,
  ...targetHandlers,
  ...activityHandlers,
  ...drugHandlers,
  ...propertyHandlers,
  ...advancedHandlers,
};
