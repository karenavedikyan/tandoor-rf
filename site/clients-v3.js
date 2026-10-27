/* Isolated visual prototype. Synthetic records only. No API, storage or production writes. */
const baseTeams=[
 {id:'volkova',name:'Елена Волкова',region:'Краснодарский край · Адыгея',managers:['Алексей Морозов','Анна Белова']},
 {id:'orlov',name:'Дмитрий Орлов',region:'Ростовская область · Ставрополье',managers:['Павел Лебедев','Ольга Миронова']}
];
const baseSeed=[
 ['Южный дом','Краснодар','ТОП-150','volkova','Алексей Морозов',2,'Подтверждено','Южный дом','Северная, 100'],
 ['Дверной квартал','Армавир','ТОП-350','volkova','Алексей Морозов',1,'Подтверждено','Дверной квартал','Ленина, 24'],
 ['Интерьер Юга','Майкоп','ТОП-500','volkova','Анна Белова',2,'Подтверждено','Интерьер Юга','Пионерская, 12'],
 ['Дом и стиль','Краснодар','ТОП-350','volkova','Елена Волкова',1,'Подтверждено','Нет данных','Российская, 88'],
 ['Линия интерьера','Ростов-на-Дону','ТОП-500','orlov','Павел Лебедев',2,'Подтверждено','Линия интерьера','Садовая, 16'],
 ['Дверной формат','Таганрог','ТОП-350','orlov','Павел Лебедев',1,'Подтверждено','Дверной формат','Чехова, 40'],
 ['Пространство','Ставрополь','ТОП-150','orlov','Ольга Миронова',3,'Подтверждено','Пространство','Мира, 56'],
 ['Тёплый дом','Ростов-на-Дону','ТОП-500','orlov','Ольга Миронова',0,'Подтверждено','Нет данных','Малиновского, 8'],
 ['Новый контур','Краснодар','Нет данных','','Ирина Новикова',1,'Без команды РОП','Нет данных','Уральская, 10'],
 ['Мастерская дверей','Армавир','ТОП-500','','Сергей Петров',1,'Вне списка ОПТ','Связь не подтверждена','Кирова, 38'],
 ['Двери на Юге','Майкоп','ТОП-350','','Сергей Петров',0,'Вне списка ОПТ','Нет данных','Гагарина, 20'],
 ['Студия пространства','Ставрополь','Нет данных','','Не указан',1,'Ответственный не указан','Связь не подтверждена','Ленина, 64']
];
const baseClients=baseSeed.map((r,i)=>({
 id:`C${String(i+1).padStart(3,'0')}`,code:`ДЕМО-${String(i+1).padStart(3,'0')}`,name:r[0],
 city:r[1],category:r[2],team:r[3],rop:baseTeams.find(t=>t.id===r[3])?.name||'Не подтверждён',
 manager:r[4],outlets:r[5],review:r[6],holding:r[7],address:`${r[1]}, ${r[8]}`,
 inn:'Нет данных',rm:r[3]==='volkova'&&i!==1?'Игорь Соколов':r[3]==='orlov'?'Мария Власова':'Не указан',
 warehouse:'Нет данных',club:'Нет данных',cashback:'Нет данных',next:'Не назначен',
 stores:Array.from({length:r[5]},(_,n)=>({id:`TT-${i+1}-${n+1}`,name:n===0?'Основная точка':`Точка ${n+1}`,address:n===0?`${r[1]}, ${r[8]}`:`${r[1]}, Тестовая, ${n*10+1}`,closed:i===6&&n===2}))
}));
const baseColumns=[
 ['name','Клиент',250,'text'],['code','Код 1С',125,'text'],['inn','ИНН',135,'text'],
 ['city','Город',170,'select'],['category','Категория',135,'select'],['rop','РОП',175,'select'],
 ['manager','Менеджер',180,'select'],['rm','Региональный',170,'select'],['outlets','ТТ',105,'number'],
 ['review','Назначение',200,'select'],['holding','Холдинг',185,'select'],['address','Адрес',250,'text'],
 ['warehouse','Склад',135,'select'],['club','Tandoor Club',145,'select'],['cashback','Cashback',135,'select'],['next','Следующий шаг',170,'text']
];
let baseState={view:'all',entity:'clients',q:'',team:'',manager:'',reason:'',filters:{},sort:'name',dir:1,page:1,columns:baseColumns.map(c=>c[0]),selected:null};
 let baseSelectedId=null,baseReturnHash='clients',baseScroll=0;
