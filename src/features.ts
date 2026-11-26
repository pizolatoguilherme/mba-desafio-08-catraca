import type { FastifyPluginAsync } from 'fastify';
import { authPlugin } from './auth/plugin.js';
import { eventsOrgRoutes } from './events/routes-org.js';
import { eventsPublicRoutes } from './events/routes-public.js';
import { purchasesPlugin } from './purchases/routes.js';
import { checkinPlugin } from './checkin/routes.js';

/**
 * Plugins das features, registrados por buildApp em ordem, depois do core.
 * Cada feature acrescenta UMA linha aqui (F02: authPlugin, …).
 */
export const featurePlugins: FastifyPluginAsync[] = [
  authPlugin,
  /* F04 */ eventsPublicRoutes, eventsOrgRoutes,
  /* F05 */ purchasesPlugin,
  /* F07 */ checkinPlugin,
];
