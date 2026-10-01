// Router-owned presentation: one strip per mounted product screen plus the
// driver's profile slot. All identity/status reads live in driver_current_trip.
import { driverTripScope, loadDriverTrip, driverTripRoute } from './driver_current_trip.js';

export function mountDriverRideReturn({ view, shell, tabbar, noChrome, guestReadOnly, isCurrent, go }) {
  const scope = driverTripScope();
  if (noChrome || guestReadOnly || !scope || view.classList.contains('pfp-experience')) return null;
  const strip = document.createElement('div');
  strip.className = 'driver-active-return';
  strip.hidden = true;
  strip.innerHTML = `<button type="button" class="driver-active-return__button">
    <span class="driver-active-return__copy"><strong>Активный заказ</strong>
      <span class="driver-active-return__status"></span></span>
    <span class="driver-active-return__action">Вернуться</span>
  </button>`;
  shell.insertBefore(strip, tabbar);
  const button = strip.querySelector('button');
  const status = strip.querySelector('.driver-active-return__status');
  const action = strip.querySelector('.driver-active-return__action');
  const card = view.querySelector('#pf2-current-order');
  if (card) card.innerHTML = `<p class="pf2-current-order__eyebrow">АКТИВНЫЙ ЗАКАЗ</p>
    <h2 class="pf2-current-order__status"></h2>
    <p class="pf2-current-order__passenger"></p>
    <div class="pf2-current-order__route"><p></p><p></p></div>
    <button type="button" class="bd-btn primary">Вернуться к заказу</button>`;
  const cardButton = card?.querySelector('button');
  let disposed = false;
  let epoch = 0;
  let request = null;
  let displayed = null;
  let opening = false;
  const ownsView = () => !disposed && isCurrent() && driverTripScope() === scope;

  function paint(value) {
    displayed = value;
    const visible = ownsView() && ['ready', 'error'].includes(value.state);
    if (!visible && (strip.contains(document.activeElement) || card?.contains(document.activeElement))) {
      tabbar.querySelector('.active')?.focus();
    }
    strip.hidden = !visible;
    shell.classList.toggle('has-driver-active-return', visible);
    if (card) card.hidden = !visible;
    if (!visible) return;
    const trip = value.trip;
    const label = trip?.label || 'Не удалось проверить заказ';
    status.textContent = label;
    action.textContent = trip ? 'Вернуться' : 'Повторить';
    button.setAttribute('aria-label', trip
      ? `Вернуться к активному заказу. ${label}. ${trip.from} — ${trip.to}`
      : 'Повторить проверку активного заказа');
    if (card) {
      card.querySelector('h2').textContent = label;
      const passenger = card.querySelector('.pf2-current-order__passenger');
      passenger.textContent = trip?.passenger || '';
      passenger.hidden = !trip?.passenger;
      const route = card.querySelector('.pf2-current-order__route');
      route.hidden = !trip;
      const points = route.querySelectorAll('p');
      points[0].textContent = trip?.from || 'Место подачи не указано';
      points[1].textContent = trip?.to || 'Пункт назначения не указан';
      cardButton.textContent = trip ? 'Вернуться к заказу' : 'Повторить проверку';
    }
  }

  async function refresh({ navigate = false } = {}) {
    if (!ownsView()) { paint({ state: 'empty', trip: null }); return; }
    const pinnedId = navigate ? displayed?.trip?.id : null;
    const version = ++epoch;
    request?.abort();
    const controller = new AbortController();
    // Every supersession/dispose settles and clears its own timeout even if
    // a transport ignores abort. Late results cannot paint the next screen.
    let timer;
    const interrupted = new Promise(resolve => {
      request = { abort: () => {
        clearTimeout(timer);
        controller.abort();
        resolve({ state: 'empty', trip: null });
      } };
      timer = setTimeout(() => { controller.abort(); resolve({ state: 'error', trip: null }); }, 12000);
    });
    const value = await Promise.race([loadDriverTrip({ tripId: pinnedId, signal: controller.signal }), interrupted]);
    clearTimeout(timer);
    if (version !== epoch) return;
    request = null;
    if (!ownsView()) { paint({ state: 'empty', trip: null }); return; }
    const href = navigate && pinnedId ? driverTripRoute(value) : null;
    if (href) { go(href); return; }
    paint(value);
  }

  async function open() {
    if (opening) return;
    opening = true;
    button.disabled = true;
    if (cardButton) cardButton.disabled = true;
    try { await refresh({ navigate: displayed?.state === 'ready' }); }
    finally {
      opening = false;
      button.disabled = false;
      if (cardButton) cardButton.disabled = false;
    }
  }
  const reread = () => { if (!opening) void refresh(); };
  const onVisible = () => { if (!document.hidden) reread(); };
  button.addEventListener('click', open);
  cardButton?.addEventListener('click', open);
  window.addEventListener('storage', reread);
  window.addEventListener('focus', reread);
  document.addEventListener('visibilitychange', onVisible);
  // Covers in-place accept on DriverMap and backend terminal changes while
  // the driver stays in a menu. One non-overlapping reader; disposed on exit.
  const poll = setInterval(() => { if (!request && !document.hidden) reread(); }, 5000);
  void refresh();
  return () => {
    disposed = true;
    epoch++;
    request?.abort();
    clearInterval(poll);
    window.removeEventListener('storage', reread);
    window.removeEventListener('focus', reread);
    document.removeEventListener('visibilitychange', onVisible);
    strip.remove();
    shell.classList.remove('has-driver-active-return');
  };
}
