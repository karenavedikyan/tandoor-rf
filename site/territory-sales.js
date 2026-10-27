/* Static prototype, cloned synthetic fixtures only. No API or persistence. */
(function(root){
 'use strict';
 const version='territory1',finite=n=>typeof n==='number'&&Number.isFinite(n);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num=n=>finite(n)?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n):'Нет данных';
 const money=n=>finite(n)?num(Math.round(n))+' ₽':'Нет данных';
 function summarize(input){
  const rows=[...new Map(input.map(r=>[r.id,r])).values()],known=rows.filter(r=>finite(r.revenueRub)&&finite(r.quantity));
  const prior=known.filter(r=>finite(r.previousRub)&&finite(r.previousQty));
  const sum=k=>known.length?known.reduce((s,r)=>s+(finite(r[k])?r[k]:0),0):null;
  return{revenue:sum('revenueRub'),quantity:sum('quantity'),previous:prior.length===known.length&&known.length?prior.reduce((s,r)=>s+r.previousRub,0):null,
   previousQty:prior.length===known.length&&known.length?prior.reduce((s,r)=>s+r.previousQty,0):null,
   known:known.length,total:rows.length,unknown:rows.length-known.length,
   finance:Object.fromEntries(['costPrice','additionalExpenses','totalDiscount','manualDiscount','automaticDiscount','grossProfit'].map(k=>[k,known.length&&known.every(r=>finite(r[k]))?sum(k):null]))};
 }
 function delta(current,previous){
  if(!finite(current)||!finite(previous))return{kind:'unknown',label:'Нет сравнения'};
  if(previous===0)return current===0?{kind:'flat',label:'Без изменений'}:{kind:'flat',label:'База сравнения 0'};
  const p=(current-previous)/Math.abs(previous)*100;
  return Math.abs(p)<1e-8?{kind:'flat',label:'Без изменений'}:{kind:p>0?'up':'down',label:(p>0?'↑ +':'↓ −')+num(Math.abs(p))+' %'};
 }
 root.TandoorTerritorySales={version,summarize,delta};
 if(!root.document||!root.exchangePrototype)return;
 const E=root.exchangePrototype,M=root.TandoorClientMetrics,S=root.TandoorCategorySales;
 const clients=structuredClone(E.clientRows),outlets=structuredClone(E.outletRows),legals=structuredClone(E.legalRows);
 const byClient=new Map(),clientMap=new Map(clients.map(c=>[c.id,c]));
 legals.forEach(l=>{if(!byClient.has(l.clientId))byClient.set(l.clientId,[]);byClient.get(l.clientId).push(l)});
 M.create({clients,outlets,legals,legalFor:r=>byClient.get(r.clientId||r.id)||[]});
 // Explicit prior-year DEMO fixtures, never described as an existing1C feed.
 legals.forEach((l,i)=>M.months.forEach(month=>{
  const year=String(+month.slice(0,4)-1)+month.slice(4),factor=[.83,1.12,.91][i%3];
  l.metricsByMonth[year]=structuredClone(l.metricsByMonth[month]);
  for(const group of Object.values(l.metricsByMonth[year].categorySales))for(const r of group.sourceRows){
   const categoryFactor={entry:.86,interior:1.06,hardware:.91}[sourceGroup(r.sourceType)];
   for(const k of ['revenueRub','quantity','costPrice','additionalExpenses','totalDiscount','manualDiscount','automaticDiscount','grossProfit'])
    r[k]=finite(r[k])?Math.round(r[k]*factor*categoryFactor):null;
  }
 }));
 function sourceGroup(id){return S.sourceCategories.find(c=>c.id===id)?.group||'interior'}
 const defaults={month:'2026-09',comparison:'year',city:'',manager:'',client:'',category:'',source:'',view:'cities',q:'',sort:'revenue',dir:-1,page:1};
 let state={...defaults},stack=[],returnHash='',lastRole='';
 const city=c=>String(c?.clientAddress||'Не указан').split(',')[0].trim();
 const months=M.months;
 const monthLabel=m=>M.monthNames[+m.slice(5)-1]+' '+m.slice(0,4);
 const priorMonth=m=>{const d=new Date(m+'-15T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7)};
 const comparisonMonth=()=>state.comparison==='year'?String(+state.month.slice(0,4)-1)+state.month.slice(4):priorMonth(state.month);
 const accessible=()=>E.baseRows('clients').map(c=>clientMap.get(c.id)).filter(Boolean);
 function normalize(){
  const available=accessible(),supervisor=['rop','director','admin'].includes(prototypeRole);
  if(!supervisor)state.manager='';
  if(state.manager&&!available.some(c=>c.client_managerId===state.manager))state.manager='';
  if(state.city&&!available.some(c=>city(c)===state.city))state.city='';
  if(state.client&&!available.some(c=>c.id===state.client))state.client='';
 }
 function read(){
  const p=new URLSearchParams(location.hash.split('?')[1]||'');
  state={...defaults};
  for(const k of ['month','comparison','city','manager','client','category','source','view','q','sort'])if(p.has('s_'+k))state[k]=p.get('s_'+k).slice(0,180);
  if(!months.includes(state.month))state.month=defaults.month;
  if(!['year','month'].includes(state.comparison))state.comparison='year';
  if(!['cities','clients','legals','categories','outlets'].includes(state.view))state.view='cities';
  if(!S.categories.some(c=>c.id===state.category))state.category='';
  if(!S.sourceCategories.some(c=>c.id===state.source))state.source='';
  if(state.source)state.category=S.sourceCategories.find(c=>c.id===state.source).group;
  if(!['revenue','quantity','change','name'].includes(state.sort))state.sort='revenue';
  state.dir=p.get('s_dir')==='1'?1:-1;state.page=Math.max(1,Math.min(1000,parseInt(p.get('s_page'),10)||1));
  normalize();
 }
 function write(push=false){
  const p=new URLSearchParams({role:prototypeRole});
  for(const [k,v]of Object.entries(state))if(v!==defaults[k]&&v!=='')p.set('s_'+k,String(v));
  const hash='#territory-sales?'+p.toString();
  history[push?'pushState':'replaceState'](null,'',hash);
  renderSales();
 }
 function sourceRows(){
  const selected=accessible().filter(c=>(!state.city||city(c)===state.city)&&(!state.manager||c.client_managerId===state.manager)&&(!state.client||c.id===state.client));
  const rows=[];
  for(const c of selected)for(const l of byClient.get(c.id)||[])for(const source of S.sourceCategories){
   if(state.category&&source.group!==state.category)continue;
   if(state.source&&source.id!==state.source)continue;
   const data=l.metricsByMonth[state.month]?.categorySales?.[source.group]?.sourceRows.find(r=>r.sourceType===source.id);
   const prev=l.metricsByMonth[comparisonMonth()]?.categorySales?.[source.group]?.sourceRows.find(r=>r.sourceType===source.id);
   rows.push({...data,id:l.legalId+':'+source.id,legalId:l.legalId,legalName:l.legalName,clientId:c.id,clientName:c.clientName,city:city(c),
    managerId:c.client_managerId,category:source.group,sourceId:source.id,sourceName:source.label,previousRub:prev?.revenueRub??null,previousQty:prev?.quantity??null});
  }
  return{selected,rows};
 }
 function groups(rows){
  const key={cities:'city',clients:'clientId',legals:'legalId',categories:'sourceId'}[state.view],map=new Map();
  for(const r of rows){const id=r[key];if(!map.has(id))map.set(id,[]);map.get(id).push(r)}
  return[...map].map(([id,rs])=>({id,name:state.view==='clients'?rs[0].clientName:state.view==='legals'?rs[0].legalName:state.view==='categories'?rs[0].sourceName:rs[0].city,
   clientId:rs[0].clientId,city:rs[0].city,clients:new Set(rs.map(r=>r.clientId)).size,legals:new Set(rs.map(r=>r.legalId)).size,...summarize(rs)}));
 }
 const trend=(value,previous)=>{const d=delta(value,previous);return`<span class="ts-delta ts-${d.kind}">${esc(d.label)}</span>`};
 const option=(value,label,selected)=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`;
 const select=(key,label,values,all)=>`<label>${label}<select data-ts-filter="${key}" data-testid="sales-filter-${key}">${all?option('',all,state[key]):''}${values.map(([v,l])=>option(v,l,state[key])).join('')}</select></label>`;
 const action=(name,value,label,cls='')=>`<button type="button" class="${cls}" data-ts-action="${name}" data-ts-value="${esc(value)}">${label}</button>`;
 function renderSales(){
  if(current!=='territory-sales')return;
  normalize();const target=document.querySelector('.screenbody');if(!target)return;
  const {selected,rows}=sourceRows(),total=summarize(rows),available=accessible();
  const tts=E.baseRows('outlets').filter(o=>{const c=clientMap.get(o.clientId);return c&&(!state.city||city(c)===state.city)&&(!state.manager||c.client_managerId===state.manager)&&(!state.client||c.id===state.client)});
  const chosenLegals=new Set(rows.map(r=>r.legalId));
  let grouped=groups(rows).filter(r=>!state.q||`${r.name} ${r.city}`.toLocaleLowerCase('ru').includes(state.q.toLocaleLowerCase('ru')));
  const sortVal=r=>state.sort==='change'?(finite(r.previous)&&r.previous!==0?(r.revenue-r.previous)/Math.abs(r.previous):null):r[state.sort];
  grouped.sort((a,b)=>{const x=sortVal(a),y=sortVal(b);return x===null?y===null?0:1:y===null?-1:typeof x==='string'?state.dir*x.localeCompare(y,'ru'):state.dir*(x-y)});
  const pages=Math.max(1,Math.ceil(grouped.length/12));state.page=Math.min(state.page,pages);
  const finance=S.visibleFinanceMetrics(prototypeRole);
  const profitability=finite(total.finance.grossProfit)&&finite(total.revenue)&&total.revenue!==0?total.finance.grossProfit/total.revenue*100:null;
  const financeHtml=finance.length?`<details class="ts-finance"><summary>Финансовые показатели · ${prototypeRole==='rop'?'без себестоимости':'все данные'}</summary><dl>${finance.map(f=>`<div><dt>${esc(f.label)}</dt><dd>${f.percent?finite(profitability)?num(profitability)+' %':'Нет данных':money(total.finance[f.id])}</dd></div>`).join('')}</dl></details>`:'';
  const table=state.view==='outlets'?`<div class="ts-empty"><h3>Продажи по ТТ пока недоступны</h3><p>В текущей структуре продажи передаются по юрлицу за месяц. Привязки к торговой точке нет.</p><p>В выбранной территории ${tts.length} доступных ТТ. Выручку клиента между ними не распределяем.</p>${action('view','clients','Посмотреть продажи клиентов')}</div>`:
   `<div class="ts-table-scroll" tabindex="0" aria-label="Продажи в выбранном разрезе"><table><thead><tr><th>${action('sort','name',({cities:'Город клиента',clients:'Клиент',legals:'Юридическое лицо',categories:'Категория 1С'})[state.view]+' ↕')}</th><th>${action('sort','revenue','Выручка, ₽ ↕')}</th><th>${action('sort','quantity','Количество, шт. ↕')}</th><th>${action('sort','change','Динамика выручки ↕')}</th><th>Детализация</th></tr></thead><tbody>${grouped.slice((state.page-1)*12,state.page*12).map(r=>`<tr data-testid="sales-detail-row"><th scope="row">${esc(r.name)}<small>${esc(state.view==='categories'?'Месячные данные по юрлицам':state.view==='cities'?r.clients+' клиентов · '+r.legals+' юрлиц':state.view==='clients'?r.city+' · '+r.legals+' юрлиц':r.city)}${r.unknown?' · неполные данные':''}</small></th><td>${money(r.revenue)}</td><td>${num(r.quantity)}</td><td>${trend(r.revenue,r.previous)}</td><td>${state.view==='cities'?action('city',r.id,'Клиенты →','ts-link'):state.view==='clients'?action('client',r.id,'Юрлица →','ts-link'):state.view==='legals'?action('card',r.clientId,'Карточка клиента →','ts-link'):action('source',r.id,'Клиенты →','ts-link')}</td></tr>`).join('')||`<tr><td colspan="5" class="ts-empty">Нет совпадений. ${state.q?action('clear-search','','Очистить поиск'):action('reset','','Сбросить фильтры')}</td></tr>`}</tbody></table></div><div class="ts-pagination"><span>${grouped.length} строк · ${state.page} / ${pages}</span><div><button data-ts-action="page" data-ts-value="-1" aria-label="Предыдущие строки" ${state.page===1?'disabled':''}>←</button><button data-ts-action="page" data-ts-value="1" aria-label="Следующие строки" ${state.page===pages?'disabled':''}>→</button></div></div>`;
  target.innerHTML=`<div class="ts-page" data-testid="territory-sales" data-ts-version="${version}">
   <header class="ts-top"><div><span class="ts-scope">${esc(['manager','regional'].includes(prototypeRole)?'Моя территория':roleProfile().scope)} · ${esc(roleProfile().name)}</span></div><span class="ts-demo">Демо · не данные 1С</span></header>
   <section class="ts-filters" aria-label="Фильтры территории">
    ${select('month','Период',months.map(m=>[m,monthLabel(m)]))}
    ${select('city','Город клиента',[...new Set(available.map(city))].sort().map(c=>[c,c]),'Все города')}
    ${['rop','director','admin'].includes(prototypeRole)?select('manager','Менеджер',[...new Map(available.map(c=>[c.client_managerId,c.client_manager||'Не назначен']))].map(([id,n])=>[id,n]),'Вся доступная команда'):''}
    ${select('client','Клиент',available.filter(c=>(!state.city||city(c)===state.city)&&(!state.manager||c.client_managerId===state.manager)).map(c=>[c.id,c.clientName]),'Все клиенты')}
    ${select('category','Товарная группа',S.categories.map(c=>[c.id,c.label]),'Все группы')}
    ${action('reset','','Сбросить','ts-reset')}
   </section>
   <div class="ts-period"><span><b>${esc(monthLabel(state.month))}</b> · база: ${esc(monthLabel(comparisonMonth()))}</span>${select('comparison','Сравнивать',[['year','Тот же месяц год назад'],['month','Предыдущий месяц']])}</div>
   ${state.source?`<div class="ts-source-chip">Категория 1С: <b>${esc(S.sourceCategories.find(c=>c.id===state.source).label)}</b> ${action('clear-source','','Снять уточнение')}</div>`:''}
   <section class="ts-total" aria-label="Итог территории"><div><span>Выручка территории</span><strong data-testid="sales-total">${money(total.revenue)}</strong>${trend(total.revenue,total.previous)}</div><div><span>Единиц товара</span><strong>${num(total.quantity)} <small>шт.</small></strong>${trend(total.quantity,total.previousQty)}</div><div class="ts-population"><span><b>${selected.length}</b> клиентов</span><span><b>${chosenLegals.size}</b> юрлиц</span><span><b>${tts.length}</b> доступных ТТ территории</span></div></section>
   ${total.unknown?`<p class="ts-incomplete" role="status">Неполные данные: ${new Set(rows.filter(r=>!finite(r.revenueRub)||!finite(r.quantity)).map(r=>r.legalId)).size} юрлиц без показателей. Итог только по загруженным строкам; отсутствие данных не равно нулю.</p>`:''}
   <section class="ts-categories" aria-label="Продажи по товарным группам">${S.categories.map(c=>{const a=summarize(rows.filter(r=>r.category===c.id)),outside=state.category&&state.category!==c.id;return`<button class="ts-category ${state.category===c.id?'is-selected':''}" data-ts-action="toggle-category" data-ts-value="${c.id}" aria-pressed="${state.category===c.id}"><span>${c.label}</span><strong>${outside?'Вне выборки':money(a.revenue)}</strong><div>${outside?'Показать эту группу →':num(a.quantity)+' шт. '+trend(a.revenue,a.previous)}</div><small>${outside?'Нажмите, чтобы сменить фильтр':'Дистрибуция по ТТ: нет данных'}</small></button>`}).join('')}</section>
   ${financeHtml}
   <section class="ts-details"><div class="ts-detail-heading"><div><h2>Где формируется результат</h2></div>${stack.length?action('back','','← Назад по разрезам'):''}</div>
    <div class="ts-detail-tools"><nav class="ts-tabs" aria-label="Разрез продаж">${[['cities','Города'],['clients','Клиенты'],['legals','Юрлица'],['categories','Категории 1С'],['outlets','ТТ']].map(([id,label])=>`<button data-ts-action="view" data-ts-value="${id}" aria-pressed="${state.view===id}" class="${state.view===id?'is-selected':''}">${label}</button>`).join('')}</nav>
    ${state.view==='outlets'?'':`<label class="ts-search">Поиск в таблице<input type="search" data-ts-search placeholder="Название или город" value="${esc(state.q)}" aria-label="Поиск в таблице продаж"></label>`}
    </div>${table}
   </section>
   <details class="ts-method"><summary>Как читать данные и чего пока нет</summary><p>Все суммы и история вымышлены. Суммы в рублях, с НДС, после скидок. Период — месяц, не отдельные дни.</p><p>Город берётся из адреса клиента, а не места продажи ТТ. Нет распределения выручки по ТТ и факта дистрибуции. Клиенты и ТТ в счётчиках — состав доступной выборки, не число покупателей и не историческая динамика базы.</p><p>Межкомнатная группа включает погонаж; в «Категориях 1С» пять исходных категорий показаны отдельно. Модели и документы в этот вариант не добавлены: детализации нет в подтверждённом месячном формате.</p><p>Настройки и фильтры этого демо хранятся в ссылке, не в рабочем профиле ЛК.</p></details>
  </div>`;
  document.querySelector('.heading h1').textContent='Продажи';
  document.querySelector('.heading .sub')?.remove();
  document.querySelector('.r-other-example')?.remove();
  document.body.classList.remove('x14-focus-mode','x7-active');
  document.body.classList.add('ts-active');
  target.querySelectorAll('.ts-page button,.ts-page input,.ts-page select,.ts-page summary').forEach((el,i)=>{
   if(el.hasAttribute('data-testid'))return;
   const key=el.dataset.tsAction||el.dataset.tsFilter||(el.hasAttribute('data-ts-search')?'table-search':el.closest('.ts-finance')?'finance-details':el.closest('.ts-method')?'method-details':el.tagName.toLowerCase());
   el.dataset.testid='sales-'+key+'-'+encodeURIComponent(el.dataset.tsValue||String(i));
  });
  document.title='Tandoor RF · Продажи · '+roleProfile().label;
 }
 add('territory-sales','Продажи','Результат территории и детализация','Менеджер','territory-sales','','');
 const beforeNav=roleNav;roleNav=items=>{const ns=beforeNav(items),at=ns.findIndex(r=>r[0]==='exchange');ns.splice(at+1,0,['territory-sales','Продажи','chart-no-axes-combined','territory-sales']);return ns};
 const beforeRender=render;render=function(){beforeRender();document.body.classList.toggle('ts-active',current==='territory-sales');if(current==='territory-sales'){read();if(lastRole!==prototypeRole){stack=[];lastRole=prototypeRole}renderSales()}};
 const beforeRole=switchPrototypeRole;switchPrototypeRole=function(role){const sales=current==='territory-sales';beforeRole(role);if(sales){state={...defaults};stack=[];change('territory-sales')}};
 document.addEventListener('change',e=>{
  const key=e.target.dataset.tsFilter;if(!key||!Object.hasOwn(defaults,key))return;
  state[key]=e.target.value;state.page=1;state.q='';
  if(['city','manager'].includes(key))state.client='';
  if(key==='category')state.source='';
  stack=[];write();
 });
 document.addEventListener('input',e=>{if(!e.target.hasAttribute('data-ts-search'))return;state.q=e.target.value;state.page=1;const pos=e.target.selectionStart;write();const input=document.querySelector('[data-ts-search]');input.focus();input.setSelectionRange?.(pos,pos)});
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-ts-action]');if(!b||current!=='territory-sales')return;
  const a=b.dataset.tsAction,v=b.dataset.tsValue;
  if(a==='view'){state.view=v;state.q='';state.page=1;write(true);return}
  if(a==='reset'){state={...defaults};stack=[];write();return}
  if(a==='clear-search'){state.q='';write();return}
  if(a==='page'){state.page+=Number(v);write();return}
  if(a==='sort'){state.dir=state.sort===v?-state.dir:-1;state.sort=v;write();return}
  if(a==='toggle-category'){state.category=state.category===v?'':v;state.source='';state.page=1;write();return}
  if(a==='source'){const source=S.sourceCategories.find(c=>c.id===v);if(!source)return;stack.push({...state});state.source=v;state.category=source.group;state.view='clients';state.q='';state.page=1;write(true);return}
  if(a==='clear-source'){state.source='';state.page=1;write();return}
  if(a==='back'){state=stack.pop()||{...defaults};write(true);return}
  if(['city','client','category'].includes(a)){
   stack.push({...state});state[a]=v;state.view=a==='client'?'legals':'clients';state.q='';state.page=1;write(true);return;
  }
  if(a==='card'&&accessible().some(c=>c.id===v)){
   returnHash=location.hash;location.hash='#exchange?role='+prototypeRole+'&entity=clients&mode=card&record='+encodeURIComponent(v)+'&tab=overview';
  }
 });
 const restoreLink=()=>{if(returnHash&&current==='exchange'&&E.getState().mode==='card'){const box=document.querySelector('.x13-record-title');if(box&&!box.querySelector('[data-ts-return]'))box.insertAdjacentHTML('afterbegin','<button type="button" data-ts-return class="link">← Вернуться в продажи</button>')}};
 const linkRender=render;render=function(){linkRender();restoreLink()};
 document.addEventListener('click',e=>{if(e.target.closest('[data-ts-return]')&&returnHash)location.hash=returnHash});
 function polishBaselineCopy(){
  if(current!=='exchange')return;
  const search=document.getElementById('x6-search');
  if(search&&search.placeholder!=='Поиск по базе…'){search.placeholder='Поиск по базе…';search.title='Клиент, адрес, контакт, ответственный'}
  const note=document.querySelector('[data-demo-scale]');
  if(note){
   const text='Архивный демонстрационный масштаб: 6 РОПов · 43 сотрудника ОПТ. База: 2\u00a0206 клиентов · 2\u00a0743 юрлица · 3\u00a0773 ТТ. Имена, карточки и назначения вымышлены; это не текущие данные рабочего ЛК.';
   if(note.textContent!==text)note.textContent=text;
  }
 }
 new MutationObserver(polishBaselineCopy).observe(document.getElementById('app'),{childList:true,subtree:true});
 Object.assign(root.TandoorTerritorySales,{getState:()=>({...state}),getRows:sourceRows,groups});
 if(location.hash.split('?')[0]==='#territory-sales')current='territory-sales';
 render();polishBaselineCopy();
})(typeof window==='undefined'?globalThis:window);
