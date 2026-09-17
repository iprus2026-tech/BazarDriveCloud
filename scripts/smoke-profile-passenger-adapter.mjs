// 01B behavioral integration checks. Synthetic fixtures, no real service.
import assert from 'node:assert/strict';
const store = new Map();
let writes = 0;
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => { writes++; store.set(k,String(v)); }, removeItem: k => { writes++; store.delete(k); } };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { user } = await import('../public/src/state.js');
const { readPassengerProfile, loadPassengerHistory, loadPassengerContext, passengerTripRoute } = await import('../public/src/profile_passenger_data.js');
user.set({ onboarded: true, role: 'passenger', firstName: 'Тест', tripCount: 999, paymentLast4: '9999' });
const historyKey = 'bazardrive.ride_history.v1';
const ordersKey = 'bazardrive.ride_orders.v1';
const ridesKey = 'bazardrive.active_ride.v1';
const tripId = 'trip_order-01b';
const seedRide = (status = 'IN_PROGRESS', role = 'passenger') => {
  store.set(ordersKey, JSON.stringify([{ id:'order-01b', status:'ACCEPTED', createdByRole:role }]));
  store.set(ridesKey, JSON.stringify({ [tripId]: {tripId, status, route:{pickupLabel:'A',dropoffLabel:'B'}} }));
};
const ok = value => ({ ok:true, status:200, text:async()=>JSON.stringify(value) });
let tests = 0;
async function check(name, test) { await test(); tests++; console.log('PASS — '+name); }
await check('local empty history is distinct from unavailable active discovery', () => {
  const m = readPassengerProfile();
  assert.equal(m.history.state,'empty'); assert.equal(m.context.state,'unavailable');
  assert.equal(passengerTripRoute(m.context),null); assert.equal(m.identity.name,'Тест');
  assert.equal(m.identity.rating,undefined);
});
await check('malformed history is an error; retry reads the repaired existing store', async () => {
  store.set(historyKey,'broken'); const m=readPassengerProfile(); assert.equal(m.history.state,'error');
  store.set(historyKey,'[]'); assert.equal((await loadPassengerHistory(m)).state,'empty');
});
await check('local history excludes driver records', () => {
  store.set(historyKey,JSON.stringify([{role:'driver',tripId:'d'},{role:'passenger',tripId:'p',rating:5}]));
  assert.deepEqual(readPassengerProfile().history.entries.map(e=>e.tripId),['p']);
});
await check('canonical local handoff has a concrete tripId and route', () => {
  seedRide(); const m=readPassengerProfile(); assert.equal(m.context.state,'ready');
  assert.equal(m.context.trip.from,'A'); assert.equal(passengerTripRoute(m.context),'/active-ride?role=passenger&tripId=trip_order-01b');
});
await check('click-time read cannot reopen terminal or driver test rides', async () => {
  const m=readPassengerProfile(); seedRide('COMPLETED'); assert.equal(passengerTripRoute(await loadPassengerContext(m)),null);
  seedRide('IN_PROGRESS','driver'); assert.equal(readPassengerProfile().context.state,'unavailable');
});
await check('backend pending does not paint local history as server truth', () => {
  seedRide(); globalThis.__BD_API_BASE__='https://fixture.invalid';
  const m=readPassengerProfile(); assert.equal(m.history.state,'loading'); assert.equal(m.context.state,'loading');
});
await check('server history authority, role isolation and matching local feedback', async () => {
  store.set(historyKey,JSON.stringify([{role:'passenger',tripId:'p',fare:999,rating:5},{role:'passenger',tripId:'local-only'}]));
  globalThis.fetch=async()=>ok({items:[{tripId:'p',role:'passenger',fare:123,route:{pickupLabel:'Server A'}},{tripId:'driver',role:'driver'}]});
  const result=await loadPassengerHistory(readPassengerProfile());
  assert.equal(result.state,'ready'); assert.equal(result.entries.length,1); assert.equal(result.entries[0].fare,123); assert.equal(result.entries[0].rating,5);
});
await check('backend empty and failure never fall back to local success', async () => {
  globalThis.fetch=async()=>ok({items:[]}); assert.equal((await loadPassengerHistory(readPassengerProfile())).state,'empty');
  globalThis.fetch=async()=>{throw Error('offline');}; assert.equal((await loadPassengerHistory(readPassengerProfile())).state,'error');
  const context=await loadPassengerContext(readPassengerProfile()); assert.equal(context.state,'error'); assert.equal(passengerTripRoute(context),null);
});
await check('backend trip identity, participant role, status, and terminal guards', async () => {
  for (const ride of [
    {tripId:'wrong',role:'passenger',status:'IN_PROGRESS'},
    {tripId,role:'driver',status:'IN_PROGRESS'},
    {tripId,role:'passenger',status:'UNKNOWN'},
    {tripId,role:'passenger',status:'COMPLETED'},
  ]) {
    globalThis.fetch=async()=>ok({ride}); assert.equal(passengerTripRoute(await loadPassengerContext(readPassengerProfile())),null);
  }
  globalThis.fetch=async()=>ok({ride:{tripId,role:'passenger',status:'DRIVER_EN_ROUTE',route:{pickupLabel:'Server A',dropoffLabel:'Server B'}}});
  const context=await loadPassengerContext(readPassengerProfile()); assert.equal(context.state,'ready'); assert.equal(context.trip.from,'Server A');
});
await check('no backend candidate is unavailable, never a demo seed', async () => {
  store.delete(ordersKey); let calls=0; globalThis.fetch=async()=>{calls++;throw Error();};
  assert.equal((await loadPassengerContext(readPassengerProfile())).state,'unavailable'); assert.equal(calls,0);
});
await check('adapter performs zero storage writes', async () => {
  const before=writes; const m=readPassengerProfile(); await loadPassengerContext(m); await loadPassengerHistory(m); assert.equal(writes,before);
});
await check('explicit passenger preview cannot expose persisted driver history', () => {
  globalThis.__BD_API_BASE__=''; user.set({role:'driver'});
  const m=readPassengerProfile(); assert.equal(m.history.state,'unavailable'); assert.equal(m.context.state,'unavailable');
});
console.log(`\n${tests} passenger adapter integration checks passed.`);

