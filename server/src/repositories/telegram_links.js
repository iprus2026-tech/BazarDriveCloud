// SQL-only seam for Telegram channel state. Never writes users, sessions, rides,
// orders, merchant/external contacts or notifications. All writes require db.tx.
export async function lockNamespace(db, scope) {
  // Pilot-scale serialization covers absent-row races as well as revoke/confirm.
  // Other authorities do not take this lock. Keep the transaction free of network I/O.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`telegram-link:${scope.environment}:${scope.botId}`]);
}

export async function appendAudit(db, scope, action, { requestId = null, linkId = null, actorHash = null, sessionId = null } = {}) {
  await db.query(`INSERT INTO telegram_link_audit
    (bot_id, environment, action, request_id, link_id, actor_hash, authorizing_session_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
  [scope.botId, scope.environment, action, requestId, linkId, actorHash, sessionId]);
}

export async function createRateAllowed(db, scope, accountId) {
  const { rows } = await db.query(`SELECT count(*) < 5 AS ok FROM telegram_link_requests
    WHERE bot_id=$1 AND environment=$2 AND account_id=$3
      AND created_at > clock_timestamp() - interval '1 hour'`, [scope.botId, scope.environment, accountId]);
  return rows[0].ok;
}

export async function claimRateAllowed(db, scope, actorHash) {
  const { rows } = await db.query(`SELECT count(*) < 20 AS ok FROM telegram_link_audit
    WHERE bot_id=$1 AND environment=$2 AND actor_hash=$3 AND action='CLAIM_ATTEMPT'
      AND created_at > clock_timestamp() - interval '10 minutes'`, [scope.botId, scope.environment, actorHash]);
  return rows[0].ok;
}

export async function cancelPending(db, scope, accountId, exceptId = null) {
  await db.query(`WITH canceled AS (UPDATE telegram_link_requests SET state='CANCELED'
    WHERE bot_id=$1 AND environment=$2 AND account_id=$3 AND state IN ('PENDING','CLAIMED')
      AND ($4::uuid IS NULL OR id <> $4) RETURNING *)
    INSERT INTO telegram_link_audit(bot_id,environment,request_id,action)
    SELECT bot_id,environment,id,'CANCELED' FROM canceled`, [scope.botId, scope.environment, accountId, exceptId]);
}

export async function insertRequest(db, scope, { accountId, sessionId, tokenHash, comparisonCode }) {
  const { rows } = await db.query(`WITH t AS MATERIALIZED (SELECT clock_timestamp() AS ts)
    INSERT INTO telegram_link_requests
      (bot_id,environment,account_id,session_id,token_hash,comparison_code,created_at,expires_at)
    SELECT $1,$2,$3,$4,$5,$6,t.ts,t.ts + interval '5 minutes' FROM t RETURNING *`,
  [scope.botId, scope.environment, accountId, sessionId, tokenHash, comparisonCode]);
  return rows[0];
}

export async function lockRequestById(db, scope, id) {
  const { rows } = await db.query(`SELECT *, expires_at <= clock_timestamp() AS expired
    FROM telegram_link_requests WHERE bot_id=$1 AND environment=$2 AND id=$3 FOR UPDATE`,
  [scope.botId, scope.environment, id]);
  return rows[0] ?? null;
}

export async function lockRequestByHash(db, scope, hash) {
  const { rows } = await db.query(`SELECT *, expires_at <= clock_timestamp() AS expired
    FROM telegram_link_requests WHERE bot_id=$1 AND environment=$2 AND token_hash=$3 FOR UPDATE`,
  [scope.botId, scope.environment, hash]);
  return rows[0] ?? null;
}

export async function expireRequest(db, id) {
  await db.query(`WITH expired AS (UPDATE telegram_link_requests SET state='EXPIRED'
    WHERE id=$1 AND state IN ('PENDING','CLAIMED') AND expires_at <= clock_timestamp() RETURNING *)
    INSERT INTO telegram_link_audit(bot_id,environment,request_id,action)
    SELECT bot_id,environment,id,'EXPIRED' FROM expired`, [id]);
}

export async function claimRequest(db, id, candidateId) {
  const { rows } = await db.query(`UPDATE telegram_link_requests SET state='CLAIMED', candidate_id=$2
    WHERE id=$1 AND state='PENDING' AND expires_at > clock_timestamp() RETURNING *`, [id, candidateId]);
  return rows[0] ?? null;
}

export async function rejectConfirm(db, id) {
  await db.query(`UPDATE telegram_link_requests SET failed_confirms=failed_confirms+1,
    state=CASE WHEN failed_confirms >= 4 THEN 'CANCELED' ELSE state END
    WHERE id=$1 AND state='CLAIMED' AND failed_confirms < 5`, [id]);
}

export async function confirmRequest(db, id) {
  const { rows } = await db.query(`UPDATE telegram_link_requests SET state='CONFIRMED', confirmed_at=clock_timestamp()
    WHERE id=$1 AND state='CLAIMED' AND failed_confirms < 5 AND expires_at > clock_timestamp() RETURNING *`, [id]);
  return rows[0] ?? null;
}

export async function activeConflict(db, scope, accountId, actorId = null) {
  const { rows } = await db.query(`SELECT 1 FROM telegram_account_links WHERE bot_id=$1 AND environment=$2
    AND status='ACTIVE' AND (account_id=$3 OR telegram_user_id=$4) LIMIT 1`,
  [scope.botId, scope.environment, accountId, actorId]);
  return rows.length > 0;
}

export async function insertLink(db, requestId, sessionExpiresAt) {
  const { rows } = await db.query(`INSERT INTO telegram_account_links
    (request_id,bot_id,environment,account_id,session_id,telegram_user_id,private_chat_id,confirmed_at,grant_expires_at)
    SELECT id,bot_id,environment,account_id,session_id,candidate_id,candidate_id,confirmed_at,
      LEAST($2::timestamptz, confirmed_at + interval '24 hours')
      FROM telegram_link_requests WHERE id=$1 AND state='CONFIRMED' RETURNING *`, [requestId, sessionExpiresAt]);
  return rows[0];
}

export async function findLinkForRequest(db, scope, requestId) {
  const { rows } = await db.query(`SELECT *, grant_expires_at <= clock_timestamp() AS expired
    FROM telegram_account_links WHERE bot_id=$1 AND environment=$2 AND request_id=$3`,
  [scope.botId, scope.environment, requestId]);
  return rows[0] ?? null;
}

export async function lockLink(db, scope, linkId) {
  const { rows } = await db.query(`SELECT *, grant_expires_at <= clock_timestamp() AS expired
    FROM telegram_account_links WHERE bot_id=$1 AND environment=$2 AND id=$3 FOR UPDATE`,
  [scope.botId, scope.environment, linkId]);
  return rows[0] ?? null;
}

export async function revokeLink(db, id) {
  const { rows } = await db.query(`UPDATE telegram_account_links SET status='REVOKED',
    revoked_at=clock_timestamp(), epoch=nextval('telegram_link_epoch_seq')
    WHERE id=$1 AND status='ACTIVE' RETURNING *`, [id]);
  return rows[0] ?? null;
}

// Production always uses public. The internal schema argument lets the same catalog
// checks run against disposable test schemas without changing shared public objects.
export async function telegramLinkSchemaReady(db, schema = 'public') {
  const { rows } = await db.query(`SELECT
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_sequence s ON s.seqrelid=c.oid
      WHERE c.oid=to_regclass(format('%I.telegram_link_epoch_seq',$1::text)) AND c.relkind='S'
        AND s.seqtypid='bigint'::regtype AND s.seqincrement=1 AND s.seqmin=1
        AND s.seqmax=9223372036854775807 AND s.seqcache=1 AND NOT s.seqcycle)
    AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relkind='r' AND c.relname IN
        ('telegram_link_requests','telegram_account_links','telegram_link_audit')) = 3
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('telegram_link_requests','id','uuid',true),('telegram_link_requests','bot_id','text',true),
        ('telegram_link_requests','environment','text',true),('telegram_link_requests','account_id','uuid',true),
        ('telegram_link_requests','session_id','uuid',true),('telegram_link_requests','token_hash','text',true),
        ('telegram_link_requests','comparison_code','text',true),('telegram_link_requests','candidate_id','text',false),
        ('telegram_link_requests','failed_confirms','integer',true),('telegram_link_requests','state','text',true),
        ('telegram_link_requests','created_at','timestamptz',true),('telegram_link_requests','expires_at','timestamptz',true),
        ('telegram_link_requests','confirmed_at','timestamptz',false),
        ('telegram_account_links','id','uuid',true),('telegram_account_links','request_id','uuid',true),
        ('telegram_account_links','bot_id','text',true),('telegram_account_links','environment','text',true),
        ('telegram_account_links','account_id','uuid',true),('telegram_account_links','session_id','uuid',true),
        ('telegram_account_links','telegram_user_id','text',true),('telegram_account_links','private_chat_id','text',true),
        ('telegram_account_links','epoch','bigint',true),('telegram_account_links','status','text',true),
        ('telegram_account_links','confirmed_at','timestamptz',true),('telegram_account_links','grant_expires_at','timestamptz',true),
        ('telegram_account_links','revoked_at','timestamptz',false),
        ('telegram_link_audit','id','bigint',true),('telegram_link_audit','bot_id','text',true),
        ('telegram_link_audit','environment','text',true),('telegram_link_audit','request_id','uuid',false),
        ('telegram_link_audit','link_id','uuid',false),('telegram_link_audit','authorizing_session_id','uuid',false),
        ('telegram_link_audit','action','text',true),('telegram_link_audit','actor_hash','text',false),
        ('telegram_link_audit','created_at','timestamptz',true)
      ) wanted(tbl,col,typ,required) WHERE NOT EXISTS (
        SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass(format('%I.%I',$1,wanted.tbl))
          AND a.attname=wanted.col AND a.atttypid=wanted.typ::regtype AND a.attnotnull=wanted.required
          AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated=''))
    -- These values are omitted by INSERTs. Column presence alone is insufficient.
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('telegram_link_requests','id','gen_random_uuid()'),
        ('telegram_link_requests','state','''PENDING''::text'),
        ('telegram_link_requests','failed_confirms','0'),
        ('telegram_link_requests','created_at','clock_timestamp()'),
        ('telegram_account_links','id','gen_random_uuid()'),
        ('telegram_account_links','status','''ACTIVE''::text'),
        ('telegram_account_links','confirmed_at','clock_timestamp()'),
        ('telegram_link_audit','created_at','clock_timestamp()')
      ) wanted(tbl,col,expr) WHERE NOT EXISTS (
        SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=to_regclass(format('%I.%I',$1,wanted.tbl)) AND a.attname=wanted.col
          AND a.atthasdef AND pg_get_expr(d.adbin,d.adrelid)=wanted.expr))
    -- Compare the default's expression AND its dependency on the exact sequence OID.
    -- Neither a constant, another sequence nor nextval(correct_sequence)+1 is accepted.
    AND EXISTS (
      SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        JOIN pg_depend dep ON dep.classid='pg_attrdef'::regclass AND dep.objid=d.oid
          AND dep.refclassid='pg_class'::regclass AND dep.deptype='n'
        JOIN pg_class seq ON seq.oid=dep.refobjid
      WHERE a.attrelid=to_regclass(format('%I.telegram_account_links',$1)) AND a.attname='epoch'
        AND a.atthasdef AND seq.oid=to_regclass(format('%I.telegram_link_epoch_seq',$1))
        AND pg_get_expr(d.adbin,d.adrelid)=format('nextval(%L::regclass)',seq.oid::regclass::text))
    -- GENERATED ALWAYS identity does not have an ordinary pg_attrdef default.
    AND EXISTS (
      SELECT 1 FROM pg_attribute a JOIN pg_depend dep ON dep.refclassid='pg_class'::regclass
        AND dep.refobjid=a.attrelid AND dep.refobjsubid=a.attnum
        AND dep.classid='pg_class'::regclass AND dep.deptype='i'
        JOIN pg_class seq ON seq.oid=dep.objid AND seq.relkind='S'
        JOIN pg_sequence s ON s.seqrelid=seq.oid
      WHERE a.attrelid=to_regclass(format('%I.telegram_link_audit',$1)) AND a.attname='id'
        AND a.attidentity='a' AND seq.relnamespace=to_regnamespace($1)
        AND s.seqtypid='bigint'::regtype AND s.seqincrement=1 AND NOT s.seqcycle)
    -- PK/UNIQUE checks use ordered column identities and valid supporting indexes.
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('auth_session','u',ARRAY['id','user_id']),
        ('telegram_link_requests','p',ARRAY['id']),
        ('telegram_link_requests','u',ARRAY['token_hash']),
        ('telegram_account_links','p',ARRAY['id']),
        ('telegram_account_links','u',ARRAY['request_id']),
        ('telegram_link_audit','p',ARRAY['id'])
      ) wanted(tbl,typ,cols) WHERE NOT EXISTS (
        SELECT 1 FROM pg_constraint c JOIN pg_index i ON i.indexrelid=c.conindid
        WHERE c.conrelid=to_regclass(format('%I.%I',$1,wanted.tbl)) AND c.contype::text=wanted.typ
          AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
          AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
          AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=cardinality(wanted.cols)
          AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,ord)
            JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num AND NOT a.attisdropped
            ORDER BY k.ord)=wanted.cols))
    -- Validate both sides of every Telegram FK, not just its name or contype.
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('telegram_link_requests',ARRAY['account_id'],'users',ARRAY['id']),
        ('telegram_link_requests',ARRAY['session_id','account_id'],'auth_session',ARRAY['id','user_id']),
        ('telegram_account_links',ARRAY['request_id'],'telegram_link_requests',ARRAY['id']),
        ('telegram_account_links',ARRAY['account_id'],'users',ARRAY['id']),
        ('telegram_account_links',ARRAY['session_id','account_id'],'auth_session',ARRAY['id','user_id']),
        ('telegram_link_audit',ARRAY['request_id'],'telegram_link_requests',ARRAY['id']),
        ('telegram_link_audit',ARRAY['link_id'],'telegram_account_links',ARRAY['id']),
        ('telegram_link_audit',ARRAY['authorizing_session_id'],'auth_session',ARRAY['id'])
      ) wanted(tbl,cols,target,refcols) WHERE NOT EXISTS (
        SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass(format('%I.%I',$1,wanted.tbl))
          AND c.contype='f' AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
          AND c.confrelid=to_regclass(format('%I.%I',$1,wanted.target))
          AND c.confdeltype='r' AND c.confupdtype='a' AND c.confmatchtype='s'
          AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,ord)
            JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num AND NOT a.attisdropped
            ORDER BY k.ord)=wanted.cols
          AND ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(num,ord)
            JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num AND NOT a.attisdropped
            ORDER BY k.ord)=wanted.refcols))
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('auth_session','auth_session_id_user_uq','u'),
        ('telegram_link_requests','telegram_requests_session_account_fk','f'),
        ('telegram_link_requests','telegram_requests_lifecycle_ck','c'),
        ('telegram_link_requests','telegram_requests_time_ck','c'),
        ('telegram_account_links','telegram_links_session_account_fk','f'),
        ('telegram_account_links','telegram_links_private_chat_ck','c'),
        ('telegram_account_links','telegram_links_lifecycle_ck','c'),
        ('telegram_account_links','telegram_links_time_ck','c')
      ) wanted(tbl,con,typ) WHERE NOT EXISTS (
        SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass(format('%I.%I',$1,wanted.tbl))
          AND c.conname=wanted.con AND c.contype::text=wanted.typ AND c.convalidated))
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('telegram_links_active_account_uq','account_id'),('telegram_links_active_actor_uq','telegram_user_id')
      ) wanted(idx,lastkey) WHERE NOT EXISTS (
        SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass(format('%I.%I',$1,wanted.idx))
          AND i.indrelid=to_regclass(format('%I.telegram_account_links',$1))
          AND i.indisunique AND i.indisvalid AND i.indisready AND i.indnkeyatts=3 AND i.indnatts=3
          AND pg_get_indexdef(i.indexrelid,1,true)='bot_id'
          AND pg_get_indexdef(i.indexrelid,2,true)='environment'
          AND pg_get_indexdef(i.indexrelid,3,true)=wanted.lastkey
          AND pg_get_expr(i.indpred,i.indrelid)='(status = ''ACTIVE''::text)'))
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('telegram_link_requests','telegram_requests_guard','telegram_request_guard',19),
        ('telegram_account_links','telegram_links_guard','telegram_link_guard',23),
        ('telegram_link_audit','telegram_audit_append_only','telegram_audit_no_mutation',27)
      ) wanted(tbl,trg,fn,typ) WHERE NOT EXISTS (
        SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass(format('%I.%I',$1,wanted.tbl))
          AND t.tgname=wanted.trg AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=wanted.typ
          AND t.tgfoid=to_regprocedure(format('%I.%I()',$1,wanted.fn)) AND t.tgqual IS NULL)) AS ok`, [schema]);
  return rows[0]?.ok === true;
}
