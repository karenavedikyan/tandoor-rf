/* Canonical prototype model. Fixtures are synthetic, not imported customer data.
 * A future validated1C adapter replaces fixtures, not the UI layout. */
(function(root){
 'use strict';
 const cache=new Map();
 root.prototypeMemoryStorage={getItem:k=>cache.get(k)??null,setItem:(k,v)=>cache.set(k,String(v)),removeItem:k=>cache.delete(k)};
 const months=['2026-08','2026-09','2026-10'],defaultMonth='2026-09';
 const week=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
 const monthNames=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
 const missing='Нет данных из 1С';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 const money=v=>finite(v)?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(v):missing;
 const percent=v=>finite(v)?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(v)+' %':'Не рассчитано';
 const ratio=(handles,doors)=>finite(handles)&&finite(doors)&&doors!==0?handles/doors*100:null;
 const sumKnown=vs=>vs.length&&vs.every(finite)?vs.reduce((a,b)=>a+b,0):null;
 function dateParts(v){
  const m=/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(String(v||''));if(!m||+m[1]<2)return null;
  const y=+m[1],mo=+m[2],d=+m[3],check=new Date(Date.UTC(y,mo-1,d));
  return check.getUTCFullYear()===y&&check.getUTCMonth()===mo-1&&check.getUTCDate()===d?{y,mo,d}:null;
 }
 const birthdayLabel=v=>{const p=dateParts(v);return p?`${String(p.d).padStart(2,'0')}.${String(p.mo).padStart(2,'0')}.${p.y}`:missing};
 function daysToBirthday(v,today=new Date()){
  const p=dateParts(v);if(!p)return null;
  const y=today.getFullYear(),start=Date.UTC(y,today.getMonth(),today.getDate());
  let next=Date.UTC(y,p.mo-1,p.d);if(next<start)next=Date.UTC(y+1,p.mo-1,p.d);
  return Math.round((next-start)/86400000);
 }
 function aggregate(legals){
  const rows=[...new Map(legals.map(l=>[l.legalId,l])).values()];
  const handles=sumKnown(rows.map(l=>l.handlesQty)),doors=sumKnown(rows.map(l=>l.doorLeavesQty));
  return{salesRub:sumKnown(rows.map(l=>l.salesRub)),conversionPct:ratio(handles,doors),debtRub:sumKnown(rows.map(l=>l.debtRub)),handlesQty:handles,doorLeavesQty:doors,count:rows.length};
 }
 const fields=[
  {id:'salesRub',label:'Продажи',group:'Продажи и конверсия',source:'month · client_info.id · sale_info.income',type:'number',relation:'context',planned:true},
  {id:'conversionPct',label:'Конверсия, %',group:'Продажи и конверсия',source:'sale_info.quantity: ручки / полотна МК ×100; сопоставить типы товаров',type:'number',relation:'context',planned:true},
  {id:'debtRub',label:'Дебиторка по юрлицам',group:'Юридические лица и реквизиты',source:'Фактический остаток долга по GUID юрлица, не кредитный лимит. Ключ подтвердить',type:'number',relation:'legal',planned:true},
  {id:'shipmentDays',label:'День отгрузки',group:'Отгрузка',source:'Отдельный график отгрузки клиента / ТТ; не loading_on_days. Ключи подтвердить',type:'days',relation:'context',planned:true},
  {id:'shipmentDirection',label:'Направление отгрузки',group:'Отгрузка',source:'Направление отгрузки клиента / ТТ. Уровни и ключи подтвердить',type:'enum',relation:'context',planned:true}
 ];
 const ids=['salesRub','conversionPct','debtRub','lprBirth','shipmentDays','shipmentDirection'];
 function create({clients,outlets,legals,legalFor}){
  const directions=['Север','Центр','Юг','Восток'];
  legals.forEach((l,i)=>{
   l.debtRub=i>5&&i%17===8?null:i%7===4?0:72000+(i%5)*24000;
   l.metricsByMonth=Object.fromEntries(months.map((month,j)=>{
    const unknown=i>5&&i%23===0,doors=i>2&&i%19===0?0:45+(i*13+j*17)%150;
    const handles=i%11===4?0:Math.round(doors*(0.45+(i%8)*0.13));
    const data={salesRub:unknown?null:doors*6500+handles*950+(i%12)*420,doorLeavesQty:unknown?null:doors,handlesQty:unknown?null:handles,otherHardwareQty:unknown?null:i%12};
    data.categorySales=root.TandoorCategorySales.demoBreakdown(data,i);
    return[month,data];
   }));
  });
  clients.forEach((c,i)=>{c.shipmentDays=i>3&&i%13===0?[]:[i%5+1,(i+2)%5+1].sort();c.shipmentDirection=i>3&&i%11===0?null:directions[i%4]});
  outlets.forEach((o,i)=>{
   o.shipmentDays=i>3&&i%9===0?[]:[(i+1)%5+1,(i+3)%5+1].sort();o.shipmentDirection=i>3&&i%8===0?null:directions[(i+1)%4];
   if(!o.lprName)o.lprBirth=null;
   else if(!dateParts(o.lprBirth))o.lprBirth=i%4===0?null:`${1985+i%15}-${String((Math.floor(i/6)+i*5)%12+1).padStart(2,'0')}-${String((Math.floor(i/3)+i*7)%27+1).padStart(2,'0')}`;
  });
  let activeMonth=null;
  function setMonth(month){
   const next=months.includes(month)?month:defaultMonth;if(activeMonth===next)return next;activeMonth=next;
   legals.forEach(l=>Object.assign(l,l.metricsByMonth[next],{conversionPct:ratio(l.metricsByMonth[next].handlesQty,l.metricsByMonth[next].doorLeavesQty)}));
   [...clients,...outlets].forEach(r=>{const a=aggregate(legalFor(r));r.salesRub=a.salesRub;r.conversionPct=a.conversionPct});
   return next;
  }
  setMonth(defaultMonth);
  function periodControl(month){
   return`<label class="m14-period"><span>Период продаж</span><select data-m14-period aria-label="Период продаж">${months.map(m=>`<option value="${m}" ${m===month?'selected':''}>${monthNames[+m.slice(5)-1]} ${m.slice(0,4)}</option>`).join('')}</select></label>`;
  }
  function toolbar(month,quick=false){
   return`<div class="m14-toolbar" data-m14-version="2026-10-21">${periodControl(month)}<span class="m14-demo">Демо · не загрузка из 1С</span>${quick?`<div class="m14-quick" aria-label="Фильтры новых показателей">${ids.map(id=>`<button type="button" data-x6="choose-field" data-value="${id}">${esc(id==='lprBirth'?'ДР ЛПР':fields.find(f=>f.id===id).label)}</button>`).join('')}</div>`:''}</div>`;
  }
  function formatted(value,field){
   if(field.id==='salesRub')return money(value);
   if(field.id==='debtRub')return typeof value==='string'?value:money(value);
   if(field.id==='conversionPct')return percent(value);
   if(field.id==='shipmentDays'){const ds=Array.isArray(value)?value:String(value??'').split(';').map(Number);return ds.length&&ds.every(n=>n>=1&&n<=7)?ds.map(n=>week[n-1]).join(', '):missing}
   if(field.id==='lprBirth')return String(value??'').split(';').map(v=>birthdayLabel(v.trim())).filter((v,i,a)=>a.indexOf(v)===i).join(' · ');
   if(field.id==='shipmentDirection')return value||missing;
   return null;
  }
  function legalTable(r,month,{quantities=false,legalId=''}={}){
   const ls=legalFor(r).filter(l=>!legalId||l.legalId===legalId);
   return`<div class="m14-table-scroll" role="region" aria-label="Показатели по юридическим лицам" tabindex="0"><table class="m14-table"><thead><tr><th scope="col">Юридическое лицо</th><th scope="col">Продажи, ₽</th>${quantities?'<th scope="col">Ручки, шт.</th><th scope="col">Полотна МК, шт.</th>':''}<th scope="col">Конверсия</th><th scope="col">Дебиторка, ₽</th></tr></thead><tbody>${ls.length?ls.map(l=>`<tr><th scope="row">${esc(l.legalName)}<small>${esc(l.inn)}</small></th><td>${esc(money(l.salesRub))}</td>${quantities?`<td>${esc(l.handlesQty??missing)}</td><td>${esc(l.doorLeavesQty??missing)}</td>`:''}<td>${esc(percent(l.conversionPct))}</td><td>${esc(money(l.debtRub))}</td></tr>`).join(''):`<tr><td colspan="${quantities?6:4}">${missing}: нет связанных юрлиц</td></tr>`}</tbody></table></div>`;
  }
  function panel(r,{outlets:available,month}){
   const a=aggregate(legalFor(r)),points=r.outletId?[r]:available,birthdays=points.filter(o=>o.lprName&&dateParts(o.lprBirth));
   return`<section class="card m14-panel" aria-labelledby="m14-title"><header><div><span class="m14-demo">Демонстрационные значения</span><h3 id="m14-title">Продажи и отгрузка</h3></div>${periodControl(month)}</header>
    <dl class="m14-facts"><div><dt>Продажи за месяц</dt><dd>${esc(money(a.salesRub))}</dd><small>С НДС · после скидок · RUB</small><button type="button" class="m15-entry" data-x6="card-tab" data-value="sales">По категориям →</button></div><div><dt>Конверсия ручки / полотна МК</dt><dd>${esc(percent(a.conversionPct))}</dd><small>${esc(a.handlesQty??'—')} ручек / ${esc(a.doorLeavesQty??'—')} полотен · шт.</small></div><div><dt>Дебиторка юрлиц</dt><dd>${esc(money(a.debtRub))}</dd><small>Остаток на 21.10.2026 · ${a.count} юрл. без повторов</small></div>
    <div><dt>ДР ЛПР</dt><dd class="m14-text">${birthdays.length?birthdays.map(o=>`<span>${esc(o.lprName)} · ${esc(birthdayLabel(o.lprBirth))}</span>`).join(''):missing}</dd><small>Контакты доступных ТТ; не дата контрагента</small></div><div><dt>День отгрузки ${r.outletId?'ТТ':'клиента'}</dt><dd class="m14-text">${esc(formatted(r.shipmentDays,{id:'shipmentDays'}))}</dd><small>Не график приёмки товара</small></div><div><dt>Направление отгрузки ${r.outletId?'ТТ':'клиента'}</dt><dd class="m14-text">${esc(r.shipmentDirection||missing)}</dd><small>Только значение этого уровня</small></div></dl>
    ${r.outletId?'<p class="m14-note">Продажи и долг связаны с юрлицами этой ТТ. Это не отдельная выручка ТТ, по точкам их не суммируют.</p>':''}
    ${legalTable(r,month)}
    ${!r.outletId?`<div class="m14-shipping"><h4>Отгрузка по доступным ТТ</h4>${points.length?points.map(o=>`<div><span>${esc(o.storeAddress)}</span><b>${esc(formatted(o.shipmentDays,{id:'shipmentDays'}))}</b><span>${esc(o.shipmentDirection||missing)}</span></div>`).join(''):`<p>${missing}: нет доступных ТТ</p>`}</div>`:''}
    <p class="m14-note">Макет состояний, не фактическая проверка выгрузки. Конверсия: сумма ручек / сумма полотен МК ×100% за один месяц. При нулевом знаменателе не рассчитывается. Долг не зависит от периода продаж.</p></section>`;
  }
  return{setMonth,toolbar,periodControl,formatted,panel,legalTable,get month(){return activeMonth}};
 }
 root.TandoorClientMetrics={create,fields,ids,months,defaultMonth,week,monthNames,ratio,sumKnown,aggregate,money,percent,dateParts,daysToBirthday};
})(typeof window==='undefined'?globalThis:window);
