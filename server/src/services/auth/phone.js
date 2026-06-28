// /server/src/services/auth/phone.js — normalize + validate the OTP identity-key phone
// (BD-DOCS-032 decision 2: phone is the identity key). Normalization makes the SAME number
// always map to ONE stored phone, so it resolves to ONE account via uq_users_phone: strip
// spaces/dashes/dots/parentheses and keep a single leading '+'. Validation is deliberately
// permissive E.164-ish (optional '+', a non-zero leading digit, 7..15 digits total) — real
// per-region validation is a delivery-provider concern (BD-DOCS-032 open question); this only
// stops empty/garbage phones from minting OTPs and keeps the identity key canonical. BOTH OTP
// endpoints normalize+validate identically, so request and verify agree on the stored key.
const SEPARATORS = /[\s().-]/g;

export function normalizePhone(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  const digits = trimmed.replace(SEPARATORS, '').replace(/\+/g, '');
  return digits ? plus + digits : '';
}

export function isValidPhone(normalized) {
  return /^\+?[1-9]\d{6,14}$/.test(normalized);
}
