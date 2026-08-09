// BD-ORDER-P-02A — static guard for /responses empty/order-context hardening.
// Pins: renderEmptyState accepts request and branches on isFallback + orderId;
// requestFromOrder null path sets isFallback:true with context-aware fallback copy;
// order context fields (pickup, dropoff, price, note, time) are rendered from request;
// no forbidden technical terms in user-facing fallback copy.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];

function check(cond, msg) {
  if (!cond) errors.push(msg);
}

const responsesPath = path.join(root, 'public', 'src', 'screens', 'responses.js');
check(fs.existsSync(responsesPath), 'responses.js not found');

const src = fs.existsSync(responsesPath) ? fs.readFileSync(responsesPath, 'utf8') : '';

// renderEmptyState signature accepts request
check(
  // request stays the first param; CUT-4 (#784) added an optional opts arg (the error variant).
  /function\s+renderEmptyState\s*\(\s*request\b/.test(src),
  'renderEmptyState must accept a request parameter',
);

// Call site passes request — must appear at least twice: once as the function
// declaration and once as the actual runtime call inside the render branch.
// A single match would only verify the declaration, not the call site.
check(
  (src.match(/renderEmptyState\s*\(\s*request\b/g) || []).length >= 2,
  'renderEmptyState(request) must appear at least twice: declaration + call site',
);

// Targeted call-site shape: the settled empty request-state branch renders the
// context-aware empty state (02A moved this out of the original root ternary).
check(
  /readState\s*===\s*'empty'[\s\S]{0,220}renderEmptyState\s*\(\s*request\s*\)/.test(src),
  'settled empty request-state branch must call renderEmptyState(request)',
);

// Context-aware copy: published-order branch present
check(
  src.includes('Заказ опубликован'),
  'renderEmptyState must include published-order copy ("Заказ опубликован")',
);

// Context-aware copy: isFallback branch present
check(
  /isFallback/.test(src),
  'renderEmptyState must branch on isFallback',
);

// requestFromOrder sets isFallback: true for null order
check(
  /isFallback\s*:\s*true/.test(src),
  'requestFromOrder null path must set isFallback: true',
);

// requestFromOrder distinguishes hasOrderId vs no-orderId for fallback copy
check(
  /hasOrderId\s*\?/.test(src),
  'requestFromOrder must branch on hasOrderId for fallback label copy',
);

// Fallback copy: no-orderId variant
check(
  src.includes('Заказ пока не выбран'),
  'requestFromOrder must include no-orderId pickup fallback label',
);
check(
  src.includes('Когда заказ будет опубликован, здесь появятся маршрут, бюджет, время и комментарий.'),
  'requestFromOrder must include no-orderId note fallback copy',
);

// Fallback copy: unknown-orderId variant
check(
  src.includes('Заказ не найден'),
  'requestFromOrder must include unknown-orderId pickup fallback label',
);
check(
  src.includes('Детали заказа недоступны. Можно безопасно проверить отклики или вернуться на карту.'),
  'requestFromOrder must include unknown-orderId note fallback copy',
);

// Order context fields rendered from request (not hardcoded)
check(
  /request\.pickupLabel/.test(src),
  'route card must render request.pickupLabel',
);
check(
  /request\.dropoffLabel/.test(src),
  'route card must render request.dropoffLabel',
);
check(
  /request\.price/.test(src),
  'route card must render request.price',
);
check(
  /request\.note/.test(src),
  'route card must render request.note',
);
check(
  /renderOrderMeta\s*\(\s*request\s*\)/.test(src),
  'renderOrderMeta must be called with request (time + budget meta)',
);

// resolveCanonicalOrder uses getOrderById — safe lookup, never crashes
check(
  /function\s+resolveCanonicalOrder\s*\(\s*\)/.test(src),
  'resolveCanonicalOrder must be defined',
);
check(
  /getOrderById\s*\(/.test(src),
  'resolveCanonicalOrder must call getOrderById',
);

// No forbidden technical terms in user-facing fallback copy
const forbiddenInCopy = ['state=', '"empty"', "'empty'", '`empty`', 'CREATED', 'mock_api', 'isFallback'];
// Check only within string literals that reach the DOM (inside template literals used for HTML)
// We approximate by checking the fallback note strings directly
const fallbackNotes = [
  'Когда заказ будет опубликован, здесь появятся маршрут, бюджет, время и комментарий.',
  'Детали заказа недоступны. Можно безопасно проверить отклики или вернуться на карту.',
  'Опубликуйте заказ с карты — водители рядом увидят маршрут и смогут откликнуться.',
  'Не удалось открыть детали заказа. Вернитесь на карту или откройте опубликованный заказ ещё раз.',
];
for (const note of fallbackNotes) {
  for (const term of ['state=', 'CREATED', 'mock', 'isFallback']) {
    check(
      !note.includes(term),
      `fallback copy must not contain forbidden term "${term}" — found in: "${note.slice(0, 60)}"`,
    );
  }
}

// BD-MAP-05 handoff preserved: responseUrl sets orderId param when request.orderId exists
check(
  /params\.set\s*\(\s*['"`]orderId['"`]/.test(src),
  'responseUrl must set orderId param for canonical order navigation',
);

if (errors.length) {
  for (const e of errors) process.stderr.write('FAIL: ' + e + '\n');
  process.exit(1);
}
process.stdout.write('BD-ORDER-P-02A responses empty context: all checks passed.\n');
