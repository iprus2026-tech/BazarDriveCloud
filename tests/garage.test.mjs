// BD-TEST-07 — node:test coverage for the garage derive layer (garage.js).
//
// garage.js is strictly read-only: every helper is a pure derive over the
// profile object (no storage, no DOM), so these tests need no mock. It feeds
// the driver readiness gate and the accept/respond snapshots — the active
// vehicle that ride_actions.js stamps onto a seeded ride comes from here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGarageVehicles,
  resolveActiveGarageVehicleId,
  resolveActiveGarageVehicle,
  getGarageReadinessState,
  countArchivedGarageVehicles,
  listArchivedGarageVehicles,
} from '../public/src/garage.js';

const withGarage = (vehicles, activeVehicleId) => ({ driverGarage: { vehicles, activeVehicleId } });
const LEGACY_USER = { vehicleMake: 'Kia', vehicleModel: 'Rio', vehicleColor: 'белый', vehiclePlate: 'A1' };

// ── buildGarageVehicles ───────────────────────────────────────────────────────

test('buildGarageVehicles: persisted vehicles, active flagged from activeVehicleId', () => {
  const u = withGarage([{ id: 'v1', model: 'Kia Rio' }, { id: 'v2', model: 'Lada' }], 'v2');
  const out = buildGarageVehicles(u);
  assert.equal(out.length, 2);
  assert.equal(out.find((v) => v.id === 'v2').status, 'active');
  assert.equal(out.find((v) => v.id === 'v1').status, 'available');
});

test('buildGarageVehicles: no active selection → all available (no silent promotion)', () => {
  const u = withGarage([{ id: 'v1', model: 'A' }, { id: 'v2', model: 'B' }], null);
  const out = buildGarageVehicles(u);
  assert.ok(out.every((v) => v.status === 'available'));
});

test('buildGarageVehicles: archived entries never reach the active list', () => {
  const u = withGarage([{ id: 'v1', model: 'A' }, { id: 'v2', model: 'B', archived: true }], 'v1');
  const ids = buildGarageVehicles(u).map((v) => v.id);
  assert.deepEqual(ids, ['v1']);
});

test('buildGarageVehicles: legacy fallback synthesizes one active vehicle from user.* fields', () => {
  const out = buildGarageVehicles(LEGACY_USER);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'legacy-1');
  assert.equal(out[0].model, 'Kia Rio');
  assert.equal(out[0].status, 'active');
  assert.equal(out[0]._synthesized, true);
});

test('buildGarageVehicles: drops model-less entries and de-dupes by id', () => {
  const u = withGarage([{ id: 'v1', model: '' }, { id: 'v2', model: 'X' }, { id: 'v2', model: 'Y' }], 'v2');
  const out = buildGarageVehicles(u);
  assert.deepEqual(out.map((v) => v.id), ['v2']);
  assert.equal(out[0].model, 'X'); // first wins on id collision
});

test('buildGarageVehicles: force "empty" → []; empty profile → []', () => {
  assert.deepEqual(buildGarageVehicles(withGarage([{ id: 'v1', model: 'A' }], 'v1'), { force: 'empty' }), []);
  assert.deepEqual(buildGarageVehicles({}), []);
});

test('buildGarageVehicles: force "multi" appends a preview vehicle when a real one exists', () => {
  const out = buildGarageVehicles(withGarage([{ id: 'v1', model: 'A' }], 'v1'), { force: 'multi' });
  assert.ok(out.some((v) => v.id === 'demo-2'));
  // multi requires a real vehicle — empty garage stays empty.
  assert.deepEqual(buildGarageVehicles({}, { force: 'multi' }), []);
});

// ── resolveActiveGarageVehicleId / resolveActiveGarageVehicle ──────────────────

test('resolveActiveGarageVehicleId: saved match wins; stale → null; synthesized fallback', () => {
  const vehicles = [{ id: 'v1' }, { id: 'v2' }];
  assert.equal(resolveActiveGarageVehicleId(withGarage([], 'v2'), vehicles), 'v2');
  assert.equal(resolveActiveGarageVehicleId(withGarage([], 'gone'), vehicles), null);
  assert.equal(resolveActiveGarageVehicleId(withGarage([], null), vehicles), null);
  assert.equal(resolveActiveGarageVehicleId(withGarage([], null), [{ id: 'leg', _synthesized: true }]), 'leg');
  assert.equal(resolveActiveGarageVehicleId(withGarage([], 'x'), []), null);
});

test('resolveActiveGarageVehicle: returns the active vehicle object or null', () => {
  const u = withGarage([{ id: 'v1', model: 'A' }, { id: 'v2', model: 'B' }], 'v1');
  assert.equal(resolveActiveGarageVehicle(u).id, 'v1');
  // no active selection → null
  assert.equal(resolveActiveGarageVehicle(withGarage([{ id: 'v1', model: 'A' }], null)), null);
  // legacy fallback resolves
  assert.equal(resolveActiveGarageVehicle(LEGACY_USER).id, 'legacy-1');
});

// ── getGarageReadinessState ───────────────────────────────────────────────────

test('getGarageReadinessState: active / legacy / empty / archived-only / no-selection', () => {
  assert.deepEqual(
    pick(getGarageReadinessState(withGarage([{ id: 'v1', model: 'A' }], 'v1'))),
    { state: 'active_vehicle', reason: 'explicit_active' });
  assert.deepEqual(
    pick(getGarageReadinessState(LEGACY_USER)),
    { state: 'active_vehicle', reason: 'legacy_fallback' });
  assert.deepEqual(
    pick(getGarageReadinessState({})),
    { state: 'empty_garage', reason: 'empty_collection' });
  assert.deepEqual(
    pick(getGarageReadinessState(withGarage([{ id: 'v1', model: 'A', archived: true }], null))),
    { state: 'no_active_vehicle', reason: 'archived_only' });
  assert.deepEqual(
    pick(getGarageReadinessState(withGarage([{ id: 'v1', model: 'A' }], null))),
    { state: 'no_active_vehicle', reason: 'no_active_selection' });
});

function pick(s) { return { state: s.state, reason: s.reason }; }

// ── archived helpers ──────────────────────────────────────────────────────────

test('countArchivedGarageVehicles: counts raw archived (incl. model-less); 0 on no garage', () => {
  const u = withGarage([
    { id: 'a', model: '', archived: true },   // model-less but still counted (storage truth)
    { id: 'b', model: 'B', archived: true },
    { id: 'c', model: 'C' },
  ], null);
  assert.equal(countArchivedGarageVehicles(u), 2);
  assert.equal(countArchivedGarageVehicles({}), 0);
});

test('listArchivedGarageVehicles: normalised archived only (model-less dropped) with _rawIdx', () => {
  const u = withGarage([
    { id: 'a', model: '', archived: true },   // dropped from the render list
    { id: 'b', model: 'B', archived: true },
    { id: 'c', model: 'C' },
  ], null);
  const list = listArchivedGarageVehicles(u);
  assert.deepEqual(list.map((v) => v.id), ['b']);
  assert.equal(list[0]._rawIdx, 1);
  assert.deepEqual(listArchivedGarageVehicles({}), []);
});
