// /server/src/domain/order-terms-change.js — #1188: what an owner's edit of an open order changes.
// Pure: compares the request's fields with the stored row and says what to write and what it means
// for the offers already made (owner's decision, 2026-11-20):
//   - the price changed            -> the open offers are rejected (drivers offer again);
//   - only the time or the comment -> the open offers stay, marked as made for the previous terms;
//   - nothing changed              -> nothing is written (a repeated request is a no-op).
// A display label (estimatedPriceLabel / scheduledLabel) that differs while its value does not is
// written without counting as a change of terms: a reformatted label must not mark or reject offers.
// The route is not editable here — a different route is a new order.
//
// Two things an edit must not leave behind (Codex on #1223):
//   - a price label for another price. The label is what the feed and the ride show first
//     (mock_api formatRideOrderPrice, matching buildRideSeed), so a new price sent without a label
//     gets one made here — the same `1 480 ₽` form matching's formatRub() writes; no budget (0)
//     has no label;
//   - a comment in the passenger snapshot. The ride note falls back to it when the order's own
//     comment is blank (domain/ride-order-comment.js), and an order may carry its comment only
//     there. So the comment is compared as the ride would read it, and a request that names the
//     comment is written whenever either copy differs from it — the repository replaces both.
import { rideNoteText, rideOrderComment } from './ride-order-comment.js';

const text = (v) => (typeof v === 'string' ? v : '');
const priceLabel = (n) => (n > 0 ? `${n.toLocaleString('ru-RU')} ₽` : '');

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
  const label = b.estimatedPriceLabel !== undefined
    ? b.estimatedPriceLabel
    : (priceChanged ? priceLabel(values.estimatedPrice) : undefined);
  if (label !== undefined && label !== text(row.estimated_price_label)) {
    values.estimatedPriceLabel = label;
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
  if (b.comment !== undefined) {
    const snap = (row.passenger_snapshot && typeof row.passenger_snapshot === 'object') ? row.passenger_snapshot : {};
    const snapshotDiffers = rideNoteText(snap.comment) !== null && snap.comment !== b.comment;
    if (b.comment !== text(row.comment) || snapshotDiffers) {
      values.comment = b.comment;
      commentChanged = (rideOrderComment(row) ?? '') !== (rideNoteText(b.comment) ?? '');
    }
  }

  return {
    values,
    hasWrites: Object.keys(values).length > 0,
    priceChanged,
    termsChanged: priceChanged || timeChanged || commentChanged,
  };
}
