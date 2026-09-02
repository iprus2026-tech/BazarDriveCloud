// /server/src/services/safety/index.js
// #7 Safety & Compliance, partially lit by BD-DRIVER-DOCUMENT-COMPLIANCE-01B
// (#955). One authenticated self-scoped read is live:
//
//   GET /api/v1/safety/driver/compliance
//
// Every other Safety path remains the explicit 501 skeleton. Upload, object
// storage, verification writes, moderation, risk, audit and ONLINE enforcement
// remain dark and are intentionally absent from this slice.
import {
  DRIVER_DOCUMENT_STATUSES,
  DRIVER_DOCUMENT_TYPES,
  buildDriverComplianceProjection,
} from '../../domain/driver-compliance.js';
import { listDriverDocumentsForDriver } from '../../repositories/driver_documents.js';
import { darkService } from '../_skeleton.js';

const problem = (reply, status, code, error, retryable = false) =>
  reply.code(status).send({ error, code, retryable });

const nullableTimestamp = { type: ['string', 'null'], format: 'date-time' };
const remainingSafetyService = darkService(
  'safety',
  '#7 Safety & Compliance — only driver compliance read is live; remaining surfaces dark',
);

export default async function safetyService(app) {
  app.get('/driver/compliance', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: [
            'driverId', 'documents', 'documentsReady', 'shiftReady',
            'lineReady', 'blockingReasons', 'warnings', 'evaluatedAt',
          ],
          properties: {
            driverId: { type: 'string' },
            documents: {
              type: 'array',
              minItems: DRIVER_DOCUMENT_TYPES.length,
              maxItems: DRIVER_DOCUMENT_TYPES.length,
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'id', 'type', 'scope', 'status', 'validFrom', 'validUntil',
                  'issuedAt', 'verifiedAt', 'verificationReason', 'updatedAt',
                ],
                properties: {
                  id: { type: ['string', 'null'] },
                  type: { type: 'string', enum: DRIVER_DOCUMENT_TYPES },
                  scope: { type: 'string', enum: ['LONG_LIVED', 'SHIFT'] },
                  status: { type: 'string', enum: DRIVER_DOCUMENT_STATUSES },
                  validFrom: nullableTimestamp,
                  validUntil: nullableTimestamp,
                  issuedAt: nullableTimestamp,
                  verifiedAt: nullableTimestamp,
                  verificationReason: { type: ['string', 'null'] },
                  updatedAt: nullableTimestamp,
                },
              },
            },
            documentsReady: { type: 'boolean' },
            shiftReady: { type: 'boolean' },
            lineReady: { type: 'boolean' },
            blockingReasons: { type: 'array', items: { type: 'string' } },
            warnings: { type: 'array', items: { type: 'string' } },
            evaluatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const viewer = await req.resolveUser();
    if (req.authError) {
      return problem(
        reply,
        503,
        'SESSION_LOOKUP_FAILED',
        'session lookup failed',
        true,
      );
    }
    if (!viewer) {
      return problem(reply, 401, 'UNAUTHENTICATED', 'authentication required');
    }

    const rows = await listDriverDocumentsForDriver(app.db, viewer.userId);
    const projection = buildDriverComplianceProjection(rows, {
      driverId: String(viewer.userId),
      evaluatedAt: new Date(),
    });

    reply.header('Cache-Control', 'no-store');
    return reply.send(projection);
  });

  // Preserve the architecture-visible dark boundary for every unimplemented
  // Safety capability, including the bare /api/v1/safety prefix.
  await remainingSafetyService(app);
}
