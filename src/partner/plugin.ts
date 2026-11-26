import type { FastifyPluginAsync } from 'fastify';

/** Rotas da API de parceiros (contrato fixo do brief), sob o prefixo /api/partner. */
const partnerRoutes: FastifyPluginAsync = async (app) => {
  app.get('/events', async (_req, reply) => reply.code(200).send([]));
};

/**
 * Plugin encapsulado (SEM fastify-plugin): parser, hooks e handlers valem só em /api/partner/*.
 */
export const partnerPlugin: FastifyPluginAsync = async (app) => {
  await app.register(partnerRoutes, { prefix: '/api/partner' });
};