// Screen-level async ownership: immediate reads may settle before mount; late
// reads after navigation/account change must never paint. DOM shim records paints.
let paints = [];
function element() {
  const children = new Map();
  const listeners = new Map();
  return {
    className:'', dataset:{}, classList:{add(){},remove(){}},
    set innerHTML(v) { this._html=String(v); paints.push(String(v)); },
    get innerHTML() { return this._html || ''; },
    querySelector(selector){
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector);
    },querySelectorAll(){return [];},
    get firstElementChild(){return element();},
    addEventListener(type, fn){
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    async click(){ for (const fn of [...(listeners.get('click') || [])]) await fn({}); },
    removeEventListener(){}, replaceWith(){},
    setAttribute(){}, remove(){},focus(){},scrollIntoView(){},
  };
}
globalThis.document={createElement:element,querySelector:()=>null,body:{contains:()=>false},addEventListener(){}};
globalThis.window={location:{hash:'#/profile'},addEventListener(){}};
const profile=(await import('../public/src/screens/profile.js')).default;
const tick=()=>new Promise(r=>setTimeout(r,0));
user.set({role:'passenger'});globalThis.__BD_API_BASE__='https://fixture.invalid';
await check('immediate backend absence settles before mount, without a permanent spinner',async()=>{
  globalThis.fetch=async()=>ok({items:[]});paints=[];
  profile({isCurrent:()=>true});await tick();
  assert.ok(paints.some(v=>v.includes('id="pfp-quick-where"')));
  assert.ok(paints.some(v=>v.includes('Истории пока нет')));
});
await check('late history result cannot paint after router invalidation',async()=>{
  let finish;globalThis.fetch=()=>new Promise(r=>{finish=r;});let current=true;
  profile({isCurrent:()=>current});await tick();const before=paints.length;current=false;
  finish(ok({items:[{tripId:'late',role:'passenger',route:{pickupLabel:'LATE'}}]}));await tick();
  assert.equal(paints.length,before);
});
await check('late history result cannot paint after an account change',async()=>{
  let finish;globalThis.fetch=()=>new Promise(r=>{finish=r;});
  profile({isCurrent:()=>true});await tick();const before=paints.length;
  user.set({firstName:'Другой пользователь'});
  finish(ok({items:[{tripId:'private',role:'passenger'}]}));await tick();
  assert.equal(paints.length,before);
});
console.log(`\n${tests} total passenger adapter + screen integration checks passed.`);
await check('hung history read leaves loading after its bounded deadline',async()=>{
  const original=globalThis.setTimeout;
  globalThis.setTimeout=(fn,ms,...args)=>original(fn,ms===12000?5:ms,...args);
  globalThis.fetch=()=>new Promise(()=>{});
  try { assert.equal((await loadPassengerHistory(readPassengerProfile())).state,'error'); }
  finally { globalThis.setTimeout=original; }
});
console.log(`\n${tests} checks passed, including timeout.`);

