// /server/test/order-terms-change.test.mjs — #1188: the pure rule behind PATCH /orders/:orderId
// (domain/order-terms-change.js). No DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { orderTermsChange } from '../src/domain/order-terms-change.js';

const ROW = {
  estimated_price: '500.00', estimated_price_label: '500 ₽',
  scheduled_mode: 'now', scheduled_at: '', scheduled_label: '', comment: 'Подъезд 2',
};

test('a request equal to the stored order writes nothing', () => {
  const same = orderTermsChange(ROW, {
    estimatedPrice: 500, estimatedPriceLabel: '500 ₽', scheduledMode: 'now', scheduledAt: '',
    scheduledLabel: '', comment: 'Подъезд 2',
  });
  assert.deepEqual(same, { values: {}, hasWrites: false, priceChanged: false, termsChanged: false });
  assert.equal(orderTermsChange(ROW, {}).hasWrites, false);
  assert.equal(orderTermsChange(ROW, null).hasWrites, false);
});

test('a price change is a price change; the label alone is not a change of terms', () => {
  const price = orderTermsChange(ROW, { estimatedPrice: 800, estimatedPriceLabel: '800 ₽' });
  assert.deepEqual(price.values, { estimatedPrice: 800, estimatedPriceLabel: '800 ₽' });
  assert.deepEqual([price.priceChanged, price.termsChanged, price.hasWrites], [true, true, true]);

  const label = orderTermsChange(ROW, { estimatedPrice: 500, estimatedPriceLabel: '500 руб.' });
  assert.deepEqual(label.values, { estimatedPriceLabel: '500 руб.' });
  assert.deepEqual([label.priceChanged, label.termsChanged, label.hasWrites], [false, false, true]);

  // A budget removed (0 = «по договорённости») or set on an order that had none is a price change.
  assert.equal(orderTermsChange(ROW, { estimatedPrice: 0 }).priceChanged, true);
  assert.equal(orderTermsChange({ ...ROW, estimated_price: '0.00' }, { estimatedPrice: 300 }).priceChanged, true);
  assert.equal(orderTermsChange({ ...ROW, estimated_price: null }, { estimatedPrice: 0 }).hasWrites, false);
});

test('the time and the comment change the terms without changing the price', () => {
  const time = orderTermsChange(ROW, { scheduledMode: 'later', scheduledAt: '2026-12-01T10:00', scheduledLabel: '1 дек, 10:00' });
  assert.deepEqual(time.values, { scheduledMode: 'later', scheduledAt: '2026-12-01T10:00', scheduledLabel: '1 дек, 10:00' });
  assert.deepEqual([time.priceChanged, time.termsChanged], [false, true]);

  const timeLabel = orderTermsChange(ROW, { scheduledLabel: 'Сейчас' });
  assert.deepEqual([timeLabel.hasWrites, timeLabel.termsChanged], [true, false]);

  const comment = orderTermsChange(ROW, { comment: '' });
  assert.deepEqual(comment.values, { comment: '' });
  assert.deepEqual([comment.priceChanged, comment.termsChanged], [false, true]);

  const both = orderTermsChange(ROW, { comment: 'Новый', estimatedPrice: 650 });
  assert.deepEqual([both.priceChanged, both.termsChanged], [true, true]);
});

test('a new price without a label gets a label for that price', () => {
  const made = orderTermsChange(ROW, { estimatedPrice: 1480 });
  assert.deepEqual(made.values, { estimatedPrice: 1480, estimatedPriceLabel: `${(1480).toLocaleString('ru-RU')} ₽` });
  assert.deepEqual([made.priceChanged, made.termsChanged], [true, true]);
  // No budget has no label; a label the request does carry is kept as sent.
  assert.deepEqual(orderTermsChange(ROW, { estimatedPrice: 0 }).values, { estimatedPrice: 0, estimatedPriceLabel: '' });
  assert.deepEqual(orderTermsChange(ROW, { estimatedPrice: 800, estimatedPriceLabel: '800' }).values,
    { estimatedPrice: 800, estimatedPriceLabel: '800' });
  // The same price without a label leaves the stored label alone.
  assert.equal(orderTermsChange(ROW, { estimatedPrice: 500 }).hasWrites, false);
});

