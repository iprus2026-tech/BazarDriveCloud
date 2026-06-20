// /server/src/index.js — process entrypoint: build the app, listen, and shut down
// gracefully on SIGTERM/SIGINT (clean pg pool drain via the db plugin's onClose hook).
// buildApp() stays listen-free so tests import it directly. Per ADR BD-DOCS-041.
import { buildApp } from './server.js';

const app = await buildApp();

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    app.log.info(`${signal} received — shutting down`);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}

try {
  await app.listen({ port: app.config.port, host: app.config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
