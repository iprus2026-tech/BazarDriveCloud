-- =============================================================================
-- /server/migrations/0004_notification_outbox.sql
-- BD-NOTIF-OUTBOX-RUNTIME-01B — transactional Ride notification source (#943)
--
-- The outbox is an immutable source ledger, not a delivery queue. Delivery attempts,
-- leases/retries/DLQ state and consumer APIs deliberately do not belong in this slice.
-- `outbox_seq` is a unique discovery cursor allocated by a PostgreSQL sequence; sequence
-- allocation is not transactional, so it is explicitly NOT a commit/completeness watermark.
--
-- `source_event_id` intentionally has no FK to ride_events. The source UUID is durable even
-- when a privileged retention/test path removes an old timeline row, and the unique constraint
-- is the idempotency key. `occurred_at` is copied directly from ride_events.at by the repository
-- in one INSERT ... SELECT, preserving PostgreSQL's full six-digit timestamp precision.
-- =============================================================================

BEGIN;

-- Frozen audiences are lowercase UUID strings in strict C/byte order. Strict increase proves
-- both lexical sorting and deduplication without a subquery in the table CHECK constraint.
CREATE OR REPLACE FUNCTION notification_outbox_user_ids_valid(user_ids JSONB)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  element JSONB;
  current_id TEXT;
  previous_id TEXT := NULL;
BEGIN
  IF jsonb_typeof(user_ids) <> 'array' THEN
    RETURN FALSE;
  END IF;
  IF jsonb_array_length(user_ids) = 0 THEN
    RETURN FALSE;
  END IF;
  FOR element IN
    SELECT entry.value
      FROM jsonb_array_elements(user_ids) WITH ORDINALITY AS entry(value, position)
      ORDER BY entry.position
  LOOP
    IF jsonb_typeof(element) <> 'string' THEN
      RETURN FALSE;
    END IF;
    current_id := element #>> '{}';
    IF current_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN FALSE;
    END IF;
    IF previous_id IS NOT NULL
       AND current_id COLLATE "C" <= previous_id COLLATE "C" THEN
      RETURN FALSE;
    END IF;
    previous_id := current_id;
  END LOOP;
  RETURN TRUE;
END;
$$;

CREATE TABLE IF NOT EXISTS notification_outbox (
  outbox_seq         BIGSERIAL PRIMARY KEY,
  source_event_id    UUID NOT NULL UNIQUE,
  occurred_at        TIMESTAMPTZ(6) NOT NULL,
  immutable_envelope JSONB NOT NULL,
  immutable_digest   BYTEA NOT NULL CHECK (octet_length(immutable_digest) = 32),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT notification_outbox_envelope_object CHECK (
    jsonb_typeof(immutable_envelope) = 'object'
  ),
  CONSTRAINT notification_outbox_envelope_keys CHECK (
    immutable_envelope ?& ARRAY[
      'eventId', 'eventType', 'schemaVersion', 'producer', 'aggregate',
      'occurredAt', 'actor', 'audience', 'payload'
    ]
    AND immutable_envelope - ARRAY[
      'eventId', 'eventType', 'schemaVersion', 'producer', 'aggregate',
      'occurredAt', 'actor', 'audience', 'payload'
    ] = '{}'::jsonb
  ),
  CONSTRAINT notification_outbox_envelope_identity CHECK (
    (
      immutable_envelope->>'eventId' = source_event_id::text
      AND immutable_envelope->>'eventType' = 'ride.status_changed.v1'
      AND immutable_envelope->'schemaVersion' = '1'::jsonb
      AND immutable_envelope->>'producer' = 'ride-state'
    ) IS TRUE
  ),
  CONSTRAINT notification_outbox_envelope_aggregate CHECK (
    (
      jsonb_typeof(immutable_envelope->'aggregate') = 'object'
      AND immutable_envelope->'aggregate' ?& ARRAY['type', 'id', 'key']
      AND (immutable_envelope->'aggregate') - ARRAY['type', 'id', 'key'] = '{}'::jsonb
      AND immutable_envelope#>>'{aggregate,type}' = 'ride'
      AND jsonb_typeof(immutable_envelope#>'{aggregate,id}') = 'string'
      AND immutable_envelope#>>'{aggregate,id}'
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND jsonb_typeof(immutable_envelope#>'{aggregate,key}') = 'string'
      AND coalesce(immutable_envelope#>>'{aggregate,key}', '') <> ''
    ) IS TRUE
  ),
  CONSTRAINT notification_outbox_envelope_occurred_at CHECK (
    (
      jsonb_typeof(immutable_envelope->'occurredAt') = 'string'
      AND immutable_envelope->>'occurredAt'
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
      AND immutable_envelope->>'occurredAt' = to_char(
        occurred_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      )
    ) IS TRUE
  ),
  CONSTRAINT notification_outbox_envelope_actor CHECK (
    (
      jsonb_typeof(immutable_envelope->'actor') = 'object'
      AND immutable_envelope->'actor' ?& ARRAY['userId', 'role']
      AND (immutable_envelope->'actor') - ARRAY['userId', 'role'] = '{}'::jsonb
      AND jsonb_typeof(immutable_envelope#>'{actor,userId}') = 'string'
      AND immutable_envelope#>>'{actor,userId}'
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND immutable_envelope#>>'{actor,role}' IN ('passenger', 'driver')
    ) IS TRUE
  ),
  CONSTRAINT notification_outbox_envelope_audience CHECK (
    (
      jsonb_typeof(immutable_envelope->'audience') = 'object'
      AND immutable_envelope->'audience' ?& ARRAY['policyVersion', 'userIds']
      AND (immutable_envelope->'audience') - ARRAY['policyVersion', 'userIds'] = '{}'::jsonb
      AND immutable_envelope#>'{audience,policyVersion}' = '1'::jsonb
      AND notification_outbox_user_ids_valid(immutable_envelope#>'{audience,userIds}')
      AND (immutable_envelope#>'{audience,userIds}') ? (immutable_envelope#>>'{actor,userId}')
    ) IS TRUE
  ),
  CONSTRAINT notification_outbox_envelope_payload CHECK (
    (
      jsonb_typeof(immutable_envelope->'payload') = 'object'
      AND immutable_envelope->'payload' ?& ARRAY['fromStatus', 'toStatus']
      AND (immutable_envelope->'payload') - ARRAY['fromStatus', 'toStatus'] = '{}'::jsonb
      AND jsonb_typeof(immutable_envelope#>'{payload,fromStatus}') = 'string'
      AND jsonb_typeof(immutable_envelope#>'{payload,toStatus}') = 'string'
      AND immutable_envelope#>>'{payload,fromStatus}' IN (
        'NEW_ORDER', 'CONFIRMATION_PENDING', 'CONFIRMED', 'CHAT_STARTED',
        'ACCEPTED', 'DRIVER_EN_ROUTE', 'DRIVER_APPROACHING_PICKUP',
        'WAITING_PASSENGER', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'NO_SHOW'
      )
      AND immutable_envelope#>>'{payload,toStatus}' IN (
        'NEW_ORDER', 'CONFIRMATION_PENDING', 'CONFIRMED', 'CHAT_STARTED',
        'ACCEPTED', 'DRIVER_EN_ROUTE', 'DRIVER_APPROACHING_PICKUP',
        'WAITING_PASSENGER', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'NO_SHOW'
      )
      AND immutable_envelope#>>'{payload,fromStatus}'
        <> immutable_envelope#>>'{payload,toStatus}'
    ) IS TRUE
  )
);

CREATE OR REPLACE FUNCTION notification_outbox_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'notification_outbox is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;

DROP TRIGGER IF EXISTS trg_notification_outbox_no_mutation ON notification_outbox;
CREATE TRIGGER trg_notification_outbox_no_mutation
  BEFORE UPDATE OR DELETE ON notification_outbox FOR EACH ROW
  EXECUTE FUNCTION notification_outbox_block_mutation();

COMMIT;