test('the comment is compared as the ride reads it: the snapshot copy counts', () => {
  // The comment lives only in the snapshot (order.comment is empty): clearing it is a change.
  const snapOnly = { ...ROW, comment: '', passenger_snapshot: { name: 'А', comment: 'Позвоните у подъезда' } };
  const cleared = orderTermsChange(snapOnly, { comment: '' });
  assert.deepEqual(cleared.values, { comment: '' });
  assert.deepEqual([cleared.hasWrites, cleared.termsChanged, cleared.priceChanged], [true, true, false]);
  // Naming the same text moves it into the order's own column without changing the terms.
  const same = orderTermsChange(snapOnly, { comment: 'Позвоните у подъезда' });
  assert.deepEqual([same.hasWrites, same.termsChanged], [true, false]);
  // A stale snapshot copy behind the order's own comment is replaced, also without a change of terms.
  const stale = orderTermsChange({ ...ROW, passenger_snapshot: { comment: 'старое' } }, { comment: 'Подъезд 2' });
  assert.deepEqual([stale.hasWrites, stale.termsChanged], [true, false]);
  // Both copies already say it, or the snapshot has no text: nothing to write.
  assert.equal(orderTermsChange({ ...ROW, passenger_snapshot: { comment: 'Подъезд 2' } }, { comment: 'Подъезд 2' }).hasWrites, false);
  assert.equal(orderTermsChange({ ...ROW, passenger_snapshot: { comment: '  ' } }, { comment: 'Подъезд 2' }).hasWrites, false);
  // Blank text is no comment: '' -> '  ' is written, but the ride reads the same nothing.
  const blank = orderTermsChange({ ...ROW, comment: '' }, { comment: '  ' });
  assert.deepEqual([blank.hasWrites, blank.termsChanged], [true, false]);
});

test('a time or mode change without a label clears the stored time label', () => {
  const later = { ...ROW, scheduled_mode: 'later', scheduled_at: '2026-12-01T10:00', scheduled_label: '1 дек, 10:00' };
  const moved = orderTermsChange(later, { scheduledAt: '2026-12-02T12:00' });
  assert.deepEqual(moved.values, { scheduledAt: '2026-12-02T12:00', scheduledLabel: '' });
  assert.deepEqual([moved.priceChanged, moved.termsChanged], [false, true]);
  // Back to «now»: the dated label goes too.
  assert.deepEqual(orderTermsChange(later, { scheduledMode: 'now' }).values, { scheduledMode: 'now', scheduledLabel: '' });
  // A label the request carries is stored as sent.
  assert.deepEqual(orderTermsChange(later, { scheduledAt: '2026-12-02T12:00', scheduledLabel: '2 дек, 12:00' }).values,
    { scheduledAt: '2026-12-02T12:00', scheduledLabel: '2 дек, 12:00' });
  // The same time without a label leaves the stored label alone.
  assert.equal(orderTermsChange(later, { scheduledAt: '2026-12-01T10:00', scheduledMode: 'later' }).hasWrites, false);
  // A time change on an order with no label writes no empty label.
  assert.deepEqual(orderTermsChange(ROW, { scheduledAt: '2026-12-02T12:00' }).values, { scheduledAt: '2026-12-02T12:00' });
});

test('a price is compared at the stored precision (NUMERIC(12,2))', () => {
  // 800.001 is stored as 800.00: the first edit writes 800, a repeat against 800.00 is a no-op.
  const first = orderTermsChange(ROW, { estimatedPrice: 800.001 });
  assert.deepEqual(first.values, { estimatedPrice: 800, estimatedPriceLabel: `${(800).toLocaleString('ru-RU')} ₽` });
  const stored = { ...ROW, estimated_price: '800.00', estimated_price_label: first.values.estimatedPriceLabel };
  assert.deepEqual(orderTermsChange(stored, { estimatedPrice: 800.001 }),
    { values: {}, hasWrites: false, priceChanged: false, termsChanged: false });
  assert.equal(orderTermsChange(ROW, { estimatedPrice: 500.004 }).hasWrites, false);
  // Rounded as PostgreSQL rounds the decimal text: 1.005 -> 1.01.
  assert.equal(orderTermsChange(ROW, { estimatedPrice: 1.005 }).values.estimatedPrice, 1.01);
  assert.equal(orderTermsChange({ ...ROW, estimated_price: '1.01' }, { estimatedPrice: 1.005 }).hasWrites, false);
  assert.equal(orderTermsChange({ ...ROW, estimated_price: '0.00' }, { estimatedPrice: 1e-7 }).hasWrites, false);
});
