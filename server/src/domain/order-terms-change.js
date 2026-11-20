// /server/src/domain/order-terms-change.js — #1188: what an owner's edit of an open order changes.
// Pure: compares the request's fields with the stored row and says what to write and what it means
// for the offers already made (owner's decision, 2026-11-20):
//   - the price changed            -> the open offers are rejected (drivers offer again);
//   - only the time or the comment -> the open offers stay, marked as made for the previous terms;
//   - nothing changed              -> nothing is written (a repeated request is a no-op).
// A display label (estimatedPriceLabel / scheduledLabel) that differs while its value does not is
// written without counting as a change of terms: a reformatted label must not mark or reject offers.
// The route is not editable here — a different route is a new order.

const text = (v) => (typeof v === 'string' ? v : '');

export function orderTermsChange(row, body) {
  const b = (body && typeof body === 'object') ? body : {};
  const values = {};
  let priceChanged = false;
  let timeChanged = false;
  let commentChanged = false;

  if (b.estimatedPrice !== undefined && Number(b.estimatedPrice) !== (Number(row.estimated_price) || 0)) {
    values.estimatedPrice = Number(b.estimatedPrice);
    priceChanged = true;
  }
  if (b.estimatedPriceLabel !== undefined && b.estimatedPriceLabel !== text(row.estimated_price_label)) {
    values.estimatedPriceLabel = b.estimatedPriceLabel;
  }
  if (b.scheduledMode !== undefined && b.scheduledMode !== row.scheduled_mode) {
    values.scheduledMode = b.scheduledMode;
    timeChanged = true;
  }
  if (b.scheduledAt !== undefined && b.scheduledAt !== text(row.scheduled_at)) {
    values.scheduledAt = b.scheduledAt;
    timeChanged = true;
  }
  if (b.scheduledLabel !== undefined && b.scheduledLabel !== text(row.scheduled_label)) {
    values.scheduledLabel = b.scheduledLabel;
  }
  if (b.comment !== undefined && b.comment !== text(row.comment)) {
    values.comment = b.comment;
    commentChanged = true;
  }

  return {
    values,
    hasWrites: Object.keys(values).length > 0,
    priceChanged,
    termsChanged: priceChanged || timeChanged || commentChanged,
  };
}
