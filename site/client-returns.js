/* Returns UI concept only: all amounts, documents and model rows are synthetic.
 * No file fetch, import, backend, posting or net-sales calculation. */
(function(root){
 'use strict';
 const categories=[
  {id:'entry',label:'Входные двери',models:['Норд Термо','Гранит'],price:15000},
  {id:'interior',label:'Межкомнатные двери',models:['Porta-62','Соло Зефир'],price:3800},
  {id:'trim',label:'Межкомнатные двери (погонаж)',models:['Стойка телескопическая','Наличник прямой'],price:300},
  {id:'handles',label:'Фурнитура (ручки)',models:['Ручка R101','Ручка R202'],price:850},
  {id:'other',label:'Фурнитура (прочее)',models:['Петля Универсал','Защёлка магнитная'],price:120}
 ];
 const scenarios=['detail','summary','missing','zero'];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>typeof n==='number'&&Number.isFinite(n)?new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)+' ₽':'Нет данных из 1С';
 const qty=n=>typeof n==='number'&&Number.isFinite(n)?new Intl.NumberFormat('ru-RU').format(n)+' шт.':'Нет данных из 1С';
 const total=rows=>({quantity:rows.reduce((s,r)=>s+r.quantity,0),income:Math.round(rows.reduce((s,r)=>s+r.income,0)*100)/100});
 const hash=s=>[...String(s)].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,7);
 function demoRows(legals,month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))return [];
  const distinct=[...new Map(legals.filter(l=>l?.legalId).map(l=>[l.legalId,l])).values()];
  return distinct.flatMap(l=>categories.flatMap((c,ci)=>c.models.map((name,mi)=>{
   const seed=hash(l.legalId),n=ci*2+mi,quantity=1+(seed+Number(month.slice(5))+n)%3,doc=n%3+1;
   return {
    id:`demo-${l.legalId}-${month}-${c.id}-${mi}`,legalId:l.legalId,legalName:l.legalName,
    categoryId:c.id,modelId:`${c.id}-${mi}`,modelName:name,article:`ДЕМО-${c.id.toUpperCase()}-${mi+1}`,
    quantity,income:((c.price*(mi+1)*100+45)*quantity)/100,
    documentId:`demo-${l.legalId}-${month}-${doc}`,documentNumber:`ДЕМО-ВЗ-${String(seed%1000).padStart(3,'0')}-${doc}`,
    date:`${month}-${String(4+doc*6).padStart(2,'0')}`,
    outlet:doc===1?'Демонстрационная ТТ':null,
    reason:doc===1?'Повреждение при доставке':doc===2?'Пересортица':null
   };
  })));
 }
 function data(legals,month,scenario='detail'){
  const status=scenarios.includes(scenario)?scenario:'detail';
  if(status==='missing'||!legals.some(l=>l?.legalId)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))return {status:'missing',rows:[],quantity:null,income:null,categories:categories.map(c=>({...c,quantity:null,income:null}))};
  const rows=status==='zero'?[]:demoRows(legals,month);
  return {status,rows,...total(rows),categories:categories.map(c=>({...c,...total(rows.filter(r=>r.categoryId===c.id))}))};
 }
 function models(rows,categoryId,query=''){
  const map=new Map();
  for(const r of rows.filter(r=>r.categoryId===categoryId)){
   if(!map.has(r.modelId))map.set(r.modelId,{id:r.modelId,name:r.modelName,article:r.article,rows:[]});
   map.get(r.modelId).rows.push(r);
  }
  return [...map.values()].map(m=>({...m,...total(m.rows)})).filter(m=>(m.name+' '+m.article).toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
 }
 const button=(label,action,value='',extra='')=>`<button type="button" data-x6="${action}" data-value="${esc(value)}" data-testid="button-${action}${value?'-'+esc(value):''}" ${extra}>${label}</button>`;
 function navigation(mode='sales'){
  return `<nav class="r18-switch" aria-label="Продажи и возвраты">${[['sales','Продажи'],['returns','Возвраты']].map(([id,label])=>button(label,'sales-mode',id,`aria-pressed="${id===mode}" class="${id===mode?'selected':''}"`)).join('')}</nav>`;
 }
 function render({record,legals,month,periodControl,legalId='',scenario='detail',categoryId='',modelId='',query=''}){
  const valid=!legalId||legals.some(l=>l.legalId===legalId),selected=legalId?legals.filter(l=>l.legalId===legalId):legals;
  const d=data(selected,month,scenario),category=categories.find(c=>c.id===categoryId);
  const monthLabel=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(new Date(month+'-15T12:00:00'));
  const controls=`<div class="r18-controls">${periodControl(month).replaceAll('Период продаж','Период возвратов')}<label><span>Юридическое лицо</span><select data-return-legal data-testid="select-returns-legal" aria-label="Юридическое лицо возвратов"><option value="" ${!legalId?'selected':''}>Все юрлица клиента</option>${!valid?`<option value="${esc(legalId)}" selected disabled>Юрлицо недоступно</option>`:''}${legals.map(l=>`<option value="${esc(l.legalId)}" ${l.legalId===legalId?'selected':''}>${esc(l.legalName)}</option>`).join('')}</select></label><label><span>Данные макета</span><select data-return-scenario data-testid="select-returns-scenario" aria-label="Сценарий данных возвратов">${[['detail','Будущий формат (демо)'],['summary','Только месячные итоги'],['missing','Нет выгрузки'],['zero','Возвратов нет']].map(([id,label])=>`<option value="${id}" ${d.status===id?'selected':''}>${label}</option>`).join('')}</select></label></div>`;
  const notice=`<aside class="r18-notice"><strong>Макет возвратов · не подключён к 1С</strong><p>${d.status==='detail'?'Модели, документы, даты, ТТ и причины ниже вымышлены: это пример будущей детализации, выгрузку ещё нужно согласовать.':'Все значения в этом макете демонстрационные, реальный файл возвратов не загружался.'} Реализация в рабочем ЛК отложена.</p></aside>`;
  const categoryContext=category&&d.status==='detail',headTotals=categoryContext?total(d.rows.filter(r=>r.categoryId===category.id)):d;
  const head=`<header class="r18-heading"><div><h3 tabindex="-1">Возвраты${categoryContext?' · '+esc(category.label):''}</h3><p>${esc(monthLabel)} · ${legalId?'выбранное юрлицо':'все связанные юрлица'}</p></div><div class="r18-summary" data-testid="returns-total"><span>${categoryContext?'Сумма категории':'Сумма возвратов'}<strong data-return-total="income">${money(headTotals.income)}</strong></span><span>Количество<strong data-return-total="quantity">${qty(headTotals.quantity)}</strong></span></div></header>`;
  let body='';
  if(!valid)body='<div class="r18-empty"><h4>Юрлицо недоступно в этой карточке</h4><p>Выберите одно из связанных юрлиц клиента. Чужие данные не показываются.</p></div>';
  else if(d.status==='missing')body='<div class="r18-empty"><h4>Нет данных из 1С</h4><p>Пример отсутствующей выгрузки за выбранный период. Это не означает, что возвратов не было: нули не подставляем.</p></div>';
  else if(d.status==='detail'&&category){
   const ms=models(d.rows,category.id),model=ms.find(m=>m.id===modelId);
   body=`<div class="r18-breadcrumb">${button('← Все категории','returns-overview')}${modelId?button('К моделям','returns-back-models'):''}<span>${esc(category.label)}${model?' / '+esc(model.name):''}</span></div><p class="r18-future">Будущая детализация · вымышленные данные, не текущий файл 1С</p>`;
   if(modelId&&!model)body+='<div class="r18-empty"><h4>Модель недоступна</h4><p>Вернитесь к моделям этой категории.</p></div>';
   else if(model){
    const docs=[...new Map(model.rows.map(r=>[r.documentId,{id:r.documentId,number:r.documentNumber,date:r.date,legalName:r.legalName}])).values()];
    body+=`<div class="r18-model-total"><strong>${esc(model.name)} <small>${esc(model.article)}</small></strong><span>${qty(model.quantity)} · ${money(model.income)}</span></div><p class="r18-muted">Показаны строки выбранной модели, а не полные суммы документов.</p><div class="r18-documents">${docs.map(doc=>{
     const rows=model.rows.filter(r=>r.documentId===doc.id),s=total(rows);
     return `<details class="r18-document" data-testid="returns-document-${esc(doc.id)}" open><summary><span><strong>${esc(doc.number)}</strong><small>${esc(doc.date.split('-').reverse().join('.'))} · ${esc(doc.legalName)}</small></span><span>${money(s.income)}<small>${qty(s.quantity)}</small></span></summary>${rows.map(r=>`<div class="r18-document-line"><dl><div><dt>Товар</dt><dd>${esc(r.modelName)} · ${esc(r.article)}</dd></div><div><dt>Торговая точка</dt><dd>${esc(r.outlet||'Не передано в примере')}</dd></div><div><dt>Причина возврата</dt><dd>${esc(r.reason||'Не передано в примере')}</dd></div></dl><p>${qty(r.quantity)} · ${money(r.income)}</p></div>`).join('')}</details>`;
    }).join('')}</div>`;
   }else{
    const filtered=models(d.rows,category.id,query);
    body+=`<div class="r18-search"><label for="returns-model-search">Найти модель или артикул</label><div><input id="returns-model-search" data-testid="input-returns-model-search" type="search" value="${esc(query)}" placeholder="Например, Норд или R101">${query?button('Сбросить','returns-clear-search'):''}</div></div><div class="r18-table-head"><span>Модель / артикул</span><span>Количество</span><span>Сумма возвратов</span><span></span></div><div class="r18-models">${filtered.length?filtered.map(m=>`<button type="button" class="r18-row" data-x6="returns-model" data-value="${esc(m.id)}" data-testid="returns-model-${esc(m.id)}"><span><strong>${esc(m.name)}</strong><small>${esc(m.article)}</small></span><span class="r18-value"><small>Количество</small><b>${qty(m.quantity)}</b></span><span class="r18-value"><small>Сумма</small><b>${money(m.income)}</b></span><span class="r18-link">Документы →</span></button>`).join(''):'<div class="r18-empty"><h4>Модели не найдены</h4><p>Измените запрос или сбросьте поиск.</p></div>'}</div>`;
   }
  }else{
   body=`${d.status==='zero'?'<div class="r18-empty"><h4>За этот месяц возвратов нет</h4><p>Пример подтверждённого нулевого итога. Он отличается от отсутствия выгрузки.</p></div>':''}${d.status==='summary'?'<p class="r18-future">Месячные итоги по описанной структуре returne_info. Моделей и документов в ней пока нет.</p>':''}<div class="r18-table-head"><span>Категория</span><span>Количество</span><span>Сумма возвратов</span><span></span></div><div class="r18-categories">${d.categories.map(c=>`<${d.status==='detail'?'button type="button"':'div'} class="r18-row" ${d.status==='detail'?`data-x6="returns-category" data-value="${c.id}" data-testid="returns-category-${c.id}"`:''}><span><strong>${c.label}</strong><small>${d.status==='detail'?'Модели и документы · демо':d.status==='summary'?'Только месячный итог':'Подтверждённый ноль · демо'}</small></span><span class="r18-value"><small>Количество</small><b>${qty(c.quantity)}</b></span><span class="r18-value"><small>Сумма</small><b>${money(c.income)}</b></span><span class="r18-link">${d.status==='detail'?'Подробнее →':d.status==='summary'?'Без детализации':''}</span></${d.status==='detail'?'button':'div'}>`).join('')}</div>`;
  }
  return `<section class="card r18-returns" data-testid="returns-panel" data-returns-version="concept1">${controls}${notice}${head}${body}<footer class="r18-footer"><p>Возвраты показываем отдельно. Продажи минус возвраты не рассчитываем, пока не подтверждено, учтены ли возвраты в выручке 1С.</p>${record?.outletId?'<p>Это показатели связанных юрлиц, не отдельный итог этой ТТ. По торговым точкам их не суммируют.</p>':''}</footer></section>`;
 }
 root.TandoorClientReturns={version:'concept1',categories,scenarios,demoRows,data,models,total,money,qty,navigation,render};
})(typeof window==='undefined'?globalThis:window);
