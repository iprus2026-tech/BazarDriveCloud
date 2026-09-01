// /server/src/repositories/notification_outbox.js — the sole write seam for the immutable
// notification source ledger introduced by BD-NOTIF-OUTBOX-RUNTIME-01B (#943). The first and
// only producer is Ride State's accepted status transition. This module does not publish,
// lease, retry or expose a consumer API; those are separate delivery slices.
import { createHash } from 'node:crypto';

import { isValidRideStatus } from '../domain/ride-status.js';

const EVENT_TYPE = 'ride.status_changed.v1';
const SCHEMA_VERSION = 1;
const PRODUCER = 'ride-state';
// PostgreSQL's uuid type accepts old, current and future UUID versions. Validate only the
// canonical 8-4-4-4-12 shape here; do not accidentally reject a future v7 identity.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invariant(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeUuid(value, field) {
  const normalized = String(value ?? '').toLowerCase();
  if (!UUID.test(normalized)) {
    throw invariant('NOTIFICATION_OUTBOX_SOURCE_INVALID', `invalid ${field}`);
  }
  return normalized;
}

function assertWellFormedString(value) {
  // RFC 8785 requires Unicode scalar values. JSON.stringify would silently escape lone
  // surrogates, so reject them before hashing rather than producing a non-JCS digest.
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw invariant('NOTIFICATION_OUTBOX_CANONICALIZATION_FAILED', 'invalid unicode string');
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw invariant('NOTIFICATION_OUTBOX_CANONICALIZATION_FAILED', 'invalid unicode string');
    }
  }
}

// RFC 8785 / JCS for JSON-compatible values. Object keys use ECMAScript's UTF-16 lexical
// ordering; strings/numbers use ECMAScript JSON serialization. The envelope currently contains
// only strings and the safe integer 1, but the complete guard prevents silent future drift.
function canonicalize(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    assertWellFormedString(value);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw invariant('NOTIFICATION_OUTBOX_CANONICALIZATION_FAILED', 'non-finite number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    // Array.from visits holes (as undefined), which makes the guard reject sparse arrays rather
    // than accidentally serializing invalid JCS such as "[,x]".
    return `[${Array.from({ length: value.length }, (_, index) => canonicalize(value[index])).join(',')}]`;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw invariant('NOTIFICATION_OUTBOX_CANONICALIZATION_FAILED', 'unsupported object type');
    }
    return `{${Object.keys(value).sort().map((key) => {
      const member = value[key];
      if (member === undefined) {
        throw invariant('NOTIFICATION_OUTBOX_CANONICALIZATION_FAILED', 'undefined object member');
      }
      assertWellFormedString(key);
      return `${JSON.stringify(key)}:${canonicalize(member)}`;
    }).join(',')}}`;
  }
  throw invariant('NOTIFICATION_OUTBOX_CANONICALIZATION_FAILED', 'unsupported JSON value');
}

function digestEnvelope(envelope) {
  return createHash('sha256').update(canonicalize(envelope), 'utf8').digest();
}

function sameDigest(left, rightHex) {
  return left.equals(Buffer.from(rightHex, 'hex'));
}

async function loadStatusChangeSource(db, sourceEventId) {
  const { rows } = await db.query(
    `SELECT e.id::text AS source_event_id,
            e.role,
            e.payload->>'from' AS from_status,
            e.payload->>'to' AS to_status,
            to_char(e.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
            r.id::text AS aggregate_id,
            r.trip_id AS aggregate_key,
            r.passenger_user_id::text AS passenger_user_id,
            r.driver_user_id::text AS driver_user_id
       FROM ride_events e
       JOIN rides r ON r.id = e.ride_id AND r.trip_id = e.trip_id
      WHERE e.id = $1::uuid AND e.type = 'status_change'`,
    [sourceEventId],
  );
  return rows[0] ?? null;
}

