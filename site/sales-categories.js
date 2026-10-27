/* Synthetic category/model records for the approved prototype only. No1C import. */
(function(root){
 'use strict';
 const categories=[
  {id:'entry',label:'Входные двери'},
  {id:'interior',label:'Межкомнатные двери'},
  {id:'hardware',label:'Фурнитура'}
 ];
 const sourceCategories=[
  {id:'entry',label:'Входные двери',group:'entry'},
  {id:'interior',label:'Межкомнатные двери',group:'interior'},
  {id:'trim',label:'Межкомнатные двери (погонаж)',group:'interior'},
  {id:'handles',label:'Фурнитура (ручки)',group:'hardware'},
  {id:'other',label:'Фурнитура (прочее)',group:'hardware'}
 ];
 const financeMetrics=[
  {id:'costPrice',label:'Себестоимость',source:'sale_info.cost_price'},
  {id:'additionalExpenses',label:'Дополнительные расходы',source:'sale_info.additional_expenses'},
  {id:'totalDiscount',label:'Скидки всего',source:'sale_info.discounts.total_discount'},
  {id:'manualDiscount',label:'Ручная скидка',source:'sale_info.discounts.manual_discount'},
  {id:'automaticDiscount',label:'Автоматическая скидка',source:'sale_info.discounts.automatic_discount'},
  {id:'grossProfit',label:'Валовая прибыль',source:'sale_info.gross_profit'},
  {id:'profitability',label:'Рентабельность',source:'sale_info.profitability',percent:true}
 ];
 function visibleFinanceMetrics(role){
  if(role==='director')return financeMetrics;
  if(role==='rop')return financeMetrics.filter(f=>f.id!=='costPrice');
  return [];
 }
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 const sum=values=>values.length&&values.every(finite)?values.reduce((a,b)=>a+b,0):null;
 const money=v=>finite(v)?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(v)+' ₽':'Нет данных из 1С';
 const quantity=v=>finite(v)?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(v)+' шт.':'Нет данных из 1С';
 const preciseMoney=v=>finite(v)?new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v)+' ₽':'Нет данных из 1С';
 const rate=v=>finite(v)?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(v)+' %':'Не рассчитано';
 // Synthetic amounts only. This is NOT a formula for replacing 1C measures.
 function demoFinance(sourceType,revenueRub,qty){
  const round=v=>Math.round(v*100)/100;
  if(!finite(revenueRub))return {sourceType,revenueRub:null,quantity:null,...Object.fromEntries(financeMetrics.map(f=>[f.id,null]))};
  const costPrice=round(revenueRub*.70),additionalExpenses=round(revenueRub*.03),manualDiscount=round(revenueRub*.01),automaticDiscount=round(revenueRub*.02);
  const grossProfit=round(revenueRub-costPrice-additionalExpenses);
  return {sourceType,revenueRub,quantity:qty,costPrice,additionalExpenses,manualDiscount,automaticDiscount,totalDiscount:round(manualDiscount+automaticDiscount),grossProfit,profitability:revenueRub?grossProfit/revenueRub*100:null};
 }
 function aggregateFinance(legals,month){
  const distinct=[...new Map(legals.map(l=>[l.legalId,l])).values()];
  return sourceCategories.map(c=>{
   const values=distinct.map(l=>l.metricsByMonth?.[month]?.categorySales?.[c.group]?.sourceRows?.find(r=>r.sourceType===c.id));
   const result={...c};
   for(const key of ['revenueRub','quantity',...financeMetrics.filter(f=>!f.percent).map(f=>f.id)])result[key]=sum(values.map(v=>v?.[key]));
   result.profitability=finite(result.grossProfit)&&finite(result.revenueRub)&&result.revenueRub!==0?result.grossProfit/result.revenueRub*100:null;
   return result;
  });
 }
 function renderFinance(legals,month,role,categoryId){
  const fields=visibleFinanceMetrics(role);if(!fields.length)return '';
  const rows=aggregateFinance(legals,month).filter(r=>!categoryId||r.group===categoryId);
  return `<section class="m16-finance" data-testid="sales-role-metrics" data-sales-role="${esc(role)}"><header><div><h3>Показатели продаж</h3><p>${role==='director'?'Директор · все показатели':'РОП · без себестоимости'} · ${categoryId?'выбранная группа':'пять категорий обмена'}</p></div><span class="m16-demo">Вымышленный пример</span></header>
   <div class="m16-source-rows">${rows.map((r,i)=>`<details class="m16-source" ${i===0?'open':''} data-source-type="${esc(r.id)}"><summary><strong>${esc(r.label)}</strong><span><b data-personal-field="salesRub">${esc(preciseMoney(r.revenueRub))}</b><small data-personal-field="salesQuantity">${esc(quantity(r.quantity))}</small></span></summary><dl class="m16-facts">${fields.map(f=>`<div data-sales-metric="${f.id}"><dt>${f.label}</dt><dd>${esc(f.percent?rate(r[f.id]):preciseMoney(r[f.id]))}</dd></div>`).join('')}</dl></details>`).join('')}</div>
   <p class="m15-footnote">Раскройте категорию для подробностей. Все суммы в этом макете вымышлены; реальная выгрузка не подключена. Погонаж показан отдельной нулевой строкой демопримера, не как результат проверки 1С.</p></section>`;
 }
 function split(total,weights){
  const n=weights.reduce((a,b)=>a+b,0);if(!n)return weights.map(()=>0);
  const values=weights.map(w=>Math.floor(total*w/n));
  const last=weights.findLastIndex(w=>w>0);values[last]+=total-values.reduce((a,b)=>a+b,0);return values;
 }
 function demoBreakdown(base,index){
  // Prototype-only rebalance of the old fake door budget; NOT a1C classification rule.
  if(!finite(base.salesRub))return Object.fromEntries(categories.map(c=>[c.id,{revenueRub:null,quantity:null,models:null,sourceRows:sourceCategories.filter(s=>s.group===c.id).map(s=>demoFinance(s.id,null,null))}]));
  const interiorQty=base.doorLeavesQty,entryQty=Math.round(interiorQty*.1);
  const doorBudget=interiorQty*6500,entryRub=entryQty?Math.round(doorBudget*.3):0;
  const make=(id,names,qty,revenue)=>{
   const quantities=split(qty,[5,3,2]),revenues=split(revenue,quantities);
   return{quantity:qty,revenueRub:revenue,models:qty?names.map((name,i)=>({id:id+'-'+i,name,quantity:quantities[i],revenueRub:revenues[i]})).filter(m=>m.quantity>0):[]};
  };
  const result={
   entry:make('entry',['Норд Термо','Гранит','Сталь Про'],entryQty,entryRub),
   interior:make('interior',['Porta-62','Соло Зефир','Деканто'],interiorQty,doorBudget-entryRub),
   hardware:{quantity:base.handlesQty+base.otherHardwareQty,revenueRub:base.handlesQty*950+base.otherHardwareQty*420,models:[]}
  };
  const handles=split(base.handlesQty,[6,4]);
  result.hardware.models=[
   ...handles.map((qty,i)=>({id:'handle-'+i,name:['Ручка R101','Ручка R202'][i],kind:'handle',quantity:qty,revenueRub:qty*950})),
   {id:'hinge-0',name:'Петля Универсал',kind:'other',quantity:base.otherHardwareQty,revenueRub:base.otherHardwareQty*420}
  ].filter(m=>m.quantity>0);
  // Exercise truthful missing-model detail while preserving known category totals.
  if(index>5&&index%31===11)result.hardware.models=null;
  result.entry.sourceRows=[demoFinance('entry',result.entry.revenueRub,result.entry.quantity)];
  result.interior.sourceRows=[demoFinance('interior',result.interior.revenueRub,result.interior.quantity),demoFinance('trim',0,0)];
  result.hardware.sourceRows=[demoFinance('handles',base.handlesQty*950,base.handlesQty),demoFinance('other',base.otherHardwareQty*420,base.otherHardwareQty)];
  return result;
 }
 function aggregate(legals,month){
  const distinct=[...new Map(legals.map(l=>[l.legalId,l])).values()];
  return categories.map(c=>{
   const records=distinct.map(l=>l.metricsByMonth?.[month]?.categorySales?.[c.id]);
   const revenueRub=sum(records.map(r=>r?.revenueRub)),qty=sum(records.map(r=>r?.quantity));
   const modelMap=new Map();let missingModels=false,unallocatedRub=0,unallocatedQty=0;
   records.forEach(record=>{
    if(!record||!Array.isArray(record.models)){
     missingModels=true;
     if(finite(record?.revenueRub))unallocatedRub+=record.revenueRub;
     if(finite(record?.quantity))unallocatedQty+=record.quantity;
     return;
    }
    record.models.forEach(m=>{
     if(!modelMap.has(m.id))modelMap.set(m.id,{id:m.id,name:m.name,revenueRub:0,quantity:0});
     const target=modelMap.get(m.id);target.revenueRub+=m.revenueRub;target.quantity+=m.quantity;
    });
   });
   return{...c,revenueRub,quantity:qty,models:[...modelMap.values()].sort((a,b)=>b.revenueRub-a.revenueRub||a.name.localeCompare(b.name,'ru')),missingModels,unallocatedRub,unallocatedQty};
  });
 }
 function render({record,legals,month,periodControl,legalId='',categoryId='',query='',role='manager'}){
  const validLegal=!legalId||legals.some(l=>l.legalId===legalId);
  const selected=legalId?legals.filter(l=>l.legalId===legalId):legals;
  const rows=aggregate(selected,month),category=rows.find(c=>c.id===categoryId);
  const total=sum(rows.map(c=>c.revenueRub));
  const controls=`<div class="m15-controls">${periodControl(month)}<label class="m15-legal"><span>Юридическое лицо</span><select data-m15-legal aria-label="Юридическое лицо продаж"><option value="" ${!legalId?'selected':''}>Все юрлица клиента</option>${!validLegal?`<option value="${esc(legalId)}" selected disabled>Юрлицо недоступно</option>`:''}${legals.map(l=>`<option value="${esc(l.legalId)}" ${l.legalId===legalId?'selected':''}>${esc(l.legalName)}</option>`).join('')}</select></label><span class="m15-demo">Демоданные</span></div>`;
  const help='<p class="m15-footnote">Рубли с НДС, после скидок. Количество в штуках. Это пример интерфейса, не импорт из 1С.</p>';
  if(!validLegal)return`<section class="card m15-sales" data-m15-version="categories1">${controls}<div class="m15-empty"><h3>Юрлицо недоступно в этой карточке</h3><p>Выберите одно из связанных юрлиц этого клиента.</p><button type="button" data-x6="sales-reset-legal">Все юрлица этого клиента</button></div>${help}</section>`;
  let body;
  if(!category){
   body=`<header class="m15-heading"><div><h3 tabindex="-1">Продажи по категориям</h3><p>Выберите категорию, чтобы посмотреть модели</p></div><div class="m15-total"><span>Общая выручка</span><strong>${esc(money(total))}</strong></div></header>
    <div class="m15-table-heading" aria-hidden="true"><span>Категория</span><span>Выручка</span><span>Количество</span><span></span></div>
    <div class="m15-categories">${rows.map(c=>`<button type="button" class="m15-category" data-x6="sales-category" data-value="${c.id}" aria-label="Показать модели: ${esc(c.label)}"><span class="m15-category-name"><strong>${c.label}</strong><small>${!finite(c.revenueRub)||!finite(c.quantity)?'Нет полных данных из 1С':c.missingModels?'Есть продажи без детализации по моделям':c.models.length?'Моделей: '+c.models.length:'За выбранный месяц'}</small></span><span class="m15-value"><small>Выручка</small><b>${esc(money(c.revenueRub))}</b></span><span class="m15-value"><small>Количество</small><b>${esc(quantity(c.quantity))}</b></span><span class="m15-open"><span>Модели</span> →</span></button>`).join('')}</div>`;
  }else{
   const filtered=category.models.filter(m=>m.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
   const complete=finite(category.revenueRub)&&finite(category.quantity);
   body=`<div class="m15-detail-nav"><button type="button" class="m15-back" data-x6="sales-back">← К категориям</button><span>Продажи / ${esc(category.label)}</span></div>
    <header class="m15-heading"><div><h3 tabindex="-1">${esc(category.label)}</h3><p>Модели · выбранный период и юрлицо сохранены</p></div><div class="m15-total"><span>Итог категории</span><strong>${esc(money(category.revenueRub))}</strong><small>${esc(quantity(category.quantity))}</small></div></header>
    ${complete&&category.models.length?`<div class="m15-search"><label for="m15-model-search">Поиск по моделям</label><div><input id="m15-model-search" type="search" placeholder="Название модели" value="${esc(query)}">${query?'<button type="button" data-x6="sales-clear-search" aria-label="Очистить поиск моделей">Сбросить</button>':''}</div><span>Показано ${filtered.length} из ${category.models.length}</span></div>`:''}
    ${!complete?'<div class="m15-empty"><h4>Нет полных данных из 1С</h4><p>За этот месяц не переданы показатели одного или нескольких юрлиц. Значения не заменяем нулём.</p></div>':!category.quantity?'<div class="m15-empty"><h4>За этот месяц продаж нет</h4><p>Количество и выручка категории равны нулю.</p></div>':`
     ${category.missingModels?`<p class="m15-notice">${category.models.length?'Для части продаж нет детализации по моделям из 1С.':'Нет детализации по моделям из 1С.'} Сумма без детализации отдельно показана внизу, без выдуманных названий моделей.</p>`:''}
     <div class="m15-model-heading" aria-hidden="true"><span>Модель</span><span>Выручка</span><span>Количество</span></div>
     <div class="m15-models">${filtered.length?filtered.map(m=>`<div class="m15-model"><strong>${esc(m.name)}</strong><span class="m15-value"><small>Выручка</small><b>${esc(money(m.revenueRub))}</b></span><span class="m15-value"><small>Количество</small><b>${esc(quantity(m.quantity))}</b></span></div>`).join(''):query?'<div class="m15-empty"><h4>Модели не найдены</h4><p>Попробуйте другое название или сбросьте поиск.</p></div>':''}
     ${category.missingModels?`<div class="m15-model m15-unallocated"><strong>Без детализации по моделям<small>Нет данных из 1С о модели</small></strong><span class="m15-value"><small>Выручка</small><b>${esc(money(category.unallocatedRub))}</b></span><span class="m15-value"><small>Количество</small><b>${esc(quantity(category.unallocatedQty))}</b></span></div>`:''}</div>`}`;
  }
  return`<section class="card m15-sales" data-m15-version="roles2">${controls}${body}${renderFinance(selected,month,role,category?.id)}${record.outletId?'<p class="m15-footnote">Показатели связанных юрлиц, не отдельная выручка ТТ. По торговым точкам эти суммы не суммируют.</p>':''}${help}</section>`;
 }
 root.TandoorCategorySales={categories,sourceCategories,financeMetrics,visibleFinanceMetrics,demoFinance,aggregateFinance,demoBreakdown,aggregate,render,split};
})(typeof window==='undefined'?globalThis:window);
