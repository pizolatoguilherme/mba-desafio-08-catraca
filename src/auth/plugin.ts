import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string; name: string; email: string; role: 'participant' | 'organizer' } | null;
  }
}

export type SessionUser = NonNullable<FastifyRequest['user']>;

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('user', null);
};

export const authPlugin: FastifyPluginAsync = fp(plugin, { name: 'catraca-auth' });
