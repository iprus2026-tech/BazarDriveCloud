// BD-CLOUD-DESIGN-LOADING-02B cancellation repair — read operation cleanup regressions.
import fs from 'node:fs';
const read=(rel)=>fs.readFileSync(new URL(rel,import.meta.url),'utf8');
const src=read('../public/src/screens/driver_map.js');
const mockApi=read('../public/src/mock_api.js');
const failures=[];
function expect(label,value){const ok=Boolean(value);console.log((ok?'PASS':'FAIL')+' — '+label);if(!ok)failures.push(label);}
const cancel=src.slice(src.indexOf('function cancelActiveRead()'),src.indexOf('const teardownObserver'));
const operation=src.slice(src.indexOf('async function readNearbyOrders'),src.indexOf('// BD-ERROR-01C-F',src.indexOf('async function readNearbyOrders')));
expect('teardown cancels request and timer',/MutationObserver/.test(src)&&/rootWasConnected/.test(src)&&/cancelActiveRead\(\);\s*teardownObserver\.disconnect\(\)/.test(src)&&/clearTimeout\(operation\.timeoutId\)/.test(cancel)&&/operation\.controller\.abort\(\)/.test(cancel));
expect('epoch replacement cancels previous operation before creating the next',/const epoch = \+\+readEpoch/.test(src)&&/cancelActiveRead\(\);\s*const controller = new AbortController\(\)/.test(operation)&&/\{ controller, epoch, reject, timeoutId: null \}/.test(operation));
expect('retry reuses the single-operation seam without stale GET or timer accumulation',/onDriverMapRetry = \(\) => \{ void renderList\(true\)/.test(src)&&/activeRead = operation/.test(operation)&&/clearTimeout\(operation\.timeoutId\)/.test(cancel));
expect('canceled settlement cannot mutate UI',/isActive: \(\) => isCurrent\(epoch\)/.test(operation)&&(src.match(/if \(!isCurrent\(epoch\)/g)||[]).length===2&&/operation\.reject\(error\)/.test(cancel));
expect('AbortSignal reaches apiFetch and fetch seam',/listNearbyOrders\(\{ signal: controller\.signal \}\)/.test(operation)&&/listNearbyOrders\(\{ signal \} = \{\}\)/.test(mockApi)&&/apiFetch\('\/orders', \{ signal \}\)/.test(mockApi));
if(failures.length){console.error('\nFAIL '+failures.length+' expectation(s):\n  - '+failures.join('\n  - '));process.exit(1);}console.log('\nALL PASSED');
