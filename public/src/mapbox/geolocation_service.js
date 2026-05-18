// BD-MAP-FOUND-STUB-01 — geolocation service stub.
// Does NOT call navigator.geolocation. Does NOT trigger any native
// permission prompt. MapHome treats the permission as unknown by
// default; the user opts in explicitly via the «Моё место» action.
//
// Contract:
//   getPermissionStatus() → 'unknown' | 'granted' | 'denied' | 'prompt'
//   requestPosition()     → Promise<null>   (stub, never resolves to real coords)

export const GEO_STATUS = Object.freeze({
  UNKNOWN: 'unknown',
  PROMPT:  'prompt',
  GRANTED: 'granted',
  DENIED:  'denied',
});

export function getPermissionStatus() {
  return GEO_STATUS.UNKNOWN;
}

export function requestPosition() {
  return Promise.resolve(null);
}
