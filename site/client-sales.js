/* Prototype-only presentation of existing synthetic legal-entity metrics.
 * No network calls, production data, browser storage or business writes. */
(function(root){
 'use strict';
 const M=root.TandoorClientMetrics, C=root.TandoorCategorySales;
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=n=>finite(n)?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(n):'Нет данных';
 const money=n=>finite(n)?number(n)+' ₽':'Нет данных';
 const percent=n=>finite(n)?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n)+' %':'Не рассчитано';
 const unique=rows=>[...new Map(rows.map(l=>[l.legalId,l])).values()];
 const fields=[
  {id:'salesRub',label:'Продажи клиента, ₽',type:'number'},
  {id:'salesQuantity',label:'Продано, шт.',type:'number'},
  {id:'salesLegalCount',label:'Юрлица с продажами',type:'number'},
  {id:'salesByLegal',label:'Продажи по юрлицам',type:'text'}
 ].map(f=>({...f,group:'Продажи за выбранный месяц',relation:'context',source:'Демо: month · legalId · sale_info.income / quantity',planned:true}));
 function create({clients,outlets,legals,legalFor}){
  const metrics=M.create({clients,outlets,legals,legalFor});
  const rowsFor=r=>unique(legalFor(r));
  function summary(rows,month=metrics.month){
   const rowsUnique=unique(rows);
   const values=rowsUnique.map(l=>{
    const source=C.aggregate([l],month);
    return{legal:l,revenue:M.sumKnown(source.map(c=>c.revenueRub)),quantity:M.sumKnown(source.map(c=>c.quantity))};
   });
   const revenue=M.sumKnown(values.map(v=>v.revenue)),quantity=M.sumKnown(values.map(v=>v.quantity));
   return{values,revenue,quantity,count:values.length,known:values.filter(v=>finite(v.revenue)&&finite(v.quantity)).length,
    active:values.length&&values.every(v=>finite(v.revenue))?values.filter(v=>v.revenue>0).length:null};
  }
  const forRecord=r=>summary(rowsFor(r));
  function setMonth(month){
   metrics.setMonth(month);
   [...clients,...outlets].forEach(r=>{
    const s=forRecord(r);
    Object.assign(r,{salesRub:s.revenue,salesQuantity:s.quantity,salesLegalCount:s.active,
     salesByLegal:s.values.length?s.values.map(v=>`${v.legal.legalName}: ${money(v.revenue)}`).join('; '):null});
   });
   return metrics.month;
  }
  function formatted(value,f){
   if(f.id==='salesRub')return money(value);
   if(f.id==='salesQuantity')return finite(value)?number(value)+' шт.':'Нет данных';
   if(f.id==='salesLegalCount')return number(value);
   if(f.id==='salesByLegal')return value||'Нет связанных юрлиц';
   return null;
  }
  function breakdown(r){
   const s=forRecord(r);
   return s.values.length?`<span class="cs-legal-cell">${s.values.map(v=>`<span><span>${esc(v.legal.legalName)}</span><strong>${esc(money(v.revenue))}</strong></span>`).join('')}</span>`:'<span class="x6-muted">Нет связанных юрлиц</span>';
  }
  function period(){
   return`<label class="cs-period"><span>Период продаж</span><select data-cs-period aria-label="Период продаж">${M.months.map(m=>`<option value="${m}" ${m===metrics.month?'selected':''}>${M.monthNames[+m.slice(5)-1]} ${m.slice(0,4)}</option>`).join('')}</select></label>`;
  }
  function toolbar(){
   return`<div class="cs-list-toolbar">${period()}<span>Итоги и разбивка по юрлицам за один месяц</span><span class="cs-demo">Вымышленные данные</span></div>`;
  }
  function stats(s){
   return`<div class="cs-stats"><div><span>Продажи за месяц</span><strong data-cs-total="${finite(s.revenue)?s.revenue:''}">${esc(money(s.revenue))}</strong><small>С НДС · после скидок</small></div><div><span>Продано товаров</span><strong>${esc(number(s.quantity))}<small class="cs-unit">${finite(s.quantity)?' шт.':''}</small></strong><small>Сумма единиц всех категорий</small></div><div><span>Юрлица с продажами</span><strong>${esc(number(s.active))}<small class="cs-unit"> из ${s.count}</small></strong><small>Без повторов по GUID</small></div></div>`;
  }
  function notice(s,r){
   return`${!s.count?'<p class="cs-warning">Нет связанных юридических лиц. Данные о продажах не определены.</p>':s.known<s.count?`<p class="cs-warning" role="status">Неполные данные: ${s.known} из ${s.count} юрлиц. Общий итог и доли не рассчитываем, отсутствующие значения не заменяем нулём.</p>`:''}${r.outletId?'<p class="cs-warning">Показатели связанных юрлиц, а не отдельная выручка торговой точки. По ТТ эти суммы не суммируются.</p>':''}`;
  }
  function legalTable(s){
   return`<div class="cs-table-scroll" role="region" aria-label="Продажи клиента по юридическим лицам" tabindex="0"><table class="cs-table"><thead><tr><th scope="col">Юридическое лицо</th><th scope="col">Продажи, ₽</th><th scope="col">Продано, шт.</th><th scope="col">Доля продаж</th><th scope="col"><span class="cs-sr">Действия</span></th></tr></thead><tbody>${s.values.map(v=>{
    const share=finite(v.revenue)&&finite(s.revenue)&&s.revenue>0?v.revenue/s.revenue*100:null;
    return`<tr data-cs-legal="${esc(v.legal.legalId)}" data-cs-revenue="${finite(v.revenue)?v.revenue:''}"><th scope="row">${esc(v.legal.legalName)}<small>ИНН: ${esc(v.legal.inn||'не передан')}</small></th><td data-label="Продажи">${esc(money(v.revenue))}</td><td data-label="Продано">${esc(number(v.quantity))}${finite(v.quantity)?' шт.':''}</td><td data-label="Доля"><div class="cs-share"><span>${esc(percent(share))}</span>${finite(share)?`<span class="cs-share-track" aria-hidden="true"><span style="width:${Math.max(0,Math.min(100,share))}%"></span></span>`:''}</div></td><td><button type="button" class="link" data-x6="sales-legal" data-value="${esc(v.legal.legalId)}" aria-label="Подробнее о продажах: ${esc(v.legal.legalName)}">Подробнее →</button></td></tr>`;
   }).join('')}</tbody><tfoot><tr><th scope="row">Всего по клиенту</th><td data-label="Всего продаж">${esc(money(s.revenue))}</td><td data-label="Всего товаров">${esc(number(s.quantity))}${finite(s.quantity)?' шт.':''}</td><td>${finite(s.revenue)&&s.revenue>0?'100 %':'Не рассчитано'}</td><td></td></tr></tfoot></table></div>`;
  }
  function panel(r,{detail=false,legalId=''}={}){
   const all=rowsFor(r),selected=all.filter(l=>!legalId||l.legalId===legalId),s=summary(detail?selected:all);
   const legalSelect=detail?`<label class="cs-legal-select"><span>Юридическое лицо</span><select data-cs-legal-select aria-label="Юридическое лицо"><option value="">Все юрлица клиента</option>${all.map(l=>`<option value="${esc(l.legalId)}" ${legalId===l.legalId?'selected':''}>${esc(l.legalName)}</option>`).join('')}</select></label>`:'';
   const categories=detail&&s.count?`<div class="cs-categories"><h4>Продажи по категориям</h4><div class="cs-category-grid">${C.aggregate(selected,metrics.month).map(c=>`<div><span>${esc(c.label)}</span><strong>${esc(money(c.revenueRub))}</strong><small>${esc(number(c.quantity))}${finite(c.quantity)?' шт.':''}</small></div>`).join('')}</div><p>Три группы обзора объединяют пять исходных категорий. Возвраты в продажи не вычитаются.</p></div>`:'';
   return`<section class="card cs-panel" aria-label="${detail?'Детали продаж':'Продажи клиента'}"><header><div><span class="cs-eyebrow">${detail?'ДЕТАЛИ ПРОДАЖ':'ПРОДАЖИ КЛИЕНТА'}</span><h3>${detail&&legalId?esc(selected[0]?.legalName||'Юрлицо недоступно'):'Итог клиента и юридические лица'}</h3></div>${period()}</header>${legalSelect}${stats(s)}${notice(s,r)}${!detail?`<div class="cs-table-heading"><h4>Разбивка по юрлицам</h4><span>${s.count} юрл. · тот же период</span></div>`:''}${s.count?legalTable(s):''}${categories}<footer>Демо-пример, не выгрузка 1С. Итог считается по уникальным юрлицам; торговые точки его не увеличивают.</footer></section>`;
  }
  setMonth(M.defaultMonth);
  return{fields,rowsFor,summary,forRecord,setMonth,formatted,breakdown,period,toolbar,panel,get month(){return metrics.month}};
 }
 root.TandoorClientSales={create,fields};
})(window);
