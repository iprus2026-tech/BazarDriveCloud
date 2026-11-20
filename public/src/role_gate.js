// Role-gate refusals from the server as readable text (BD-AUTH-POLICY-01B-C, K3-2;
// docs/driver-role-grant-contract.md §2, §4). Backend-ON only: these codes never occur with the
// backend OFF. The way out is the profile's server role switch (#1080), never a local role change.
// A driver-mode «Попутчик» publication is NOT pointed at the switch: a driver would only create a
// passenger order for themselves (the driver ride offer entity is #1081).

export const PASSENGER_ROLE_REQUIRED = 'PASSENGER_ROLE_REQUIRED';
export const DRIVER_ROLE_REQUIRED = 'DRIVER_ROLE_REQUIRED';
export const DRIVER_NOT_ELIGIBLE = 'DRIVER_NOT_ELIGIBLE';

// The role-gate code of a failed request (an ApiError), or null for any other failure.
export function roleGateCode(err) {
  const code = err?.code;
  if (err?.status === 403 && (code === PASSENGER_ROLE_REQUIRED || code === DRIVER_ROLE_REQUIRED)) return code;
  if (err?.status === 409 && code === DRIVER_NOT_ELIGIBLE) return code;
  return null;
}

export const PROFILE_CTA_LABEL = 'Перейти в профиль';

export const ROLE_GATE_TEXT = Object.freeze({
  offersListTitle: 'Отклики доступны в режиме пассажира',
  offersListBody: 'Сейчас ваш аккаунт в режиме водителя. Переключите режим в профиле, чтобы посмотреть отклики и выбрать водителя.',
  select: 'Выбрать водителя можно только в режиме пассажира. Переключите режим в профиле.',
  orderCreate: 'Заказ можно создать только в режиме пассажира. Переключите режим в профиле.',
  orderCancel: 'Отменить заказ можно только в режиме пассажира. Переключите режим в профиле.',
  orderEdit: 'Изменить заказ можно только в режиме пассажира. Переключите режим в профиле.',
  driverRidePublish: 'Публикация поездок от водителя пока недоступна.',
  offerCreate: 'Отклик можно отправить только в режиме водителя. Переключите режим в профиле.',
  driverNotEligible: 'Этот водитель больше не может принять заказ. Выберите другого.',
});

// #1183 — on a live backend the `role=` query parameter must agree with the account.
//
// `?role=` is a VIEW selector on three screens: the ride screen, the trip confirmation and the
// profile. With the backend OFF one local identity plays both sides of a ride through it (the
// single-device demo), so it stays free there. With a real session the account has one active
// role, and a link that asks for the other one showed that role's screen to the wrong person
// (its actions were refused by the server, but the screen was theirs to look at).
//
// Given the current route (path + query, no leading '#') and the session's active role, returns
// the same route with `role=` corrected, or null when nothing needs to change. Pure.
//   - only /active-ride, /trip-confirmation and /profile are considered;
//   - a role other than passenger/driver (none, guest) corrects nothing;
//   - an absent `role=` is left alone where the screen already defaults from the account
//     (/active-ride, /profile). /trip-confirmation defaults to the passenger variant, so a
//     driver gets `role=driver` there;
//   - `status=` is dropped on a correction: it is a hint for the other role's flow.
export const ROLE_PARAM_ROUTES = Object.freeze(['/active-ride', '/trip-confirmation', '/profile']);

export function roleCorrectedRoute(route, accountRole) {
  if (accountRole !== 'passenger' && accountRole !== 'driver') return null;
  const full = typeof route === 'string' ? route : '';
  const qi = full.indexOf('?');
  const path = qi === -1 ? full : full.slice(0, qi);
  if (!ROLE_PARAM_ROUTES.includes(path)) return null;
  const params = new URLSearchParams(qi === -1 ? '' : full.slice(qi + 1));
  const asked = params.get('role');
  if (asked !== null && asked !== 'passenger' && asked !== 'driver') return null;
  // `/trip-confirmation` also takes an explicit `state=` that picks the variant on its own
  // (PASSENGER_* / DRIVER_*), whatever `role=` says — the other side's state is dropped too.
  const other = accountRole === 'driver' ? 'PASSENGER_' : 'DRIVER_';
  const foreignState = path === '/trip-confirmation'
    && (params.get('state') || '').startsWith(other);
  const roleOk = asked === accountRole
    || (asked === null && !(path === '/trip-confirmation' && accountRole === 'driver'));
  if (roleOk && !foreignState) return null;
  if (!roleOk) {
    params.set('role', accountRole);
    params.delete('status');
  }
  if (foreignState) params.delete('state');
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
