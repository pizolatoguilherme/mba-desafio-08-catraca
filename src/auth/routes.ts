import type { FastifyInstance } from 'fastify';

export async function authRoutes(_app: FastifyInstance): Promise<void> {
  // esqueleto: rotas nas etapas 4–6
}

export function safeNext(_v: unknown): string {
  return '/';
}
