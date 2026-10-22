// /server/src/domain/vehicle-plate.js — the driver's car plate as the passenger sees it (#1113).
//
// normalizeVehiclePlate() is the one stored form: trimmed, inner whitespace collapsed to single
// spaces, upper case, and the Latin letters that look like Cyrillic ones (A B E K M H O P C T Y X)
// replaced by those Cyrillic letters (А В Е К М Н О Р С Т У Х), so «a108op77» and «А 108 ОР 77»
// are one plate. No strict format check: a foreign plate stays as typed (other Latin letters and
// all digits pass through). An empty or non-string value is null.
//
// maskVehiclePlate() is what the passenger sees before choosing a driver (the offers list); the
// full plate is served only on the ride, after selection. Built from the normalized plate:
//   - a Russian plate (letter, 3 digits, 2 letters, 2–3 region digits) hides the 3 digits and keeps
//     its own spacing: «А 108 ОР 77» -> «А ••• ОР 77», «А108ОР77» -> «А•••ОР77»;
//   - otherwise, with three or more space-separated parts, the second part is hidden (at least
//     three dots), as the client's offer card did: «AB 1234 CD» -> «АВ •••• СD» (A B C are
//     look-alikes, D is not);
//   - otherwise the first character and the last two stay and the rest is hidden; a plate of three
//     characters or fewer is hidden entirely.

const LATIN_TO_CYRILLIC = Object.freeze({
  A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х',
});

export const VEHICLE_PLATE_MAX_LENGTH = 20;

export function normalizeVehiclePlate(raw) {
  if (typeof raw !== 'string') return null;
  const plate = raw
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .replace(/[ABEKMHOPCTYX]/g, (ch) => LATIN_TO_CYRILLIC[ch]);
  return plate || null;
}

const RU_PLATE = /^([АВЕКМНОРСТУХ])( ?)(\d{3})( ?)([АВЕКМНОРСТУХ]{2})( ?)(\d{2,3})$/;
const DOT = '•';

export function maskVehiclePlate(raw) {
  const plate = normalizeVehiclePlate(raw);
  if (!plate) return null;
  const ru = plate.match(RU_PLATE);
  if (ru) return `${ru[1]}${ru[2]}${DOT.repeat(3)}${ru[4]}${ru[5]}${ru[6]}${ru[7]}`;
  const parts = plate.split(' ');
  if (parts.length >= 3) {
    parts[1] = DOT.repeat(Math.max(parts[1].length, 3));
    return parts.join(' ');
  }
  const chars = [...plate];
  if (chars.length <= 3) return DOT.repeat(chars.length);
  return `${chars[0]}${DOT.repeat(chars.length - 3)}${chars.slice(-2).join('')}`;
}

// An optional free-text car field (model / colour): trimmed, inner whitespace collapsed; empty is null.
export function normalizeVehicleText(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/\s+/g, ' ');
  return text || null;
}
