// /server/src/infra/db.js — the pg Pool, decorated as fastify.db. This is the ONLY place
// that owns the connection; repositories/* receive `db` and own the SQL (the single seam
// for any future DB engine change). ACTIVE in Phase 1 (ADR BD-DOCS-041). The Pool is
// lazy — constructing it does not connect — so buildApp() is testable with no live
// database; the first query (or /readyz) opens a connection.
import fp from 'fastify-plugin';
import pg from 'pg';

const { Pool } = pg;

async function dbPlugin(app, opts) {
  const pool = new Pool({
    connectionString: opts.databaseUrl,
    max: opts.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // A pool 'error' on an idle client must not crash the process.
  pool.on('error', (err) => app.log.error({ err }, 'pg pool error'));

  const db = {
    query: (text, params) => pool.query(text, params),

    // Transaction helper for the multi-statement steps (e.g. the ACCEPTED assignment,
    // BD-DOCS-041): runs fn(client) inside BEGIN/COMMIT, ROLLBACK on throw.
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    // Readiness check (used by /readyz): connectivity AND that the migrations the LIVE endpoints
    // depend on are applied — not just 0002's auth_session and 0003's widened
    // ride_events.type CHECK, but also 0004's transactional notification_outbox. Without that
    // final leg an env could report ready while every accepted Ride transition rolls back at the
    // outbox insert. A bare SELECT 1 would report a fresh, un-migrated database as ready.
    //
    // 0005 (BD-DRIVER-VEHICLE-ASSIGNMENT-AUTHORITY-01B) is included too, even though no route
    // reads it live yet: readiness is a schema-completeness gate, not a "some endpoint calls
    // this today" gate, so a future 01C route landing behind this same /readyz never has to
    // remember to widen the check — a database with 0001-0004 but not 0005 must already report
    // schema-incomplete. Checked structurally (load-bearing columns + named constraints +
    // trigger), not just to_regclass — a same-named-but-wrong-shape table must not pass.
    //
    // 0006 (BD-DRIVER-SHIFT-AUTHORITY-01B) extends this the same way: driver_shift has no live
    // route yet either, but a database with 0001-0005 and not 0006 must already report
    // schema-incomplete, not just when 01C eventually wires a route behind it.
    //
    // 0007 (BD-DRIVER-DOCUMENT-COMPLIANCE-01B rebuild) extends this identically once more:
    // driver_document_lineages/driver_documents have no live route yet either, but a database
    // with 0001-0006 and not 0007 must already report schema-incomplete.
    //
    // 0009 (BD-MERCHANT-IDENTITY-CONTACT-AUTHORITY-01B) extends schema completeness to the
    // Merchant Identity/Contact dark authority. 0008 remains reserved by the frozen vehicle
    // block-state contract and is intentionally untouched/absent in this slice; numbering gaps
    // do not weaken readiness because the actual load-bearing 0009 objects are checked directly.
    async ready() {
      const { rows } = await pool.query(
        `SELECT to_regclass('public.auth_session') IS NOT NULL
            AND EXISTS (
              SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = 'notification_outbox'
                 AND c.relkind = 'r'
                 AND (
                   SELECT count(*)
                     FROM pg_attribute a
                    WHERE a.attrelid = c.oid
                      AND a.attnum > 0
                      AND NOT a.attisdropped
                      AND a.attname IN (
                        'outbox_seq', 'source_event_id', 'occurred_at',
                        'immutable_envelope', 'immutable_digest', 'created_at'
                      )
                 ) = 6
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'notification_outbox_pkey'
                      AND pc.contype = 'p'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'notification_outbox_source_event_id_key'
                      AND pc.contype = 'u'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = c.oid
                      AND t.tgname = 'trg_notification_outbox_no_mutation'
                      AND NOT t.tgisinternal
                 )
            )
            AND to_regprocedure(
              'public.notification_outbox_insert_guarded(uuid,jsonb,bytea,text)'
            ) IS NOT NULL
            AND EXISTS (
              SELECT 1
                FROM pg_constraint pc
                JOIN pg_class c ON c.oid = pc.conrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = 'ride_events'
                 AND pc.conname = 'ride_events_type_check'
                 AND pc.contype = 'c'
                 AND pg_get_constraintdef(pc.oid) LIKE '%status_change%'
            )
            AND EXISTS (
              SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = 'vehicle_driver_assignments'
                 AND c.relkind = 'r'
                 AND (
                   SELECT count(*)
                     FROM pg_attribute a
                    WHERE a.attrelid = c.oid
                      AND a.attnum > 0
                      AND NOT a.attisdropped
                      AND a.attname IN (
                        'id', 'vehicle_id', 'driver_id', 'assigned_by_user_id',
                        'assigned_by_service_id', 'assignment_type', 'status',
                        'starts_at', 'ends_at', 'entitlement_window', 'terminated_at',
                        'created_at', 'updated_at'
                      )
                 ) = 13
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'vehicle_driver_assignments_pkey'
                      AND pc.contype = 'p'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'vehicle_driver_assignments_actor_xor'
                      AND pc.contype = 'c'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'vehicle_driver_assignments_window_check'
                      AND pc.contype = 'c'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'vehicle_driver_assignments_active_iff_not_terminated'
                      AND pc.contype = 'c'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'vehicle_driver_assignments_id_driver_uq'
                      AND pc.contype = 'u'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'vehicle_driver_assignments_no_overlap'
                      AND pc.contype = 'x'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = c.oid
                      AND t.tgname = 'trg_vehicle_driver_assignments_updated_at'
                      AND NOT t.tgisinternal
                 )
            )
            AND EXISTS (
              SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = 'driver_active_vehicle'
                 AND c.relkind = 'r'
                 AND (
                   SELECT count(*)
                     FROM pg_attribute a
                    WHERE a.attrelid = c.oid
                      AND a.attnum > 0
                      AND NOT a.attisdropped
                      AND a.attname IN ('driver_id', 'assignment_id', 'selected_at', 'updated_at')
                 ) = 4
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'driver_active_vehicle_pkey'
                      AND pc.contype = 'p'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'driver_active_vehicle_assignment_driver_fkey'
                      AND pc.contype = 'f'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = c.oid
                      AND t.tgname = 'trg_driver_active_vehicle_updated_at'
                      AND NOT t.tgisinternal
                 )
            )
            AND EXISTS (
              SELECT 1 FROM pg_constraint pc
               JOIN pg_class c ON c.oid = pc.conrelid
               WHERE c.relname = 'vehicle_driver_assignments'
                 AND pc.conname = 'vehicle_driver_assignments_id_driver_vehicle_uq'
                 AND pc.contype = 'u'
            )
            AND EXISTS (
              SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = 'driver_shift'
                 AND c.relkind = 'r'
                 AND (
                   SELECT count(*)
                     FROM pg_attribute a
                    WHERE a.attrelid = c.oid
                      AND a.attnum > 0
                      AND NOT a.attisdropped
                      AND a.attname IN (
                        'id', 'driver_id', 'vehicle_id', 'assignment_id', 'status',
                        'opened_at', 'closed_at', 'close_reason', 'updated_at'
                      )
                 ) = 9
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'driver_shift_pkey'
                      AND pc.contype = 'p'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'driver_shift_assignment_driver_vehicle_fkey'
                      AND pc.contype = 'f'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'driver_shift_lifecycle_check'
                      AND pc.contype = 'c'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'driver_shift_close_reason_check'
                      AND pc.contype = 'c'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_class ci
                    WHERE ci.relname = 'driver_shift_one_open_per_driver_uq'
                      AND ci.relkind = 'i'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_class ci
                    WHERE ci.relname = 'driver_shift_one_open_per_vehicle_uq'
                      AND ci.relkind = 'i'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = c.oid
                      AND t.tgname = 'trg_driver_shift_guard_immutability'
                      AND NOT t.tgisinternal
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = c.oid
                      AND t.tgname = 'trg_driver_shift_updated_at'
                      AND NOT t.tgisinternal
                 )
            )
            -- 0007 (BD-DRIVER-DOCUMENT-COMPLIANCE-01B rebuild) — the two additive composite
            -- keys on driver_shift, purely additive FK targets for driver_document_lineages'
            -- own composite FKs below.
            AND EXISTS (
              SELECT 1 FROM pg_constraint pc
               JOIN pg_class c ON c.oid = pc.conrelid
               WHERE c.relname = 'driver_shift'
                 AND pc.conname = 'driver_shift_id_driver_uq'
                 AND pc.contype = 'u'
            )
            AND EXISTS (
              SELECT 1 FROM pg_constraint pc
               JOIN pg_class c ON c.oid = pc.conrelid
               WHERE c.relname = 'driver_shift'
                 AND pc.conname = 'driver_shift_id_driver_vehicle_uq'
                 AND pc.contype = 'u'
            )
            AND EXISTS (
              SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = 'driver_document_lineages'
                 AND c.relkind = 'r'
                 AND (
                   SELECT count(*)
                     FROM pg_attribute a
                    WHERE a.attrelid = c.oid
                      AND a.attnum > 0
                      AND NOT a.attisdropped
                      AND a.attname IN (
                        'id', 'document_type', 'driver_id', 'vehicle_id', 'shift_id', 'created_at'
                      )
                 ) = 6
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'driver_document_lineages_pkey'
                      AND pc.contype = 'p'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'driver_document_lineages_document_type_check'
                      AND pc.contype = 'c'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'driver_document_lineages_subject_shape_check'
                      AND pc.contype = 'c'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'driver_document_lineages_shift_driver_fkey'
                      AND pc.contype = 'f'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'driver_document_lineages_shift_driver_vehicle_fkey'
                      AND pc.contype = 'f'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_class ci
                    WHERE ci.relname = 'driver_document_lineages_driver_license_uq' AND ci.relkind = 'i'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_class ci
                    WHERE ci.relname = 'driver_document_lineages_taxi_osago_uq' AND ci.relkind = 'i'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_class ci
                    WHERE ci.relname = 'driver_document_lineages_taxi_registry_uq' AND ci.relkind = 'i'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_class ci
                    WHERE ci.relname = 'driver_document_lineages_waybill_uq' AND ci.relkind = 'i'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_class ci
                    WHERE ci.relname = 'driver_document_lineages_medical_check_uq' AND ci.relkind = 'i'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = c.oid
                      AND t.tgname = 'trg_driver_document_lineages_guard_immutability'
                      AND NOT t.tgisinternal
                 )
            )
            AND EXISTS (
              SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = 'driver_documents'
                 AND c.relkind = 'r'
                 AND (
                   SELECT count(*)
                     FROM pg_attribute a
                    WHERE a.attrelid = c.oid
                      AND a.attnum > 0
                      AND NOT a.attisdropped
                      AND a.attname IN (
                        'id', 'lineage_id', 'status', 'supersedes_id', 'object_key',
                        'issued_at', 'valid_from', 'valid_until', 'verified_at',
                        'verification_source', 'verification_reason', 'created_at', 'updated_at'
                      )
                 ) = 13
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'driver_documents_pkey'
                      AND pc.contype = 'p'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'driver_documents_status_check'
                      AND pc.contype = 'c'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'driver_documents_lineage_id_fkey'
                      AND pc.contype = 'f'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'driver_documents_supersedes_id_fkey'
                      AND pc.contype = 'f'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'driver_documents_supersedes_id_key'
                      AND pc.contype = 'u'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_class ci
                    WHERE ci.relname = 'driver_documents_one_open_per_lineage_uq' AND ci.relkind = 'i'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = c.oid
                      AND t.tgname = 'trg_driver_documents_guard_immutability'
                      AND NOT t.tgisinternal
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = c.oid
                      AND t.tgname = 'trg_driver_documents_updated_at'
                      AND NOT t.tgisinternal
                 )
            -- 0009 (BD-MERCHANT-IDENTITY-CONTACT-AUTHORITY-01B) — 0008 is intentionally
            -- reserved by the frozen vehicle block-state contract and may not exist yet.
            -- Merchant authority is still a readiness dependency once 0009 is present: the
            -- dark seam must never be wired later against a same-named-but-wrong-shape schema.
            AND EXISTS (
              SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = 'merchants'
                 AND c.relkind = 'r'
                 AND (
                   SELECT count(*) FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                      AND a.attname IN ('id','display_name','status','created_at','updated_at')
                 ) = 5
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchants_pkey' AND pc.contype='p')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchants_display_name_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchants_status_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema='public' AND ic.table_name='merchants' AND ic.column_name='status' AND ic.column_default LIKE '%SUSPENDED%')
                 AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='trg_merchants_guard_lifecycle' AND NOT t.tgisinternal AND pg_get_triggerdef(t.oid) LIKE '%BEFORE%' AND pg_get_triggerdef(t.oid) LIKE '%INSERT%' AND pg_get_triggerdef(t.oid) LIKE '%UPDATE%')
                 AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='trg_merchants_updated_at' AND NOT t.tgisinternal)
            )
            AND EXISTS (
              SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = 'merchant_memberships'
                 AND c.relkind = 'r'
                 AND (
                   SELECT count(*) FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                      AND a.attname IN (
                        'id','merchant_id','user_id','membership_role','status',
                        'granted_at','revoked_at','created_at','updated_at'
                      )
                 ) = 9
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_memberships_pkey' AND pc.contype='p')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_memberships_merchant_id_fkey' AND pc.contype='f' AND pc.confrelid='public.merchants'::regclass AND pc.confdeltype='r')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_memberships_user_id_fkey' AND pc.contype='f' AND pc.confrelid='public.users'::regclass AND pc.confdeltype='r')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_memberships_role_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_memberships_status_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_memberships_lifecycle_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_class ci JOIN pg_namespace ni ON ni.oid=ci.relnamespace JOIN pg_index pi ON pi.indexrelid=ci.oid WHERE ni.nspname='public' AND ci.relname='merchant_memberships_one_active_per_user_uq' AND ci.relkind='i' AND pi.indisunique AND pg_get_indexdef(ci.oid,1,true)='merchant_id' AND pg_get_indexdef(ci.oid,2,true)='user_id' AND pg_get_expr(pi.indpred,pi.indrelid) LIKE '%status%ACTIVE%')
                 AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='trg_merchant_memberships_guard_immutability' AND NOT t.tgisinternal AND pg_get_triggerdef(t.oid) LIKE '%BEFORE%' AND pg_get_triggerdef(t.oid) LIKE '%DELETE%' AND pg_get_triggerdef(t.oid) LIKE '%UPDATE%')
                 AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='trg_merchant_memberships_updated_at' AND NOT t.tgisinternal)
            )
            AND EXISTS (
              SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = 'merchant_locations'
                 AND c.relkind = 'r'
                 AND (
                   SELECT count(*) FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                      AND a.attname IN (
                        'id','merchant_id','label','address_text','lat','lng','pickup_instructions',
                        'is_default_pickup','status','created_at','updated_at'
                      )
                 ) = 11
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_locations_pkey' AND pc.contype='p')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_locations_merchant_id_fkey' AND pc.contype='f' AND pc.confrelid='public.merchants'::regclass AND pc.confdeltype='r')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_locations_label_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_locations_address_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_locations_pickup_instructions_length_check' AND pc.contype='c' AND pg_get_constraintdef(pc.oid) LIKE '%length(pickup_instructions) <= 512%')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_locations_status_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_locations_coordinates_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_class ci JOIN pg_namespace ni ON ni.oid=ci.relnamespace JOIN pg_index pi ON pi.indexrelid=ci.oid WHERE ni.nspname='public' AND ci.relname='merchant_locations_one_active_default_uq' AND ci.relkind='i' AND pi.indisunique AND pg_get_indexdef(ci.oid,1,true)='merchant_id' AND pg_get_expr(pi.indpred,pi.indrelid) LIKE '%status%ACTIVE%' AND pg_get_expr(pi.indpred,pi.indrelid) LIKE '%is_default_pickup%')
                 AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='trg_merchant_locations_guard_immutability' AND NOT t.tgisinternal)
                 AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='trg_merchant_locations_updated_at' AND NOT t.tgisinternal)
            )
            AND EXISTS (
              SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = 'external_contact_identities'
                 AND c.relkind = 'r'
                 AND (
                   SELECT count(*) FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                      AND a.attname IN (
                        'id','channel','subject_namespace','canonical_subject_key','phone_e164',
                        'display_name','status','channel_proof','linked_user_id','linked_at','revoked_at',
                        'created_at','updated_at'
                      )
                 ) = 13
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='external_contact_identities_pkey' AND pc.contype='p')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='external_contact_identities_linked_user_id_fkey' AND pc.contype='f' AND pc.confrelid='public.users'::regclass AND pc.confdeltype='r')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='external_contact_identities_canonical_uq' AND pc.contype='u' AND pg_get_constraintdef(pc.oid)='UNIQUE (channel, subject_namespace, canonical_subject_key)')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='external_contact_identities_channel_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='external_contact_identities_namespace_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='external_contact_identities_subject_key_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='external_contact_identities_phone_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='external_contact_identities_status_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='external_contact_identities_channel_proof_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='external_contact_identities_link_shape_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='external_contact_identities_lifecycle_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='trg_external_contact_identities_guard_immutability' AND NOT t.tgisinternal)
                 AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='trg_external_contact_identities_updated_at' AND NOT t.tgisinternal)
            )
            AND EXISTS (
              SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = 'merchant_contact_bindings'
                 AND c.relkind = 'r'
                 AND (
                   SELECT count(*) FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                      AND a.attname IN (
                        'id','merchant_id','external_contact_identity_id','relationship','status',
                        'bound_at','revoked_at','provenance','created_at','updated_at'
                      )
                 ) = 10
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_contact_bindings_pkey' AND pc.contype='p')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_contact_bindings_merchant_id_fkey' AND pc.contype='f' AND pc.confrelid='public.merchants'::regclass AND pc.confdeltype='r')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_contact_bindings_external_contact_identity_id_fkey' AND pc.contype='f' AND pc.confrelid='public.external_contact_identities'::regclass AND pc.confdeltype='r')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_contact_bindings_relationship_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_contact_bindings_status_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_contact_bindings_provenance_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conrelid=c.oid AND pc.conname='merchant_contact_bindings_lifecycle_check' AND pc.contype='c')
                 AND EXISTS (SELECT 1 FROM pg_class ci JOIN pg_namespace ni ON ni.oid=ci.relnamespace JOIN pg_index pi ON pi.indexrelid=ci.oid WHERE ni.nspname='public' AND ci.relname='merchant_contact_bindings_one_active_uq' AND ci.relkind='i' AND pi.indisunique AND pg_get_indexdef(ci.oid,1,true)='merchant_id' AND pg_get_indexdef(ci.oid,2,true)='external_contact_identity_id' AND pg_get_expr(pi.indpred,pi.indrelid) LIKE '%status%ACTIVE%')
                 AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='trg_merchant_contact_bindings_guard_immutability' AND NOT t.tgisinternal)
                 AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='trg_merchant_contact_bindings_updated_at' AND NOT t.tgisinternal)
            )
            ) AS ok`,
      );
      return rows[0]?.ok === true;
    },
  };

  app.decorate('db', db);
  app.addHook('onClose', async () => { await pool.end(); });
}

export default fp(dbPlugin, { name: 'db' });
