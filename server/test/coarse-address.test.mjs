// /server/test/coarse-address.test.mjs — BD-ORDERS-PUBLIC-PROJECTION-01 (#1125, owner's decision R2):
// the order feed shows other people the street without the house. Pure unit tests (no DB).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { coarseAddress } from '../src/domain/coarse-address.js';

const cases = [
  // The owner's cases: street names with digits survive.
  ['2-я Владимирская ул., 15', '2-я Владимирская ул.'],
  ['ул. 8 Марта, 4к2', 'ул. 8 Марта'],
  ['Проектируемый проезд 4062, 6', 'Проектируемый проезд 4062'],
  // The house and everything after it are cut.
  ['ул. Ленина, 10, кв. 5', 'ул. Ленина'],
  ['ул. Ленина, д. 10', 'ул. Ленина'],
  ['Москва, ул. Ленина, д. 10, кв. 5', 'Москва, ул. Ленина'],
  ['Москва, Тверская ул., 7 стр 2', 'Москва, Тверская ул.'],
  ['ул. Ленина, 10/2', 'ул. Ленина'],
  ['ул. Ленина, 12а, подъезд 3', 'ул. Ленина'],
  ['Ленинский проспект, 32А', 'Ленинский проспект'],
  ['Внуковское ш., 24', 'Внуковское ш.'],
  ['пр-т Мира, корп. 2', 'пр-т Мира'],
  ['ул. 1905 года, 7', 'ул. 1905 года'],
  ['Домодедовская ул., 5', 'Домодедовская ул.'],
  // No comma: the house inside the street segment.
  ['ул. Ленина 10', 'ул. Ленина'],
  ['ул. 8 Марта 4', 'ул. 8 Марта'],
  ['2-я Владимирская ул. 15', '2-я Владимирская ул.'],
  ['ул. Ленина д.10', 'ул. Ленина'],
  ['ул. Ленина д. 10 кв 5', 'ул. Ленина'],
  ['пр-т Мира корп 2', 'пр-т Мира'],
  // Ambiguous without a comma: cut coarser, never leak.
  ['Проектируемый проезд 4062', 'Проектируемый проезд'],
  // No house at all: kept as is.
  ['Аэропорт Внуково, терминал А', 'Аэропорт Внуково, терминал А'],
  ['Аэропорт Внуково', 'Аэропорт Внуково'],
  // CodeRabbit #1157: a house number before a house-word segment, or with no street word.
  ['ул. Ленина 10, подъезд 2', 'ул. Ленина'],
  ['ул. Ленина 10, кв. 5', 'ул. Ленина'],
  ['Проектируемый проезд 4062, д. 6', 'Проектируемый проезд'],
  ['Ленина 10', null],
  ['Тверская 7, кв 3', null],
  ['Москва, Ленина 10', null],
  // CodeRabbit #1157: «№» house numbers.
  ['ул. Ленина, №10', 'ул. Ленина'],
  ['ул. Ленина, № 10', 'ул. Ленина'],
  ['ул. Ленина №10', 'ул. Ленина'],
  ['ул. Ленина, д. №10', 'ул. Ленина'],
  ['Ленина №10, кв 2', 'Ленина'],
  ['Москва, Ленина 10 №5', null],
  ['Ленина, №10а', 'Ленина'],
  // Unreliable or empty: no address (null), never the full text.
  ['возле дома 5', null],
  ['д. 10', null],
  ['15', null],
  ['', null],
  ['   ', null],
];

test('coarseAddress: the street without the house; street digits survive; unreliable -> null', () => {
  for (const [input, expected] of cases) {
    assert.equal(coarseAddress(input), expected, JSON.stringify(input));
  }
});

test('coarseAddress: non-strings are null', () => {
  for (const input of [null, undefined, 10, {}, []]) assert.equal(coarseAddress(input), null);
});
