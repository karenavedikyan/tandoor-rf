/* Synthetic prototype, in-memory only. No production API or storage. */
(() => {
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const segs={mk:'МК двери',vh:'ВХ двери',hw:'Дверная фурнитура'};
 const mounts={portal:'Портал',book:'Книжка',cube:'Куб / квадрат',feet:'Копытца · без крепления',loose:'Без крепления',stand:'Фирменный стенд',board:'Щит с ручками'};
 const mountRules={mk:['portal','book','feet'],vh:['portal','cube','loose'],hw:['stand','board']};
 const variableMounts=['book','cube','stand','board'];
 const bestMount=seg=>seg==='hw'?'stand':'portal';
 const unitWord=()=>state.seg==='hw'?'мест под ручки':'мест под двери';
 const catalog=[
  {id:'M1',name:'Линия 01',seg:'mk',finish:'Белый матовый',rank:4,units:18,stock:22},
  {id:'M2',name:'Линия 05',seg:'mk',finish:'Дуб натуральный',rank:1,units:46,stock:14},
  {id:'M3',name:'Линия 06',seg:'mk',finish:'Светлый серый',rank:2,units:31,stock:8},
  {id:'M0',name:'Линия Classic',seg:'mk',finish:'Сохранённый образец',rank:null,units:0,stock:0,retired:true},
  {id:'V1',name:'Контур 10',seg:'vh',finish:'Графит / белый',rank:1,units:27,stock:5},
  {id:'V2',name:'Контур 20',seg:'vh',finish:'Тёплый дуб',rank:2,units:19,stock:0},
  {id:'H1',name:'Ручка Forma',seg:'hw',finish:'Матовый чёрный',rank:1,units:83,stock:36},
  {id:'H2',name:'Ручка Line',seg:'hw',finish:'Сатин',rank:2,units:54,stock:18}
 ];
 for(const m of catalog){Object.assign(m,window.distributionCatalogPhotos?.[m.id]||{});delete m.retired}
 const byModel=id=>catalog.find(m=>m.id===id);
 const initial=(cap,other,unknown,items)=>({cap,ours:items.filter(i=>i[1]>0).length,other,unknown,restVerified:cap>0,items:items.map(([id,qty,rotate=0])=>({id,qty:qty>0?1:0,rotate:qty>0&&rotate>0?1:0}))});
 const seed={
  'TT-1-1':{date:'2026-10-07',mk:{portal:initial(12,3,1,[['M1',4],['M0',2,2]]),book:{...initial(8,2,1,[['M1',3]]),units:[5,3]}},vh:{portal:initial(6,2,0,[['V1',2]]),cube:{...initial(4,1,0,[]),units:[4]}},hw:{stand:{...initial(12,2,0,[['H1',6]]),units:[12]},board:{...initial(20,6,2,[['H1',8]]),units:[20]}}},
  'TT-1-2':{date:'2026-10-05',mk:{portal:initial(10,2,0,[['M1',3],['M2',2]])},vh:{portal:initial(4,1,0,[['V1',2]])},hw:{stand:{...initial(0,0,0,[]),units:[0]}}},
  'TT-2-1':{date:'2026-08-14',mk:{portal:initial(8,1,1,[['M1',4]])},vh:{portal:initial(3,1,0,[['V1',1]])},hw:{board:{...initial(10,2,0,[['H1',4]]),units:[10]}}},
  'TT-3-1':{date:'2026-10-06',mk:{portal:initial(16,4,1,[['M1',5],['M2',3]])},vh:{portal:initial(5,1,1,[['V1',2]])},hw:{stand:{...initial(8,2,0,[['H1',4]]),units:[8]}}}
 };
 // Additional synthetic inspected points let the second demo team be compared.
 for(const [target,source] of [['TT-5-1','TT-1-1'],['TT-6-1','TT-1-2'],['TT-7-1','TT-3-1']])seed[target]=structuredClone(seed[source]);
 const tt=baseClients.flatMap(c=>c.stores.map(t=>({...t,client:c.id,clientName:c.name,city:c.city,team:c.team,manager:c.manager,rop:c.rop,
  holding:['C001','C003'].includes(c.id)?'H-YUG':`H-${c.id}`,
  holdingName:['C001','C003'].includes(c.id)?'Группа «Юг»':c.name,
  fact:structuredClone(seed[t.id]||{date:null,mk:{},vh:{},hw:{}}),revision:1})));
 const state={tab:'overview',level:'all',object:'',seg:'mk',q:'',city:'',density:'medium',focusview:'current',catalogQ:'',fresh:'all',group:'tt',draft:null,message:'',error:'',recommendation:null};
 tt.forEach(t=>{t.fact.dates=Object.fromEntries(Object.keys(segs).map(s=>[s,Object.keys(t.fact[s]).length?t.fact.date:null]))});
 const tasks=[{id:'V-014',tt:'TT-1-1',model:'M3',mount:'portal',qty:1,stage:1,kind:'place',due:'2026-10-15',owner:'Менеджер + региональный',evidence:false,comment:'Учебное обязательство: отгружено, установка не подтверждена.'}];
 const audit=[];
 const goals=[{tt:'TT-1-1',model:'M2',mount:'portal',qty:1,version:1,due:'2026-10-22'}];
 const stages=['Согласовано','Отгружено','Фото получено','Проверено на ТТ','Проверено РОПом','Закрыто директором'];
 const demoDate='2026-10-08';
 const scoped=()=>tt.filter(t=>!t.closed&&roleScopedClients().some(c=>c.id===t.client&&c.stores.some(s=>s.id===t.id)));
 const currentTT=()=>scoped().find(t=>t.id===state.object);
 const roleLabel=()=>roleProfile().label;
 const observed=t=>t.fact.dates[state.seg];
 const isStale=t=>!observed(t)||((Date.parse(demoDate)-Date.parse(observed(t)))/86400000)>30;
 const totalItems=p=>p.items.reduce((s,i)=>s+i.qty,0);
 const placementStats=p=>{
  const ours=p.ours??totalItems(p),remainder=p.cap-ours-p.other;
  return {cap:p.cap,ours,other:p.other,unknown:p.restVerified?p.unknown:Math.max(p.unknown,remainder),free:p.restVerified?remainder-p.unknown:0,rotate:p.items.reduce((s,i)=>s+i.rotate,0)};
 };
 const metric=t=>{
  const ps=Object.values(t.fact[state.seg]||{}),known=ps.length>0;
  return ps.reduce((a,p)=>{const s=placementStats(p);for(const k of ['cap','ours','other','unknown','free','rotate'])a[k]+=s[k];return a},{known,cap:0,ours:0,other:0,unknown:0,free:0,rotate:0});
 };
 const rows=()=>scoped().filter(t=>(state.level==='all'||(state.level==='tt'?t.id:state.level==='client'?t.client:t.holding)===state.object)
  &&(!state.q||`${t.clientName} ${t.city} ${t.address}`.toLowerCase().includes(state.q.toLowerCase()))
  &&(!state.city||t.city===state.city)
  &&(state.fresh==='all'||(state.fresh==='fresh'?!isStale(t):isStale(t))));
 const aggregate=items=>{
  const unique=[...new Map(items.map(t=>[t.id,t])).values()],data=unique.map(metric);
  return data.reduce((a,m)=>{for(const k of ['cap','ours','other','unknown','free','rotate'])a[k]+=m[k];a.known+=Number(m.known);return a},{count:unique.length,known:0,cap:0,ours:0,other:0,unknown:0,free:0,rotate:0});
 };
 const pct=m=>m.cap>0?`${(100*m.ours/m.cap).toLocaleString('ru-RU',{maximumFractionDigits:1})}%`:'Не рассчитано';
 const btn=(a,text,v='',cls='')=>`<button class="${cls}" data-d7="${a}" data-value="${esc(v)}">${text}</button>`;
 const opt=(v,l,sel)=>`<option value="${esc(v)}" ${v===sel?'selected':''}>${esc(l)}</option>`;
 const read=()=>{
  const p=new URLSearchParams(location.hash.split('?')[1]||'');
  state.tab=['overview','performance','entry','recommend','plan','matrix','method'].includes(p.get('dtab'))?p.get('dtab'):(current==='recommendations'?'recommend':current==='installation'?'plan':'overview');
  state.level=['all','holding','client','tt'].includes(p.get('level'))?p.get('level'):(current==='distribution'?'client':'all');
  state.object=p.get('object')||(current==='distribution'?baseSelectedId||'C001':'');
  if(['overview','performance'].includes(state.tab)&&state.level==='holding'){
   const first=scoped().find(t=>t.holding===state.object);if(first){state.level='client';state.object=first.client}
  }
  state.seg=Object.hasOwn(segs,p.get('seg'))?p.get('seg'):'mk';
  state.q=p.get('dq')||'';state.fresh=['fresh','stale'].includes(p.get('fresh'))?p.get('fresh'):'all';
  state.group=['client','holding','city'].includes(p.get('group'))?p.get('group'):'tt';
  state.city=p.get('city')||'';
  state.demo=['medium','large'].includes(p.get('demo'))?p.get('demo'):'small';
  state.density=['large','medium','small','list'].includes(p.get('cards'))?p.get('cards'):'medium';
  state.focusview=p.get('show')==='next'?'next':'current';
 };
 const url=()=>`#showcase?${new URLSearchParams({role:prototypeRole,dtab:state.tab,level:state.level,object:state.object,seg:state.seg,dq:state.q,city:state.city,cards:state.density,show:state.focusview,fresh:state.fresh,group:state.group,demo:state.demo||'small'})}`;
 const write=()=>{current='showcase';history.replaceState(null,'',url())};
 const navigate=patch=>{Object.assign(state,patch);state.message='';state.error='';write();render()};
 const announce=text=>{state.message=text;state.error='';paint()};
 function options(){
  return [...new Map(scoped().map(t=>state.level==='tt'?[t.id,`${t.clientName} · ${t.address}`]:state.level==='client'?[t.client,t.clientName]:[t.holding,t.holdingName])).entries()];
 }
 function toolbar(){
  return `<div class="d7-filter"><label>Уровень<select data-d7-field="level">${[['all','Моя область'],['holding','Холдинг'],['client','Клиент'],['tt','Торговая точка']].map(([v,l])=>opt(v,l,state.level)).join('')}</select></label>
  ${state.level!=='all'?`<label class="d7-wide">Объект<select data-d7-field="object"><option value="">Выберите объект</option>${options().map(([v,l])=>opt(v,l,state.object)).join('')}</select></label>`:''}
  <label>Категория<select data-d7-field="seg">${Object.entries(segs).map(([v,l])=>opt(v,l,state.seg)).join('')}</select></label>
  <label>Территория<select data-d7-field="city">${opt('','Все доступные города',state.city)}${[...new Set(scoped().map(t=>t.city))].map(c=>opt(c,c,state.city)).join('')}</select></label>
  <label>Актуальность<select data-d7-field="fresh">${[['all','Все осмотры'],['fresh','За 30 дней'],['stale','Нужен осмотр']].map(([v,l])=>opt(v,l,state.fresh)).join('')}</select></label>
  <label class="d7-wide">Поиск<input data-d7-field="q" type="search" value="${esc(state.q)}" placeholder="Город, клиент, адрес"></label>${btn('reset','Сбросить')}</div>`;
 }
 function meter(m){
  if(!m.cap)return '<div class="d7-no-data">Нет измеренной мощности</div>';
  return `<div class="d7-meter" aria-label="Наши ${m.ours}; конкуренты ${m.other}; неизвестно ${m.unknown}; свободно ${m.free}">${['ours','other','unknown','free'].map(k=>`<span class="d7-${k}" style="width:${100*m[k]/m.cap}%"></span>`).join('')}</div>`;
 }
 const legend=m=>`<div class="d7-legend">${[['ours','Наши'],['other','Не наши'],['unknown','Не определено'],['free','Свободно']].map(([k,l])=>`<span><i class="d7-${k}"></i>${l} <b>${m[k]}</b></span>`).join('')}</div>`;
 const densityControl=()=>`<div class="d8-density" aria-label="Размер карточек">${[['large','Крупно'],['medium','Средне'],['small','Мелко'],['list','Список']].map(([v,l])=>`<button data-d7="density" data-value="${v}" aria-pressed="${state.density===v}" class="${state.density===v?'active':''}">${l}</button>`).join('')}</div>`;
 const modelPhoto=m=>`<button class="d8-photo ${m.seg==='hw'?'hardware':''}" data-d7="photo" data-value="${m.id}" aria-label="Фото: ${esc(m.name)}"><img src="${esc(m.images?.[0]||'')}" alt="${esc(m.name)}" loading="lazy" width="240" height="260"></button>`;
 function modelCard(m,item,editMount=''){
  return `<article class="d8-product ${item?.qty?'selected':''}">${modelPhoto(m)}<div class="d8-product-info"><h3>${esc(m.name)}</h3><p class="small muted">${esc(m.finish)}</p>${editMount?`<div class="d8-product-counts"><label>Наших на витрине<input type="number" min="0" max="999" step="1" data-d7-item="${editMount}:${m.id}:qty" value="${item?.qty||0}"></label><label>Из них обновить<input type="number" min="0" max="999" step="1" data-d7-item="${editMount}:${m.id}:rotate" value="${item?.rotate||0}"></label></div>`:`<div class="row d7-mt">${tag('Стоит '+item.qty,'green')}${item.rotate?tag('Обновить '+item.rotate,'warn'):''}</div>`}</div></article>`;
 }
 const groupId=t=>state.group==='tt'?t.id:state.group==='client'?t.client:state.group==='city'?t.city:t.holding;
 const groupName=t=>state.group==='tt'?t.address:state.group==='client'?t.clientName:state.group==='city'?t.city:t.holdingName;
 function equipmentSummary(rs){
  const weighted=aggregate(rs),known=rs.map(metric).filter(m=>m.known&&m.cap>0),mean=known.length?`${(known.reduce((s,m)=>s+100*m.ours/m.cap,0)/known.length).toLocaleString('ru-RU',{maximumFractionDigits:1})}%`:'Не рассчитано';
  return `<section class="card pad d7-mt"><div class="row between"><h2>Дистрибуция и качество показа</h2>${tag('Без выдуманных коэффициентов продаж')}</div>
   <div class="d8-averages"><div><span>Общая доля по местам</span><b>${pct(weighted)}</b><small>${weighted.ours} / ${weighted.cap}. Большая ТТ имеет больший вес.</small></div><div><span>Среднее процентов ТТ</span><b>${mean}</b><small>${known.length} ТТ с известной мощностью. Каждая ТТ имеет одинаковый вес.</small></div></div>
   <div class="d7-table"><table><thead><tr><th>Оборудование</th><th>Всего мест</th><th>Наших</th><th>Дистрибуция</th><th>Наших не сопоставлено с моделями</th><th>Качество показа</th></tr></thead><tbody>${mountRules[state.seg].map(k=>{
    const ps=rs.flatMap(t=>t.fact[state.seg][k]?[t.fact[state.seg][k]]:[]);if(!ps.length)return '';
    const a=ps.reduce((a,p)=>({cap:a.cap+p.cap,ours:a.ours+placementStats(p).ours,unmapped:a.unmapped+Math.max(0,placementStats(p).ours-totalItems(p))}),{cap:0,ours:0,unmapped:0});
    return `<tr><td>${mounts[k]}</td><td>${a.cap}</td><td>${a.ours}</td><td>${pct(a)}</td><td>${a.unmapped}</td><td>${k===bestMount(state.seg)?tag('Предпочтительный формат','green'):'Возможность улучшить размещение'}</td></tr>`
   }).join('')||'<tr><td colspan="6">Оборудование ещё не обследовано.</td></tr>'}</tbody></table></div><p class="sub">В предпочтительном формате «${mounts[bestMount(state.seg)]}»: ${rs.reduce((s,t)=>s+(t.fact[state.seg][bestMount(state.seg)]?.ours||0),0)} из ${weighted.ours} наших мест. Портал для дверей и фирменный стенд для ручек приоритетны для качественного показа. Это не множитель дистрибуции или обещанный прирост продаж.</p></section>`;
 }
 function focusContext(){
  const t=currentTT(),selected=options().find(([id])=>id===state.object)?.[1];
  const clientId=state.level==='client'?state.object:t?.client;
  const clientPoints=scoped().filter(p=>p.client===clientId);
  return `<section class="d9-context">
   <div class="d9-breadcrumb">${clientId?btn('client-card','← Карточка клиента',clientId):btn('focus-home','Дистрибуция')}${clientId?`<span>/</span>${btn('focus-client',esc(clientPoints[0]?.clientName||'Клиент'),clientId)}`:''}<span>/</span><span>${state.level==='tt'?'Торговая точка':'Витрины'}</span></div>
   <div class="row between"><div><h2>${esc(state.level==='tt'?t?.address||'Точка недоступна':selected||'Витрины моей области')}</h2><p class="sub">${state.level==='tt'?esc(t?.clientName||''):state.level==='client'?'Все доступные торговые точки клиента':'Выберите клиента: состав и действия по его точкам'}</p></div>
   ${state.level==='tt'&&t?`<div class="row">${btn('edit-capacities','Все места',t.id)}${btn('edit','Внести дистрибуцию',t.id)}</div>`:`<details class="d9-client-picker" ${clientId?'':'open'}><summary>${clientId?'Сменить клиента':'Выбрать клиента'}</summary><label>Клиент<select data-d9-client><option value="">Выбрать клиента</option>${[...new Map(scoped().map(p=>[p.client,p.clientName]))].map(([id,name])=>opt(id,name,clientId)).join('')}</select></label></details>`}</div>
   ${clientId?`<div class="d9-points" aria-label="Торговые точки клиента"><button data-d7="focus-client" data-value="${esc(clientId)}" aria-pressed="${state.level==='client'}">Все ТТ · ${clientPoints.length}</button>${clientPoints.map(p=>`<button data-d7="focus-tt" data-value="${p.id}" aria-pressed="${p.id===state.object}">${esc(p.address)}</button>`).join('')}</div>`:''}
   <div class="d9-categories" aria-label="Категория витрины">${Object.entries(segs).map(([id,name])=>`<button data-d7="category" data-value="${id}" aria-pressed="${state.seg===id}">${id==='hw'?'Фурнитура':name}</button>`).join('')}</div>
  </section>`;
 }
 function focusRecommendation(r){
  const existing=tasks.some(t=>t.recId===r.id||(t.tt===r.t.id&&t.model===r.model?.id&&t.stage<5));
  const label=r.kind==='visit'?'Нужен осмотр':r.kind==='upgrade'?'Улучшить размещение':r.kind==='capacity'?'Согласовать место':r.kind==='replace'?'Заменить образец':'Поставить на витрину';
  return `<article class="d9-model d9-suggestion">${r.model?modelPhoto(r.model):'<div class="d9-check">Осмотр</div>'}<div>
   <span class="d9-eyebrow">${label}${existing?' · уже в плане':''}</span><h3>${esc(r.model?.name||r.title)}</h3><p class="sub">${r.priority===0?'Нет на ТТ: ':''}${esc(r.t.address)}${r.mount?' · '+mounts[r.mount]:''}</p>
   <details class="d9-reason"><summary>Почему и что сделать</summary><p>${esc(r.reason)}</p>${r.old?`<p>Вместо: ${esc(byModel(r.old)?.name)}.</p>`:''}${r.sourceMount?`<p>Перенести из: ${mounts[r.sourceMount]}.</p>`:''}<p>Осмотр: ${observed(r.t)||'нет'}. ${r.model?`Учебный остаток: ${r.model.stock} шт. `:''}Перед согласованием проверить место, комплектацию и наличие.</p></details>
   <div class="d9-action">${r.kind==='visit'||r.kind==='capacity'?btn('edit',r.kind==='capacity'?'Проверить места':'Внести осмотр',r.t.id):existing?btn('tab','Посмотреть план','plan'):btn('propose','Согласовать установку',r.id,'primary')}</div>
  </div></article>`;
 }
 function overview(){
  const rs=rows(),a=aggregate(rs),list=recs(),suggestions=list.filter(r=>r.model),checks=list.filter(r=>!r.model);
  const models=catalog.filter(m=>m.seg===state.seg).map(m=>{
   const placements=rs.flatMap(t=>Object.entries(t.fact[state.seg]).flatMap(([mount,p])=>p.items.filter(i=>i.id===m.id&&i.qty>0).map(i=>({t,mount,...i}))));
   return {m,placements,qty:placements.reduce((n,i)=>n+i.qty,0)};
  }).filter(m=>m.qty>0);
  const unidentified=rs.reduce((n,t)=>n+Object.values(t.fact[state.seg]).reduce((s,p)=>s+Math.max(0,placementStats(p).ours-totalItems(p)),0),0);
  return `<div class="dp-entry"><span>Как выставленные модели продаются и покрывают вложения</span>${btn('tab','Продажа и конверсия ↗','performance')}</div><div class="d9-summary"><div><span>Сейчас · ${segs[state.seg]}</span><b>${pct(a)}</b><small>${a.ours} наших из ${a.cap} мест · измерено ${a.known} из ${a.count} ТТ</small></div><div><span>Следующий шаг</span><b>${suggestions.length?`Предложений: ${suggestions.length}`:checks.length?'Уточнить состав':'Проверить возможности'}</b><small>${a.free} подтверждённых свободных мест · ${a.rotate} наших на обновление</small></div></div>
   <div class="d9-switch" aria-label="Состав и предложения"><button data-d7="focus-view" data-value="current" aria-pressed="${state.focusview==='current'}">Что стоит <span>${a.ours}</span></button><button data-d7="focus-view" data-value="next" aria-pressed="${state.focusview==='next'}">Что поставить <span>${suggestions.length}</span></button></div>
   <div class="d9-comparison" data-view="${state.focusview}">
   <section class="card d9-current"><div class="d9-panelhead"><h2>Что стоит сейчас</h2><p class="sub">Наши образцы · ${segs[state.seg]}</p></div>
    ${models.map(({m,placements,qty})=>`<article class="d9-model">${modelPhoto(m)}<div><span class="d9-eyebrow">На витрине · ${qty} шт.</span><h3>${esc(m.name)}</h3><p class="sub">${[...new Set(placements.map(p=>mounts[p.mount]))].join(' · ')}</p><details class="d9-reason"><summary>Где стоит · ${new Set(placements.map(p=>p.t.id)).size} ТТ</summary>${placements.map(p=>`<div class="d9-location"><p>${esc(p.t.address)} · ${mounts[p.mount]} · ${p.qty} шт.${p.rotate?' · обновить '+p.rotate:''}</p>${btn('focus-tt','Открыть точку',p.t.id)}</div>`).join('')}</details></div></article>`).join('')||`<div class="d9-empty"><h3>${a.known?'Модели пока не отмечены':'Состав ещё не внесён'}</h3><p>Это не означает, что наших образцов нет. Внесите осмотр выбранной точки.</p>${state.level==='tt'&&currentTT()?btn('edit','Внести состав',state.object,'primary'):btn('tab','Выбрать ТТ для осмотра','entry')}</div>`}
    ${unidentified?`<div class="d9-caution">Ещё ${unidentified} наших образцов не сопоставлено с каталогом. Нельзя достоверно назвать отсутствующие модели.</div>`:''}
    ${rs.some(isStale)?'<div class="d9-caution">Есть ТТ без свежего осмотра. Сначала уточните состав.</div>':''}
   </section>
   <section class="card d9-next"><div class="d9-panelhead"><h2>Что поставить и улучшить</h2><p class="sub">Вначале востребованные модели, которых нет на конкретной ТТ</p></div>
    ${suggestions.slice(0,3).map(focusRecommendation).join('')||'<div class="d9-empty"><h3>Пока нет подтверждённых предложений</h3><p>Нужно проверить состав, места и спрос. Это не вывод об отсутствии потенциала.</p></div>'}
    ${suggestions.length>3?`<details class="d9-more"><summary>Ещё предложений: ${suggestions.length-3}</summary>${suggestions.slice(3).map(focusRecommendation).join('')}</details>`:''}
    ${checks.length?`<details class="d9-more" ${!suggestions.length?'open':''}><summary>Сначала уточнить данные · ${checks.length}</summary>${checks.map(focusRecommendation).join('')}</details>`:''}
    <p class="d9-footnote">Спрос и остатки учебные. Предложение не меняет факт до подтверждённой установки.</p>
   </section></div>
   <div class="d9-bottom">${state.level==='tt'&&currentTT()?btn('edit','Внести дистрибуцию',state.object):btn('tab','Внести дистрибуцию','entry')}${btn('tab','План установки','plan')}${btn('tab','Адресные цели','matrix')}${btn('tab','Правила расчёта','method')}</div>
   <details class="d7-details d9-analytics"><summary>Подробная аналитика: проценты, оборудование и все ТТ</summary>${analyticsOverview()}</details>`;
 }
 function analyticsOverview(){
  const rs=rows(),a=aggregate(rs),fresh=rs.filter(t=>!isStale(t)&&metric(t).known).length;
  const gs=[...new Map(rs.map(t=>[groupId(t),groupName(t)])).entries()];
  return `<div class="d7-kpis"><section><span>Доля наших мест · ${segs[state.seg]}</span><strong>${pct(a)}</strong><small>${a.ours} наших / ${a.cap} измеренных мест</small></section><section><span>Данные по витринам</span><strong>${a.known} / ${a.count}</strong><small>ТТ с измерениями · свежих ${fresh}</small></section><section><span>Свободно для расширения</span><strong>${a.free}</strong><small>Физические места, не прогноз продаж</small></section><section><span>Наших на обновление</span><strong>${a.rotate}</strong><small>Внутри наших ${a.ours}, не добавляем к мощности</small></section></div>
  <div class="d7-split"><section class="card pad"><div class="row between"><h2>Состав витрины</h2>${tag(segs[state.seg])}</div>${meter(a)}${legend(a)}
   <p class="sub">Не определено: ${a.unknown}. Эти позиции не считаем пустыми или конкурентными. ${a.count-a.known} ТТ без измерений не входят в процент.</p></section>
  <section class="card pad"><h2>Следующее действие</h2><p class="sub">${prototypeRole==='regional'?'Обновить осмотры и проверить реальные места.':prototypeRole==='manager'?'Согласовать модели и наличие с региональным.':prototypeRole==='rop'?'Проверить качество данных и обязательства команды.':'Сравнить холдинги, дефициты и завершение установок.'}</p><div class="row d7-mt">${btn('tab','Рекомендации','recommend','primary')}${btn('tab','План установки','plan')}</div></section></div>
  ${equipmentSummary(rs)}
  <section class="card d7-mt"><div class="cardhead"><h2>${state.level==='client'?'Каждая торговая точка клиента':'От общей картины к точке'}</h2><label>Группировать <select data-d7-field="group">${[['tt','По ТТ'],['client','По клиентам'],['holding','По холдингам'],['city','По территории']].map(([v,l])=>opt(v,l,state.group)).join('')}</select></label></div>
  <div class="d7-table"><table><thead><tr><th>Объект</th><th>Доля / база</th><th>Свободно</th><th>Ротация своих</th><th>Качество данных</th><th></th></tr></thead><tbody>${gs.map(([id,name])=>{
   const subset=rs.filter(t=>groupId(t)===id),m=aggregate(subset),t=subset[0];
   return `<tr><td><b>${esc(name)}</b><small>${state.group==='tt'?esc(t.clientName)+' · '+esc(t.id):subset.length+' доступных ТТ'}</small></td><td><b>${pct(m)}</b><small>${m.ours} / ${m.cap} мест</small></td><td>${m.free}</td><td>${m.rotate}</td><td>${m.known<subset.length?tag('Есть пробелы','warn'):subset.some(isStale)?tag('Нужен осмотр','warn'):tag('Свежий факт','green')}<small>${state.group==='tt'?(observed(t)||'Осмотра нет'):'Измерено '+m.known+' ТТ'}</small></td><td>${btn('drill','Открыть',`${state.group}:${id}`)}</td></tr>`;
  }).join('')||'<tr><td colspan="6">Нет доступных ТТ по этим условиям. Сбросьте фильтры.</td></tr>'}</tbody></table></div></section>
  ${state.level==='tt'&&currentTT()?ttDetail(currentTT()):''}
  <details class="d7-details"><summary>Как читать проценты и потенциал</summary><p>Общая доля = сумма наших мест / сумма измеренных мест в выбранной категории. Среднее процентов обследованных ТТ показано отдельно и не подменяет общую долю. ВХ, МК и фурнитуру не смешиваем.</p><p>Свободные места дают физический потенциал расширения. Конкуренты требуют переговоров, неизвестные позиции требуют уточнения. Финансовый потенциал ТТ без её продаж не рассчитан.</p></details>`;
 }
 function ttDetail(t){
  const ps=Object.entries(t.fact[state.seg]||{});
  return `<section class="card d7-mt"><div class="cardhead"><h2>Наши образцы · ${esc(t.id)}</h2>${btn('edit','Внести осмотр',t.id,'primary')}</div><div class="pad">${densityControl()}</div>
   ${ps.map(([k,p])=>`<div class="d8-showcase-group"><div class="row between"><h3>${mounts[k]}</h3>${tag(`${placementStats(p).ours} наших / ${p.cap} мест · ${pct(placementStats(p))}`)}</div>${p.units?`<p class="sub">Вместимость: ${p.units.join(' + ')} = ${p.cap} ${unitWord()}</p>`:''}<div class="d8-products ${state.density}">${p.items.filter(i=>i.qty>0).map(i=>modelCard(byModel(i.id),i)).join('')||'<p class="sub">Опознанных наших моделей пока нет.</p>'}</div>${placementStats(p).ours>totalItems(p)?`<p class="sub">Ещё ${placementStats(p).ours-totalItems(p)} наших образцов нужно сопоставить с каталогом. Доля мест известна, отсутствие конкретных моделей пока не доказано.</p>`:''}</div>`).join('')||'<div class="pad">Осмотра нет. Не подставляем нулевую дистрибуцию.</div>'}
   <div class="pad small muted">Осмотр категории: ${observed(t)||'не внесён'} · ревизия ${t.revision}. Фото и названия из сохранённого публичного каталога Tandoor; состав ТТ и количества учебные. Каталожная фотография не подтверждает установку.</div></section>`;
 }
 function beginEdit(id){
  const t=scoped().find(t=>t.id===id);if(!t)return;
  state.draft={tt:id,seg:state.seg,revision:t.revision,placements:{},categories:{},step:1,mount:null,date:demoDate,note:'',proof:false,finish:'',onlySelected:false};
  state.catalogQ='';
  navigate({tab:'entry',level:'tt',object:id});
 }
 function chooseInspectionCategory(seg){
  const d=state.draft,t=currentTT();if(!d||!t||!segs[seg])return;
  if(!d.categories[seg]){
   d.categories[seg]=structuredClone(t.fact[seg]||{});
   Object.values(d.categories[seg]).forEach(p=>{p.emptyPlaces=placementStats(p).free;p.reviewed=false});
   for(const [key,c] of Object.entries(t.capacitySetup?.[seg]||{})){
    const p=d.categories[seg][key]||initial(0,0,0,[]);
    Object.assign(p,structuredClone(c),{capacityReady:true,reviewed:false});
    d.categories[seg][key]=p;
   }
  }
  d.placements=d.categories[seg];d.seg=seg;state.seg=seg;d.step=2;d.mount=null;d.finish='';d.onlySelected=false;state.catalogQ='';write();paint();
 }
 function chooseInspectionMount(key){
  const d=state.draft;if(!d||!mountRules[d.seg].includes(key))return;
  if(!d.placements[key]){
   const p=initial(0,0,0,[]);p.emptyPlaces=0;p.reviewed=false;
   if(variableMounts.includes(key))p.units=[0];
   d.placements[key]=p;d.dirty=true;
  }
  d.mount=key;d.step=d.placements[key].capacityReady?3:2;paint();
 }
 function openAllCapacities(){
  const d=state.draft,t=currentTT();if(!d||!t)return;
  d.capacityForm={};
  for(const seg of Object.keys(segs)){
   d.capacityForm[seg]={};
   for(const key of mountRules[seg]){
    const p=d.categories[seg]?.[key]||t.capacitySetup?.[seg]?.[key]||t.fact[seg]?.[key];
    d.capacityForm[seg][key]={cap:p?.cap??null,emptyPlaces:p?(p.emptyPlaces??placementStats(p).free):0,
     units:variableMounts.includes(key)?(p?.units||[p?.cap??0]).join(' + '):'',present:!!p};
   }
  }
  d.capacityFormDirty=false;d.beforeCapacityStep=d.step;d.step=0;state.error='';paint();
 }
 function capacityFormError(){
  const d=state.draft,t=currentTT();
  for(const [seg,ps] of Object.entries(d.capacityForm))for(const [key,p] of Object.entries(ps)){
   if(p.cap===null&&!p.present&&p.emptyPlaces===0)continue;
   if(!Number.isInteger(p.cap)||p.cap<0||p.cap>999||!Number.isInteger(p.emptyPlaces)||p.emptyPlaces<0||p.emptyPlaces>p.cap)return `${segs[seg]} · ${mounts[key]}: проверьте вместимость и пустые места.`;
   if(variableMounts.includes(key)&&!/^\s*\d+\s*(?:\+\s*\d+\s*)*$/.test(p.units))return `${segs[seg]} · ${mounts[key]}: укажите места каждого экземпляра, например 5 + 3.`;
   const items=d.categories[seg]?.[key]?.items||t.fact[seg]?.[key]?.items||[];
   if(items.reduce((s,i)=>s+i.qty,0)+p.emptyPlaces>p.cap)return `${segs[seg]} · ${mounts[key]}: мест меньше, чем уже отмеченных моделей и пустых мест. Уточните число мест или сначала снимите лишние модели.`;
  }
  return '';
 }
 function allCapacities(){
  const d=state.draft;
  return `<section class="card d10-inspection d12-capacities"><div class="cardhead"><div><h2>Все места на торговой точке</h2><p class="sub">${esc(currentTT().clientName)} · ${esc(currentTT().address)}</p></div>${btn('capacity-cancel','Назад')}</div><div class="pad">
   <p class="d12-intro">Заполните оборудование всех категорий один раз. Затем отмечайте модели в каталоге без повторного ввода мест.</p>
   ${Object.entries(segs).map(([seg,title])=>`<fieldset class="d12-category"><legend>${title}</legend>${mountRules[seg].map(key=>{
    const p=d.capacityForm[seg][key],variable=variableMounts.includes(key);
    return `<div class="d12-row"><h3>${mounts[key]}</h3><label>${variable?'Места по экземплярам':'Всего мест'}<input ${variable?'type="text" inputmode="text"':'type="number" min="0" max="999"'} data-d12-field="${seg}:${key}:${variable?'units':'cap'}" value="${variable?(p.present?esc(p.units):''):(p.cap??'')}" placeholder="${variable?'Например: 5 + 3':'Не указано'}"></label><label>Пустых мест<input type="number" min="0" max="999" data-d12-field="${seg}:${key}:emptyPlaces" value="${p.emptyPlaces}"></label><div class="d12-total"><span>Всего</span><b data-d12-total="${seg}:${key}">${p.cap??'—'}</b></div></div>`;
   }).join('')}</fieldset>`).join('')}
   <p class="small muted">Пустое поле вместимости: ещё не указано. 0: оборудования нет. Для книжек, кубов и щитов укажите места каждого экземпляра через «+»; общая вместимость сложится автоматически.</p>
   <p id="d12-validation" class="d7-validation" role="status">${capacityFormError()}</p>
   <div class="d12-save">${btn('capacity-save','Сохранить места и выбрать модели','','primary')}<p class="sub">Сохраняется вместимость, не новый состав витрины. Дистрибуция обновится после подтверждения осмотра.</p></div>
  </div></section>`;
 }
 function saveAllCapacities(){
  const d=state.draft,t=currentTT();if(!d||!t)return;
  const err=capacityFormError();
  if(err){state.error=err;paint();document.querySelector('.d7-error')?.scrollIntoView({block:'nearest'});return}
  const configs=structuredClone(t.capacitySetup||{});
  let count=0;
  for(const [seg,ps] of Object.entries(d.capacityForm)){
   configs[seg]||={};
   for(const [key,p] of Object.entries(ps)){
    if(p.cap===null&&!p.present)continue;
    const config={cap:p.cap,emptyPlaces:p.emptyPlaces,...(variableMounts.includes(key)?{units:p.units.split('+').map(Number)}:{})};
    configs[seg][key]=config;count++;
    if(d.categories[seg]&&!d.categories[seg][key])d.categories[seg][key]={...initial(0,0,0,[]),reviewed:false};
    const target=d.categories[seg]?.[key];
    if(target){
     if(target.cap!==config.cap||target.emptyPlaces!==config.emptyPlaces||JSON.stringify(target.units)!==JSON.stringify(config.units)){target.reviewed=false;target.edited=true}
     Object.assign(target,structuredClone(config),{capacityReady:true});
    }
   }
  }
  if(!count){state.error='Укажите вместимость хотя бы одного типа оборудования.';paint();return}
  t.capacitySetup=configs;t.revision++;d.revision=t.revision;d.capacityFormDirty=false;d.step=1;
  state.error='';state.message=`Места сохранены для ${count} типов оборудования в демо. Теперь выберите категорию и отмечайте модели.`;paint();
 }
 function inspectionBalance(p){
  return {cap:p.cap,ours:totalItems(p),free:p.emptyPlaces,other:p.cap-totalItems(p)-p.emptyPlaces};
 }
 function inspectionError(p){
  if(p.items.some(i=>![0,1].includes(i.qty))||new Set(p.items.map(i=>i.id)).size!==p.items.length)return 'Модель может быть отмечена только один раз на выбранной витрине.';
  if([p.cap,p.emptyPlaces,...(p.units||[]),...p.items.flatMap(i=>[i.qty,i.rotate])].some(n=>!Number.isInteger(n)||n<0||n>999))return 'Укажите целые числа от 0 до 999.';
  if(p.units&&p.units.reduce((s,n)=>s+n,0)!==p.cap)return 'Проверьте вместимость оборудования.';
  if(inspectionBalance(p).other<0)return 'Наших образцов и пустых мест больше, чем всего мест. Уточните вместимость или выбор.';
  return '';
 }
 function inspectionWarning(p){
  const over=totalItems(p)+p.emptyPlaces-p.cap;
  return over>0?`<div class="d10-overflow" role="alert"><b>Мест не хватает: ещё ${over}</b><p>Выбрано наших: ${totalItems(p)}, пустых: ${p.emptyPlaces}, всего мест: ${p.cap}. Уточните вместимость оборудования или уберите лишние отметки.</p>${btn('inspection-back','Изменить количество мест')}</div>`:'';
 }
 function refreshInspection(){
  const d=state.draft,p=d?.placements[d.mount];if(!p)return;
  const b=inspectionBalance(p);
  const balance=document.querySelector('.d10-balance');
  if(balance)balance.innerHTML=`<span>Всего <b>${b.cap}</b></span><span>Наших <b>${b.ours}</b></span><span>Пустых <b>${b.free}</b></span><span>Не наши <b>${Math.max(0,b.other)}</b></span><span>Доля <b>${b.other<0?'Проверьте места':pct(b)}</b></span>`;
  const validation=document.getElementById('d10-validation');if(validation)validation.textContent=inspectionError(p);
  const warning=document.getElementById('d10-warning');if(warning)warning.innerHTML=inspectionWarning(p);
  const count=document.querySelector('.d10-save b');if(count)count.textContent='Проверено типов оборудования: '+Object.values(d.categories).flatMap(Object.values).filter(p=>p.reviewed).length;
 }
 function inspectionModelCard(m,p){
  const i=p.items.find(i=>i.id===m.id),qty=i?.qty||0;
  return `<article class="d8-product d10-product ${qty?'selected':''}" data-model="${m.id}">
   <button class="d10-select-model" data-d7="inspection-toggle" data-value="${m.id}" aria-pressed="${qty>0}" aria-label="${qty?'Убрать с витрины':'Стоит на витрине'}: ${esc(m.name)}">
    <span class="d10-select-state">${qty?'✓ Стоит':'+ Отметить: стоит'}</span>
    <img src="${esc(m.images[0])}" alt="${esc(m.name)}" width="240" height="240"><h3>${esc(m.name)}</h3><span class="small muted">${esc(m.finish)}</span>
   </button>
   <div class="d10-model-bottom"><span class="small muted">${qty?'Нажмите, чтобы убрать':'Нажмите, чтобы отметить'}</span>${btn('photo','Фото',m.id)}</div>
  </article>`;
 }
 function entry(){
  const d=state.draft,t=currentTT();
  if(!t||!d||d.tt!==t.id)return `<section class="card pad"><h2>Внести дистрибуцию</h2><p class="sub">Выберите торговую точку для осмотра витрины.</p><div class="d7-pick">${rows().map(t=>btn('edit',`${esc(t.clientName)} · ${esc(t.address)}`,t.id)).join('')||'Нет доступных точек.'}</div></section>`;
  if(d.step===0)return allCapacities();
  const p=d.mount?d.placements[d.mount]:null,b=p?inspectionBalance(p):null;
  const reviewed=Object.values(d.categories).flatMap(Object.values).filter(p=>p.reviewed).length;
  return `<section class="card d10-inspection"><div class="cardhead"><div><h2>Внести дистрибуцию</h2><p class="sub">${esc(t.clientName)} · ${esc(t.address)}</p></div>${btn('cancel-edit','Закрыть осмотр')}</div>
   <div class="pad"><div class="d12-entry"><div><b>Сначала заполнить все места</b><p class="sub">МК, ВХ и фурнитура в одной форме. Можно вернуться в любой момент.</p></div>${btn('capacity-open','Все места по оборудованию','','primary')}</div><div class="d10-steps" aria-label="Этап осмотра">${[[1,'Категория'],[2,'Оборудование и места'],[3,'Что стоит']].map(([n,l])=>`<span class="${n===d.step?'active':''}">${n}. ${l}</span>`).join('')}</div>
   <div class="d9-categories" aria-label="Категория осмотра">${Object.entries(segs).map(([seg,name])=>`<button data-d7="inspection-category" data-value="${seg}" aria-pressed="${d.step>1&&d.seg===seg}">${seg==='hw'?'Фурнитура':name}</button>`).join('')}</div>
   ${d.step===1?'<div class="d10-start"><h3>Выберите категорию товара</h3><p>Затем укажите оборудование, вместимость и отметьте наши модели в каталоге.</p></div>':`
   <div class="d10-mounts"><h3>Тип оборудования</h3><div class="row">${mountRules[d.seg].map(k=>`<button data-d7="inspection-mount" data-value="${k}" aria-pressed="${d.mount===k}">${mounts[k]}${d.placements[k]?.reviewed?' · проверено':''}</button>`).join('')}</div></div>
   ${!p?'<p class="sub d7-mt">Выберите тип оборудования. Ранее внесённые модели будут отмечены в каталоге.</p>':`
   <div id="d10-warning">${inspectionWarning(p)}</div>
   ${d.step===2?`<div class="d10-capacity">
    ${variableMounts.includes(d.mount)?`<div class="d8-units"><b>Вместимость каждого оборудования</b><div class="row d7-mt">${p.units.map((n,i)=>`<label>№${i+1}: ${unitWord()}<input type="number" min="0" max="999" data-d8-unit="${d.mount}:${i}" value="${n}"></label>`).join('')}${btn('unit-add','Добавить ещё',d.mount)}</div></div>`:''}
    <div class="d7-formrow"><label>Всего мест · ${mounts[d.mount]}<input type="number" min="0" max="999" data-d7-count="${d.mount}:cap" value="${p.cap}" ${variableMounts.includes(d.mount)?'readonly':''}></label><label>Пустых мест (если есть)<input type="number" min="0" max="999" data-d10-empty value="${p.emptyPlaces}"></label></div>
    <p class="sub">Пустые места не относятся к «не нашим». Если пустых нет, оставьте 0.</p>${btn('inspection-catalog','Выбрать наши модели','','primary')}
   </div>`:`<div class="d10-catalog-head"><b>${mounts[d.mount]} · ${p.cap} мест · пустых ${p.emptyPlaces}</b>${btn('inspection-back','Изменить вместимость')}<p class="sub">Тап по карточке: стоит / не стоит. Одна отмеченная модель занимает одно место.</p></div>
    <div class="d10-filters"><label>Найти модель<input id="d8-catalog-search" type="search" value="${esc(state.catalogQ)}" placeholder="Название, код или исполнение"></label><label>Исполнение<select data-d10-finish><option value="">Все исполнения</option>${[...new Set(catalog.filter(m=>m.seg===d.seg).map(m=>m.finish))].map(f=>opt(f,f,d.finish)).join('')}</select></label><label>Показать<select data-d10-selected>${opt('all','Весь каталог',d.onlySelected?'selected':'all')}${opt('selected','Только стоит',d.onlySelected?'selected':'all')}</select></label>${btn('inspection-filter-reset','Сбросить фильтры')}</div>
    ${densityControl()}<div class="d8-products d10-catalog ${state.density}">${catalog.filter(m=>m.seg===d.seg).map(m=>inspectionModelCard(m,p)).join('')}</div><p class="d10-no-matches" hidden>По фильтрам моделей нет. Сбросьте фильтры; выбранные модели не удалены.</p>
   `}
   <div class="d10-balance" role="status"><span>Всего <b>${b.cap}</b></span><span>Наших <b>${b.ours}</b></span><span>Пустых <b>${b.free}</b></span><span>Не наши <b>${Math.max(0,b.other)}</b></span><span>Доля <b>${b.other<0?'Проверьте места':pct(b)}</b></span></div>
   <p id="d10-validation" class="d7-validation" role="status">${inspectionError(p)}</p>
   ${d.step===3?`<div class="d10-confirm"><p>Подтверждаю: все наши образцы и пустые места отмечены. Остальные занятые места относятся к не нашим моделям.</p>${btn('inspection-confirm',p.reviewed?'Состав подтверждён':'Подтвердить это оборудование','',p.reviewed?'':'primary')}</div>`:''}
   `}
   `}
   <details class="d7-details"><summary>Дата и комментарий осмотра</summary><div class="d7-formrow"><label>Дата<input type="date" max="${demoDate}" data-d7-draft="date" value="${d.date}"></label><label>Комментарий<input data-d7-draft="note" value="${esc(d.note)}"></label></div></details>
   <div class="d10-save"><div><b>Проверено типов оборудования: ${reviewed}</b><p class="sub">Можно пройти другие типы и категории: отметки сохраняются в черновике.</p></div>${btn('save-fact','Сохранить осмотр','','primary')}</div>
   <p class="small muted">Демо: изменения живут до перезагрузки. Сохранение не отправляет данные в рабочий ЛК.</p>
  </div></section>`;
 }
 function legacyEntry(){
  const d=state.draft,t=currentTT();
  if(!t||!d||d.tt!==t.id||d.seg!==state.seg)return `<section class="card pad"><h2>Начните с торговой точки</h2><p class="sub">Физический факт хранится только по ТТ. Выберите точку, затем отметьте мощность и образцы по типу размещения.</p><div class="d7-pick">${rows().map(t=>btn('edit',`${esc(t.clientName)} · ${esc(t.address)}`,t.id)).join('')||'Нет доступных точек. Сбросьте фильтры.'}</div></section>`;
  return `<section class="card"><div class="cardhead"><div><h2>Осмотр · ${esc(t.address)}</h2><p class="sub">${segs[state.seg]} · черновик не меняет аналитику</p></div>${tag('Ревизия '+d.revision)}</div><div class="pad">
   <div class="d7-formrow"><label>Дата осмотра<input type="date" max="${demoDate}" data-d7-draft="date" value="${d.date}"></label><label class="d7-wide">Комментарий<input data-d7-draft="note" value="${esc(d.note)}" placeholder="Что изменилось на точке"></label></div>
   <div class="d8-entry-guide"><b>1. Места → 2. Наши образцы → 3. Сохранить осмотр</b><p>Сначала посчитайте вместимость каждого типа и наши места. Затем отметьте модели по фото. Число оборудования не равно числу мест: книжки, кубы и щиты бывают разной вместимости.</p></div>
   <div class="row between d7-mt">${densityControl()}<label>Найти модель<input id="d8-catalog-search" type="search" value="${esc(state.catalogQ)}" placeholder="Название модели"></label></div>
   ${Object.entries(d.placements).map(([key,p])=>`<fieldset class="d7-fieldset"><legend>${mounts[key]}</legend>
    ${variableMounts.includes(key)?`<div class="d8-units"><b>Уточните вместимость каждого оборудования</b><div class="row d7-mt">${(p.units||[p.cap]).map((cap,i)=>`<label>${key==='book'?'Книжка':key==='cube'?'Куб':key==='board'?'Щит':'Стенд'} №${i+1}: ${unitWord()}<input type="number" min="0" max="999" step="1" data-d8-unit="${key}:${i}" value="${cap}"></label>`).join('')}${btn('unit-add','Ещё '+(key==='book'?'книжка':key==='cube'?'куб':key==='board'?'щит':'стенд'),key)}</div><p class="small muted">Общая мощность ниже равна сумме вместимостей. Для щита считайте места под образцы ручек, а не количество щитов.</p></div>`:''}
    <div class="d7-counts">
    <label>Всего ${unitWord()}<input type="number" min="0" max="999" step="1" data-d7-count="${key}:cap" value="${p.cap}" ${variableMounts.includes(key)?'readonly':''}></label>
    <label>Из них наши места<input type="number" min="0" max="999" step="1" data-d7-count="${key}:ours" value="${placementStats(p).ours}"></label>
    <div><span>Дистрибуция типа</span><b data-d8-type-percent="${key}">${pct(placementStats(p))}</b></div>
    <div><span>Наших / свободно</span><b data-d7-balance="${key}">${placementStats(p).ours} / ${placementStats(p).free}</b></div></div>
    <details class="d7-details"><summary>Разобрать остальные места: конкуренты, неизвестно, свободно</summary><div class="d7-formrow d7-mt">${[['other','Подтверждённый конкурент'],['unknown','Не удалось определить']].map(([k,l])=>`<label>${l}<input type="number" min="0" max="999" step="1" data-d7-count="${key}:${k}" value="${p[k]}"></label>`).join('')}</div><label class="d7-check"><input type="checkbox" data-d8-rest="${key}" ${p.restVerified?'checked':''}> Остальные места разобраны; остаток действительно свободен</label><p class="small muted">Без этой отметки все неразобранные места считаются неизвестными, а не свободными. Долю наших можно рассчитать и без разбора остальных мест.</p></details>
    <p class="d8-identification" data-d8-identified="${key}">По каталогу отмечено ${totalItems(p)} из ${placementStats(p).ours} наших образцов.</p>
    <div class="d8-products ${state.density}">${catalog.filter(m=>m.seg===state.seg).map(m=>modelCard(m,p.items.find(i=>i.id===m.id),key)).join('')}</div><p class="d8-no-matches" hidden>Поиск не нашёл модель в учебной подборке.</p>
   </fieldset>`).join('')}
   <div class="d7-formrow"><label>Добавить тип оборудования<select id="d7-mount">${mountRules[state.seg].filter(k=>!d.placements[k]).map(k=>opt(k,mounts[k],'')).join('')}</select></label>${btn('mount','Добавить оборудование')}</div>
   <details class="d7-details"><summary>Фотографии осмотра (необязательно)</summary><label>Фото, до 5 МБ<input type="file" accept="image/jpeg,image/png,image/webp" data-d7-photo></label><div id="d7-photo-preview"></div><p class="small muted">Только локальный просмотр в демо. Файл не отправляется и не сохраняется после перезагрузки.</p></details>
   <label class="d7-check"><input type="checkbox" data-d7-proof ${d.proof?'checked':''}> Я осмотрел точку и подтверждаю фактический состав. Это не план и не отгрузка.</label>
   <div id="d7-entry-validation" class="d7-validation" role="status">${validateDraft(d)||'Баланс корректен. Проверьте дату и подтвердите осмотр.'}</div>
   <div class="row">${btn('save-fact','Сохранить осмотр','','primary')}${btn('cancel-edit','Отменить черновик')}</div>
   <p class="small muted d7-mt">В демо изменения живут до перезагрузки страницы. План установки ведётся отдельно. При превышении мощности её нужно явно проверить и изменить, а не молча увеличить.</p>
  </div></section>`;
 }
 function validateDraft(d){
  for(const [k,p] of Object.entries(d.placements)){
   if(!mountRules[d.seg||state.seg].includes(k))return 'Этот тип оборудования не относится к категории.';
   if([p.cap,p.ours,p.other,p.unknown,...(p.units||[]),...p.items.flatMap(i=>[i.qty,i.rotate])].some(n=>!Number.isInteger(n)||n<0||n>999))return `${mounts[k]}: нужны целые числа от 0 до 999.`;
   if(variableMounts.includes(k)&&(!p.units?.length||p.units.reduce((s,n)=>s+n,0)!==p.cap))return `${mounts[k]}: уточните вместимость каждого оборудования.`;
   if(totalItems(p)>p.ours)return `${mounts[k]}: моделей отмечено больше, чем наших мест. Уточните наши места или количество моделей.`;
   if(p.cap-p.ours-p.other-p.unknown<0)return `${mounts[k]}: занято больше мест, чем измерено. Уточните мощность или состав.`;
   if(p.items.some(i=>i.rotate>i.qty))return `${mounts[k]}: обновляемых не может быть больше установленных.`;
  }
  if(!d.date||d.date>demoDate)return 'Укажите дату не позднее даты демо 08.10.2026.';
  return '';
 }
 function recs(){
  const list=[];
  for(const t of rows()){
   const m=metric(t),ps=Object.entries(t.fact[state.seg]||{});
   if(!m.known||isStale(t)){list.push({id:t.id+'-visit',t,kind:'visit',title:!m.known?'Сначала измерить витрину':'Обновить осмотр',reason:!m.known?'Мощность неизвестна. Нельзя обещать место или считать долю.':'Данные старше 30 дней. Перед рекомендацией модели нужен актуальный факт.',priority:4});continue}
   const unidentified=ps.reduce((s,[,p])=>s+Math.max(0,p.ours-totalItems(p)),0);
   if(unidentified){list.push({id:t.id+'-identify',t,kind:'visit',title:'Уточнить модели наших образцов',reason:`Наших мест ${m.ours}, но ${unidentified} образцов ещё не сопоставлены с каталогом. Доля известна, отсутствие конкретных моделей пока не подтверждено.`,priority:4});continue}
   if(m.unknown)list.push({id:t.id+'-verify',t,kind:'visit',title:'Уточнить неопределённые позиции',reason:`${m.unknown} мест не распознано. Не называем их конкурентами и не считаем свободными.`,priority:4});
   const present=new Set(ps.flatMap(([,p])=>p.items.filter(i=>i.qty>0).map(i=>i.id)));
   const rankedPs=[...ps].sort(([a],[b])=>Number(b===bestMount(state.seg))-Number(a===bestMount(state.seg)));
   for(const model of catalog.filter(m=>m.seg===state.seg&&m.units>0&&!present.has(m.id)).sort((a,b)=>b.units-a.units)){
    const target=rankedPs.find(([,p])=>placementStats(p).free>0),rotation=rankedPs.find(([,p])=>p.items.some(i=>i.rotate>0));
    const place=target||rotation;
    const goal=goals.find(g=>g.tt===t.id&&g.model===model.id);
    list.push({id:t.id+'-'+model.id,t,model,kind:!place?'capacity':!target?'replace':'place',mount:place?.[0],old:place&&!target?place[1].items.find(i=>i.rotate>0).id:null,
     title:`Продаётся, но не стоит: ${model.name}`,priority:0,
     reason:`В каталожном составе этой ТТ не отмечена. ${goal?`Есть адресная цель v${goal.version}. `:''}Демо-отгрузки ЮФО: ${model.units} шт. за 01.07–30.09.2026. ${!place?'Свободного места и подтверждённой замены нет. Сначала согласовать размещение.':!target?'Возможна замена нашего образца, отмеченного на обновление.':`Есть место: ${mounts[place[0]]}.`}`});
   }
   const best=ps.find(([k,p])=>k===bestMount(state.seg)&&placementStats(p).free>0);
   if(best)for(const model of catalog.filter(m=>m.seg===state.seg&&present.has(m.id))){
    const lower=ps.find(([k,p])=>k!==best[0]&&p.items.some(i=>i.id===model.id&&i.qty>0));
    if(lower&&!best[1].items.some(i=>i.id===model.id&&i.qty>0))list.push({id:t.id+'-upgrade-'+model.id,t,model,kind:'upgrade',mount:best[0],sourceMount:lower[0],priority:2,
     title:`Улучшить показ: ${model.name}`,reason:`Модель уже стоит: ${mounts[lower[0]]}. Есть место в формате «${mounts[best[0]]}». Предлагаем перенести образец, а не прибавить ещё один к дистрибуции. Числовой прирост продаж не рассчитан.`});
   }
  }
  return list.sort((a,b)=>a.priority-b.priority||(b.model?.units||0)-(a.model?.units||0));
 }
 function actionSummary(list){
  const grouped=[...new Map(rows().map(t=>[t.city,t.city])).keys()];
  return `<section class="card d7-mt d8-actions"><div class="cardhead"><h2>Что делать по территории</h2>${tag('Только область текущей роли')}</div><div class="d7-table"><table><thead><tr><th>Территория</th><th>Продаются, но не стоят</th><th>Улучшить показ</th><th>ТТ требуют данных</th><th>Ответственные</th><th></th></tr></thead><tbody>${grouped.map(city=>{
   const subset=list.filter(r=>r.t.city===city),missing=subset.filter(r=>r.priority===0);
   return `<tr><td><b>${esc(city)}</b></td><td>${missing.length} пар «ТТ × модель»<small>${new Set(missing.map(r=>r.t.id)).size} ТТ · не прогноз продаж</small></td><td>${subset.filter(r=>r.kind==='upgrade').length}</td><td>${new Set(subset.filter(r=>r.kind==='visit').map(r=>r.t.id)).size}</td><td>Менеджер + региональный<small>Контроль: РОП / директор</small></td><td>${btn('territory','Открыть',city)}</td></tr>`
  }).join('')||'<tr><td colspan="6">Нет доступных точек по фильтрам.</td></tr>'}</tbody></table></div></section>`;
 }
 function recommendations(){
  const list=recs();
  return `<div class="d7-notice"><b>Сначала то, что продаётся, но не стоит на ТТ</b><p>Сопоставляем спрос с фактическим каталогом каждой точки. Вначале отсутствующие модели по объёму спроса, затем качество размещения и уточнение данных. Демо-отгрузки ЮФО не являются розничными продажами конкретной ТТ; фото и названия взяты из каталога, показатели спроса и остатков учебные.</p></div>
  ${actionSummary(list)}
  <div class="d7-rec-list">${list.map(r=>{
   const existing=tasks.some(t=>t.recId===r.id||(t.tt===r.t.id&&t.model===r.model?.id&&t.stage<5));
   return `<article class="card d7-rec"><div class="d7-rec-rank">${r.model?modelPhoto(r.model):''}${r.kind==='visit'?'Проверить':r.kind==='upgrade'?'Качество показа':r.kind==='capacity'?'Согласовать место':r.kind==='replace'?'Замена':'Расширение'}</div><div><h2>${r.title}</h2><p class="sub">${esc(r.t.clientName)} · ${esc(r.t.address)}</p><p class="d7-reason">${r.reason}</p><div class="row">${tag(r.kind==='visit'?'Недостаточно данных':'Обоснованная гипотеза','warn')}${r.model?tag(r.model.stock?`Демо-остаток ${r.model.stock} шт.`:'Нет демо-остатка',r.model.stock?'green':'warn'):''}${r.mount?tag(mounts[r.mount],r.mount===bestMount(state.seg)?'green':''):''}</div>
   <details class="d7-details"><summary>Осмотр, спрос, совместимость</summary><p>Осмотр категории: ${observed(r.t)||'нет'}. Категория: ${segs[state.seg]}. В модели/исполнении, габаритах, размещении и условиях нужно убедиться до согласования. По этой ТТ нет подтверждённого sell-out: прибыль, окупаемость и прирост продаж не рассчитаны.</p><p>Матрица адресная: ТТ, категория, тип оборудования, цель и версия. Отсутствие модели в каталоге само по себе не означает вывод из ассортимента.</p></details></div>
   <div>${r.kind==='visit'||r.kind==='capacity'?btn('edit',r.kind==='capacity'?'Проверить места':'Открыть осмотр',r.t.id):existing?tag('Уже в плане','green'):btn('propose','В план',r.id,'primary')}<p class="small muted d7-mt">Менеджер: согласовать<br>Региональный: место и факт<br>РОП: срок и контроль</p></div></article>`;
  }).join('')||'<section class="card pad"><h2>Нет кандидатов по выбранным условиям</h2><p class="sub">Это не означает, что потенциала нет. Проверьте данные, категорию и фильтры.</p></section>'}</div>
  <section class="card pad d7-mt"><h2>Покрытие моделей по ТТ</h2><p class="sub">Показатель присутствия не заменяет долю занятых мест. В знаменателе только доступные ТТ с известной положительной мощностью категории.</p>
  <div class="d7-table"><table><thead><tr><th>Модель</th><th>Стоит / пригодных ТТ</th><th>Покрытие</th><th>Остальные ТТ</th></tr></thead><tbody>${catalog.filter(m=>m.seg===state.seg&&!m.retired).map(m=>{
   const eligible=rows().filter(t=>metric(t).known&&metric(t).cap>0),present=eligible.filter(t=>Object.values(t.fact[state.seg]).some(p=>p.items.some(i=>i.id===m.id&&i.qty>0))).length;
   return `<tr><td>${m.name}</td><td>${present} / ${eligible.length}</td><td>${eligible.length?Math.round(100*present/eligible.length)+'%':'Не рассчитано'}</td><td>${rows().length-eligible.length} вне знаменателя</td></tr>`
  }).join('')}</tbody></table></div></section>`;
 }
 const canAdvance=task=>{
  const roles=[['manager','regional'],['manager','regional'],['regional'],['rop'],['director']];
  return roles[task.stage]?.includes(prototypeRole)||false;
 };
 function plan(){
  const ids=new Set(rows().map(t=>t.id)),visible=tasks.filter(t=>ids.has(t.tt)&&byModel(t.model)?.seg===state.seg);
  return `<div class="d7-notice"><b>Отгрузка ещё не установка</b><p>Доля меняется после проверки установки на ТТ. Закрытие обязательства требует проверки РОПа и директора. Право на новые витринные скидки контролируется по холдингу; применение в 1С здесь не подключено.</p></div>
  ${visible.map(task=>{
   const t=scoped().find(t=>t.id===task.tt),model=byModel(task.model);
   return `<section class="card d7-task"><div class="row between"><div><span class="small muted">${task.id} · срок ${task.due}</span><h2>${model.name} · ${task.qty} образец</h2><p class="sub">${esc(t.clientName)} · ${esc(t.address)} · ${mounts[task.mount]}</p></div>${tag(stages[task.stage],task.stage===5?'green':'warn')}</div>
   <ol class="d7-stages">${stages.map((s,i)=>`<li class="${i<=task.stage?'done':''}">${i+1}. ${s}</li>`).join('')}</ol>
   <p>${esc(task.comment)}</p><p class="sub">Ответственный: ${esc(task.owner)}. ${task.stage<3?'Образец ещё не добавлен в физический факт.':'Проверенная установка включена в физический факт.'}</p>
   ${task.stage===1&&canAdvance(task)?`<label class="d7-check"><input type="checkbox" data-d7-task-proof="${task.id}" ${task.evidence?'checked':''}> Использовать учебное подтверждение фото клиента (не настоящее фото)</label>`:''}
   <div class="row d7-mt">${task.stage<5?(canAdvance(task)?btn('advance',task.kind==='upgrade'&&task.stage===0?'Передано к перемещению':stages[task.stage+1],task.id,'primary'):`<span class="tag">Следующий шаг: ${['менеджер / региональный','менеджер / региональный','региональный','РОП','директор'][task.stage]}</span>`):tag('Обязательство закрыто','green')}${btn('task-tt','Открыть ТТ',t.id)}</div>
   <details class="d7-details"><summary>Статус витринной скидки холдинга</summary><p>${!['director','admin'].includes(prototypeRole)?'Полный статус холдинга не раскрывается из частичной области. Виден статус только доступных обязательств.':tasks.some(x=>x.stage<5&&tt.find(y=>y.id===x.tt)?.holding===t.holding)?'Есть открытое обязательство. Новая витринная скидка требует завершения согласованной цепочки.':'В учебном реестре открытых обязательств нет.'} Обычные продажи этим правилом не блокируются. Решение и применение в 1С не подтверждены.</p></details></section>`;
  }).join('')||'<section class="card pad"><h2>В плане пока нет установок</h2><p class="sub">Добавьте предложение из рекомендаций. Оно не изменит факт витрины.</p>'+btn('tab','Посмотреть рекомендации','recommend')+'</section>'}
  <details class="d7-details"><summary>История действий в этой демонстрации (${audit.length})</summary>${audit.filter(a=>ids.has(a.tt)).map(a=>`<p>${esc(a.text)} · ${esc(a.role)}</p>`).join('')||'<p>Новых действий пока нет.</p>'}</details>`;
 }
 function matrix(){
  const rs=rows(),ids=new Set(rs.map(t=>t.id)),list=goals.filter(g=>ids.has(g.tt)&&byModel(g.model).seg===state.seg);
  const mayEdit=['rop','director'].includes(prototypeRole);
  return `<div class="d7-notice"><b>Адресная матрица, а не одинаковый набор для всех</b><p>Цель относится к конкретной ТТ, модели и типу размещения. РОП или директор может изменить учебную цель; источник полномочий и порядок реального утверждения ещё нужно согласовать.</p></div>
  <section class="card"><div class="cardhead"><h2>Цели по ассортименту</h2>${tag('Учебные версии')}</div><div class="d7-table"><table><thead><tr><th>ТТ / модель</th><th>Размещение</th><th>Цель / факт</th><th>Дефицит</th><th>Срок / версия</th></tr></thead><tbody>${list.map(g=>{
   const t=rs.find(t=>t.id===g.tt),p=t.fact[state.seg][g.mount],fact=p?.items.find(i=>i.id===g.model)?.qty||0;
   return `<tr><td><b>${esc(t.address)}</b><small>${byModel(g.model).name}</small></td><td>${mounts[g.mount]}</td><td>${g.qty} / ${p?fact:'нет осмотра'}</td><td>${p?Math.max(0,g.qty-fact):'неизвестен'}</td><td>${g.due}<small>v${g.version}</small></td></tr>`
  }).join('')||'<tr><td colspan="5">Адресных целей по выбранным условиям нет. Это не означает обязательную нулевую матрицу.</td></tr>'}</tbody></table></div></section>
  ${mayEdit?`<section class="card pad d7-mt"><h2>Задать учебную цель</h2><div class="d7-formrow d7-mt"><label class="d7-wide">Торговая точка<select id="d7-goal-tt">${rs.map(t=>opt(t.id,`${t.clientName} · ${t.address}`,'')).join('')}</select></label><label>Модель<select id="d7-goal-model">${catalog.filter(m=>m.seg===state.seg).map(m=>opt(m.id,m.name,'')).join('')}</select></label><label>Размещение<select id="d7-goal-mount">${mountRules[state.seg].map(k=>opt(k,mounts[k],'')).join('')}</select></label><label>Количество<input id="d7-goal-qty" type="number" min="1" max="99" value="1"></label><label>Срок<input id="d7-goal-due" type="date" min="${demoDate}" value="2026-10-22"></label></div>${btn('goal-save','Сохранить версию цели','','primary')}<p class="small muted d7-mt">Изменяет только адресную цель. Не увеличивает физический факт и не создаёт отгрузку.</p></section>`:'<section class="card pad d7-mt"><p>Менеджер и региональный видят цели, но не меняют утверждённую версию в этом сценарии. Изменение состава согласуется с руководителем.</p></section>'}`;
 }
 function method(){
  return `<div class="d7-split"><section class="card pad"><h2>Что именно считаем</h2><dl class="d7-dl">
   <dt>Доля наших мест</dt><dd>Наши установленные места / все измеренные места × 100%. Считается отдельно по МК, ВХ и фурнитуре.</dd>
   <dt>Клиент и холдинг</dt><dd>Общая доля: сумма наших мест / сумма всех мест уникальных TT GUID. Среднее процентов ТТ дополнительно показано отдельно, каждая обследованная точка имеет одинаковый вес.</dd>
   <dt>Оборудование и качество</dt><dd>МК: портал, книжка, копытца без крепления. ВХ: портал, куб/квадрат, без крепления. Фурнитура: фирменный стенд, щит с ручками. Портал и фирменный стенд предпочтительны, но не умножают процент дистрибуции.</dd>
   <dt>Потенциал расширения</dt><dd>Подтверждённые свободные места. Конкуренты и неопределённые позиции показываются отдельно, без обещания их занять.</dd>
   <dt>Ротация</dt><dd>Наши установленные образцы с подтверждённым основанием обновления. Подмножество наших мест, не дополнительные места.</dd>
   <dt>Ноль и неизвестно</dt><dd>Нет осмотра: неизвестно. Измерено 0 мест: категория отсутствует, процент не определён. Есть места, наших 0: доля 0%.</dd>
   <dt>Актуальность</dt><dd>30 дней в этом макете: предлагаемое правило. Старый факт виден с предупреждением; рекомендации сначала требуют осмотра.</dd></dl></section>
   <section class="card pad"><h2>Роли и ответственность</h2><dl class="d7-dl"><dt>Менеджер</dt><dd>Видит витрины своих клиентов, согласует модели, наличие и отгрузку. Не подтверждает финальное закрытие.</dd><dt>Региональный</dt><dd>Осматривает закреплённые ТТ, вносит размещение, согласует место, проверяет установку.</dd><dt>РОП</dt><dd>Контролирует команду, сроки, качество факта и проверяет обязательства после регионального.</dd><dt>Директор</dt><dd>Видит общую картину и завершает согласованную цепочку. Финальный шаг не подменяет проверку факта.</dd></dl><p class="small muted">В демо роли переключаются вручную. В рабочем ЛК сервер проверяет scope, разрешения и переходы статусов.</p></section></div>
   <section class="card pad d7-mt"><h2>Что нужно для рекомендаций на реальных данных</h2><div class="d7-table"><table><thead><tr><th>Слой</th><th>Источник</th><th>Без него</th></tr></thead><tbody>
   <tr><td>Физический факт</td><td>Осмотр ТТ, дата, автор, оборудование, модели / SKU, доказательства</td><td>Сначала измерить</td></tr>
   <tr><td>Адресная матрица</td><td>Утверждённые цели по ТТ / категории / оборудованию, версия</td><td>Кандидат, не нарушение обязательного стандарта</td></tr>
   <tr><td>Спрос</td><td>Отгрузки 1С с периодом, уровнем атрибуции, возвратами</td><td>Нет утверждения «хорошо продаётся»</td></tr>
   <tr><td>Возможность установки</td><td>Свободное место, габариты, остатки, срок, условия</td><td>Проверить, не автозаказ</td></tr>
   <tr><td>Финансовый эффект ТТ</td><td>Продажи ТТ, маржа, затраты, надёжная атрибуция</td><td>Не рассчитан, не распределять отгрузки холдинга</td></tr></tbody></table></div></section>`;
 }
 function paint(){
  const target=document.querySelector('.screenbody');if(!target)return;
  const simple=['overview','performance'].includes(state.tab);
  const demo=simple?window.DistributionDemoScale?.get(state.demo):null;
  const available=demo?demo.points.filter(t=>prototypeRole==='manager'?t.manager===roleProfile().name:prototypeRole==='rop'?t.rop===roleProfile().name:prototypeRole==='regional'?t.regional===roleProfile().name:true):scoped();
  const denied=state.level!=='all'&&state.object&&!available.some(t=>(state.level==='tt'?t.id:state.level==='client'?t.client:t.holding)===state.object);
  const point=state.level==='tt'?available.find(t=>t.id===state.object):null;
  const clientId=point?.client||(state.level==='client'?state.object:null);
  const performance=()=>window.DistributionPerformance.render({
   points:available.filter(t=>state.level==='all'||(state.level==='tt'?t.id===state.object:state.level==='client'?t.client===state.object:t.holding===state.object)),
   available,catalog:demo?.catalog||catalog,seg:state.seg,clientId,pointId:point?.id||'',role:prototypeRole,navigate,
   scenario:state.demo||'small',cacheToken:demo?.key,
   setScenario:key=>{if(['small','medium','large'].includes(key))navigate({demo:key,level:'all',object:'',city:'',q:''})}
  });
  const view={overview:performance,performance,entry,recommend:recommendations,plan,matrix,method}[state.tab];
  target.innerHTML=`<div class="d7 ${simple?'ds-simple':''}">${simple?'':state.tab==='entry'&&state.draft?`<div class="d10-back">${btn('tab','← К витрине','overview')}</div>`:`<div class="d7-topline"><span>Учебный срез · 08.10.2026 · ${esc(roleLabel())}</span><span>Изменения только до перезагрузки</span></div>
   <nav class="d7-tabs" aria-label="Дистрибуция">${[['overview','Обзор витрин'],['performance','Продажа и конверсия'],['entry','Внести осмотр'],['recommend','Рекомендации'],['plan','План установки'],['matrix','Адресные цели'],['method','Правила расчёта']].map(([v,l])=>`<button data-d7="tab" data-value="${v}" class="${state.tab===v?'active':''}" aria-current="${state.tab===v?'page':'false'}">${l}</button>`).join('')}</nav>
   ${toolbar()}`}${simple?'':`<p class="d7-scope">${['director','admin'].includes(prototypeRole)?'Вся учебная область.':'Только доступная часть клиентской базы.'} Закрытые ТТ исключены.</p>`}
   ${state.message?`<div class="d7-success" role="status">${esc(state.message)}</div>`:''}${state.error?`<div class="d7-error" role="alert">${esc(state.error)}</div>`:''}
   ${denied?'<section class="card pad"><h2>Объект вне области роли</h2><p class="sub">Прямая ссылка не расширяет доступ. Выберите доступную точку или сбросьте фильтры.</p></section>':view()}</div>`;
  filterCatalog();
 }
 function filterCatalog(){
  if(state.tab!=='entry')return;
  const d=state.draft;
  if(d?.categories){
   let n=0;document.querySelectorAll('.d10-product').forEach(c=>{
    const m=byModel(c.dataset.model),p=d.placements[d.mount];
    const selected=p?.items.some(i=>i.id===m.id&&i.qty>0);
    const show=(!d.onlySelected||selected)&&(!d.finish||m.finish===d.finish)&&`${m.name} ${m.finish} ${m.sourceId}`.toLowerCase().includes(state.catalogQ.toLowerCase());
    c.hidden=!show;if(show)n++;
   });
   const empty=document.querySelector('.d10-no-matches');if(empty)empty.hidden=n>0;
   return;
  }
  document.querySelectorAll('.d7-fieldset').forEach(f=>{
   let n=0;f.querySelectorAll('.d8-product').forEach(c=>{const show=c.querySelector('h3').textContent.toLowerCase().includes(state.catalogQ.toLowerCase());c.hidden=!show;if(show)n++});
   const empty=f.querySelector('.d8-no-matches');if(empty)empty.hidden=n>0;
  });
 }
 document.addEventListener('input',e=>{if(e.target.id==='d8-catalog-search'){state.catalogQ=e.target.value;filterCatalog()}});
 document.addEventListener('error',e=>{if(e.target.matches?.('.d8-photo img,.d8-gallery img')){e.target.hidden=true;const p=e.target.parentElement;const span=document.createElement('span');span.textContent='Фото недоступно';p.append(span)}},true);
 function log(t,text){audit.unshift({tt:t,text,role:roleLabel()})}
 function saveFact(){
  const d=state.draft,t=currentTT();if(!d||!t)return;
  if(d.categories){
   const edited=Object.entries(d.categories).filter(([,ps])=>Object.values(ps).some(p=>p.reviewed||p.edited));
   let err=!edited.length?'Подтвердите состав хотя бы одного оборудования.':'';
   for(const [seg,ps] of edited)for(const [key,p] of Object.entries(ps)){
    if(!p.reviewed){err=`${segs[seg]} · ${mounts[key]}: проверьте и подтвердите все типы оборудования этой категории.`;break}
    if(inspectionError(p)){err=inspectionError(p);break}
   }
   err=err||(!d.date||d.date>demoDate?'Проверьте дату осмотра.':'')||(t.revision!==d.revision?'Данные уже изменились. Откройте новый осмотр.':'');
   if(err){state.error=err;paint();document.querySelector('.d7-error')?.scrollIntoView({block:'nearest'});return}
   for(const [seg,ps] of edited){
    t.fact[seg]=Object.fromEntries(Object.entries(ps).map(([k,p])=>{
     const b=inspectionBalance(p);return [k,{cap:p.cap,ours:b.ours,other:b.other,unknown:0,restVerified:true,items:structuredClone(p.items),...(p.units?{units:[...p.units]}:{})}];
    }));t.fact.dates[seg]=d.date;
    t.capacitySetup||={};t.capacitySetup[seg]=Object.fromEntries(Object.entries(ps).map(([k,p])=>[k,{cap:p.cap,emptyPlaces:p.emptyPlaces,...(p.units?{units:[...p.units]}:{})}]));
   }
   t.revision++;log(t.id,`Осмотр категорий: ${edited.map(([s])=>segs[s]).join(', ')}.`);
   state.draft=null;state.tab='overview';state.error='';write();state.message='Осмотр сохранён в демо. Наши модели, пустые и не наши места пересчитаны; рабочий ЛК не изменён.';render();return;
  }
  const err=validateDraft(d)||(!d.proof?'Подтвердите фактический осмотр.':'')||(t.revision!==d.revision?'Данные уже изменены. Откройте новый осмотр.':'');
  if(err){state.error=err;paint();return}
  t.fact[d.seg]=structuredClone(d.placements);t.fact.dates[d.seg]=d.date;t.revision++;
  log(t.id,`Осмотр ${d.seg}, ревизия ${t.revision}: ${d.note||'состав проверен'}`);
  state.draft=null;state.tab='overview';write();state.message='Осмотр сохранён в демо. Доля пересчитана из того же физического факта; в ЛК и 1С ничего не отправлено.';state.error='';render();
 }
 function advance(id){
  const task=tasks.find(t=>t.id===id);if(!task||!scoped().some(t=>t.id===task.tt)||!canAdvance(task))return;
  if(task.stage===1&&!task.evidence){state.error='Сначала отметьте учебное подтверждение фото клиента.';paint();return}
  if(task.stage===2){
   const t=tt.find(t=>t.id===task.tt),seg=byModel(task.model).seg,p=t.fact[seg][task.mount];
   if(!p){state.error='Не найдено размещение. Сначала внесите осмотр.';paint();return}
   if(task.qty!==1||p.items.some(i=>i.id===task.model&&i.qty>0)){state.error='Модель уже стоит на этой витрине или в плане указано больше одного образца. Уточните план без дублирования модели.';paint();return}
   if(task.kind==='replace'){
    const old=p.items.find(i=>i.id===task.old);
    if(!old||old.qty<task.qty||old.rotate<task.qty){state.error='Состав изменился. Пересогласуйте замену.';paint();return}
    old.qty-=task.qty;old.rotate-=task.qty;
   }else if(placementStats(p).free<task.qty){state.error='Свободного места уже нет. Уточните осмотр и план; мощность автоматически не увеличивается.';paint();return}
   if(task.kind==='upgrade'){
    const source=t.fact[seg][task.sourceMount],old=source?.items.find(i=>i.id===task.model);
    if(!source||!old||old.qty<task.qty){state.error='Исходный образец больше не найден. Уточните осмотр.';paint();return}
    old.qty-=task.qty;old.rotate=Math.min(old.rotate,old.qty);source.ours-=task.qty;
   }
   if(task.kind!=='replace')p.ours+=task.qty;
   const item=p.items.find(i=>i.id===task.model);
   if(item)item.qty+=task.qty;else p.items.push({id:task.model,qty:task.qty,rotate:0});
   t.revision++;
  }
  task.stage++;log(task.tt,`${task.id}: ${stages[task.stage]}`);announce(task.stage===3?'Установка проверена. Физический факт и доля обновлены; обязательство ещё требует РОПа и директора.':`Учебный статус: ${stages[task.stage]}. Внешние системы не изменены.`);
 }
 const oldRender=render;
 render=function(){
  oldRender();
  const active=['showcase','distribution','recommendations','installation'].includes(current);
  document.body.classList.toggle('d7-active',active);
  if(active){read();document.querySelector('.r-other-example')?.remove();document.querySelector('.heading h1').textContent='Дистрибуция и конверсия';document.querySelector('.heading .sub').textContent='Что стоит у клиента. Что продаётся. Что нужно проверить.';paint()}
 };
 add('showcase','Дистрибуция и витрина','Факт, рекомендации и установка','Региональный','showcase','','');
 const oldNav=roleNav;roleNav=function(items){const r=oldNav(items);r.splice(3,0,['showcase','Дистрибуция','panels-top-left','showcase']);return r};
 const oldSwitch=switchPrototypeRole;switchPrototypeRole=function(role){
  if(!['showcase','distribution','recommendations','installation'].includes(current)){oldSwitch(role);return}
  if(!Object.hasOwn(roleProfiles,role))return;prototypeRole=role;state.draft=null;state.message='';state.error='';state.level='all';state.object='';state.city='';write();render();
 };
 document.addEventListener('change',e=>{
  if(!e.target.closest('.d7'))return;
  const el=e.target,key=el.dataset.d7Field;
  if(el.hasAttribute('data-d9-client')){state.draft=null;navigate({level:el.value?'client':'all',object:el.value,tab:'overview',q:'',city:'',fresh:'all'});return}
  if(el.id==='d8-catalog-search')return;
  if(key){state[key]=el.value;if(key==='level'){state.object='';state.group='tt'}if(['object','seg','level'].includes(key))state.draft=null;state.message='';state.error='';write();render();return}
  if(el.dataset.d7TaskProof){const t=tasks.find(t=>t.id===el.dataset.d7TaskProof);if(t)t.evidence=el.checked;return}
  const d=state.draft;if(!d)return;
  if(el.dataset.d12Field){
   const [seg,key,field]=el.dataset.d12Field.split(':'),p=d.capacityForm[seg][key];
   d.capacityFormDirty=true;
   if(field==='units'){
    p.units=el.value;p.present=el.value.trim()!=='';p.cap=p.present?(/^\s*\d+\s*(?:\+\s*\d+\s*)*$/.test(el.value)?el.value.split('+').reduce((s,n)=>s+Number(n),0):NaN):null;
   }else if(field==='cap'){p.cap=el.value===''?null:Number(el.value);p.present=el.value!==''}
   else p.emptyPlaces=el.value===''?0:Number(el.value);
   const total=document.querySelector(`[data-d12-total="${seg}:${key}"]`);total.textContent=p.cap===null?'—':Number.isFinite(p.cap)?p.cap:'Проверьте';
   document.getElementById('d12-validation').textContent=capacityFormError();return;
  }
  if(d.categories){
   if(el.hasAttribute('data-d10-finish')){d.finish=el.value;filterCatalog();return}
   if(el.hasAttribute('data-d10-selected')){d.onlySelected=el.value==='selected';filterCatalog();return}
   d.dirty=true;
   if(el.dataset.d7Draft){d[el.dataset.d7Draft]=el.value;return}
   const p=d.placements[d.mount];if(!p)return;
   p.reviewed=false;p.edited=true;
   if(el.hasAttribute('data-d10-empty'))p.emptyPlaces=el.value===''?0:Number(el.value);
   if(el.dataset.d7Count){const [,key]=el.dataset.d7Count.split(':');p[key]=el.value===''?NaN:Number(el.value)}
   if(el.dataset.d8Unit){const [,i]=el.dataset.d8Unit.split(':');p.units[i]=el.value===''?NaN:Number(el.value);p.cap=p.units.reduce((s,n)=>s+n,0);document.querySelector('[data-d7-count$=":cap"]').value=Number.isFinite(p.cap)?p.cap:''}
   refreshInspection();
   if(inspectionBalance(p).other<0)document.getElementById('d10-warning')?.scrollIntoView({block:'nearest'});
   return;
  }
  d.dirty=true;
  if(el.dataset.d7Draft)d[el.dataset.d7Draft]=el.value;
  if(el.hasAttribute('data-d7-proof'))d.proof=el.checked;
  if(el.dataset.d8Rest)d.placements[el.dataset.d8Rest].restVerified=el.checked;
  if(el.dataset.d8Unit){
   const [mount,index]=el.dataset.d8Unit.split(':'),p=d.placements[mount];
   p.units[index]=el.value===''?NaN:Number(el.value);p.cap=p.units.reduce((s,n)=>s+n,0);
   document.querySelector(`[data-d7-count="${mount}:cap"]`).value=Number.isFinite(p.cap)?p.cap:'';
  }
  if(el.dataset.d7Count){const [mount,k]=el.dataset.d7Count.split(':');d.placements[mount][k]=el.value===''?NaN:Number(el.value)}
  if(el.dataset.d7Item){
   const [mount,id,k]=el.dataset.d7Item.split(':'),p=d.placements[mount];let i=p.items.find(i=>i.id===id);
   if(!i){i={id,qty:0,rotate:0};p.items.push(i)}i[k]=el.value===''?NaN:Number(el.value);
  }
  if(el.hasAttribute('data-d7-photo')){
   const f=el.files[0],out=document.getElementById('d7-photo-preview');out.textContent='';
   if(f){if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>5*1024*1024)out.textContent='Нужен JPG, PNG или WebP до 5 МБ.';else{const img=document.createElement('img');img.alt='Локальный просмотр фотографии осмотра';const u=URL.createObjectURL(f);img.onload=()=>URL.revokeObjectURL(u);img.src=u;out.append(img)}}
  }
  document.querySelectorAll('[data-d7-balance]').forEach(n=>{const p=d.placements[n.dataset.d7Balance];n.textContent=`${placementStats(p).ours} / ${placementStats(p).free}`});
  document.querySelectorAll('[data-d8-type-percent]').forEach(n=>n.textContent=pct(placementStats(d.placements[n.dataset.d8TypePercent])));
  document.querySelectorAll('[data-d8-identified]').forEach(n=>{const p=d.placements[n.dataset.d8Identified];n.textContent=`По каталогу отмечено ${totalItems(p)} из ${p.ours} наших образцов.`});
  document.querySelectorAll('[data-d7-item$=":qty"]').forEach(n=>n.closest('.d8-product').classList.toggle('selected',Number(n.value)>0));
  const validation=document.getElementById('d7-entry-validation');if(validation)validation.textContent=validateDraft(d)||'Баланс корректен. Можно сохранить подтверждённый осмотр.';
 });
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-d7]');if(!b)return;
  const a=b.dataset.d7,v=b.dataset.value;
  if(a==='edit-capacities'){beginEdit(v);openAllCapacities();return}
  if(a==='capacity-open'){openAllCapacities();return}
  if(a==='capacity-save'){saveAllCapacities();return}
  if(a==='capacity-cancel'){state.draft.capacityFormDirty=false;state.draft.step=state.draft.beforeCapacityStep||1;state.error='';paint();return}
  if(a==='inspection-category'){chooseInspectionCategory(v);return}
  if(a==='inspection-mount'){chooseInspectionMount(v);return}
  if(a==='inspection-back'){state.draft.step=2;paint();document.querySelector('.d10-capacity')?.scrollIntoView({block:'nearest'});return}
  if(a==='inspection-filter-reset'){state.catalogQ='';state.draft.finish='';state.draft.onlySelected=false;paint();return}
  if(a==='inspection-catalog'){
   const d=state.draft,p=d?.placements[d.mount];if(!p)return;
   if(!Number.isInteger(p.cap)||p.cap<0||!Number.isInteger(p.emptyPlaces)||p.emptyPlaces<0||p.emptyPlaces>p.cap){state.error='Проверьте общее количество и пустые места.';paint();return}
   d.step=3;state.error='';paint();document.querySelector('.d10-catalog-head')?.scrollIntoView({block:'nearest'});return;
  }
  if(a==='inspection-toggle'){
   const d=state.draft,p=d?.placements[d.mount];if(!p)return;
   const id=v;if(byModel(id)?.seg!==d.seg)return;
   let i=p.items.find(i=>i.id===id);if(!i){i={id,qty:0,rotate:0};p.items.push(i)}
   i.qty=i.qty>0?0:1;i.rotate=Math.min(i.rotate,i.qty);
   p.reviewed=false;p.edited=true;d.dirty=true;paint();
   if(inspectionBalance(p).other<0)document.getElementById('d10-warning')?.scrollIntoView({block:'nearest'});
   return;
  }
  if(a==='inspection-confirm'){
   const d=state.draft,p=d?.placements[d.mount];if(!p)return;
   const err=inspectionError(p);if(err){state.error=err;paint();document.getElementById('d10-warning')?.scrollIntoView({block:'nearest'});return}
   p.reviewed=true;p.edited=true;d.dirty=true;state.error='';paint();return;
  }
  if(a==='client-card'){baseOpen(v);return}
  if(a==='category'){state.draft=null;navigate({seg:v});return}
  if(a==='focus-view'){navigate({focusview:v});return}
  if(a==='focus-client'){navigate({level:'client',object:v,tab:'overview',q:'',city:'',fresh:'all'});return}
  if(a==='focus-tt'){navigate({level:'tt',object:v,tab:'overview',q:'',city:'',fresh:'all'});return}
  if(a==='focus-home'){navigate({level:'all',object:'',tab:'overview',q:'',city:'',fresh:'all'});return}
  if(a==='density'){state.density=v;write();paint();return}
  if(a==='photo'){
   const [id,index='0']=v.split(':'),m=byModel(id);if(!m)return;
   const dialog=document.getElementById('dialog');
   dialog.innerHTML=`<h2>${esc(m.name)}</h2><div class="d8-gallery"><img src="${esc(m.images[Number(index)]||m.images[0])}" alt="${esc(m.name)}"></div><div class="row">${m.images.map((_,i)=>btn('photo','Фото '+(i+1),`${id}:${i}`)).join('')}</div><p>Каталожное фото, не фотография установки на ТТ.</p><p><a href="${esc(m.sourceUrl)}" target="_blank" rel="noopener noreferrer">Карточка на tandoor.ru</a></p><button data-close>Закрыть</button>`;
   if(!dialog.open)dialog.showModal();return;
  }
  if(a==='unit-add'){
   const p=state.draft?.placements[v];if(!p||!variableMounts.includes(v))return;
   p.units=[...(p.units||[p.cap]),0];p.reviewed=false;p.edited=true;state.draft.dirty=true;paint();return;
  }
  if(a==='territory'){navigate({city:v,level:'all',object:'',group:'tt'});return}
  if(a==='tab'){navigate({tab:v});return}
  if(a==='reset'){state.draft=null;navigate({level:'all',object:'',q:'',city:'',fresh:'all',group:'tt'});return}
  if(a==='drill'){const [level,object]=v.split(':');navigate(level==='city'?{level:'all',object:'',city:object,group:'tt'}:{level,object,group:'tt'});return}
  if(a==='edit'){beginEdit(v);return}
  if(a==='task-tt'){navigate({tab:'overview',level:'tt',object:v});return}
  if(a==='mount'){
   const key=document.getElementById('d7-mount')?.value;if(key&&state.draft&&mountRules[state.seg].includes(key)&&!state.draft.placements[key]){state.draft.placements[key]=initial(0,0,0,[]);if(variableMounts.includes(key))state.draft.placements[key].units=[0];state.draft.dirty=true;paint()}return;
  }
  if(a==='cancel-edit'){state.draft=null;navigate({tab:'overview'});return}
  if(a==='save-fact'){saveFact();return}
  if(a==='advance'){advance(v);return}
  if(a==='goal-save'){
   if(!['rop','director'].includes(prototypeRole))return;
   const id=document.getElementById('d7-goal-tt').value,model=document.getElementById('d7-goal-model').value,mount=document.getElementById('d7-goal-mount').value,qty=Number(document.getElementById('d7-goal-qty').value),due=document.getElementById('d7-goal-due').value;
   if(!rows().some(t=>t.id===id)||!mountRules[state.seg].includes(mount)||!Number.isInteger(qty)||qty<1||qty>99||!due||due<demoDate){state.error='Выберите доступную ТТ, количество от 1 до 99 и корректный срок.';paint();return}
   let g=goals.find(g=>g.tt===id&&g.model===model&&g.mount===mount);
   if(g){g.qty=qty;g.due=due;g.version++}else goals.push({tt:id,model,mount,qty,due,version:1});
   log(id,`Изменена адресная цель: ${byModel(model).name}, ${qty} шт.`);
   announce('Учебная версия цели сохранена. Физический факт не изменился.');return;
  }
  if(a==='propose'){
   const r=recs().find(r=>r.id===v);if(!r||tasks.some(t=>t.recId===r.id))return;
   const dialog=document.getElementById('dialog');state.recommendation=r;
   dialog.innerHTML=`<h2>Согласовать предложение</h2><p>${esc(r.title)} · ${esc(r.t.address)}</p><p>Один образец · ${mounts[r.mount]}. Это создаёт только учебный план, не заказ и не физический факт.</p><label class="d7-check"><input id="d7-agreed" type="checkbox"> Место, модель, условия и наличие согласованы в учебном сценарии</label><label>Срок<input id="d7-due" type="date" min="${demoDate}" value="2026-10-22"></label><p id="d7-proposal-error" role="alert"></p><div class="row d7-mt">${btn('confirm-proposal','Добавить в план','','primary')}<button data-close>Отмена</button></div>`;dialog.showModal();return;
  }
  if(a==='confirm-proposal'){
   const r=state.recommendation,due=document.getElementById('d7-due').value;
   if(!document.getElementById('d7-agreed').checked||!due||due<demoDate){document.getElementById('d7-proposal-error').textContent='Подтвердите согласование и укажите срок не раньше 08.10.2026.';return}
   if(!r||!scoped().some(t=>t.id===r.t.id)||tasks.some(t=>t.recId===r.id))return;
   tasks.push({id:`V-${String(15+tasks.length-1).padStart(3,'0')}`,tt:r.t.id,model:r.model.id,mount:r.mount,sourceMount:r.sourceMount,old:r.old,qty:1,stage:0,kind:r.kind,due,owner:'Менеджер + региональный',recId:r.id,comment:r.kind==='upgrade'?`Перемещение образца: ${mounts[r.sourceMount]} → ${mounts[r.mount]}. Отдельная отгрузка не требуется; в демо этап передачи используется для внутреннего перемещения.`:'Адресная цель согласована в демонстрации. Проверить комплектацию до заказа.'});
   log(r.t.id,`Предложение ${r.model.name} добавлено в план`);
   document.getElementById('dialog').close();state.tab='plan';write();state.message='Предложение в учебном плане. Физическая доля не изменилась.';render();
  }
 });
 let leaving=false,pendingLeave=null;
 function confirmLeave(action){
  pendingLeave=action;
  const dialog=document.getElementById('dialog');
  dialog.innerHTML='<h2>Есть несохранённый осмотр</h2><p>Черновик ещё не меняет факт витрины. Можно остаться, сохранить его кнопкой «Сохранить осмотр» или явно отбросить изменения.</p><div class="row"><button id="d7-keep-draft">Продолжить осмотр</button><button id="d7-discard-draft">Отбросить и перейти</button></div>';
  dialog.showModal();
  document.getElementById('d7-keep-draft').onclick=()=>{pendingLeave=null;dialog.close()};
  document.getElementById('d7-discard-draft').onclick=()=>{state.draft=null;dialog.close();leaving=true;pendingLeave?.();pendingLeave=null;leaving=false};
 }
 document.addEventListener('click',e=>{
  if(leaving||(!state.draft?.dirty&&!state.draft?.capacityFormDirty))return;
  const b=e.target.closest('button');
  if(!b||b.closest('#dialog'))return;
  const a=b.dataset.d7;
  if(a==='capacity-cancel'&&state.draft.capacityFormDirty){
   e.stopImmediatePropagation();e.preventDefault();
   const d=state.draft;
   confirmLeave(()=>{state.draft=d;d.capacityFormDirty=false;b.click()});return;
  }
  if(b.dataset.go||['tab','reset','drill','edit','cancel-edit','category','focus-client','focus-tt','focus-home','client-card'].includes(a)){
   e.stopImmediatePropagation();e.preventDefault();confirmLeave(()=>b.click());
  }
 },true);
 document.addEventListener('change',e=>{
  if(leaving||(!state.draft?.dirty&&!state.draft?.capacityFormDirty))return;
  const el=e.target,k=el.dataset.d7Field;
  if(['level','object','seg'].includes(k)||['prototype-role','screen-select'].includes(el.id)){
   const value=el.value,old=k?state[k]:el.id==='prototype-role'?prototypeRole:current;
   e.stopImmediatePropagation();el.value=old;
   confirmLeave(()=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))});
  }
 },true);
 window.distributionPrototype={aggregate,metric,placementStats,validateDraft,getState:()=>structuredClone(state),getFacts:()=>structuredClone(tt),getTasks:()=>structuredClone(tasks)};
 if(['showcase','distribution','recommendations','installation'].includes(location.hash.slice(1).split('?')[0]))current=location.hash.slice(1).split('?')[0];
 render();
})();
