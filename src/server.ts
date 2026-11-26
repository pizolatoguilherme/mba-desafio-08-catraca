import { fileURLToPath, pathToFileURL } from 'node:url';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import view from '@fastify/view';
import ejs from 'ejs';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { config } from './config.js';
import { pool, query } from './db.js';
import { featurePlugins } from './features.js';

// Resolve a partir de src/*.ts (vitest) e de dist/*.js (produção): as views ficam sempre em src/views.
const VIEWS_DIR = fileURLToPath(new URL('../src/views/', import.meta.url));

const NOT_FOUND_PAGE = {
  status: 404,
  title: 'Página não encontrada',
  message: 'O endereço acessado não existe ou não está disponível.',
} as const;

function isPartnerApi(url: string | undefined): boolean {
  return url === '/api/partner' || Boolean(url?.startsWith('/api/partner/')) || Boolean(url?.startsWith('/api/partner?'));
}

function errorTitle(status: number): string {
  if (status === 404) return NOT_FOUND_PAGE.title;
  if (status === 403) return 'Acesso negado';
  if (status >= 500) return 'Erro interno';
  return 'Requisição inválida';
}

function renderError(reply: FastifyReply, status: number): FastifyReply | Promise<unknown> {
  if (status === 404) return reply.code(404).view('error.ejs', { ...NOT_FOUND_PAGE });
  return reply.code(status).view('error.ejs', { status, title: errorTitle(status) });
}

/**
 * Monta a aplicação: core (formbody, cookie, view com layout, /healthz, 404, 500), depois os
 * featurePlugins em ordem e, por fim, o placeholder de GET / se nenhuma feature registrou GET /.
 * Não chama listen nem ready. startDispatcher é aceito aqui e usado por F03.
 */
export async function buildApp(opts?: { startDispatcher?: boolean }): Promise<FastifyInstance> {
  void opts?.startDispatcher; // F03 inicia/para o dispatcher a partir desta opção.

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    routerOptions: { maxParamLength: 500 },
    // URL malformada (ex.: %zz) é rejeitada pelo roteador antes de qualquer plugin.
    frameworkErrors: (error: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
      if (isPartnerApi(req.url)) {
        reply.code(422).send({ error: 'invalid_request' });
        return;
      }
      reply.code(400).send({ error: 'Bad Request', message: error.message, statusCode: 400 });
    },
  });

  await app.register(formbody);
  await app.register(cookie);
  await app.register(view, { engine: { ejs }, root: VIEWS_DIR, layout: 'layout.ejs' });

  // O healthcheck do Compose chama /healthz a cada 2 s: não polui o log com cada requisição.
  app.get('/healthz', { logLevel: 'warn' }, async (_req, reply) => {
    try {
      await query('SELECT 1');
      return reply.code(200).send({ ok: true });
    } catch (err) {
      app.log.error({ err }, 'healthz: banco indisponível');
      return reply.code(503).send({ ok: false });
    }
  });

  app.setNotFoundHandler((_req, reply) => renderError(reply, 404));

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const code = err.statusCode ?? 500;
    const status = code >= 400 && code < 500 ? code : 500;
    if (status >= 500) req.log.error({ err }, 'erro não tratado');
    else req.log.info({ err: err.message, status }, 'requisição rejeitada');
    return renderError(reply, status);
  });

  for (const plugin of featurePlugins) {
    await app.register(plugin);
  }

  if (!app.hasRoute({ method: 'GET', url: '/' })) {
    app.get('/', (_req, reply) => reply.view('home.ejs'));
  }

  return app;
}

// Execução direta: node dist/server.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await buildApp({ startDispatcher: true });
  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    app.log.info(`${signal} recebido: encerrando`);
    try {
      await app.close();
      await pool.end();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'falha no encerramento');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  try {
    await app.listen({ host: '0.0.0.0', port: config.port });
  } catch (err) {
    app.log.error({ err }, 'falha ao iniciar o servidor');
    await pool.end().catch(() => undefined);
    process.exit(1);
  }
}