const be=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bIcon=n=>`<i data-lucide="${n}"></i>`;
const bPill=(v,w=false)=>`<span class="tag ${w?'warn':'green'}">${be(v)}</span>`;
function selectedBaseClient(){
 const p=new URLSearchParams(location.hash.split('?').slice(1).join('?'));
 if(p.has('client')){baseSelectedId=p.get('client');const from=p.get('from');if(from?.startsWith('clients'))baseReturnHash=from;}
 return roleScopedClients().find(c=>c.id===baseSelectedId)||null;
}
function baseReadUrl(){
 const p=new URLSearchParams(location.hash.split('?')[1]||'');
 if(!p.size)return;
 baseState.view=['all','teams','review'].includes(p.get('view'))?p.get('view'):'all';
 baseState.entity=p.get('entity')==='stores'?'stores':'clients';
 for(const k of ['q','team','manager','reason'])baseState[k]=p.get(k)||'';
 baseState.page=Math.max(1,Number(p.get('page'))||1);
 baseState.sort=baseColumns.some(c=>c[0]===p.get('sort'))?p.get('sort'):'name';
 baseState.dir=p.get('dir')==='-1'?-1:1;
 baseState.filters={};
 [...baseColumns,['storeName'],['storeState']].forEach(([key])=>{if(p.has(`f_${key}`))baseState.filters[key]=p.get(`f_${key}`)});
 roleNormalizeBase();
}
function baseWriteUrl(){
 const p=new URLSearchParams({view:baseState.view,entity:baseState.entity,role:prototypeRole});
 for(const k of ['q','team','manager','reason'])if(baseState[k])p.set(k,baseState[k]);
 if(baseState.page>1)p.set('page',baseState.page);
 p.set('sort',baseState.sort);p.set('dir',baseState.dir);
 Object.entries(baseState.filters).forEach(([k,v])=>{if(v)p.set(`f_${k}`,v)});
 history.replaceState(null,'',`#clients?${p}`);
}
function baseRows(){
 let scoped=roleScopedClients();
 if(baseState.filters.rm==='Игорь Соколов')scoped=scoped.map(c=>{const stores=c.stores.filter(t=>roleProfiles.regional.stores.includes(t.id));return {...c,stores,outlets:stores.length}});
 const rows=baseState.entity==='stores'?scoped.flatMap(c=>c.stores.map(t=>({...c,storeId:t.id,storeName:t.name,address:t.address,storeState:t.closed?'Закрыта':'Открыта'}))):scoped;
 return rows.filter(c=>{
  if(baseState.view==='review'&&c.review==='Подтверждено')return false;
  if(baseState.team&&c.team!==baseState.team)return false;
  if(baseState.manager&&c.manager!==baseState.manager)return false;
  if(baseState.reason&&c.review!==baseState.reason)return false;
  if(baseState.q&&!Object.values(c).filter(v=>typeof v==='string').join(' ').toLowerCase().includes(baseState.q.toLowerCase()))return false;
  return Object.entries(baseState.filters).every(([k,v])=>{
   if(!v)return true;
   if(baseState.entity!=='stores'&&['storeName','storeState'].includes(k))return true;
   if(k==='outlets')return v==='2+'?c.outlets>=2:String(c.outlets)===v;
   const col=baseColumns.find(x=>x[0]===k);
   return col?.[3]==='select'?String(c[k])===v:String(c[k]).toLowerCase().includes(v.toLowerCase());
  });
 }).sort((a,b)=>baseState.dir*(typeof a[baseState.sort]==='number'?a[baseState.sort]-b[baseState.sort]:String(a[baseState.sort]).localeCompare(String(b[baseState.sort]),'ru')));
}
function baseOptions(values,value,all='Все'){return `<option value="">${all}</option>`+[...new Set(values)].map(v=>`<option ${v===value?'selected':''} value="${be(v)}">${be(v)}</option>`).join('')}
function renderClientBase(){
 baseReadUrl();
 return `<div id="client-base">
  ${roleContext()}${roleSummary()}
  <div class="b-tabs" role="group" aria-label="Представление базы">${roleBaseTabs().map(([v,icon,t])=>`<button data-bview="${v}" aria-pressed="${baseState.view===v}" class="${baseState.view===v?'active':''}">${bIcon(icon)}${t}${v==='review'?'<span class="b-count">4</span>':''}</button>`).join('')}</div>
  <div class="b-toolbar"><label class="b-search">${bIcon('search')}<input id="b-search" type="search" value="${be(baseState.q)}" placeholder="Клиент, код, ИНН, адрес или ответственный" aria-label="Поиск по всей базе"></label><div class="b-entities" aria-label="Тип записей"><button data-bentity="clients" class="${baseState.entity==='clients'?'active':''}">Клиенты</button><button data-bentity="stores" class="${baseState.entity==='stores'?'active':''}">Торговые точки</button></div><details class="b-columns"><summary>${bIcon('columns-3')} Колонки</summary><div><p>Показать в таблице</p>${baseColumns.map(([k,l])=>`<label><input type="checkbox" data-bcolumn="${k}" ${baseState.columns.includes(k)?'checked':''} ${k==='name'?'disabled':''}>${l}</label>`).join('')}<button data-ballcolumns>Показать все</button></div></details></div>
  ${roleQuickFilters()}
  <div id="b-results" aria-live="polite">${renderBaseResults()}</div>
 </div>`;
}
function renderBaseResults(){
 const rows=baseRows();const unique=[...new Map(rows.map(r=>[r.id,r])).values()];
 const chips=[baseState.team&&['team',baseTeams.find(t=>t.id===baseState.team)?.name],baseState.manager&&['manager',baseState.manager],baseState.reason&&['reason',baseState.reason],...Object.entries(baseState.filters).filter(x=>x[1]).map(([k,v])=>[`f_${k}`,`${baseColumns.find(c=>c[0]===k)?.[1]||({storeName:'Точка',storeState:'Статус ТТ'})[k]}: ${v}`])].filter(Boolean);
 const context=`<div class="b-context"><strong>${rows.length} ${baseState.entity==='stores'?'ТТ':'клиентов'}<span class="muted"> в выборке</span></strong>${chips.map(([k,l])=>`<button data-bremove="${be(k)}" title="Убрать фильтр">${be(l)} ×</button>`).join('')}<span class="b-right">Данные не смешиваются со старой базой</span></div>`;
 let groups='';
 if(baseState.view==='teams')groups=`<div class="b-teamgrid">${roleScopedTeams().filter(t=>!baseState.team||t.id===baseState.team).map(t=>{
  const clients=unique.filter(c=>c.team===t.id);
  return `<section class="b-teamcard"><header><div class="avatar">${t.name.split(' ').map(s=>s[0]).join('')}</div><div><span class="small muted">РОП · ${be(t.region)}</span><h2>${be(t.name)}</h2></div><button data-bteam="${t.id}" class="link">Вся команда →</button></header><div class="b-teamtotal"><b>${clients.length} клиентов</b><span>${clients.reduce((s,c)=>s+c.outlets,0)} ТТ</span><span>${t.managers.length} менеджера + региональный</span></div><div class="r-teamsection">Менеджеры продаж</div>${t.managers.map(m=>{const mc=clients.filter(c=>c.manager===m);return `<button class="b-managerrow" data-bperson="${be(m)}" data-bteamid="${t.id}"><span class="avatar">${m.split(' ').map(x=>x[0]).join('')}</span><span><strong>${be(m)}</strong><small>Менеджер ОПТ</small></span><span class="b-managercounts"><b>${mc.length}</b> клиентов · ${mc.reduce((s,c)=>s+c.outlets,0)} ТТ ${bIcon('chevron-right')}</span></button>`}).join('')}${roleRegionalRows(t,clients)}${roleOwnClients(t,clients)}</section>`;
 }).join('')}</div>${roleCanReview()?`<button class="b-orphan" data-bview="review">${bIcon('circle-help')} Вне подтверждённых команд: ${unique.filter(c=>!c.team).length} клиентов <span>Открыть назначения →</span></button>`:'<p class="b-caption">Общие клиенты менеджера и регионала посчитаны один раз. Другие команды не входят в вашу область.</p>'}`;
 if(baseState.view==='review')groups=`<div class="b-reviewnote"><strong>Проверяем назначение, а не удаляем клиента</strong><p>Отсутствие ответственного в ОПТ не означает, что клиент закрыт. Передача и статус уточняются отдельно в 1С.</p></div><div class="b-reviewgroups">${[...new Set(unique.map(c=>c.manager))].map(m=>{const r=unique.filter(c=>c.manager===m);return `<button data-breviewer="${be(m)}"><span class="small muted">${be(r[0].review)}</span><strong>${be(m)}</strong><span>${r.length} клиентов · открыть список →</span></button>`}).join('')}</div>`;
 const cols=baseColumns.filter(c=>baseState.columns.includes(c[0]));
 const pages=Math.max(1,Math.ceil(rows.length/6));baseState.page=Math.min(baseState.page,pages);
 return context+groups+`<section class="b-tablecard"><div class="b-tabletitle"><h2>${baseState.view==='teams'?'Клиенты выбранных команд':baseState.view==='review'?'Клиенты для ревизии':baseState.entity==='stores'?'Все торговые точки':'Вся клиентская база'}</h2><span class="small muted">Название закреплено · остальные колонки прокручиваются →</span></div><div class="b-scroll" tabindex="0" aria-label="Таблица клиентов с горизонтальной прокруткой"><table class="b-table"><thead><tr>${cols.map(([k,l,w])=>`<th style="min-width:${w}px;width:${w}px"><button data-bsort="${k}" aria-label="Сортировать: ${l}">${l}<span>${baseState.sort===k?(baseState.dir===1?'↑':'↓'):'↕'}</span></button></th>`).join('')}${baseState.entity==='stores'?'<th>Торговая точка</th><th>Статус ТТ</th>':''}</tr><tr class="b-filterrow">${cols.map(([k,l,w,type])=>`<th>${type==='select'?`<select data-bfilter="${k}" aria-label="Фильтр: ${l}">${baseOptions(baseClients.map(c=>c[k]),baseState.filters[k])}</select>`:type==='number'?`<select data-bfilter="${k}" aria-label="Фильтр: ${l}">${baseOptions(['0','1','2+'],baseState.filters[k])}</select>`:`<input data-bfilter="${k}" aria-label="Фильтр: ${l}" placeholder="${k==='name'?'Название…':'Найти…'}" value="${be(baseState.filters[k]||'')}">`}</th>`).join('')}${baseState.entity==='stores'?'<th colspan="2" class="muted">По данным точки</th>':''}</tr></thead><tbody>${rows.slice((baseState.page-1)*6,baseState.page*6).map(c=>`<tr>${cols.map(([k])=>`<td>${k==='name'?`<button class="b-clientlink" data-bclient="${c.id}"><strong>${be(c.name)}</strong><small>${be(c.code)} · ${be(c.city)}</small></button>`:k==='review'?bPill(c[k],c[k]!=='Подтверждено'):k==='outlets'?`<button class="b-num" data-boutlets="${c.id}" aria-label="Точки клиента ${be(c.name)}">${c.outlets}</button>`:k==='manager'?`<span class="b-person">${be(c[k])}</span>`:k==='holding'&&c[k]==='Связь не подтверждена'?bPill(c[k],true):`<span class="${['Нет данных','Не назначен','Не указан','Не подтверждён'].includes(c[k])?'muted':''}">${be(c[k])}</span>`}</td>`).join('')}${baseState.entity==='stores'?`<td>${be(c.storeName)}<small class="muted">${be(c.storeId)}</small></td><td>${bPill(c.storeState,c.storeState==='Закрыта')}</td>`:''}</tr>`).join('')||`<tr><td colspan="${cols.length+2}" class="b-empty"><strong>Ничего не найдено</strong><p>Попробуйте убрать один из фильтров или изменить запрос.</p><button data-breset>Сбросить фильтры</button></td></tr>`}</tbody></table></div><div class="b-pagination"><span>${rows.length?`${(baseState.page-1)*6+1}–${Math.min(baseState.page*6,rows.length)}`:'0'} из ${rows.length} · по 6 на странице</span><div><button data-bpage="-1" aria-label="Предыдущая страница" ${baseState.page===1?'disabled':''}>←</button><span>${baseState.page} / ${pages}</span><button data-bpage="1" aria-label="Следующая страница" ${baseState.page===pages?'disabled':''}>→</button></div></div></section><p class="b-caption">«Нет данных» означает отсутствие сведений, а не ноль. Клиент без ТТ остаётся в базе. Все имена и показатели на этом экране вымышлены.</p>`;
}
function baseRefresh(){
 const scroll=document.querySelector('.b-scroll');if(scroll)baseScroll=scroll.scrollLeft;
 baseWriteUrl();document.querySelector('#b-results').innerHTML=renderBaseResults();
 mountStoreFilters();
 const next=document.querySelector('.b-scroll');if(next)next.scrollLeft=baseScroll;
 if(window.lucide)lucide.createIcons();
}
function baseFull(){baseWriteUrl();render();}
function mountClientBase(){const sc=document.querySelector('.b-scroll');if(sc)sc.scrollLeft=baseScroll;mountStoreFilters();}
function mountStoreFilters(){
 document.querySelectorAll('select[data-bfilter]').forEach(select=>{
  const key=select.dataset.bfilter;
  if(baseColumns.some(c=>c[0]===key&&c[3]==='select'))select.innerHTML=baseOptions(roleScopedClients().map(c=>c[key]),baseState.filters[key]);
 });
 const title=document.querySelector('.b-tabletitle h2');
 if(title&&baseState.view==='all')title.textContent=baseState.entity==='stores'?(prototypeRole==='director'?'Все торговые точки':'Доступные торговые точки'):roleClientTitle();
 if(baseState.entity!=='stores')return;
 const cell=document.querySelector('.b-filterrow th[colspan]');
 if(cell){cell.removeAttribute('colspan');cell.innerHTML=`<input data-bfilter="storeName" aria-label="Фильтр: Торговая точка" placeholder="Название точки…" value="${be(baseState.filters.storeName||'')}">`;
 const stateCell=document.createElement('th');stateCell.innerHTML=`<select data-bfilter="storeState" aria-label="Фильтр: Статус ТТ">${baseOptions(['Открыта','Закрыта'],baseState.filters.storeState)}</select>`;cell.after(stateCell);}
 const table=document.querySelector('.b-table');
 if(table&&!table.dataset.storesOrdered){
  const cols=baseColumns.filter(c=>baseState.columns.includes(c[0])),addressIndex=cols.findIndex(c=>c[0]==='address'),count=cols.length+2;
  const first=[0,count-2,...(addressIndex>0?[addressIndex]:[]),count-1];
  const order=[...first,...Array.from({length:count},(_,i)=>i).filter(i=>!first.includes(i))];
  table.querySelectorAll('tr').forEach(row=>{const cells=[...row.children];if(cells.length===count)order.forEach(i=>row.append(cells[i]));});
  table.dataset.storesOrdered='true';
 }
}
function baseReset(){baseState={...baseState,q:'',team:'',manager:'',reason:'',filters:{},page:1};baseScroll=0;baseFull();}
function baseOpen(id,section='overview'){
 if(!roleScopedClients().some(c=>c.id===id))return;
 baseSelectedId=id;baseReturnHash=location.hash.startsWith('#clients')?location.hash.slice(1):`clients?role=${prototypeRole}`;change(section);
}
function renderBaseClientCard(section,c){
 const head=`<div class="row gap">${bPill(c.category)}${bPill(c.review,c.review!=='Подтверждено')}<span class="tag">Менеджер: ${be(c.manager)}</span><span class="tag">РОП: ${be(c.rop)}</span></div>`;
 const structures=`<section class="card"><div class="cardhead"><h2>Точки клиента</h2><span class="source">Пример структуры 1С</span></div>${c.stores.map(t=>`<div class="item"><div class="itemtitle"><strong>${be(t.name)}</strong>${bPill(t.closed?'Закрыта':'Открыта',t.closed)}</div><p>${be(t.address)} · ${t.id}</p></div>`).join('')||'<div class="pad"><h3>Торговые точки не переданы</h3><p class="sub">Клиент сохраняется в общей базе и в списке ответственного.</p></div>'}</section>`;
 if(section==='passport')return head+`<div class="grid equal">${panel('Клиент и ответственность',fields([['Код',c.code],['Категория',c.category],['Холдинг',c.holding],['Менеджер',c.manager],['РОП',c.rop],['Город',c.city],['Адрес',c.address],['ИНН','Нет данных']]),'Демонстрационные данные')}${structures}</div>`;
 if(section!=='overview')return head+note('Раздел выбранного клиента',`Открыт раздел «${clientTabs.find(t=>t[0]===section)?.[1]||section}» для клиента «${c.name}». Для него в этой учебной выборке нет рабочих событий. Данные другого клиента не подставляются.`)+structures;
 return head+(c.review!=='Подтверждено'?note('Назначение требует проверки',c.review+'. Клиент не архивируется автоматически.',true):'')+stats([['Торговые точки',String(c.outlets),'по выбранному клиенту'],['Заказы','Нет данных','не подключены в примере'],['Финансы','Нет данных','не подставляем нули'],['Следующий шаг','Не назначен','без автоматических задач']])+`<div class="grid two">${panel('Следующие действия',`<div class="pad"><h3>${c.review!=='Подтверждено'?'Уточнить актуального ответственного':'Проверить данные перед началом работы'}</h3><p class="sub">Назначение в ЛК не изменяет данные 1С. Решение подтверждается новой выгрузкой.</p><button class="link" data-go="passport">Данные и условия →</button></div>`,'Работа команды')}${structures}</div>`;
}
document.addEventListener('input',e=>{
 if(e.target.id==='b-search'){baseState.q=e.target.value;baseState.page=1;baseRefresh();}
 if(e.target.matches('input[data-bfilter]')){
  const key=e.target.dataset.bfilter,pos=e.target.selectionStart;
  baseState.filters[key]=e.target.value;baseState.page=1;baseRefresh();
  const input=document.querySelector(`input[data-bfilter="${key}"]`);input.focus({preventScroll:true});input.setSelectionRange(pos,pos);
 }
});
document.addEventListener('change',e=>{
 if(e.target.matches('select[data-bfilter]')){baseState.filters[e.target.dataset.bfilter]=e.target.value;baseState.page=1;baseRefresh();}
 if(e.target.id==='b-team'){baseState.team=e.target.value;baseState.manager='';baseState.page=1;baseFull();}
 if(e.target.id==='b-manager'){baseState.manager=e.target.value;baseState.page=1;baseFull();}
 if(e.target.id==='b-reason'){baseState.reason=e.target.value;baseState.page=1;baseFull();}
 if(e.target.hasAttribute('data-bcolumn')){
  const k=e.target.dataset.bcolumn;baseState.columns=e.target.checked?[...new Set([...baseState.columns,k])]:baseState.columns.filter(x=>x!==k);baseRefresh();
 }
});
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-base-return')){location.hash=baseReturnHash;return;}
 if(b.dataset.bclient){baseOpen(b.dataset.bclient);return;}
 if(b.dataset.boutlets){baseOpen(b.dataset.boutlets,'passport');return;}
 if(b.dataset.bview){baseState.view=b.dataset.bview;baseState.team='';baseState.manager='';baseState.reason='';baseState.page=1;baseFull();}
 if(b.dataset.bentity){baseState.entity=b.dataset.bentity;delete baseState.filters.storeState;delete baseState.filters.storeName;baseState.page=1;baseFull();}
 if(b.dataset.bsort){baseState.dir=baseState.sort===b.dataset.bsort?-baseState.dir:1;baseState.sort=b.dataset.bsort;baseRefresh();}
 if(b.dataset.bperson){baseState.view='all';baseState.team=b.dataset.bteamid;baseState.manager=b.dataset.bperson;baseState.page=1;baseFull();}
 if(b.dataset.bteam){baseState.view='all';baseState.team=b.dataset.bteam;baseState.manager='';baseState.page=1;baseFull();}
 if(b.dataset.breviewer){baseState.manager=b.dataset.breviewer;baseState.page=1;baseFull();}
 if(b.hasAttribute('data-breset'))baseReset();
 if(b.dataset.bpage){baseState.page+=Number(b.dataset.bpage);baseRefresh();}
 if(b.dataset.bremove){const k=b.dataset.bremove;if(k.startsWith('f_'))delete baseState.filters[k.slice(2)];else{baseState[k]='';if(k==='team')baseState.manager='';}baseState.page=1;baseFull();}
 if(b.hasAttribute('data-ballcolumns')){baseState.columns=baseColumns.map(c=>c[0]);baseFull();}
});
