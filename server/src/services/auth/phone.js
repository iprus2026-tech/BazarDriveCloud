// /server/src/services/auth/phone.js — normalize + validate the OTP identity-key phone
// (BD-DOCS-032 decision 2: phone is the identity key). Canonicalization makes cosmetic
// variants of the SAME number map to ONE stored phone, so it resolves to ONE account via
// uq_users_phone. We strip EVERY non-digit (spaces, dashes, dots, parentheses, and any '+')
// and re-add a single leading '+'. So "+15550001234", "15550001234", and "+1 (555) 000-1234"
// all collapse to "+15550001234" — request, verify, and the unique index then agree, and a
// missing '+' can no longer fork the identity (Codex #788). Only digits decide identity and we
// never alter them, so two DIFFERENT numbers can never merge. Validation is deliberately
// permissive E.164-ish (a non-zero leading digit, 7..15 digits) — real per-region validation
// is a delivery-provider concern (BD-DOCS-032 open question); this only stops empty/garbage
// phones from minting OTPs and keys off the single canonical form.
export function normalizePhone(raw) {
  if (typeof raw !== 'string') return '';
  const digits = raw.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

// Validate the CANONICAL form normalizePhone produces: a mandatory leading '+', a non-zero
// leading digit, and 7..15 digits total (the E.164 ceiling).
export function isValidPhone(normalized) {
  return /^\+[1-9]\d{6,14}$/.test(normalized);
}
