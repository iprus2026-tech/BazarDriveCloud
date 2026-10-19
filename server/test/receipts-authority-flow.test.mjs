// /server/test/receipts-authority-flow.test.mjs — DB-gated acceptance for BD-RIDE-AUTHORITY-01B-C
// (docs/ride-state-receipt-authority-contract.md §3): POST /api/v1/history/receipts derives every
// amount server-side from the interim fare basis (accepted offer price, else order estimate) and the
// configured commission; client amounts are ignored and a mismatch is logged without PII; a replay
// returns the stored receipt without recomputing. Rides reach COMPLETED through the real
// order -> offer -> select -> driver chain. SKIPPED without DATABASE_URL; runs in server-ci.
//
// CLEANUP: receipts -> ride_events -> rides with triggers relaxed (CI superuser), then orders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import { buildApp } from '../src/server.js';
import { grantDriverRole } from '../test-support/driver-grant.mjs';

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP = DATABASE_URL ? false : 'DATABASE_URL not set';

const baseConfig = {
  nodeEnv: 'test', isProd: false, port: 0, host: '127.0.0.1', logLevel: 'silent',
  databaseUrl: DATABASE_URL, allowedOrigin: '', sessionSecret: '',
  otp: { ttlSeconds: 300, length: 4, maxAttempts: 5, devMode: true },
  session: { ttlSeconds: 0 },
  receipts: { commissionPercent: 12 },
  redisUrl: '', s3: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
};

const post = (app, url, payload, headers) => app.inject({ method: 'POST', url, payload, headers });
const patch = (app, url, payload, headers) => app.inject({ method: 'PATCH', url, payload, headers });
const bearer = (s) => ({ authorization: `Bearer ${s.token}` });

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json();
}

// Record the app's warn lines (tests run with logLevel 'silent', so req.log is the app's no-op
// logger; wrapping it is enough to observe what the route would log).
function captureWarns(app) {
  const warns = [];
  const original = app.log.warn;
  app.log.warn = (obj, msg) => { warns.push({ obj, msg }); };
  return { warns, restore: () => { app.log.warn = original; } };
}

