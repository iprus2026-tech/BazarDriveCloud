// /server/src/plugins/realtime.js — the realtime MOUNT POINT only (ADR BD-DOCS-041). The
// transport (WebSocket vs SSE vs polling) is owned by BD-DOCS-033/034/036 and is NOT
// chosen here. Phase 1 keeps the client's pull-on-navigation model, so this is DARK: no
// routes, no transport. It exists so realtime later mounts in ONE known place against
// fastify.bus (infra/bus.js).
import fp from 'fastify-plugin';

async function realtimePlugin(app) {
  app.decorate('realtimeEnabled', false);
  // Future (Phase 2+): mount WS/SSE here and bridge fastify.bus topics to clients.
}

export default fp(realtimePlugin, { name: 'realtime' });
