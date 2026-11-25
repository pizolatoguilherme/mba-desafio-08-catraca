import type { FastifyPluginAsync } from 'fastify';

/**
 * Plugins das features, registrados por buildApp em ordem, depois do core.
 * Cada feature acrescenta UMA linha aqui (F02: authPlugin, …).
 */
export const featurePlugins: FastifyPluginAsync[] = [
  // cada feature acrescenta UMA linha aqui (F02: authPlugin, …)
];