test('receipts: server-derived amounts, ignored client amounts, no-PII warn, write-once', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: baseConfig });
  const app20 = await buildApp({ config: { ...baseConfig, receipts: { commissionPercent: 20 } } });
  const tag = String(process.pid).padStart(7, '0');
  const pax = `+1621${tag}`;
  const drv = `+1622${tag}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  const orderIds = [];
  const tripIds = [];
  t.after(async () => {
    await cleanup.query("SET session_replication_role = 'replica'").catch(() => {});
    await cleanup.query('DELETE FROM receipts WHERE ride_id IN (SELECT id FROM rides WHERE trip_id = ANY($1))', [tripIds]).catch(() => {});
    await cleanup.query("DELETE FROM notification_outbox WHERE immutable_envelope #>> '{aggregate,key}' = ANY($1)", [tripIds]).catch(() => {});
    await cleanup.query('DELETE FROM ride_events WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
    await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
    await cleanup.query("SET session_replication_role = 'origin'").catch(() => {});
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    for (const p of [pax, drv]) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
    await app20.close();
  });

  const paxS = await mintSession(app, pax);
  const drvS = await grantDriverRole(cleanup, await mintSession(app, drv));

  // order (with an optional estimate) -> offer (optional price) -> select -> driver chain -> COMPLETED
  async function completedRide({ estimatedPrice, offerPrice }) {
    const orderBody = { pickup: { label: 'Дом' }, dropoff: { label: 'Центр' } };
    if (estimatedPrice !== undefined) orderBody.estimatedPrice = estimatedPrice;
    const order = (await post(app, '/api/v1/orders', orderBody, bearer(paxS))).json().order;
    orderIds.push(order.id);
    const offerBody = { orderId: order.id, driverName: 'Иван' };
    if (offerPrice !== undefined) offerBody.price = offerPrice;
    const offer = await post(app, '/api/v1/matching/offers', offerBody, bearer(drvS));
    assert.equal(offer.statusCode, 201);
    const sel = await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: drvS.user.userId }, bearer(paxS));
    assert.equal(sel.statusCode, 200);
    const tripId = sel.json().ride.tripId;
    tripIds.push(tripId);
    for (const status of ['DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER', 'IN_PROGRESS', 'COMPLETED']) {
      assert.equal((await patch(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}/status`, { status }, bearer(drvS))).statusCode, 200, status);
    }
    return { tripId, orderId: order.id };
  }
  const amountsOf = (res) => {
    const { fare, commission, tip, net } = res.json().receipt;
    return { fare, commission, tip, net };
  };
  const receiptRows = async (tripId) => (await cleanup.query(
    'SELECT count(*)::int AS n FROM receipts WHERE ride_id = (SELECT id FROM rides WHERE trip_id = $1)', [tripId],
  )).rows[0].n;

  // 1) accepted priced offer, no client amounts -> server amounts, no warn line.
  {
    const { tripId } = await completedRide({ estimatedPrice: 301, offerPrice: 763 });
    const cap = captureWarns(app);
    const res = await post(app, '/api/v1/history/receipts', { tripId }, bearer(drvS));
    cap.restore();
    assert.equal(res.statusCode, 201);
    assert.deepEqual(amountsOf(res), { fare: 763, commission: -92, tip: 0, net: 671 });
    assert.equal(cap.warns.length, 0, 'no client amounts -> no warn');
  }

  // 2) offer without a price -> the order estimate is the basis.
  {
    const { tripId } = await completedRide({ estimatedPrice: 800 });
    const res = await post(app, '/api/v1/history/receipts', { tripId }, bearer(drvS));
    assert.equal(res.statusCode, 201);
    assert.deepEqual(amountsOf(res), { fare: 800, commission: -96, tip: 0, net: 704 });
  }

  // 3) no offer price and no estimate (defaults to 0) -> 409, nothing written.
  {
    const { tripId } = await completedRide({});
    const res = await post(app, '/api/v1/history/receipts', { tripId, fare: 950, commission: -114, tip: 120, net: 956 }, bearer(drvS));
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().code, 'RECEIPT_FARE_UNKNOWN');
    assert.equal(await receiptRows(tripId), 0, 'no receipt row on RECEIPT_FARE_UNKNOWN');
  }

  // 4) fractional basis rounds half up.
  {
    const { tripId } = await completedRide({ offerPrice: 763.5 });
    const res = await post(app, '/api/v1/history/receipts', { tripId }, bearer(drvS));
    assert.deepEqual(amountsOf(res), { fare: 764, commission: -92, tip: 0, net: 672 });
  }

  // 5) mismatching client amounts (the E2E's demo 950 / 120) are ignored; ONE PII-free warn line;
  //    a replay returns the stored receipt even after the offer price changes (no recompute);
  //    matching amounts log nothing.
  {
    const { tripId, orderId } = await completedRide({ offerPrice: 763 });
    const cap = captureWarns(app);
    const res = await post(app, '/api/v1/history/receipts',
      { tripId, fare: 950, commission: -114, tip: 120, net: 956, paymentMode: 'noncash' }, bearer(drvS));
    cap.restore();
    assert.equal(res.statusCode, 201);
    assert.deepEqual(amountsOf(res), { fare: 763, commission: -92, tip: 0, net: 671 });
    assert.equal(cap.warns.length, 1, 'exactly one warn line');
    const [{ obj, msg }] = cap.warns;
    assert.equal(msg, 'client receipt amounts ignored');
    assert.deepEqual(obj, {
      event: 'receipt_client_amounts_ignored',
      tripId,
      mismatched: ['fare', 'commission', 'tip', 'net'],
      client: { fare: 950, commission: -114, tip: 120, net: 956 },
      server: { fare: 763, commission: -92, tip: 0, net: 671 },
    }, 'only trip id and amounts are logged');
    const serialized = JSON.stringify(obj);
    for (const secret of [drvS.user.userId, paxS.user.userId, drv, pax, drvS.token, paxS.token]) {
      assert.equal(serialized.includes(secret), false, 'the warn line carries no user id, phone or token');
    }

    await cleanup.query(
      "UPDATE offers SET price = 9999 WHERE order_id = (SELECT id FROM orders WHERE legacy_id = $1) AND status = 'accepted'",
      [orderId],
    );
    const capMatch = captureWarns(app);
    const replay = await post(app, '/api/v1/history/receipts',
      { tripId, fare: 763, commission: -92, tip: 0, net: 671 }, bearer(drvS));
    capMatch.restore();
    assert.equal(replay.statusCode, 201);
    assert.deepEqual(amountsOf(replay), { fare: 763, commission: -92, tip: 0, net: 671 }, 'replay never recomputes');
    assert.equal(capMatch.warns.length, 0, 'matching amounts log nothing');
    assert.equal(await receiptRows(tripId), 1);
  }

  // 6) the configured commission is honoured (an app built with 20%); replaying an existing
  //    receipt through it does not recompute.
  {
    const { tripId } = await completedRide({ offerPrice: 1000 });
    const res = await post(app20, '/api/v1/history/receipts', { tripId }, bearer(drvS));
    assert.deepEqual(amountsOf(res), { fare: 1000, commission: -200, tip: 0, net: 800 });
    const replayAt12 = await post(app, '/api/v1/history/receipts', { tripId }, bearer(drvS));
    assert.deepEqual(amountsOf(replayAt12), { fare: 1000, commission: -200, tip: 0, net: 800 });
  }
});
