/* Compact client workspace: isolated visual experiment. Synthetic fixtures, no API or writes. */
roleProfiles.admin={...roleProfiles.director,label:'Администратор',name:'Администратор Tandoor',initials:'AT',scope:'Вся база и административные действия',nav:'Клиенты',focus:'Обзор отдела'};
prototypeRole='admin';
const compactOldHasTeams=roleHasTeams;
roleHasTeams=()=>prototypeRole==='admin'||compactOldHasTeams();
const compactOldNav=roleNav;
roleNav=items=>compactOldNav(items).map(row=>prototypeRole==='admin'&&row[3]==='teams'?[row[0],'Все команды',row[2],row[3]]:row).concat(prototypeRole==='admin'?[['compact-access','Настройка доступа','shield-check','compact-access']]:[]);
const ctTeams=[
 {id:'volkova',name:'Елена Волкова',area:'Краснодарский край · Адыгея',names:['Алексей Морозов','Анна Белова','Максим Савельев','Олеся Зотова','Никита Горин','Марина Котова'],regional:'Игорь Соколов'},
 {id:'orlov',name:'Дмитрий Орлов',area:'Ростовская область · Ставрополье',names:['Павел Лебедев','Ольга Миронова','Вадим Панин','Ирина Орехова','Сергей Лукин','Алина Климова'],regional:'Мария Власова'},
 {id:'kovalev',name:'Андрей Ковалёв',area:'Крым · Севастополь',names:['Илья Тихонов','Евгения Романова','Артём Лазарев','Вера Носова','Денис Макаров','Наталья Титова'],regional:'Роман Фомин'},
 {id:'medvedeva',name:'Наталья Медведева',area:'Северный Кавказ',names:['Виктор Серов','Анастасия Лукина','Матвей Егоров','Дарья Попова','Александр Седов','Юлия Жукова'],regional:'Евгений Белов'},
 {id:'frolov',name:'Павел Фролов',area:'Волгоградская область · Калмыкия',names:['Игорь Денисов','Елена Крылова','Михаил Антонов','София Иванова','Валерий Осипов','Ксения Быкова'],regional:'Андрей Ветров'},
 {id:'sokolova',name:'Ольга Соколова',area:'Новые территории',names:['Алексей Круглов','Мария Сергеева','Дмитрий Воронов','Арина Васина','Олег Зайцев','Инна Сомова'],regional:'Николай Панов'}
];
// One person record, independent leadership and team membership. All IDs are demo IDs.
const ctAssistantPeople=[
 {id:'demo-gusleva',name:'Гуслева',initials:'Г',example:false},
 {id:'demo-assistant-1',name:'Ассистент 1',initials:'А1',example:true},
 {id:'demo-assistant-2',name:'Ассистент 2',initials:'А2',example:true}
];
const ctAssistantDepartment={id:'assistants',headId:'demo-gusleva',memberIds:['demo-gusleva','demo-assistant-1','demo-assistant-2']};
function ctAssistantFunctions(id){return [id===ctAssistantDepartment.headId?'РОА':null,ctAssistantDepartment.memberIds.includes(id)?'Ассистент':null].filter(Boolean)}
function ctAssistantMembers(){return [...new Set(ctAssistantDepartment.memberIds)].map(id=>ctAssistantPeople.find(p=>p.id===id))}
const ctCities=['Краснодар','Армавир','Майкоп','Ростов-на-Дону','Ставрополь','Таганрог'];
const ctClients=[],ctOutlets=[];
for(let t=0;t<6;t++)for(let n=0;n<48;n++){
 const k=t*48+n,id=`DEMO-C${String(k+1).padStart(4,'0')}`,team=ctTeams[t];
 const client={id,type:'client',name:`${baseSeed[n%12][0]}${n<12?'':` · ${Math.floor(n/12)+1}`}`,city:ctCities[(t+n)%6],
  rop:n%19===0?'':team.id,manager:n%23===0?'':team.names[n%6],regional:'',hardware:'',
  address:`${ctCities[(t+n)%6]}, Учебная улица, ${n+1}`,code:`ДЕМО-${k+1}`,inn:'Не передано',category:n%3===0?'Не передано':'Оптовый клиент',holding:n%4===0?'Группа «Юг»':'Не передано',
  warehouse:'Не передано',club:'Не передано',cashback:'Не передано',next:'Не назначен',phone:'Демонстрационные контакты',status:'Активен'};
 ctClients.push(client);
 for(let j=0;j<n%3;j++){
  const outlet={...client,id:`${id}-T${j+1}`,type:'outlet',parent:id,parentName:client.name,name:`${client.name} / ТТ ${j+1}`,
   rop:n%17===0?'':n%11===0?ctTeams[(t+1)%6].id:team.id,manager:n%13===0?'':team.names[(n+j)%6],
   regional:n%7===0?'':team.regional,hardware:n%8===0?team.names[5]:'',status:n%16===0?'Закрыта':'Открыта'};
  ctOutlets.push(outlet);
 }
}
const ctAll=[...ctClients,...ctOutlets];
const ctFields=[['name','Название'],['city','Город'],['manager','Менеджер'],['rop','РОП'],['regional','Региональный'],['status','Статус'],['code','Код 1С'],['inn','ИНН'],['category','Категория'],['holding','Холдинг'],['address','Адрес'],['warehouse','Склад'],['club','Tandoor Club'],['cashback','Cashback'],['next','Следующий шаг']];
let ct={role:'',view:'teams',entity:'client',branch:'',person:'',kind:'manager',q:'',teamQ:'',department:'all',staff:'',reason:'',city:'',missing:false,page:1,expanded:new Set(),filters:{},columns:['name','city','manager','rop','status'],dense:true};
const ctReasons=r=>[!r.rop&&'Не указан РОП',!r.manager&&'Не указан менеджер',r.type==='outlet'&&!r.regional&&'Не указан региональный'].filter(Boolean);
const ctRop=id=>ctTeams.find(t=>t.id===id)?.name||'Не указан';
const ctEsc=be;
const ctNum=x=>Number(x).toLocaleString('ru-RU');
const ctInit=n=>n.split(' ').map(x=>x[0]).slice(0,2).join('');
function ctScope(){
 if(prototypeRole==='manager')return ctAll.filter(r=>r.manager===roleProfiles.manager.name);
 if(prototypeRole==='regional'){
  const outlets=ctOutlets.filter(r=>r.regional===roleProfiles.regional.name);
  const parents=new Set(outlets.map(r=>r.parent));
  return [...ctClients.filter(r=>parents.has(r.id)),...outlets];
 }
 if(prototypeRole==='rop')return ctAll.filter(r=>r.rop==='volkova');
 return ctAll;
}
function ctRead(){
 const p=new URLSearchParams(location.hash.split('?')[1]||'');
 if(ct.role!==prototypeRole){
  ct={...ct,role:prototypeRole,view:roleHasTeams()?'teams':'all',entity:prototypeRole==='regional'?'outlet':'client',branch:'',person:'',q:'',teamQ:'',department:'all',staff:'',reason:'',city:'',missing:false,page:1,filters:{},expanded:new Set(prototypeRole==='rop'?['volkova']:[])};
 }
 for(const k of ['view','entity','branch','person','kind','q','teamQ','department','staff','reason','city'])if(p.has('c_'+k))ct[k]=p.get('c_'+k);
 if(!['all','sales','assistants'].includes(ct.department))ct.department='all';
 if(p.has('c_open'))ct.expanded=new Set(p.get('c_open').split(',').filter(Boolean));
 if(p.has('c_filters')){try{ct.filters=JSON.parse(p.get('c_filters'))||{}}catch{ct.filters={}}}
 if(p.has('c_cols'))ct.columns=p.get('c_cols').split(',').filter(k=>ctFields.some(c=>c[0]===k));
 if(!ct.columns.includes('name'))ct.columns.unshift('name');
 if(p.has('c_dense'))ct.dense=p.get('c_dense')==='1';
 ct.page=Math.max(1,Number(p.get('c_page'))||1);ct.missing=p.get('c_missing')==='1';
 if(!roleHasTeams()&&ct.view==='teams')ct.view='all';
 if(!['admin','director'].includes(prototypeRole)&&ct.view==='queue')ct.view='all';
}
function ctWrite(){
 const p=new URLSearchParams({role:prototypeRole});
 for(const k of ['view','entity','branch','person','kind','q','teamQ','department','staff','reason','city'])if(ct[k])p.set('c_'+k,ct[k]);
 p.set('c_page',String(ct.page));p.set('c_open',[...ct.expanded].join(','));if(ct.missing)p.set('c_missing','1');
 p.set('c_filters',JSON.stringify(ct.filters));p.set('c_cols',ct.columns.join(','));p.set('c_dense',ct.dense?'1':'0');
 history.replaceState(null,'',`#clients?${p}`);
}
function ctRefresh(focus){
 ctWrite();render();
 if(focus){const el=document.getElementById(focus);el?.focus();if(el?.setSelectionRange)el.setSelectionRange(el.value.length,el.value.length);}
}
function ctMetric(rows,type){return rows.filter(r=>r.type===type).length}
function ctPeople(rows){
 const people=new Map();
 for(const r of rows)for(const kind of ['manager','regional','hardware']){
  const name=r[kind];if(!name)continue;
  if(!people.has(name))people.set(name,{name,kinds:new Set(),rows:new Map()});
  const person=people.get(name);person.kinds.add(kind);person.rows.set(r.id,r);
 }
 return [...people.values()].map(p=>({...p,rows:[...p.rows.values()]}));
}
function ctJump(branch,person,kind,entity,queue=false){
 ct={...ct,view:queue?'queue':'all',entity,branch,person,kind:kind||'manager',q:'',city:'',reason:'',page:1,filters:{}};ctRefresh();
}
function ctButton(label,action,value='',cls=''){return `<button class="${cls}" data-ct="${action}" data-val="${ctEsc(value)}">${label}</button>`}
function ctCounter(n,type,branch='',person='',kind='manager'){
 return `<button class="ct-count" data-ct="portfolio" data-branch="${branch}" data-person="${ctEsc(person)}" data-kind="${kind}" data-entity="${type}" aria-label="Открыть ${type==='client'?'клиентов':'ТТ'} ${ctEsc(person||ctRop(branch))}"><b>${ctNum(n)}</b><span>${type==='client'?'клиентов':'ТТ'}</span></button>`;
}
function renderClientBase(){
 ctRead();const rows=ctScope(),r=roleProfile(),isBoss=roleHasTeams();
 const c=ctMetric(rows,'client'),o=ctMetric(rows,'outlet');
 const missing=rows.filter(x=>ctReasons(x).length);
 return `<div id="client-base" class="ct-workspace ${ct.dense?'ct-dense':''}">
 <div class="ct-identity"><span class="avatar">${r.initials}</span><b>${r.name}</b><span class="ct-role">${r.label}</span><span class="ct-scope">${prototypeRole==='admin'?'Вся база · права администратора':prototypeRole==='director'?'Вся база · без административных действий':prototypeRole==='rop'?'Только моя команда':'Только мои назначения'}</span></div>
 <div class="ct-kpis">
 ${ctButton(`<b>${ctNum(c)}</b><span>${prototypeRole==='regional'?'Доступные клиенты':'Клиенты'}</span>`,'metric','client')}
 ${ctButton(`<b>${ctNum(o)}</b><span>Торговые точки</span>`,'metric','outlet')}
 ${isBoss?ctButton(`<b>${prototypeRole==='rop'?1:ctTeams.length}</b><span>Команды РОПов</span>`,'view','teams'):''}
 ${isBoss?`<div><b>${ctPeople(rows).length}</b><span>Сотрудники продаж</span></div>`:''}
 ${['admin','director'].includes(prototypeRole)?ctButton(`<b>${ctMetric(missing,'client')} / ${ctMetric(missing,'outlet')}</b><span>Незаполнено: клиенты / ТТ</span>`,'view','queue','ct-warning'):''}
 </div>
 <div class="ct-tabbar" aria-label="Представление клиентов">${isBoss?ctButton(prototypeRole==='rop'?'Моя команда':'По командам','view','teams',ct.view==='teams'?'active':''):''}${ctButton(prototypeRole==='manager'?'Мои клиенты':prototypeRole==='regional'?'Мои ТТ':'Все клиенты и ТТ','view','all',ct.view==='all'?'active':'')}${['admin','director'].includes(prototypeRole)?ctButton('Незаполненные назначения','view','queue',ct.view==='queue'?'active':''):''}<span>Демо: 288 клиентов · 288 ТТ</span></div>
 ${ct.view==='teams'?ctRenderTeams():ctRenderList()}
 <div class="ct-footnote">Учебная выборка для проверки плотности. Не текущая выгрузка 1С. Назначения клиента и ТТ независимы; общие сотрудники считаются один раз.</div>
 </div>`;
}
function ctRenderTeams(){
 const showDepartments=['admin','director'].includes(prototypeRole);
 const assistantsOnly=showDepartments&&ct.department==='assistants';
 let teams=prototypeRole==='rop'?ctTeams.filter(t=>t.id==='volkova'):ctTeams;
 if(assistantsOnly)teams=[];
 const query=ct.teamQ.trim().toLowerCase(),scope=ctScope();
 teams=teams.filter(t=>{const rows=scope.filter(r=>r.rop===t.id);return (!ct.missing||rows.some(r=>ctReasons(r).length))&&(!query||`${t.name} ${t.area} ${ctPeople(rows).map(p=>p.name).join(' ')}`.toLowerCase().includes(query));});
 const assistantBlock=showDepartments&&ct.department!=='sales'&&(!ct.missing||assistantsOnly)?ctRenderAssistants(query):'';
 return `<section class="ct-panel">
 ${showDepartments?`<div class="ct-departments" aria-label="Отдел"><div class="ct-segment">${[['all','Все отделы'],['sales','Продажи'],['assistants','Ассистенты']].map(([id,label])=>ctButton(label,'department',id,ct.department===id?'active':'')).join('')}</div><span class="ct-small">РОА и РОП: разные руководящие функции</span></div>`:''}
 <div class="ct-tools">
 <label class="ct-search">${bIcon('search')}<input id="ct-team-search" placeholder="Найти руководителя или сотрудника" value="${ctEsc(ct.teamQ)}" aria-label="Найти руководителя или сотрудника"></label>
 ${!assistantsOnly?`<label class="ct-check"><input type="checkbox" data-ct-check="missing" ${ct.missing?'checked':''}> С незаполненными</label>`:''}
 ${ctButton('Свернуть всё','collapse')}<details class="ct-help"><summary>Как пользоваться</summary><p>Строка РОПа раскрывает сотрудников. Числа открывают отдельный список клиентов или ТТ. Поиск находит сотрудника даже в закрытой команде. Для просмотра нескольких команд можно открыть несколько строк.</p></details></div>
 ${assistantBlock}
 ${!assistantsOnly?`<div class="ct-section-title"><strong>${prototypeRole==='rop'?'Состав моей команды':'Команды продаж'}</strong><span>${teams.length} ${prototypeRole==='rop'?'команда':'команд'} · нажмите на строку для раскрытия</span></div>
 <div class="ct-grid-head"><span>РОП / команда</span><span>Сотрудники</span><span>Клиенты</span><span>ТТ</span><span>Незаполнено</span><span></span></div>
 ${teams.map(t=>ctTeam(t,query)).join('')||'<div class="ct-empty">Команды продаж по этим условиям не найдены.</div>'}
 ${prototypeRole!=='rop'&&!query&&!ct.missing?ctUnassigned():''}`:!assistantBlock?'<div class="ct-empty">Ассистенты не найдены. Измените поисковый запрос.</div>':''}
 </section>`;
}
function ctRenderAssistants(query){
 const members=ctAssistantMembers(),head=ctAssistantPeople.find(p=>p.id===ctAssistantDepartment.headId);
 const departmentMatch=`отдел ассистентов роа руководитель ${head.name}`.toLowerCase().includes(query);
 const visible=members.filter(p=>!query||departmentMatch||`${p.name} ${ctAssistantFunctions(p.id).join(' ')}`.toLowerCase().includes(query));
 if(!visible.length)return '';
 const open=ct.expanded.has('assistants')||!!query;
 return `<section class="ct-roa" aria-label="Отдел ассистентов">
 <div class="ct-section-title"><strong>Отдел ассистентов</strong><span>Состав для согласования · демо</span></div>
 <div class="ct-roa-summary">
 <button class="ct-team-name" data-ct="expand" data-val="assistants" aria-expanded="${open}" aria-controls="ct-roa-members"><span class="ct-chevron">${open?'⌄':'›'}</span><span class="avatar">${head.initials}</span><span><b>${head.name}</b><small>РОА · руководитель отдела ассистентов</small></span></button>
 <div class="ct-roa-total"><b>${members.length}</b><span>сотрудника в примере<small>включая руководителя</small></span></div>
 <span class="ct-roa-badge">Также ассистент</span>
 </div>
 ${open?`<div id="ct-roa-members" class="ct-roa-members"><div class="ct-roa-caption"><b>Ассистенты команды</b><span>${visible.length} из ${members.length} сотрудников</span></div>
 ${visible.map(p=>`<div class="ct-roa-person" data-employee-id="${p.id}"><span class="ct-person-name"><span class="ct-avatar">${p.initials}</span><span><b>${p.name}</b><small>${p.example?'Пример сотрудника · состав не подтверждён':'Руководит отделом и входит в его команду'}</small></span></span><span class="ct-roa-functions">${ctAssistantFunctions(p.id).map(f=>`<span class="ct-roa-badge">${f}</span>`).join('')}</span><button class="ct-open" data-ct="assistant-profile" data-val="${p.id}">Профиль →</button></div>`).join('')}
 <p class="ct-inline-note">Гуслева показана как руководитель отдела и как ассистент. Это один сотрудник: в составе команды учитывается один раз.</p></div>`:''}
 </section>`;
}
function ctAssistantProfile(id){
 if(!['admin','director'].includes(prototypeRole))return;
 const p=ctAssistantPeople.find(x=>x.id===id);if(!p)return;
 const d=document.getElementById('dialog');d.classList.remove('ct-drawer');
 d.innerHTML=`<div class="ct-roa-profile"><span class="ct-small">Профиль сотрудника · прототип</span><h2>${p.name}</h2><div class="ct-roa-functions">${ctAssistantFunctions(id).map(f=>`<span class="ct-roa-badge">${f}</span>`).join('')}</div><dl><dt>Отдел</dt><dd>Отдел ассистентов</dd><dt>Руководитель отдела</dt><dd>Гуслева</dd><dt>Функции</dt><dd>${id===ctAssistantDepartment.headId?'Координация команды и работа ассистентом':'Работа ассистентом'}</dd><dt>Назначения и нагрузка</dt><dd>Нет данных: на этом этапе не подключены</dd></dl><p class="ct-small">${p.example?'Это пример, а не реальный сотрудник. ':'Обе функции привязаны к одной записи сотрудника. '}Функции в структуре не выдают права доступа автоматически.</p><button data-ct="close">Вернуться к команде</button></div>`;
 d.showModal();
}
function ctTeam(t,query){
 const rows=ctScope().filter(r=>r.rop===t.id),people=ctPeople(rows);
 const expanded=ct.expanded.has(t.id)||!!query,missing=rows.filter(r=>ctReasons(r).length);
 const teamMatches=t.name.toLowerCase().includes(query)||t.area.toLowerCase().includes(query);
 const staff=people.filter(p=>(!query||teamMatches||p.name.toLowerCase().includes(query))&&(!ct.staff||p.kinds.has(ct.staff)));
 return `<article class="ct-team ${expanded?'is-open':''}">
 <div class="ct-teamline">
 <button class="ct-team-name" data-ct="expand" data-val="${t.id}" aria-expanded="${expanded}" aria-controls="ct-team-${t.id}"><span class="ct-chevron">${expanded?'⌄':'›'}</span><span class="avatar">${ctInit(t.name)}</span><span><b>${t.name}</b><small>${t.area}</small></span></button>
 <span class="ct-cell"><b>${people.length}</b><small>сотрудников</small></span>
 ${ctCounter(ctMetric(rows,'client'),'client',t.id)}${ctCounter(ctMetric(rows,'outlet'),'outlet',t.id)}
 <div class="ct-quality">${missing.length?`<button data-ct="queue-branch" data-val="${t.id}" class="ct-warning" ${prototypeRole==='rop'?'disabled title="Очередь доступна администратору и директору"':''}>${ctMetric(missing,'client')} кл. / ${ctMetric(missing,'outlet')} ТТ</button>`:'<span class="ct-ok">Заполнено</span>'}</div><span class="ct-small">${expanded?'Открыто':'Сводка'}</span></div>
 ${expanded?`<div class="ct-employees" id="ct-team-${t.id}"><div class="ct-employee-tools"><b>Сотрудники команды <span class="ct-small">${staff.length} из ${people.length}</span></b><label>Назначение <select id="ct-kind-${t.id}" data-ct-select="staff"><option value="">Все</option>${[['manager','Продажи'],['regional','Региональные'],['hardware','Фурнитура']].map(([v,l])=>`<option value="${v}" ${ct.staff===v?'selected':''}>${l}</option>`).join('')}</select></label></div>
 <div class="ct-staff-scroll" tabindex="0" aria-label="Сотрудники ${t.name}">${staff.map(p=>`<div class="ct-person"><span class="ct-person-name"><span class="ct-avatar">${ctInit(p.name)}</span><span><b>${p.name}</b><small>${[...p.kinds].map(k=>({manager:'Продажи',regional:'Региональный',hardware:'Фурнитура'})[k]).join(' · ')}</small></span></span>${ctCounter(ctMetric(p.rows,'client'),'client',t.id,p.name,'any')}${ctCounter(ctMetric(p.rows,'outlet'),'outlet',t.id,p.name,'any')}<button class="ct-open" data-ct="portfolio" data-branch="${t.id}" data-person="${p.name}" data-kind="any" data-entity="${ctMetric(p.rows,'client')?'client':'outlet'}">Открыть портфель →</button></div>`).join('')||'<p class="ct-empty">Нет сотрудников с таким типом назначения.</p>'}</div>
 <div class="ct-inline-note">Сотрудник с несколькими назначениями показан одной строкой. В его портфеле учитываются только записи этой ветки.</div>
 </div>`:''}</article>`;
}
function ctUnassigned(){
 const rows=ctScope().filter(r=>!r.rop);
 return `<div class="ct-unassigned"><span><b>Команда не определена</b><small>Нет назначения РОПа в учебных данных</small></span>${ctCounter(ctMetric(rows,'client'),'client','none')}${ctCounter(ctMetric(rows,'outlet'),'outlet','none')}${ctButton('Разобрать назначения →','unassigned')}</div>`;
}
function ctValue(r,k){return k==='rop'?ctRop(r.rop):r[k]||'Не указан'}
function ctFiltered(){
 return ctScope().filter(r=>r.type===ct.entity&&(!ct.branch||(ct.branch==='none'?!r.rop:r.rop===ct.branch))&&(!ct.person||(ct.kind==='any'?['manager','regional','hardware'].some(k=>r[k]===ct.person):r[ct.kind]===ct.person))&&
  (ct.view!=='queue'||ctReasons(r).length)&&(!ct.reason||ctReasons(r).includes(ct.reason))&&(!ct.city||r.city===ct.city)&&
  (!ct.q||[r.name,r.code,r.city,r.manager,r.regional,ctRop(r.rop),r.address].join(' ').toLowerCase().includes(ct.q.toLowerCase()))&&
  Object.entries(ct.filters).every(([k,v])=>!v||String(ctValue(r,k)).toLowerCase().includes(v.toLowerCase())));
}
function ctRenderList(){
 const rows=ctFiltered(),pageSize=15,pages=Math.max(1,Math.ceil(rows.length/pageSize));ct.page=Math.min(ct.page,pages);
 const pageRows=rows.slice((ct.page-1)*pageSize,ct.page*pageSize);
 const cols=ctFields.filter(([k])=>ct.columns.includes(k));
 return `<section class="ct-panel">
 ${(ct.branch||ct.person)?`<div class="ct-breadcrumb">${roleHasTeams()?ctButton('← К командам','back-teams'):''}<span>${ct.branch==='none'?'Команда не определена':ctRop(ct.branch)}${ct.person?` <span class="ct-small">/</span> <b>${ctEsc(ct.person)}</b>`:''}</span>${ctButton('Вся доступная база','clear-context','','ct-open')}</div>`:''}
 <div class="ct-tools"><label class="ct-search">${bIcon('search')}<input id="ct-list-search" value="${ctEsc(ct.q)}" placeholder="Клиент, ТТ, код, адрес или сотрудник" aria-label="Поиск клиентов и ТТ"></label>
 <div class="ct-segment">${ctButton('Клиенты','entity','client',ct.entity==='client'?'active':'')}${ctButton('Торговые точки','entity','outlet',ct.entity==='outlet'?'active':'')}</div>
 ${ctButton('Фильтры','filters','','ct-filter-toggle')}
 <details class="ct-column-picker"><summary>Колонки <span>${cols.length}</span></summary><div>${ctFields.map(([k,l])=>`<label><input type="checkbox" data-ct-column="${k}" ${ct.columns.includes(k)?'checked':''} ${k==='name'?'disabled':''}>${l}</label>`).join('')}</div></details>
 ${ctButton(ct.dense?'Плотно':'Обычно','density','','ct-density')}
 </div>
 <div class="ct-filterbar" id="ct-filters"><label>Город <select data-ct-select="city"><option value="">Все города</option>${ctCities.map(c=>`<option ${ct.city===c?'selected':''}>${c}</option>`).join('')}</select></label>
 ${ct.view==='queue'?`<label>Причина <select data-ct-select="reason"><option value="">Все причины</option>${['Не указан РОП','Не указан менеджер','Не указан региональный'].map(c=>`<option ${ct.reason===c?'selected':''}>${c}</option>`).join('')}</select></label>`:''}
 ${ctButton('Сбросить фильтры','reset','','ct-open')}<span class="ct-small">Сброс сохраняет выбранную команду и сотрудника</span></div>
 <div class="ct-resultline"><b>${ctNum(rows.length)} ${ct.entity==='client'?'клиентов':'торговых точек'}</b><span>${ct.view==='queue'?'По назначениям выбранной сущности':'Назначения клиента и ТТ учитываются отдельно'}</span></div>
 <div class="ct-table-scroll"><table class="ct-table"><thead><tr>${cols.map(([k,l])=>`<th>${l}</th>`).join('')}${ct.view==='queue'?'<th>Что заполнить</th>':''}<th></th></tr><tr class="ct-column-filters">${cols.map(([k,l])=>`<th><input data-ct-field="${k}" aria-label="Фильтр: ${l}" value="${ctEsc(ct.filters[k]||'')}" placeholder="Фильтр…"></th>`).join('')}${ct.view==='queue'?'<th></th>':''}<th></th></tr></thead><tbody>
 ${pageRows.map(r=>`<tr>${cols.map(([k,l])=>`<td data-label="${l}">${k==='name'?`<button class="ct-client-name" data-ct="detail" data-val="${r.id}">${ctEsc(r.name)}</button><small>${r.type==='outlet'?`Клиент: ${ctEsc(r.parentName)}`:r.code}</small>`:`<span class="${['Не передано','Не указан','Не назначен'].includes(ctValue(r,k))?'ct-muted':''}">${ctEsc(ctValue(r,k))}</span>`}</td>`).join('')}${ct.view==='queue'?`<td>${ctReasons(r).map(x=>`<span class="ct-reason">${x}</span>`).join('')}</td>`:''}<td><button class="ct-peek" data-ct="detail" data-val="${r.id}" aria-label="Быстрый просмотр ${ctEsc(r.name)}">↗</button></td></tr>`).join('')}
 </tbody></table></div>
 <div class="ct-mobile-rows">${pageRows.map(r=>`<button class="ct-mobile-row" data-ct="detail" data-val="${r.id}"><span><b>${ctEsc(r.name)}</b><small>${r.city} · ${r.manager||'Менеджер не указан'}</small>${ct.view==='queue'?`<em>${ctReasons(r).join(' · ')}</em>`:''}</span><span>›</span></button>`).join('')}</div>
 ${!rows.length?'<div class="ct-empty"><b>Ничего не найдено</b><p>Попробуйте другой запрос или сбросьте фильтры. Область роли не расширяется.</p></div>':''}
 <div class="ct-pagination"><span>${rows.length?`${(ct.page-1)*pageSize+1}–${Math.min(ct.page*pageSize,rows.length)}`:'0'} из ${rows.length}</span><div><button data-ct="prev" ${ct.page===1?'disabled':''}>←</button><span>${ct.page} / ${pages}</span><button data-ct="next" ${ct.page===pages?'disabled':''}>→</button></div></div></section>`;
}
function ctDetail(id){
 const r=ctScope().find(x=>x.id===id);if(!r)return;
 const d=document.getElementById('dialog');d.classList.add('ct-drawer');
 d.innerHTML=`<header><div><span class="ct-small">${r.type==='client'?'Клиент':'Торговая точка'} · быстрый просмотр</span><h2>${ctEsc(r.name)}</h2></div><button data-ct="close" aria-label="Закрыть просмотр">×</button></header>
 <div class="ct-drawer-body"><span class="tag green">${r.status}</span><p class="ct-muted">Демонстрационная запись. Быстрый просмотр не заменяет согласованную полную карточку.</p>
 <h3>Ответственные</h3>${[['РОП',ctRop(r.rop)],['Менеджер',r.manager||'Не указан'],...(r.type==='outlet'?[['Региональный',r.regional||'Не указан']]:[])].map(([k,v])=>`<div class="ct-field"><span>${k}</span><b>${v}</b></div>`).join('')}
 <h3>Адрес и реквизиты</h3>${[['Город',r.city],['Адрес',r.address],['Код 1С',r.code],['ИНН',r.inn]].map(([k,v])=>`<div class="ct-field"><span>${k}</span><b>${v}</b></div>`).join('')}
 ${ctReasons(r).length?`<div class="ct-drawer-warning"><b>Нужно заполнить в 1С</b><p>${ctReasons(r).join(' · ')}</p></div>`:''}
 ${r.type==='client'?`<details open><summary>Торговые точки в моей области</summary>${ctScope().filter(t=>t.parent===r.id).map(t=>`<button class="ct-outlet-item" data-ct="detail" data-val="${t.id}">${t.name}<small>РОП: ${ctRop(t.rop)}</small></button>`).join('')||'<p>Нет доступных ТТ</p>'}</details>`:`<p class="ct-small">Родитель: ${ctEsc(r.parentName)}. Ответственные этой ТТ не наследуются автоматически от клиента.</p>`}
 <details><summary>Дополнительные поля</summary>${['warehouse','club','cashback','next'].map(k=>`<div class="ct-field"><span>${ctFields.find(c=>c[0]===k)[1]}</span><b>${r[k]}</b></div>`).join('')}</details></div>
 <footer>${ctButton('Вернуться к списку','close')}</footer>`;
 if(!d.open)d.showModal();
}
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-ct]');if(!b)return;
 const a=b.dataset.ct,v=b.dataset.val;
 if(a==='detail'){ctDetail(v);return}
 if(a==='assistant-profile'){ctAssistantProfile(v);return}
 if(a==='close'){const d=document.getElementById('dialog');d.close();d.classList.remove('ct-drawer');return}
 if(a==='filters'){document.getElementById('ct-filters').classList.toggle('ct-show');return}
 if(a==='expand'){ct.expanded.has(v)?ct.expanded.delete(v):ct.expanded.add(v)}
 if(a==='collapse'){ct.expanded.clear();ct.teamQ=''}
 if(a==='department'){ct.department=v;ct.missing=false;if(v==='assistants')ct.expanded.add('assistants')}
 if(a==='view'){ct.view=v;ct.branch='';ct.person='';ct.page=1;ct.q='';ct.reason='';ct.filters={}}
 if(a==='metric'){ctJump('','','',v);return}
 if(a==='portfolio'){ctJump(b.dataset.branch,b.dataset.person,b.dataset.kind,b.dataset.entity);return}
 if(a==='queue-branch'){ctJump(v,'','','client',true);return}
 if(a==='unassigned'){ctJump('none','','','client',true);return}
 if(a==='back-teams'){ct.view='teams';ct.person='';ct.branch=''}
 if(a==='clear-context'){ct.branch='';ct.person='';ct.page=1}
 if(a==='entity'){ct.entity=v;ct.page=1}
 if(a==='reset'){ct.q='';ct.city='';ct.reason='';ct.filters={};ct.page=1}
 if(a==='density')ct.dense=!ct.dense;
 if(a==='prev')ct.page--;if(a==='next')ct.page++;
 ctRefresh();
});
document.addEventListener('input',e=>{
 if(e.target.id==='ct-team-search'){ct.teamQ=e.target.value;ctRefresh('ct-team-search')}
 if(e.target.id==='ct-list-search'){ct.q=e.target.value;ct.page=1;ctRefresh('ct-list-search')}
});
document.addEventListener('change',e=>{
 if(e.target.dataset.ctSelect){ct[e.target.dataset.ctSelect]=e.target.value;ct.page=1;ctRefresh()}
 if(e.target.dataset.ctCheck){ct.missing=e.target.checked;ctRefresh()}
 if(e.target.dataset.ctField){ct.filters[e.target.dataset.ctField]=e.target.value;ct.page=1;ctRefresh()}
 if(e.target.dataset.ctColumn){const k=e.target.dataset.ctColumn;ct.columns=e.target.checked?[...ct.columns,k]:ct.columns.filter(x=>x!==k);ctRefresh()}
});
document.addEventListener('click',e=>{
 if(e.target.closest('[data-go="compact-access"]')){
  e.stopImmediatePropagation();
  const d=document.getElementById('dialog');d.classList.remove('ct-drawer');d.innerHTML='<h2>Настройка доступа</h2><p>В рабочем ЛК здесь остаются управление доступом и «Посмотреть как сотрудник». В этом прототипе роли переключаются только для согласования дизайна, реальные права не меняются.</p><button data-close>Понятно</button>';d.showModal();
 }
},true);
