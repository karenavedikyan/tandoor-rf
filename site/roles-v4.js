/* Presentation-only role simulator. Production permissions must be enforced server-side. */
const roleProfiles={
 manager:{label:'Менеджер',name:'Алексей Морозов',initials:'АМ',title:'Мои клиенты',subtitle:'Продажи, заказы и договорённости по закреплённым клиентам.',team:'volkova',clients:['C001','C002'],tabs:['all'],scope:'Только мои подтверждённые назначения',focus:'Продажи и сопровождение',nav:'Мои клиенты',home:'Мой рабочий день',actions:[['orders','Заказы и отгрузки','Проверить готовность и договорённости'],['tasks','Задачи по клиенту','Срок, ответственный, следующий шаг'],['finance','Оплата и документы','Условия и обязательства по клиенту']]},
 regional:{label:'Региональный менеджер',name:'Игорь Соколов',initials:'ИС',title:'Мои торговые точки',subtitle:'Закреплённые ТТ, визиты, витрины и совместная работа с менеджерами.',team:'volkova',clients:['C001','C003','C004'],stores:['TT-1-1','TT-3-1','TT-3-2','TT-4-1'],tabs:['all'],scope:'Только закреплённые клиенты и торговые точки',focus:'Территория и витрины',nav:'Мои клиенты / ТТ',home:'Моя работа на территории',actions:[['passport','Адреса и контакты','Подготовиться к работе на точке'],['distribution','Витрина точки','Образцы, факт и план'],['tasks','Общие задачи','Не дублировать поручения менеджера']]},
 rop:{label:'РОП',name:'Елена Волкова',initials:'ЕВ',title:'Клиенты моей команды',subtitle:'Менеджеры, региональные и собственные клиенты в одной области ответственности.',team:'volkova',clients:['C001','C002','C003','C004'],tabs:['all','teams'],scope:'Своя подтверждённая команда и собственные клиенты',focus:'Команда и контроль',nav:'Клиенты команды',home:'Обзор моей команды',actions:[['tasks','Работа команды','Просмотр задач выбранного клиента'],['finance','Вопросы по оплате','Данные для решения руководителя'],['plans','План клиента','Результат и следующие действия']]},
 director:{label:'Директор',name:'Андрей Власов',initials:'АВ',title:'Вся клиентская база',subtitle:'Все команды, клиенты и торговые точки, включая нераспределённые назначения.',team:'',clients:null,tabs:['all','teams','review'],scope:'Весь состав, включая клиентов вне команд',focus:'Весь отдел ОПТ',nav:'Все клиенты / ТТ',home:'Обзор отдела ОПТ',actions:[['tasks','Работа по клиенту','Контроль исполнения в общей карточке'],['plans','Планы и результат','Без двойного счёта общих клиентов'],['passport','Назначения и данные','Проверка состава и ответственности']]}
};
let prototypeRole='director';
function readPrototypeRole(){
 const p=new URLSearchParams(location.hash.split('?').slice(1).join('?'));
 if(Object.hasOwn(roleProfiles,p.get('role')))prototypeRole=p.get('role');
}
function roleProfile(){return roleProfiles[prototypeRole];}
function roleCanReview(){return prototypeRole==='director';}
function roleHasTeams(){return ['director','rop'].includes(prototypeRole);}
function roleClientTitle(){return roleProfile().title;}
function roleScopedClients(){
 const r=roleProfile();
 return baseClients.filter(c=>!r.clients||r.clients.includes(c.id)).map(c=>{
  const stores=r.stores?c.stores.filter(t=>r.stores.includes(t.id)):c.stores;
  return {...c,stores,outlets:stores.length};
 });
}
function roleScopedTeams(){return prototypeRole==='director'?baseTeams:baseTeams.filter(t=>t.id===roleProfile().team);}
function roleNormalizeBase(){
 if(!roleProfile().tabs.includes(baseState.view))baseState.view='all';
 if(prototypeRole!=='director'&&baseState.team&&baseState.team!==roleProfile().team)baseState.team='';
}
function rolePicker(){
 return `<label class="r-picker"><span>Показать роль</span><select id="prototype-role" aria-label="Показать интерфейс роли">${Object.entries(roleProfiles).map(([k,r])=>`<option value="${k}" ${k===prototypeRole?'selected':''}>${r.label}</option>`).join('')}</select></label>`;
}
function roleContext(){
 const r=roleProfile();
 return `<section class="r-context"><div class="avatar">${r.initials}</div><div><strong>${r.name}</strong><span>${r.label} · ${r.focus}</span></div><div class="r-scope"><span>Область видимости</span><strong>${r.scope}</strong></div><button class="link" data-role-rules>Правила роли ${bIcon('info')}</button></section>`;
}
function roleSummary(){
 const cs=roleScopedClients(),r=roleProfile(),stores=cs.flatMap(c=>c.stores),managers=new Set(cs.map(c=>c.manager));
 const metrics=prototypeRole==='director'?[['Клиенты',cs.length],['Торговые точки',stores.length],['Команды РОПов',baseTeams.length],['Требуют проверки',cs.filter(c=>c.review!=='Подтверждено').length]]:
 prototypeRole==='rop'?[['Клиенты команды',cs.length],['Торговые точки',stores.length],['Сотрудники команды',3],['Мои клиенты',cs.filter(c=>c.manager===r.name).length]]:
 prototypeRole==='regional'?[['Клиенты',cs.length],['Мои ТТ',stores.length],['Города назначений',new Set(cs.map(c=>c.city)).size],['Без осмотра', 'Нет данных']]:
 [['Мои клиенты',cs.length],['Торговые точки',stores.length],['Без ТТ',cs.filter(c=>!c.outlets).length],['Просроченные задачи','Нет данных']];
 return `<div class="b-summary r-summary">${metrics.map(([l,v])=>`<div><b>${v}</b><span>${l}</span></div>`).join('')}<span class="b-dataset">Учебная выборка<br>Не выгрузка 1С</span></div>`;
}
function roleBaseTabs(){return [['all','list',prototypeRole==='director'?'Все клиенты':prototypeRole==='rop'?'Клиенты команды':'Моя база'],['teams','network',prototypeRole==='rop'?'Моя команда':'По командам'],['review','clipboard-check','Требуют проверки']].filter(([id])=>roleProfile().tabs.includes(id));}
function roleQuickFilters(){
 const r=roleProfile(),cs=roleScopedClients();
 return `<div class="b-quick">${prototypeRole==='director'?`<label>РОП<select id="b-team"><option value="">Все команды</option>${roleScopedTeams().map(t=>`<option value="${t.id}" ${baseState.team===t.id?'selected':''}>${t.name}</option>`).join('')}</select></label>`:`<span class="r-fixed">${bIcon('lock-keyhole')} ${prototypeRole==='manager'?'Мои назначения':prototypeRole==='regional'?'Моя закреплённая область':`Команда: ${r.name}`}</span>`}
 ${prototypeRole!=='manager'?`<label>Менеджер<select id="b-manager">${baseOptions(cs.filter(c=>!baseState.team||c.team===baseState.team).map(c=>c.manager),baseState.manager,'Все в моей области')}</select></label>`:''}
 ${roleCanReview()?`<label>Назначение<select id="b-reason">${baseOptions(cs.map(c=>c.review),baseState.reason,'Все назначения')}</select></label>`:''}
 <button class="link" data-breset>Сбросить фильтры</button><span class="b-hint">Фильтры сужают область, но не расширяют права</span></div>`;
}
function roleRegionalRows(t,clients){
 const name=t.id==='volkova'?'Игорь Соколов':'Мария Власова';
 const scoped=clients.filter(c=>c.rm===name);
 const tt=scoped.reduce((s,c)=>s+c.stores.filter(x=>t.id!=='volkova'||roleProfiles.regional.stores.includes(x.id)).length,0);
 return `<div class="r-teamsection">Региональные менеджеры</div><button class="b-managerrow" data-bregional="${be(name)}"><span class="avatar">${name.split(' ').map(x=>x[0]).join('')}</span><span><strong>${name}</strong><small>Совместная работа · не отдельная команда</small></span><span class="b-managercounts"><b>${scoped.length}</b> клиентов · ${tt} ТТ ${bIcon('chevron-right')}</span></button>`;
}
function roleOwnClients(t,cs){
 const n=cs.filter(c=>c.manager===t.name).length;
 return `<button class="r-own" data-bperson="${be(t.name)}" data-bteamid="${t.id}">Собственные клиенты РОПа <b>${n}</b> ${bIcon('chevron-right')}</button>`;
}
function roleCardActions(c){
 const r=roleProfile();
 return `${roleContext()}<div class="r-cardactions"><span class="small muted">В фокусе роли</span>${r.actions.map(([id,l])=>`<button data-go="${id}">${l} →</button>`).join('')}</div>${prototypeRole==='regional'?`<div class="r-restriction">${bIcon('shield-check')} В этой карточке показаны только закреплённые за вами ТТ. Другие точки этого клиента не открываются автоматически.</div>`:''}`;
}
function roleDeniedCard(){
 return `<section class="card pad"><h2>Клиент вне области этой роли</h2><p class="sub">Прямая ссылка не расширяет область видимости. Содержимое карточки не отображается.</p><button class="primary" data-go="clients">Вернуться к доступным клиентам</button></section>`;
}
function roleNav(items){
 return items.filter(([id])=>!['team','analytics'].includes(id)||roleHasTeams()).map(([id,label,icon,section])=>{
  if(id==='ship')return ['role-home','Моя работа',icon,'role-home'];
  if(id==='clients')return [id,roleProfile().nav,icon,section];
  if(id==='team')return ['clients',prototypeRole==='director'?'Все команды':'Моя команда',icon,'teams'];
  return [id,label,icon,section];
 });
}
function renderRoleHome(){
 const r=roleProfile(),cs=roleScopedClients();
 return roleContext()+roleSummary()+`<div class="r-homegrid"><section class="card"><div class="cardhead"><h2>${r.focus}</h2><span class="source">Рабочий приоритет роли</span></div><div class="r-homelead"><h3>${prototypeRole==='manager'?'Начните с клиента и следующего действия':prototypeRole==='regional'?'Подготовьте работу на закреплённых точках':prototypeRole==='rop'?'Посмотрите нагрузку и состав своей команды':'Посмотрите весь отдел и нераспределённые назначения'}</h3><p>${r.subtitle}</p><button class="primary" data-role-base>${prototypeRole==='regional'?'Мои торговые точки':roleHasTeams()?'Открыть команды':'Открыть моих клиентов'} →</button></div>${r.actions.map(([id,l,d])=>`<div class="item"><strong>${l}</strong><p>${d}. Откройте клиента из своей базы.</p></div>`).join('')}</section><section class="card"><div class="cardhead"><h2>Быстрый переход к клиенту</h2><span class="source">${cs.length} доступно</span></div>${cs.slice(0,4).map(c=>`<button class="r-homeclient" data-bclient="${c.id}"><span><strong>${be(c.name)}</strong><small>${be(c.city)} · ${c.outlets} доступных ТТ</small></span>${bIcon('arrow-right')}</button>`).join('')}<div class="pad small muted">Одна карточка для всех участников. Меняются область данных и приоритет действий, а не сам клиент.</div></section></div>`;
}
function showRoleRules(){
 const r=roleProfile();
 $('#dialog').innerHTML=`<h2>${r.label}: правила интерфейса</h2><p><strong>${r.scope}.</strong> ${r.subtitle}</p><ul class="r-rulelist"><li>Таблица, поиск, счётчики, варианты фильтров и карточка используют одну область данных.</li><li>${roleHasTeams()?'Команда включает менеджеров продаж и региональных. Общие клиенты считаются один раз.':'Подчинённых и раздела «Команды» нет. Совместная работа с коллегами не даёт доступа ко всей их базе.'}</li><li>${roleCanReview()?'Все нераспределённые клиенты видны в режиме «Требуют проверки». Просмотр не даёт административных прав на изменение назначений.':'Клиенты вне подтверждённой области не показываются, в том числе по прямой ссылке.'}</li><li>Нет автопереназначения, автоматического архивирования или записи в 1С.</li></ul><p class="small muted">Это симуляция интерфейса. Реальные права, ограничения полей и временные доступы проверяет сервер ЛК. Не реализованные права нельзя выводить из наличия кнопки в макете.</p><button data-close>Понятно</button>`;
 $('#dialog').showModal();
}
function switchPrototypeRole(role){
 if(!Object.hasOwn(roleProfiles,role))return;
 prototypeRole=role;baseSelectedId=null;baseScroll=0;
 baseState={...baseState,view:roleHasTeams()?'teams':'all',entity:role==='regional'?'stores':'clients',q:'',team:'',manager:'',reason:'',filters:{},page:1};
 baseReturnHash=`clients?role=${role}`;baseWriteUrl();current='clients';render();
}
document.addEventListener('change',e=>{if(e.target.id==='prototype-role')switchPrototypeRole(e.target.value)});
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-role-rules'))showRoleRules();
 if(b.hasAttribute('data-role-base')){baseState.view=roleHasTeams()?'teams':'all';baseState.entity=prototypeRole==='regional'?'stores':'clients';baseWriteUrl();current='clients';render();}
 if(b.dataset.bregional){baseState.view='all';baseState.filters={rm:b.dataset.bregional};baseState.page=1;baseFull();}
});
