/* Presentation-only synthetic prototype. No API or 1C import.
 * Real adapters must provide validated historical revenue and open-payment data;
 * absent data must never be replaced with these explicitly seeded demo values. */
(function(root){
 'use strict';
 const missing='Нет данных из 1С',asOf='2026-10-21',cache=new WeakMap();
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 const money=v=>finite(v)?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(v):missing;
 const round=v=>Math.round(v*100)/100;
 const day=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v)))return null;const d=new Date(v+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===v?+d/86400000:null};
 const shift=n=>new Date((day(asOf)+n)*86400000).toISOString().slice(0,10);
 const days=n=>`${n} ${n%10===1&&n%100!==11?'день':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'дня':'дней'}`;
 const distinct=ls=>[...new Map((ls||[]).filter(l=>l&&l.legalId).map(l=>[l.legalId,l])).values()];
 function seedDemo(legals){
  const seen=new Map();
  legals.forEach((l,i)=>{
   const slot=seen.get(l.clientId)||0;seen.set(l.clientId,slot+1);
   const n=l.debtRub,offset=slot===1?-5:[3,0,7,3][i%4],plan=finite(n)&&n>0&&i%7!==3?
    (offset<0?[{amount:round(n/3),dueDate:shift(offset)},{amount:round(n-round(n/3)),dueDate:shift(6)}]:[{amount:n,dueDate:shift(offset)}]):null;
   const history={},conversionHistory={};
   Object.entries(l.metricsByMonth||{}).forEach(([month,row])=>{
    history[month]=i%13===7?null:i%13===8?0:finite(row.salesRub)?round(row.salesRub/[1.124,.864,1,1.085,.935][Math.floor(i/2)%5]):null;
    conversionHistory[month]=i%13===7?null:{handlesQty:finite(row.handlesQty)?Math.max(0,row.handlesQty+[-4,6,0,-2,3][Math.floor(i/2)%5]):null,doorLeavesQty:i%13===8?0:row.doorLeavesQty};
   });
   cache.set(l,{plan,termDays:plan?30:null,history,conversionHistory});
  });
 }
 function debtStatus(balance,plan,today=asOf){
  if(!finite(balance))return{kind:'unknown',label:missing,note:'Остаток неизвестен'};
  if(balance===0)return{kind:'clear',label:'Долга нет',note:'Ничего к оплате'};
  if(balance<0)return{kind:'clear',label:'Переплата',note:'Не просроченная задолженность'};
  const t=day(today),valid=Array.isArray(plan)&&plan.length&&t!==null&&plan.every(p=>finite(p.amount)&&p.amount>0&&day(p.dueDate)!==null);
  if(!valid||Math.abs(plan.reduce((a,p)=>a+p.amount,0)-balance)>.011)return{kind:'unknown',label:missing,note:'Нужен график неоплаченных платежей'};
  const sorted=[...plan].sort((a,b)=>day(a.dueDate)-day(b.dueDate)),first=sorted[0],delta=day(first.dueDate)-t;
  const overdue=round(sorted.filter(p=>day(p.dueDate)<t).reduce((a,p)=>a+p.amount,0));
  return delta<0?{kind:'overdue',label:`Просрочка ${days(-delta)}`,note:`${money(overdue)} просрочено`}:delta===0?
   {kind:'today',label:'Оплата сегодня',note:`К оплате ${money(first.amount)}`}:
   {kind:'future',label:`Осталось ${days(delta)}`,note:`Ближайший платёж ${money(first.amount)}`};
 }
 function compare(current,previous){
  if(!finite(current)||!finite(previous)||current<0||previous<0)return{kind:'unknown',label:'Нет данных для сравнения'};
  if(previous===0)return current===0?{kind:'flat',label:'Без изменений · 0 %'}:{kind:'new',label:'Есть продажи · база 0 ₽'};
  const raw=(current-previous)/previous*100;
  if(current===previous)return{kind:'flat',label:'Без изменений · 0 %',percent:0};
  const value=Math.abs(raw)<.1?'<0,1':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(Math.abs(raw));
  return{kind:raw>0?'up':'down',label:`${raw>0?'↑ +':'↓ −'}${value} %`,percent:raw};
 }
 function sales(legals,month){
  const ls=distinct(legals),known=ls.length&&ls.every(l=>finite(l.salesRub)),current=known?ls.reduce((s,l)=>s+l.salesRub,0):null;
  const bases=ls.map(l=>cache.get(l)?.history?.[month]),previous=bases.length&&bases.every(finite)?round(bases.reduce((s,v)=>s+v,0)):null;
  const c=compare(current,previous),m=/^(\d{4})-(\d{2})$/.exec(String(month)),period=m&&+m[2]>=1&&+m[2]<=12?
   new Intl.DateTimeFormat('ru-RU',{month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(+m[1]-1,+m[2]-1,15))):'аналогичному месяцу прошлого года';
  return`<span class="d19-sales"><strong>${esc(money(current))}</strong><span class="d19-trend d19-${c.kind}" aria-label="${esc(c.label)}">${esc(c.label)}</span><span class="d19-comparison">к ${esc(period)} · демо</span></span>`;
 }
 function conversionRatio(rows){
  const ls=distinct(rows);
  if(!ls.length||ls.some(l=>!finite(l.handlesQty)||!finite(l.doorLeavesQty)||l.handlesQty<0||l.doorLeavesQty<0))return null;
  const handles=ls.reduce((s,l)=>s+l.handlesQty,0),doors=ls.reduce((s,l)=>s+l.doorLeavesQty,0);
  return doors>0?handles/doors*100:null;
 }
 function conversionDelta(current,previous){
  if(!finite(current)||!finite(previous)||current<0||previous<0)return{kind:'unknown',label:'Нет данных для сравнения'};
  const points=current-previous;
  if(Math.abs(points)<1e-9)return{kind:'flat',label:'Без изменений · 0 п.п.',points:0};
  const value=Math.abs(points)<.1?'<0,1':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(Math.abs(points));
  return{kind:points>0?'up':'down',label:`${points>0?'↑ +':'↓ −'}${value} п.п.`,points};
 }
 function conversion(legals,month){
  const ls=distinct(legals),current=conversionRatio(ls);
  const historic=ls.map(l=>({legalId:l.legalId,...(cache.get(l)?.conversionHistory?.[month]||{})}));
  const c=conversionDelta(current,conversionRatio(historic)),m=/^(\d{4})-(\d{2})$/.exec(String(month));
  const period=m&&+m[2]>=1&&+m[2]<=12?new Intl.DateTimeFormat('ru-RU',{month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(+m[1]-1,+m[2]-1,15))):'аналогичному месяцу прошлого года';
  const value=finite(current)?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(current)+' %':'Не рассчитано';
  return`<span class="d19-sales d19-conversion d19-${c.kind}"><strong>${esc(value)}</strong><span class="d19-trend d19-${c.kind}" aria-label="${esc(c.label)}">${esc(c.label)}</span><span class="d19-comparison">к ${esc(period)} · демо</span></span>`;
 }
 function debtSummary(legals){
  const ls=distinct(legals),known=ls.length&&ls.every(l=>finite(l.debtRub));
  const total=known?round(ls.reduce((s,l)=>s+l.debtRub,0)):null;
  const valid=known&&ls.every(l=>l.debtRub<=0||debtStatus(l.debtRub,cache.get(l)?.plan).kind!=='unknown');
  const overdue=valid?round(ls.reduce((s,l)=>s+(l.debtRub>0?(cache.get(l)?.plan||[]).filter(p=>day(p.dueDate)<day(asOf)).reduce((n,p)=>n+p.amount,0):0),0)):null;
  return{total,overdue};
 }
 function ledger(legals,{names=true}={}){
  const ls=distinct(legals);
  if(!ls.length)return`<span class="d19-empty">${missing}: нет связанных юрлиц</span>`;
  return`<span class="d19-ledger ${names?'':'d19-no-name'}" role="group" aria-label="Демонстрационная дебиторка по юрлицам"><span class="d19-head">${names?'<span>Юридическое лицо</span>':''}<span>Долг</span><span>Отсрочка</span><span>Оплата</span></span>${ls.map(l=>{
   const seed=cache.get(l),s=debtStatus(l.debtRub,seed?.plan),term=seed?.termDays;
   return`<span class="d19-row" data-debt-legal="${esc(l.legalId)}">${names?`<span class="d19-legal">${esc(l.legalName)}</span>`:''}<span class="d19-amount"><strong>${esc(money(l.debtRub))}</strong></span><span class="d19-term">${finite(term)?`${term} дн.`:'Не передано'}</span><span class="d19-payment"><strong class="d19-${s.kind}">${esc(s.label)}</strong><span class="d19-payment-note">${esc(s.note)}</span></span></span>`;
  }).join('')}<span class="d19-note">Демо · срез 21.10.2026 · сроки не подтверждены 1С</span></span>`;
 }
 root.TandoorFinanceDisplay={version:'conversion-trend1',seedDemo,debtStatus,debtSummary,compare,sales,conversionRatio,conversionDelta,conversion,ledger,asOf};
})(typeof window==='undefined'?globalThis:window);
