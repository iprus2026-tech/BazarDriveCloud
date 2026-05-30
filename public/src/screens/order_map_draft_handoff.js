import orderMapDraftScreen from './order_map_draft.js';
import { go } from '../router.js';
import { listNearbyOrders } from '../mock_api.js';

function latestOpenOrder() {
  const orders = listNearbyOrders();
  return orders.length ? orders[0] : null;
}

function localizeSuccessStatus(root) {
  const statusPill = root.querySelector('.screen--order-map-draft[data-state="success"] .omd-topbar__sub');
  if (statusPill && statusPill.textContent.trim() === 'CREATED') {
    statusPill.textContent = 'Опубликован';
  }
}

function bindResponsesHandoff(root) {
  root.addEventListener('click', (event) => {
    const actionTarget = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('[data-action="responses"]')
      : null;
    if (!actionTarget) return;

    const order = latestOpenOrder();
    if (!order || !order.id) return;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
    go(`/responses?orderId=${encodeURIComponent(order.id)}`);
  }, true);
}

export default function orderMapDraftHandoffScreen() {
  const root = orderMapDraftScreen();
  localizeSuccessStatus(root);
  bindResponsesHandoff(root);

  const observer = new MutationObserver(() => {
    localizeSuccessStatus(root);
  });
  observer.observe(root, { childList: true, subtree: true });

  return root;
}
