// /server/src/server.js — buildApp(): construct the Fastify instance with config, the
// infra singletons (db ACTIVE; cache/storage/bus structured-but-dark), the cross-cutting
// plugins, the health/metrics routes, and the 9 Mini-Yonder service plugins (auth carries
// a live session read + dark OTP writes; #1-#8 are dark 501 skeletons). There is NO
// listen() here — index.js owns the socket; tests import buildApp() directly. Per ADR
// BD-DOCS-041.
import Fastify from 'fastify';

import { loadConfig } from './config.js';
import { loggerOptions } from './infra/logger.js';
import dbPlugin from './infra/db.js';
import { createCache } from './infra/cache.js';
import { createStorage } from './infra/storage.js';
import { createBus } from './infra/bus.js';
import errorHandler from './plugins/error-handler.js';
import helmetPlugin from './plugins/helmet.js';
import corsPlugin from './plugins/cors.js';
import authPlugin from './plugins/auth.js';
import realtimePlugin from './plugins/realtime.js';
import healthRoutes from './routes/health.js';
import metricsRoutes from './routes/metrics.js';
import { SERVICES } from './services/index.js';

export async function buildApp(overrides = {}) {
  const config = overrides.config || loadConfig();

  const app = Fastify({
    logger: loggerOptions(config),
    disableRequestLogging: config.nodeEnv === 'test',
    // /api/v1/orders and /api/v1/orders/ hit the same route (Fastify 5: router option).
    routerOptions: { ignoreTrailingSlash: true },
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });

  app.decorate('config', config);

  // Infra singletons — db is ACTIVE; cache/storage/bus are structured-but-dark
  // (decorated so a later phase just *starts using* them; nothing consumes them now).
  await app.register(dbPlugin, { databaseUrl: config.databaseUrl });
  app.decorate('cache', createCache(config));
  app.decorate('storage', createStorage(config));
  app.decorate('bus', createBus());

  // Cross-cutting plugins (uniform error shape, security headers, CORS, auth seam).
  await app.register(errorHandler);
  await app.register(helmetPlugin);
  await app.register(corsPlugin);
  await app.register(authPlugin);
  await app.register(realtimePlugin);

  // Operational surface.
  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.register(metricsRoutes);

  // The 9 service plugins, each mounted at /api/v1/<name>.
  for (const svc of SERVICES) {
    await app.register(svc.plugin, { prefix: `/api/v1/${svc.name}` });
  }

  return app;
}
