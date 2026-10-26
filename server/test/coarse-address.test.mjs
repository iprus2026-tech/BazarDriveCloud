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
  // The house and everything after it are dropped; only the street is shown.
  ['ул. Ленина, 10, кв. 5', 'ул. Ленина'],
  ['ул. Ленина, д. 10', 'ул. Ленина'],
  ['Москва, ул. Ленина, д. 10, кв. 5', 'ул. Ленина'],
  ['Москва, Тверская ул., 7 стр 2', 'Тверская ул.'],
  ['ул. Ленина, 10/2', 'ул. Ленина'],
  ['ул. Ленина, 12а, подъезд 3', 'ул. Ленина'],
  ['Ленинский проспект, 32А', 'Ленинский проспект'],
  ['Внуковское ш., 24', 'Внуковское ш.'],
  ['пр-т Мира, корп. 2', 'пр-т Мира'],
  ['ул. 1905 года, 7', 'ул. 1905 года'],
  ['ул. 50 лет Октября, 3', 'ул. 50 лет Октября'],
  ['ул. 50-летия Октября 3', 'ул. 50-летия Октября'],
  ['Домодедовская ул., 5', 'Домодедовская ул.'],
  ['Б. Никитская ул., 5', 'Б. Никитская ул.'],
  // No comma: the house inside the street segment.
  ['ул. Ленина 10', 'ул. Ленина'],
  ['ул. 8 Марта 4', 'ул. 8 Марта'],
  ['2-я Владимирская ул. 15', '2-я Владимирская ул.'],
  ['ул. Ленина д.10', 'ул. Ленина'],
  ['ул.Ленина,10', 'ул. Ленина'],
  ['ул. Ленина д. 10 кв 5', 'ул. Ленина'],
  ['пр-т Мира корп 2', 'пр-т Мира'],
  // Ambiguous without a comma: cut coarser, never leak.
  ['Проектируемый проезд 4062', 'Проектируемый проезд'],
  ['Проектируемый проезд 4062, д. 6', 'Проектируемый проезд'],
  // The exception is narrow: a house and a flat are not a numbered street.
  ['Тверская ул. 7, 2', 'Тверская ул.'],
  ['Нагорный проезд 7, 3', 'Нагорный проезд'],
  ['Ленинский проспект 123, 4', 'Ленинский проспект'],
  // CodeRabbit #1157 bypasses — all closed as a class by the whitelist.
  ['ул. Ленина 10, подъезд 2', 'ул. Ленина'],
  ['ул. Ленина 10, кв. 5', 'ул. Ленина'],
  ['ул. Ленина, №10', 'ул. Ленина'],
  ['ул. Ленина, № 10', 'ул. Ленина'],
  ['ул. Ленина №10', 'ул. Ленина'],
  ['ул. Ленина, д. №10', 'ул. Ленина'],
  ['ул. Ленина 10 с 2', 'ул. Ленина'],
  ['ул. Ленина 10с2', 'ул. Ленина'],
  ['ул. Ленина 10с2а', 'ул. Ленина'],
  ['Тверская ул. 7 с 1', 'Тверская ул.'],
  ['ул. Ленина 10к1с2', 'ул. Ленина'],
  // Not recognized as «street type + name»: no address (null), never the full text.
  ['Аэропорт Внуково, терминал А', null],
  ['Аэропорт Внуково', null],
  ['Ленина 10', null],
  ['Ленина 10с2', null],
  ['Тверская 7, кв 3', null],
  ['Москва, Ленина 10', null],
  ['Ленина №10, кв 2', null],
  ['Ленина, №10а', null],
  ['Москва, Ленина 10 №5', null],
  ['возле дома 5', null],
  ['дом 5 по ул. Ленина', null],
  ['ул. 10', null],
  ['д. 10', null],
  ['15', null],
  ['', null],
  ['   ', null],
];

test('coarseAddress: the street without the house; street digits survive; unrecognized -> null', () => {
  for (const [input, expected] of cases) {
    assert.equal(coarseAddress(input), expected, JSON.stringify(input));
  }
});

// The class of bypasses, not single cases: any spelling of a house appended to a known street,
// with or without a comma, gives the street itself — never a digit of the house.
test('coarseAddress: no spelling of a house number survives after a street', () => {
  const streets = ['ул. Ленина', 'Тверская ул.', 'пр-т Мира', 'ул. 8 Марта', '2-я Владимирская ул.'];
  const houses = [
    '10', '10а', '10/2', '10к2', '10 к 2', '10к1с2', '10с2а', '10 с 2а', '10 стр. 2', '№10', '№ 10',
    'д. 10', 'д.10', 'дом 10', 'д. №10', 'вл. 4', 'корп. 2', 'кв. 5', 'подъезд 2', 'офис 7', '10-А',
    '10 лит. Б', '10, кв. 5', '10 Б', '10б-2', '10А стр 1 кв 3',
  ];
  for (const street of streets) {
    for (const house of houses) {
      for (const sep of [' ', ', ']) {
        const input = `${street}${sep}${house}`;
        assert.equal(coarseAddress(input), street, JSON.stringify(input));
      }
    }
  }
});

test('coarseAddress: non-strings are null', () => {
  for (const input of [null, undefined, 10, {}, []]) assert.equal(coarseAddress(input), null);
});
