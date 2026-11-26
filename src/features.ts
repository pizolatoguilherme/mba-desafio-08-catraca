import type { FastifyPluginAsync } from 'fastify';
import { authPlugin } from './auth/plugin.js';

/**
 * Plugins das features, registrados por buildApp em ordem, depois do core.
 * Cada feature acrescenta UMA linha aqui (F02: authPlugin, …).
 */
export const featurePlugins: FastifyPluginAsync[] = [
  authPlugin,
];
