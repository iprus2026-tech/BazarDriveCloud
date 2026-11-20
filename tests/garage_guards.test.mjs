// #1185 — node:test coverage for the garage add / edit draft guards (garage.js). Pure functions.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { garageDraftError, plateKey, isPlausiblePlate, GARAGE_MODEL_REQUIRED, VEHICLE_TEXT_MAX } from '../public/src/garage.js';

const garage = [
  { id: 'v1', model: 'Toyota Camry', color: 'белый', plate: 'А 123 ВС 77' },
  { id: 'v2', model: 'Kia Rio', color: '', plate: '' },
];

test('a clean draft may be saved', () => {
  assert.equal(garageDraftError({ model: 'Lada Vesta', color: 'серый', plate: 'В 456 ОР 99' }, garage), '');
  assert.equal(garageDraftError({ model: 'Lada Vesta', color: '', plate: '' }, garage), '', 'colour and plate are optional');
});

test('a missing model keeps the existing message', () => {
  assert.equal(garageDraftError({ model: '   ', color: '', plate: '' }, garage), GARAGE_MODEL_REQUIRED);
  assert.equal(garageDraftError(null, garage), GARAGE_MODEL_REQUIRED);
});

test('an over-long model or colour is refused', () => {
  const long = 'x'.repeat(VEHICLE_TEXT_MAX + 1);
  assert.match(garageDraftError({ model: long, color: '', plate: '' }, garage), /не длиннее 40/);
  assert.match(garageDraftError({ model: 'Kia', color: long, plate: '' }, garage), /не длиннее 40/);
  assert.equal(garageDraftError({ model: 'x'.repeat(VEHICLE_TEXT_MAX), color: '', plate: '' }, garage), '');
});

test('a plate that is not a plate is refused', () => {
  assert.match(garageDraftError({ model: 'Kia', color: '', plate: '!!!' }, garage), /Проверьте номер/);
  assert.equal(isPlausiblePlate('!!!'), false);
});

test('a second car with the same plate is refused, whatever the spacing or case', () => {
  for (const plate of ['А 123 ВС 77', 'а123вс77', 'А-123-ВС-77']) {
    assert.match(garageDraftError({ model: 'Kia', color: '', plate }, garage), /уже есть в гараже/, plate);
  }
  assert.equal(plateKey(' а 123-вс 77 '), 'А123ВС77');
});

test('editing a vehicle does not collide with itself, but does with another one', () => {
  assert.equal(garageDraftError({ model: 'Toyota Camry', color: 'чёрный', plate: 'А 123 ВС 77' }, garage, { exceptId: 'v1' }), '');
  assert.match(garageDraftError({ model: 'Kia Rio', color: '', plate: 'А 123 ВС 77' }, garage, { exceptId: 'v2' }), /уже есть в гараже/);
});

test('two cars with no plate do not count as duplicates', () => {
  assert.equal(garageDraftError({ model: 'Lada', color: '', plate: '' }, garage), '');
});
