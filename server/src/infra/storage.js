// /server/src/infra/storage.js — createStorage(): an S3-compatible client (the concrete
// self-hosted engine is owned by BD-DOCS-037) when S3_* is configured, else a no-op
// fallback (ADR BD-DOCS-041: structured-but-dark). Phase-1 receipts are DB rows
// (BD-RIDE-HISTORY-D-01), so there is NO Phase-1 blob consumer. Decorated as
// fastify.storage; the DB will store only object keys when this lights up (Phase 5/6).
export function createStorage(config) {
  if (config.s3?.endpoint) {
    throw new Error(
      'S3_* is set but the object-storage driver is not wired yet (Phase 5/6 / BD-DOCS-037)',
    );
  }
  return {
    kind: 'noop',
    async putObject() { throw new Error('object storage is not wired in Phase 1'); },
    async getSignedUrl() { throw new Error('object storage is not wired in Phase 1'); },
  };
}