function buildEnvelope(source, { actorUserId, actorRole }) {
  if (!source) {
    throw invariant('NOTIFICATION_OUTBOX_SOURCE_INVALID', 'status-change source not found');
  }

  const eventId = normalizeUuid(source.source_event_id, 'source event id');
  const aggregateId = normalizeUuid(source.aggregate_id, 'aggregate id');
  const actorId = normalizeUuid(actorUserId, 'actor user id');
  if (actorRole !== 'passenger' && actorRole !== 'driver') {
    throw invariant('NOTIFICATION_OUTBOX_SOURCE_INVALID', 'invalid actor role');
  }
  if (source.role !== actorRole) {
    throw invariant('NOTIFICATION_OUTBOX_SOURCE_INVALID', 'actor role does not match source');
  }

  const participantForRole = actorRole === 'driver'
    ? source.driver_user_id
    : source.passenger_user_id;
  if (!participantForRole || normalizeUuid(participantForRole, 'participant user id') !== actorId) {
    throw invariant('NOTIFICATION_OUTBOX_SOURCE_INVALID', 'actor is not the source participant');
  }

  const audienceUserIds = [source.passenger_user_id, source.driver_user_id]
    .filter(Boolean)
    .map((id) => normalizeUuid(id, 'audience user id'))
    .sort()
    .filter((id, index, ids) => index === 0 || id !== ids[index - 1]);
  if (audienceUserIds.length === 0 || !audienceUserIds.includes(actorId)) {
    throw invariant('NOTIFICATION_OUTBOX_SOURCE_INVALID', 'invalid frozen audience');
  }

  const fromStatus = source.from_status;
  const toStatus = source.to_status;
  if (!isValidRideStatus(fromStatus) || !isValidRideStatus(toStatus) || fromStatus === toStatus) {
    throw invariant('NOTIFICATION_OUTBOX_SOURCE_INVALID', 'invalid status-change payload');
  }

  if (!source.aggregate_key || !source.occurred_at) {
    throw invariant('NOTIFICATION_OUTBOX_SOURCE_INVALID', 'incomplete status-change source');
  }

  return {
    eventId,
    eventType: EVENT_TYPE,
    schemaVersion: SCHEMA_VERSION,
    producer: PRODUCER,
    aggregate: { type: 'ride', id: aggregateId, key: source.aggregate_key },
    occurredAt: source.occurred_at,
    actor: { userId: actorId, role: actorRole },
    audience: { policyVersion: 1, userIds: audienceUserIds },
    payload: { fromStatus, toStatus },
  };
}

// Must be called inside the same transaction that appends sourceEventId. The INSERT copies
// `e.at` to `occurred_at` directly in PostgreSQL; the exact text embedded in the envelope is
// also rechecked in SQL, so node-pg's millisecond-only Date parser never participates.
export async function insertRideStatusNotificationOutbox(
  db,
  { sourceEventId, actorUserId, actorRole },
) {
  const normalizedSourceId = normalizeUuid(sourceEventId, 'source event id');
  const source = await loadStatusChangeSource(db, normalizedSourceId);
  const envelope = buildEnvelope(source, { actorUserId, actorRole });
  const immutableDigest = digestEnvelope(envelope);

  let inserted;
  try {
    inserted = await db.query(
      `SELECT event_seq
         FROM public.notification_outbox_insert_guarded(
           $1::uuid, $2::jsonb, $3::bytea, $4::text
         )`,
      [normalizedSourceId, envelope, immutableDigest, envelope.occurredAt],
    );
  } catch {
    // The guarded PostgreSQL function strips CHECK row DETAIL before it can reach database logs.
    // This second boundary also keeps raw database errors out of application request logging.
    throw invariant('NOTIFICATION_OUTBOX_INSERT_FAILED', 'notification outbox insert failed');
  }

  if (inserted.rows[0]) {
    return {
      inserted: true,
      eventSeq: inserted.rows[0].event_seq,
      envelope,
      immutableDigest: immutableDigest.toString('hex'),
    };
  }

  const existingResult = await db.query(
    `SELECT outbox_seq::text AS event_seq,
            immutable_envelope,
            encode(immutable_digest, 'hex') AS immutable_digest,
            to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at
       FROM notification_outbox
      WHERE source_event_id = $1::uuid`,
    [normalizedSourceId],
  );
  const existing = existingResult.rows[0];
  if (!existing) {
    throw invariant('NOTIFICATION_OUTBOX_SOURCE_INVALID', 'status-change source was not inserted');
  }

  const sameEnvelope = canonicalize(existing.immutable_envelope) === canonicalize(envelope);
  if (!sameEnvelope
      || !sameDigest(immutableDigest, existing.immutable_digest)
      || existing.occurred_at !== envelope.occurredAt) {
    throw invariant(
      'NOTIFICATION_OUTBOX_SOURCE_COLLISION',
      'notification outbox source collision',
    );
  }

  return {
    inserted: false,
    eventSeq: existing.event_seq,
    envelope: existing.immutable_envelope,
    immutableDigest: existing.immutable_digest,
  };
}
