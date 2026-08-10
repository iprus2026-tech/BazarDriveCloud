// BD-CLOUD-DESIGN-LOADING-02B repair — driver→passenger role-race regression.
import fs from 'node:fs';
const src=fs.readFileSync(new URL('../public/src/screens/driver_map.js',import.meta.url),'utf8');
const failures=[];
function expect(label,value){const ok=Boolean(value);console.log((ok?'PASS':'FAIL')+' — '+label);if(!ok)failures.push(label);}
const start=src.indexOf('function keepDriverPrecedence()');
const end=src.indexOf('function renderReadState',start);
const guard=start>=0&&end>start?src.slice(start,end):'';
expect('effective role is re-resolved instead of trusting initial role',/resolveEffectiveRole\(\) === 'driver'/.test(guard));
expect('lost driver role replaces a mounted view with Passenger guard',/root\.isConnected/.test(guard)&&/root\.replaceWith\(renderPassengerGuard\(\)\)/.test(guard));
expect('ready and not-ready late settlements both enforce role precedence',(src.match(/!keepDriverPrecedence\(\)/g)||[]).length>=4);
expect('ready settlement checks role before exposing list actions',/!isCurrent\(epoch\) \|\| !keepDriverPrecedence\(\) \|\| !isDriverLineReady/.test(src));
expect('not-ready settlement also checks current role',/!isCurrent\(epoch\) \|\| !keepDriverPrecedence\(\) \|\| isDriverLineReady/.test(src));
const accept=src.slice(src.indexOf("if (action === 'accept')"),src.indexOf("} else if (action === 'complete-readiness')"));
expect('click path enforces role before canonical accept',src.indexOf('if (!keepDriverPrecedence()) return;',src.indexOf("root.addEventListener('click', async"))<src.indexOf("if (action === 'accept')")&&/acceptCanonicalRideOrder/.test(accept));
if(failures.length){console.error('\nFAIL '+failures.length+' expectation(s):\n  - '+failures.join('\n  - '));process.exit(1);}console.log('\nALL PASSED');
