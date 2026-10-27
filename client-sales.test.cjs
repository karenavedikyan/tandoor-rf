const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function fixture(){
 const box={window:{},console,Intl,Map,Set,URLSearchParams};
 vm.createContext(box);
 for(const file of ['sales-categories.js','client-metrics.js','client-sales.js'])
  vm.runInContext(fs.readFileSync(__dirname+'/site/'+file,'utf8'),box,{filename:file});
 const clients=[{id:'C1',clientId:'C1'},{id:'C2',clientId:'C2'},{id:'EMPTY',clientId:'EMPTY'}];
 const outlets=[{id:'T1',clientId:'C1',outletId:'T1'},{id:'T2',clientId:'C1',outletId:'T2'}];
 const legals=Array.from({length:24},(_,i)=>({legalId:'L'+i,clientId:i<2?'C1':'C2',legalName:'Демо '+i,inn:'DEMO-'+i}));
 const legalFor=r=>legals.filter(l=>l.clientId===r.clientId);
 const sales=box.window.TandoorClientSales.create({clients,outlets,legals,legalFor});
 return{sales,clients,outlets,legals};
}
test('all months reconcile category, legal, client and outlet context',()=>{
 const {sales,clients,outlets}=fixture();
 for(const month of ['2026-08','2026-09','2026-10']){
  sales.setMonth(month);
  const summary=sales.forRecord(clients[0]);
  assert.equal(summary.revenue,summary.values.reduce((sum,v)=>sum+v.revenue,0));
  assert.equal(summary.quantity,summary.values.reduce((sum,v)=>sum+v.quantity,0));
  assert.equal(clients[0].salesRub,summary.revenue);
  assert.equal(outlets[0].salesRub,clients[0].salesRub);
  assert.equal(outlets[1].salesRub,clients[0].salesRub);
 }
});
test('deduplicate legal IDs, never count an entity twice',()=>{
 const {sales,legals}=fixture();
 const a=sales.summary([legals[0],legals[1]]);
 const b=sales.summary([legals[0],legals[1],legals[0]]);
 assert.equal(a.revenue,b.revenue);assert.equal(a.quantity,b.quantity);assert.equal(b.count,2);
});
test('missing data does not become zero or a partial total',()=>{
 const {sales,clients}=fixture();
 const s=sales.forRecord(clients[1]);
 assert.equal(s.revenue,null);assert.equal(s.quantity,null);assert.equal(s.active,null);
 assert.ok(s.known>0&&s.known<s.count);
 assert.match(sales.panel(clients[1]),/Неполные данные/);
});
test('no related legal entities is an explicit unavailable state',()=>{
 const {sales,clients}=fixture();const s=sales.forRecord(clients[2]);
 assert.equal(s.count,0);assert.equal(s.revenue,null);assert.equal(s.quantity,null);
 assert.match(sales.panel(clients[2]),/Нет связанных юридических лиц/);
});
test('a known zero is not missing and has no calculable sales share',()=>{
 const {sales}=fixture();
 const zero={legalId:'ZERO',legalName:'Нулевой пример',metricsByMonth:{
  '2026-09':{categorySales:Object.fromEntries(['entry','interior','hardware'].map(k=>[k,{revenueRub:0,quantity:0,models:[]}]))}
 }};
 const s=sales.summary([zero]);assert.equal(s.revenue,0);assert.equal(s.quantity,0);assert.equal(s.active,0);
 assert.equal(sales.formatted(0,{id:'salesRub'}),'0 ₽');
 assert.equal(sales.formatted(null,{id:'salesRub'}),'Нет данных');
});
test('period changes sales, invalid period returns to pinned September default',()=>{
 const {sales,clients}=fixture();const sept=clients[0].salesRub;
 sales.setMonth('2026-10');assert.notEqual(clients[0].salesRub,sept);
 assert.equal(sales.setMonth('not-a-month'),'2026-09');assert.equal(clients[0].salesRub,sept);
});
test('untrusted legal names are escaped in list and card',()=>{
 const {sales,clients,legals}=fixture();legals[0].legalName='<img src=x onerror=alert(1)>';
 assert.ok(!sales.breakdown(clients[0]).includes('<img'));
 assert.ok(!sales.panel(clients[0]).includes('<img'));
});
