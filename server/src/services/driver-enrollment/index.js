// /server/src/services/driver-enrollment/index.js — driver enrollment for the applicant
// (BD-AUTH-POLICY-01B-A; docs/driver-role-grant-contract.md §1). Mounted at /api/v1/drivers.
//   POST /enrollment -> 201 { enrollment, roles }  a new application (PENDING, or APPROVED when
//                       200 { enrollment, roles }  DRIVER_ENROLLMENT_AUTO_APPROVE is on — the
//                                                  local stand only); 200 when the application is
//                                                  already pending or the grant is already held
//   GET  /enrollment -> 200 { enrollment, roles }  the caller's latest application (or null)
//
// The applicant never sends roles or any other field: the body must be absent or `{}`.
// Decisions (approve / reject / revoke) are not HTTP routes in this slice — they go through
// decideDriverEnrollment, run by the operator command `npm run ops:driver`.
import {
  submitDriverEnrollment, readDriverEnrollment, serializeEnrollment,
} from './decisions.js';

const problem = (reply, status, code, error, retryable = false) =>
  reply.code(status).send({ error, code, retryable });

const FAILURES = {
  ACCOUNT_NOT_FOUND: [401, 'UNAUTHENTICATED', 'authentication required'],
  PHONE_NOT_VERIFIED: [403, 'PHONE_NOT_VERIFIED', 'a verified phone is required'],
  ENROLLMENT_STATE_CONFLICT: [409, 'ENROLLMENT_STATE_CONFLICT', 'the driver enrollment needs operator review'],
};

const ENROLLMENT_RESPONSE = {
  type: 'object',
  additionalProperties: false,
  required: ['enrollment', 'roles'],
  properties: {
    enrollment: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['status', 'requestedAt', 'decidedAt'],
      properties: {
        status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'REVOKED'] },
        requestedAt: { type: 'string' },
        decidedAt: { type: ['string', 'null'] },
      },
    },
    roles: { type: 'array', items: { type: 'string' } },
  },
};

// The authenticated applicant, or a reply already sent.
async function applicant(req, reply) {
  const viewer = await req.resolveUser();
  if (req.authError) {
    problem(reply, 503, 'SESSION_LOOKUP_FAILED', 'session lookup failed', true);
    return null;
  }
  if (!viewer) {
    problem(reply, 401, 'UNAUTHENTICATED', 'authentication required');
    return null;
  }
  if (viewer.phoneVerified !== true) {
    problem(reply, 403, 'PHONE_NOT_VERIFIED', 'a verified phone is required');
    return null;
  }
  return viewer;
}

function sendFailure(reply, result) {
  const [status, code, error] = FAILURES[result.code] ?? [500, 'INTERNAL', 'internal error'];
  return problem(reply, status, code, error);
}

export default async function driverEnrollmentService(app) {
  const autoApprove = app.config?.drivers?.enrollmentAutoApprove === true;

  app.post('/enrollment', {
    preValidation: async (req, reply) => {
      const body = req.body;
      const empty = body === undefined
        || (body !== null && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0);
      if (!empty || Object.keys(req.query).length > 0) {
        return problem(reply, 400, 'VALIDATION', 'driver enrollment takes no body fields or query parameters');
      }
    },
    schema: { response: { 200: ENROLLMENT_RESPONSE, 201: ENROLLMENT_RESPONSE } },
  }, async (req, reply) => {
    const viewer = await applicant(req, reply);
    if (!viewer) return reply;
    const result = await submitDriverEnrollment(app.db, { userId: viewer.userId, autoApprove });
    if (!result.ok) return sendFailure(reply, result);
    return reply.code(result.created ? 201 : 200).send({
      enrollment: serializeEnrollment(result.enrollment),
      roles: result.roles,
    });
  });

  app.get('/enrollment', {
    schema: { response: { 200: ENROLLMENT_RESPONSE } },
  }, async (req, reply) => {
    const viewer = await applicant(req, reply);
    if (!viewer) return reply;
    const result = await readDriverEnrollment(app.db, { userId: viewer.userId });
    if (!result.ok) return sendFailure(reply, result);
    return { enrollment: serializeEnrollment(result.enrollment), roles: result.roles };
  });
}
