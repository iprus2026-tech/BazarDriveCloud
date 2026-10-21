// Driver enrollment client seam (BD-AUTH-POLICY-01C-1; docs/driver-role-grant-contract.md §1, §3).
// Backend-ON only: the applicant's POST/GET /api/v1/drivers/enrollment, a pure view model for
// the four states (no application / PENDING / APPROVED / REJECTED-REVOKED), and the card markup
// shared by the onboarding "Вход выполнен" step and (01C-2) the profile. Backend-OFF never
// reaches this module's network calls; the demo keeps its local driver flow.
import { isBackendEnabled } from './api_config.js';
import { apiFetch, ApiError } from './api_client.js';
import { escapeHtml } from './util.js';

const STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED', 'REVOKED']);

// The server envelope { enrollment: { status, requestedAt, decidedAt } | null, roles } as a
// small immutable model. A malformed envelope is an error, never "no application".
export function normalizeEnrollment(payload) {
  const e = payload?.enrollment;
  const roles = payload?.roles;
  const enrollmentOk = e === null || (e && typeof e === 'object' && !Array.isArray(e) && STATUSES.has(e.status));
  if (!payload || typeof payload !== 'object' || !enrollmentOk
      || !Array.isArray(roles) || roles.some(r => typeof r !== 'string')) {
    throw new ApiError({ status: 0, code: 'BAD_RESPONSE', retryable: true, message: 'malformed driver enrollment response' });
  }
  return Object.freeze({
    status: e ? e.status : 'NONE',
    roles: Object.freeze(roles.slice()),
    driverGranted: roles.includes('driver'),
  });
}

function requireBackend() {
  if (!isBackendEnabled()) {
    throw new ApiError({ status: 0, code: 'BACKEND_DISABLED', retryable: false, message: 'backend is disabled' });
  }
}

// Apply (idempotent on the server: an open application or an existing grant answers 200).
export async function submitDriverEnrollment() {
  requireBackend();
  return normalizeEnrollment(await apiFetch('/drivers/enrollment', { method: 'POST' }));
}

// The caller's latest application and current grants.
export async function readDriverEnrollment() {
  requireBackend();
  return normalizeEnrollment(await apiFetch('/drivers/enrollment'));
}

// What the card shows for a model. `granted` = the account already holds the driver grant;
// `passengerAvailable` = "continue as passenger" is possible (the passenger grant is held).
// Actions are ids the host wires: apply | refresh | continue-driver | continue-passenger | exit.
export function enrollmentView(model, { passengerAvailable = false } = {}) {
  const status = model?.driverGranted ? 'APPROVED' : (model?.status ?? 'NONE');
  const passenger = passengerAvailable ? ['continue-passenger'] : [];
  switch (status) {
    case 'PENDING':
      return { status, title: 'Заявка на рассмотрении',
        body: 'Мы проверим данные и откроем доступ водителя. Пока можно пользоваться приложением как пассажир.',
        actions: ['refresh', ...passenger, 'exit'] };
    case 'APPROVED':
      return { status, title: 'Доступ водителя открыт',
        body: 'Роль водителя выдана. Продолжите вход как водитель.',
        actions: ['continue-driver', ...passenger, 'exit'] };
    case 'REJECTED':
      return { status, title: 'Заявка отклонена',
        body: 'Заявку водителя не одобрили. Можно подать её снова.',
        actions: ['apply', ...passenger, 'exit'] };
    case 'REVOKED':
      return { status, title: 'Доступ водителя отозван',
        body: 'Роль водителя для этого аккаунта отозвана. Можно подать заявку снова.',
        actions: ['apply', ...passenger, 'exit'] };
    default:
      return { status: 'NONE', title: 'Роль водителя пока не выдана',
        body: 'Подайте заявку — после проверки вы сможете принимать заказы.',
        actions: ['apply', ...passenger, 'exit'] };
  }
}

const ACTION_LABELS = Object.freeze({
  apply: 'Подать заявку водителя',
  refresh: 'Проверить статус',
  'continue-driver': 'Продолжить как водитель',
  'continue-passenger': 'Продолжить как пассажир',
  exit: 'Выйти',
});

// Re-applying after REJECTED / REVOKED reads as "again".
function actionLabel(action, status) {
  if (action === 'apply' && (status === 'REJECTED' || status === 'REVOKED')) return 'Подать заявку снова';
  return ACTION_LABELS[action];
}

// Card markup. `idPrefix` keeps ids unique per host; the heading takes programmatic focus when
// the card appears or changes (tabindex="-1"). `busy` disables every action; `error` renders a
// role="alert" line and keeps the current state.
export function renderEnrollmentCard(view, { idPrefix = 'drv-enroll', busy = false, error = '', lead = '' } = {}) {
  const buttons = view.actions.map((action, i) => {
    const primary = i === 0 && action !== 'exit';
    return `<button type="button" class="bd-btn ${primary ? 'primary' : 'ghost'}" id="${idPrefix}-${action}"`
      + ` data-enroll-action="${action}"${busy ? ' disabled aria-disabled="true"' : ''}>`
      + `${escapeHtml(actionLabel(action, view.status))}</button>`;
  }).join('');
  return `
    <div class="ob-scroll" data-enroll-status="${escapeHtml(view.status)}">
      ${lead ? `<p class="ob-subtitle">${escapeHtml(lead)}</p>` : ''}
      <h1 class="ob-title" id="${idPrefix}-title" tabindex="-1">${escapeHtml(view.title)}</h1>
      <p class="ob-subtitle">${escapeHtml(view.body)}</p>
    </div>
    <div class="ob-footer">
      <p class="ob-subtitle" id="${idPrefix}-err" role="alert"${error ? '' : ' hidden'}>${escapeHtml(error)}</p>
      ${buttons}
    </div>
  `;
}

// User-facing text for a failed enrollment or switch request.
export function enrollmentErrorText(err) {
  const code = err?.code;
  if (code === 'NETWORK') return 'Не удалось связаться с сервером. Попробуйте ещё раз.';
  if (code === 'ROLE_NOT_GRANTED') return 'Роль водителя ещё не выдана. Проверьте статус позже.';
  if (code === 'PHONE_NOT_VERIFIED') return 'Подтвердите номер телефона и попробуйте снова.';
  return 'Не удалось выполнить запрос. Попробуйте ещё раз.';
}
