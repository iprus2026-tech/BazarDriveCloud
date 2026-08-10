// BD-CLOUD-DESIGN-LOADING-02B repair — timed-out nearby read → error regression.
import fs from 'node:fs';
const src=fs.readFileSync(new URL('../public/src/screens/driver_map.js',import.meta.url),'utf8');
const failures=[];
function expect(label,value){const ok=Boolean(value);console.log((ok?'PASS':'FAIL')+' — '+label);if(!ok)failures.push(label);}
const start=src.indexOf('async function readNearbyOrders');
const end=src.indexOf('// BD-ERROR-01C-F',start);
const read=start>=0&&end>start?src.slice(start,end):'';
expect('nearby read has an explicit finite timeout',/READ_TIMEOUT_MS = 12_000/.test(src));
expect('fixtures bypass timeout and canonical read',/if \(fixture\) return fixtureResult\(\)/.test(read));
expect('timeout rejects the guarded read',/operation\.timeoutId = setTimeout\(\(\) => \{[\s\S]*reject\(new Error\('nearby orders read timed out'\)\)/.test(read));
expect('timeout aborts the underlying request after settling timeout error',/reject\(new Error\('nearby orders read timed out'\)\);\s*controller\.abort\(\)/.test(read));
expect('operation settlement clears its timer',/\.finally\(\(\) => \{[\s\S]*clearTimeout\(activeRead\.timeoutId\)/.test(read));
expect('timed read remains inside loadResource retry/error adapter',/loadResource\(timedRead, \{ onRetry, isRetry, fallback: READ_FAILED/.test(read));
expect('timeout failure sentinel renders explicit error, not empty',/if \(live === READ_FAILED\) \{[\s\S]{0,100}buildReadErrorCard\(\)/.test(src));
if(failures.length){console.error('\nFAIL '+failures.length+' expectation(s):\n  - '+failures.join('\n  - '));process.exit(1);}console.log('\nALL PASSED');
