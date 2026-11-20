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
