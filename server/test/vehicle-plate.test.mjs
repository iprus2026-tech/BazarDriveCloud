// /server/test/vehicle-plate.test.mjs — #1113: the driver's car plate as the passenger sees it.
// Pure unit tests of src/domain/vehicle-plate.js (no DB) plus the 0013 migration file contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  normalizeVehiclePlate, maskVehiclePlate, normalizeVehicleText, VEHICLE_PLATE_MAX_LENGTH,
} from '../src/domain/vehicle-plate.js';

test('normalizeVehiclePlate: trim, collapse whitespace, upper case', () => {
  assert.equal(normalizeVehiclePlate('  а  108\tор 77 '), 'А 108 ОР 77');
  assert.equal(normalizeVehiclePlate('а 108 ор\n77'), 'А 108 ОР 77', 'non-breaking space and newline collapse too');
  assert.equal(normalizeVehiclePlate('В 777 ЕЕ 50'), 'В 777 ЕЕ 50', 'an already normal plate is unchanged');
});

test('normalizeVehiclePlate: every Latin look-alike becomes its Cyrillic letter', () => {
  assert.equal(normalizeVehiclePlate('ABEKMHOPCTYX'), 'АВЕКМНОРСТУХ');
  assert.equal(normalizeVehiclePlate('abekmhopctyx'), 'АВЕКМНОРСТУХ', 'lower-case Latin is upper-cased first');
  assert.equal(normalizeVehiclePlate('a108op77'), 'А108ОР77');
  for (const ch of normalizeVehiclePlate('ABEKMHOPCTYX')) {
    assert.ok(/[Ѐ-ӿ]/.test(ch), `${ch} is Cyrillic`);
  }
});

test('normalizeVehiclePlate: no strict format — other Latin letters and digits pass through', () => {
  assert.equal(normalizeVehiclePlate('d-fz 1234'), 'D-FZ 1234');
  assert.equal(normalizeVehiclePlate('WD 12345 BG'), 'WD 12345 ВG', 'only the look-alikes change');
  assert.equal(normalizeVehiclePlate('123'), '123');
});

test('normalizeVehiclePlate: empty, blank and non-string values are null', () => {
  for (const value of ['', '   ', '\t\n', null, undefined, 42, {}, []]) {
    assert.equal(normalizeVehiclePlate(value), null, JSON.stringify(value));
  }
});

test('maskVehiclePlate: a Russian plate hides its three digits and keeps its spacing', () => {
  assert.equal(maskVehiclePlate('А 108 ОР 77'), 'А ••• ОР 77');
  assert.equal(maskVehiclePlate('А108ОР77'), 'А•••ОР77');
  assert.equal(maskVehiclePlate('В 777 ЕЕ 750'), 'В ••• ЕЕ 750', 'a three-digit region');
});

test('maskVehiclePlate: built from the normalized plate', () => {
  assert.equal(maskVehiclePlate('  a 108  op 77 '), 'А ••• ОР 77');
  assert.equal(maskVehiclePlate('a108op77'), 'А•••ОР77');
  const full = normalizeVehiclePlate(' a 108 op 77 ');
  assert.equal(maskVehiclePlate(full), maskVehiclePlate(' a 108 op 77 '), 'masking a normalized plate is the same');
});

test('maskVehiclePlate: other shapes', () => {
  assert.equal(maskVehiclePlate('ab 1234 cd'), 'АВ •••• СD', 'three or more parts: the second part is hidden');
  assert.equal(maskVehiclePlate('X 12 Z'), 'Х ••• Z', 'at least three dots');
  assert.equal(maskVehiclePlate('WD12345'), 'W••••45', 'one part: the first and the last two stay');
  assert.equal(maskVehiclePlate('AB 1234'), 'А••••34', 'two parts: the same rule over the whole plate');
  assert.equal(maskVehiclePlate('ABC'), '•••', 'three characters or fewer are hidden entirely');
  assert.equal(maskVehiclePlate('A1'), '••');
  for (const value of ['', '  ', null, undefined]) assert.equal(maskVehiclePlate(value), null);
});

test('maskVehiclePlate: the masked form never contains the hidden digits', () => {
  for (const plate of ['А 108 ОР 77', 'А108ОР77', 'В 777 ЕЕ 750']) {
    const digits = normalizeVehiclePlate(plate).match(/\d{3}/)[0];
    assert.ok(!maskVehiclePlate(plate).includes(digits), plate);
  }
});

test('normalizeVehicleText: trimmed, collapsed, empty is null', () => {
  assert.equal(normalizeVehicleText('  Kia   Rio '), 'Kia Rio');
  assert.equal(normalizeVehicleText('Серый'), 'Серый');
  assert.equal(normalizeVehicleText('   '), null);
  assert.equal(normalizeVehicleText(null), null);
  assert.equal(VEHICLE_PLATE_MAX_LENGTH, 20);
});

test('migration 0013: schema-only, re-applicable, ASCII', () => {
  const dir = new URL('../migrations/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.includes('0013_offer_vehicle_fields.sql'));
  assert.equal(files.at(-1), '0013_offer_vehicle_fields.sql', 'the newest migration');
  const sql = fs.readFileSync(new URL('0013_offer_vehicle_fields.sql', dir), 'utf8');
  assert.doesNotMatch(sql, /[^\x00-\x7F]/, 'ASCII only');
  for (const col of ['vehicle_model', 'vehicle_color', 'vehicle_plate']) {
    assert.match(sql, new RegExp(`ALTER TABLE offers ADD COLUMN IF NOT EXISTS ${col} TEXT NULL;`), col);
  }
  assert.doesNotMatch(sql, /\b(UPDATE|DELETE|INSERT|DROP)\b/i, 'no data change');
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;$/m);
});
