// /server/src/infra/bus.js — createBus(): a neutral event hub for the realtime seam (ADR
// BD-DOCS-041). In-process EventEmitter now; the same surface backs Redis pub/sub once
// there is >1 instance (Phase 2+). DARK in Phase 1 — nothing publishes or subscribes yet,
// but the seam exists so services emit domain events through ONE place. Decorated as
// fastify.bus. The realtime transport (WS/SSE/poll) is owned by BD-DOCS-033/034/036, not
// here.
import { EventEmitter } from 'node:events';

export function createBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0); // many service subscribers expected once it lights up

  return {
    kind: 'in-proc',
    publish(topic, payload) { emitter.emit(topic, payload); },
    subscribe(topic, handler) {
      emitter.on(topic, handler);
      return () => emitter.off(topic, handler);
    },
  };
}
