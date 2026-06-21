// BD-FEED-01 — static regression smoke for the Feed empty states.
//
// renderList must distinguish a genuinely empty / load-failed feed (no posts at
// all) from a filter that matched nothing. The old copy always said "change the
// filter", which is misleading on a zero-data feed. This smoke pins the two
// distinct states so a refactor can't collapse them back into one message.
//
// STATIC: reads source and asserts the contract holds. No browser, no DOM, no
// network, no behaviour change.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const feed = read('../public/src/screens/feed.js');

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) return '';
  const open = source.indexOf('{', start);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(open, i + 1); }
  }
  return '';
}

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

const body = functionBody(feed, 'renderList');

expect('renderList branches on the total post count (zero-data vs filtered-empty)',
  /posts\.length === 0/.test(body));
expect('zero-data state uses a no-data message, not the change-filter hint',
  /Пока нет публикаций/.test(body));
expect('filtered-empty state keeps the change-filter hint',
  /сменить фильтр/.test(body));
expect('the two empty states are distinct and ordered (zero-data, then filtered)',
  body.indexOf('Пока нет публикаций') > -1
    && body.indexOf('Ничего не найдено') > -1
    && body.indexOf('Пока нет публикаций') < body.indexOf('Ничего не найдено'));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
