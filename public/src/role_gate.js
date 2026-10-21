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
  driverRidePublish: 'Публикация поездок от водителя пока недоступна.',
  offerCreate: 'Отклик можно отправить только в режиме водителя. Переключите режим в профиле.',
  driverNotEligible: 'Этот водитель больше не может принять заказ. Выберите другого.',
});