// R1 regressions: mixed-role discovery and confirmed local recovery.
const { findLatestHandedOffOrderTripId } = await import('../public/src/mock_api.js');
function seedMixedOrders() {
  const orders = [
    {id:'driver-new',status:'ACCEPTED',createdByRole:'driver',passenger:{isCurrentUser:true}},
    {id:'unknown-new',status:'ACCEPTED'},
    {id:'terminal-passenger',status:'ACCEPTED',createdByRole:'passenger'},
    {id:'passenger-live',status:'ACCEPTED',createdByRole:'passenger'},
    {id:'passenger-older',status:'ACCEPTED',createdByRole:'passenger'},
  ];
  store.set(ordersKey,JSON.stringify(orders));
  store.set(ridesKey,JSON.stringify(Object.fromEntries(orders.map(o=>[
    `trip_${o.id}`,{tripId:`trip_${o.id}`,status:o.id==='terminal-passenger'?'COMPLETED':'IN_PROGRESS',route:{pickupLabel:o.id}}
  ]))));
}
user.set({role:'passenger'}); globalThis.__BD_API_BASE__='';
await check('R1 mixed-role selection skips driver, unknown and terminal candidates; default finder unchanged',()=>{
  seedMixedOrders(); const before=writes;
  assert.equal(findLatestHandedOffOrderTripId(),'trip_driver-new');
  assert.equal(readPassengerProfile().context.trip.id,'trip_passenger-live');
  assert.equal(writes,before);
});
await check('R1 backend GET uses the matching passenger candidate and never local success on failure',async()=>{
  globalThis.__BD_API_BASE__='https://fixture.invalid'; let url;
  globalThis.fetch=async input=>{url=String(input);return ok({ride:{tripId:'trip_passenger-live',role:'passenger',status:'IN_PROGRESS'}});};
  assert.equal((await loadPassengerContext(readPassengerProfile())).trip.id,'trip_passenger-live');
  assert.ok(url.endsWith('/ride-state/rides/trip_passenger-live'));
  globalThis.fetch=async()=>{throw Error('offline');};
  assert.equal((await loadPassengerContext(readPassengerProfile())).state,'error');
  globalThis.__BD_API_BASE__='';
});
await check('R1 malformed local history recovers only on second click through the screen handler',async()=>{
  store.set(historyKey,'broken'); paints=[]; const before=writes;
  const root=profile({isCurrent:()=>true});
  assert.ok(root.innerHTML.includes('id="profile-history-error-clear"'));
  assert.ok(!root.innerHTML.includes('id="pfp-history-retry"'));
  const button=root.querySelector('#profile-history-error-clear');
  await button.click(); assert.equal(store.get(historyKey),'broken'); assert.equal(writes,before);
  assert.equal(button.dataset.confirm,'pending');
  const otherEntries=[...store].filter(([k])=>k!==historyKey);
  await button.click(); assert.equal(store.has(historyKey),false); assert.equal(writes,before+1);
  assert.deepEqual([...store],otherEntries);
  assert.ok(paints.at(-1).includes('Истории пока нет'));
});
await check('R1 confirmation cannot erase history repaired in another tab',async()=>{
  store.set(historyKey,'broken');const root=profile({isCurrent:()=>true});
  const button=root.querySelector('#profile-history-error-clear');await button.click();
  const repaired=JSON.stringify([{role:'passenger',tripId:'preserve',route:{pickupLabel:'Repaired'}}]);
  store.set(historyKey,repaired);const before=writes;
  await button.click();assert.equal(store.get(historyKey),repaired);assert.equal(writes,before);
});
await check('R1 failed removal retains malformed state and requires fresh confirmation',async()=>{
  store.set(historyKey,'broken');const root=profile({isCurrent:()=>true});
  const button=root.querySelector('#profile-history-error-clear');await button.click();
  const original=localStorage.removeItem;localStorage.removeItem=()=>{throw Error('denied');};paints=[];
  try {await button.click();} finally {localStorage.removeItem=original;}
  assert.equal(store.get(historyKey),'broken');
  assert.ok(paints.at(-1).includes('id="profile-history-error-clear"'));
  assert.ok(!paints.at(-1).includes('Истории пока нет'));
  assert.ok(!paints.at(-1).includes('data-confirm="pending"'));
});
await check('R1 stale screen or changed account cannot clear local history',async()=>{
  for (const boundary of ['navigation','account','backend']) {
    globalThis.__BD_API_BASE__='';store.set(historyKey,'broken');let current=true;
    const root=profile({isCurrent:()=>current});const button=root.querySelector('#profile-history-error-clear');
    await button.click();const before=writes;
    if(boundary==='navigation')current=false;
    if(boundary==='account')user.set({firstName:'Changed during confirmation'});
    if(boundary==='backend')globalThis.__BD_API_BASE__='https://fixture.invalid';
    const afterBoundary=writes;await button.click();
    assert.equal(store.get(historyKey),'broken');assert.equal(writes,afterBoundary);
  }
  globalThis.__BD_API_BASE__='';
});
await check('R1 backend failure with malformed local data offers retry, never local deletion',async()=>{
  globalThis.__BD_API_BASE__='https://fixture.invalid';store.set(historyKey,'broken');store.delete(ordersKey);
  globalThis.fetch=async()=>{throw Error('offline');};paints=[];
  const before=writes;profile({isCurrent:()=>true});await tick();
  assert.ok(paints.some(v=>v.includes('id="pfp-history-retry"')));
  assert.ok(!paints.some(v=>v.includes('id="profile-history-error-clear"')));
  assert.equal(store.get(historyKey),'broken');assert.equal(writes,before);
});
console.log(`\n${tests} checks passed, including R1 regressions.`);
