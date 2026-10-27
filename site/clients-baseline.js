/* Target UI only. Synthetic data; production access is always enforced server-side. */
(() => {
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const registry=[];
 const addField=(id,label,group,source,type='text',access='work',added=false)=>registry.push({id,label,group,source,type,access,added});
 [
  ['clientId','GUID клиента','guid_client','id'],['clientName','Название клиента','name_client'],
  ['holdingId','GUID холдинга','guid_holding','id'],['holdingName','Холдинг','name_holding'],
  ['isHolding','Карточка холдинга','holding','bool'],['clientAddress','Адрес клиента','address'],
  ['clientPhones','Телефоны клиента','telephone']
 ].forEach(([id,l,s,t])=>addField(id,l,'Клиент и холдинг',s,t));
 const staff=[['manager','Менеджер','manager'],['regional','Региональный','regional_manager'],['hardware','По фурнитуре','hardware_manager'],['rop','РОП','head_of_the_sales_department']];
 for(const scope of ['client','outlet'])for(const [key,label,raw] of staff){
  addField(`${scope}_${key}`,`${label} ${scope==='client'?'клиента':'ТТ'}`,scope==='client'?'Ответственные клиента':'Ответственные ТТ',`${scope==='outlet'?'retail_outlets[].managers.':''}name_${raw}`);
  addField(`${scope}_${key}Id`,`GUID: ${label} ${scope==='client'?'клиента':'ТТ'}`,scope==='client'?'Ответственные клиента':'Ответственные ТТ',`${scope==='outlet'?'retail_outlets[].managers.':''}guid_${raw}`,'id');
 }
 [['outletId','GUID торговой точки','guid_store','id'],['outletHolding','Холдинг из ТТ','holding'],['closed','Точка закрыта','closed','bool'],['warehouse','Склад','warehouse','bool']].forEach(([id,l,s,t])=>addField(id,l,'Торговая точка',`retail_outlets[].${s}`,t));
 [['storeAddress','Адрес магазина','store_address'],['deliveryAddress','Адрес доставки','delivery_address'],['route','Направление маршрута','direction_of_the_route']].forEach(([id,l,s])=>addField(id,l,'Доставка и приёмка',`retail_outlets[].address.${s}`));
 const days=[['monday','Понедельник'],['tuesday','Вторник'],['wednesday','Среда'],['thursday','Четверг'],['friday','Пятница'],['saturday','Суббота'],['sunday','Воскресенье']];
 days.forEach(([d,l])=>addField(d,`Приёмка: ${l}`,'Доставка и приёмка',`retail_outlets[].information_loading.loading_on_${d}`,'bool'));
 addField('loadingTime','Начало приёмки','Доставка и приёмка','retail_outlets[].information_loading.loading_time','time');
 [['storePhone','Телефон магазина','store_phone'],['accountantPhone','Телефон бухгалтерии','accountant_phone'],['accountantEmail','Почта бухгалтерии','accountant_email']].forEach(([id,l,s])=>addField(id,l,'Рабочие контакты',`retail_outlets[].contact_information.${s}`));
 [['lprName','ФИО ЛПР','name'],['lprPost','Должность ЛПР','post'],['lprPhone','Телефон ЛПР','phone'],['lprEmail','Email ЛПР','email'],['lprBirth','Дата рождения ЛПР','date_of_birth','date','personal']].forEach(([id,l,s,t,a])=>addField(id,l,'Контакт ЛПР',`retail_outlets[].LPR_information.${s}`,t,a,true));
 addField('lprBonus','Бонус ЛПР','Бонусные условия','retail_outlets[].LPR_information.bonus','text','personal',true);
 addField('lprTerms','Условия бонуса ЛПР','Бонусные условия','retail_outlets[].LPR_information.conditions_bonus','text','personal',true);
 addField('club','Статус Tandoor Club','Tandoor Club','retail_outlets[].additional_information.status_tandoor_club');
 addField('clubBonus','Бонус Tandoor Club','Tandoor Club','retail_outlets[].additional_information.bonus_tandoor_club','text','personal',true);
 const planned=(id,label,group,type='text',relation='client')=>{
  addField(id,label,group,'JSON-путь 1С: требуется сопоставление',type,'work',true);
  Object.assign(registry[registry.length-1],{planned:true,relation});
 };
 planned('topCategory','ТОП-категория холдинга','Категория холдинга','enum');
 [['legalId','GUID юрлица','id'],['legalName','Юридическое лицо'],['inn','ИНН'],['kpp','КПП'],['legalAddress','Юридический адрес'],['bank','Банк'],['bik','БИК'],['account','Расчётный счёт'],['corrAccount','Корреспондентский счёт']]
  .forEach(([id,label,type])=>planned(id,label,'Юридические лица и реквизиты',type,'legal'));
 [['contractId','GUID договора','id'],['contractNumber','Номер договора'],['contractDate','Дата договора','date'],['contractStatus','Статус договора','enum'],['paymentType','Вид оплаты'],['deferDays','Отсрочка, дней','number'],['creditLimit','Лимит договора','number']]
  .forEach(([id,label,type])=>planned(id,label,'Договоры и условия',type,'contract'));
 [['discountProgram','Скидочная программа','Discount','text'],['discountAmount','Значение скидки','DiscountAmount','number'],['markupName','Наименование наценки','Markups[].Name','text'],['markupPercentage','Значение наценки','Markups[].Percentage','number']]
  .forEach(([id,label,source,type])=>{addField(id,label,'Коммерческие условия',source,type);registry[registry.length-1].relation='client'});
 const clientRows=Array.from({length:6},(_,i)=>({
  id:`DEMO-C${i+1}`,clientId:`DEMO-C${i+1}`,clientName:['Южный дом','Дверной квартал','Линия интерьера','Новый формат','Дом и стиль','Галерея дверей'][i],
  holdingId:i<3?'DEMO-H1':null,holdingName:i<3?'Группа «Юг»':null,isHolding:i===0,
  clientAddress:['Краснодар','Армавир','Майкоп'][i%3]+', Учебная улица, '+(i+1),clientPhones:'Демо-телефон',
  client_manager:i<3?'Алексей Морозов':'Павел Лебедев',client_regional:'Игорь Соколов',client_hardware:null,
  client_rop:i<3?'Елена Волкова':'Дмитрий Орлов',client_managerId:i<3?'DEMO-M1':'DEMO-M2',client_regionalId:'DEMO-R1',client_hardwareId:null,client_ropId:i<3?'DEMO-ROP1':'DEMO-ROP2'
 }));
 const outletRows=clientRows.flatMap((c,i)=>Array.from({length:i===5?0:2},(_,j)=>({
  ...c,id:`${c.id}-T${j+1}`,outletId:`${c.id}-T${j+1}`,outletHolding:c.holdingName,
  closed:i===4&&j===1,warehouse:j===1,storeAddress:['Краснодар','Армавир','Майкоп'][i%3]+`, Демонстрационная, ${10+i*2+j}`,
  deliveryAddress:j?null:`Демо-склад №${i+1}`,route:['Краснодар','Армавир','Майкоп'][i%3],
  outlet_manager:c.client_manager,outlet_managerId:c.client_managerId,
  outlet_regional:i===2&&j===1?'Мария Власова':'Игорь Соколов',outlet_regionalId:i===2&&j===1?'DEMO-R2':'DEMO-R1',
  outlet_hardware:i%2?'Максим Савельев':null,outlet_hardwareId:i%2?'DEMO-HW1':null,outlet_rop:c.client_rop,outlet_ropId:c.client_ropId,
  monday:true,tuesday:i%2===0,wednesday:true,thursday:true,friday:true,saturday:j===1,sunday:false,loadingTime:j?'10:00':'09:00',
  storePhone:'Демо-телефон магазина',accountantPhone:i%2?null:'Демо-телефон бухгалтерии',accountantEmail:i%2?null:`accounts-${i}@example.test`,
  lprName:(i+j)%3||i===0?['Марина Крылова','Сергей Ильин','Анна Белова'][i%3]:null,
  lprPost:(i+j)%3||i===0?'Управляющий':null,lprPhone:(i+j)%3||i===0?'Демо-телефон ЛПР':null,lprEmail:(i+j)%3||i===0?`contact-${i}@example.test`:null,
  lprBirth:i===0?'1988-04-12':null,lprBonus:i===0?'0':null,lprTerms:i===0?'По индивидуальному соглашению':null,
  club:['Gold','Silver',null,'Platinum',null][i],clubBonus:i===0?'0':i===1?'По программе':null
 })));
 // Synthetic relations only. These field ids are UI model names, NOT confirmed 1C JSON keys.
 const legalRows=[];
 clientRows.forEach((c,i)=>{
  c.topCategory=c.holdingId?'ТОП-150':['ТОП-350','ТОП-500',null][i-3];
  c.discountProgram=i%2?'Партнёрская':'Базовая';c.discountAmount=i===0?0:5;
  c.markupName='Заказная комплектация';c.markupPercentage=i===0?0:3;
  for(let j=0;j<(i===0?2:i===5?0:1);j++){
   const n=i*2+j+1,legalId=`DEMO-L${n}`;
   legalRows.push({clientId:c.id,legalId,legalName:`ООО «${c.clientName}${j?' Сервис':''}»`,
    inn:`ДЕМО-ИНН-${String(n).padStart(3,'0')}`,kpp:j?null:`ДЕМО-КПП-${String(n).padStart(3,'0')}`,
    legalAddress:`Учебный город, ул. Макетная, ${n}`,bank:'Демонстрационный банк',
    bik:`ДЕМО-БИК-${n}`,account:`ДЕМО-РС-${n}`,corrAccount:`ДЕМО-КС-${n}`,
    outletIds:outletRows.filter(o=>o.clientId===c.id).map(o=>o.id),
    contracts:[{contractId:`DEMO-D${n}`,contractNumber:`ДЕМО-2026/${String(n).padStart(2,'0')}`,
     contractDate:'2026-01-15',contractStatus:j?'Архивный':'Действующий',
     paymentType:'Безналичный расчёт',deferDays:j?0:14,creditLimit:j?0:500000}]
   });
  }
 });
 const clientFor=r=>clientIndex.get(r.clientId)||r;
 const legalFor=r=>(legalIndex.get(clientFor(r).id)||[]).filter(l=>!r.outletId||l.outletIds.includes(r.outletId));
 const values=(r,f)=>f.relation==='legal'?legalFor(r).map(l=>l[f.id]):
  f.relation==='contract'?legalFor(r).flatMap(l=>l.contracts.map(c=>c[f.id])):
  [f.relation==='client'?clientFor(r)[f.id]:r[f.id]];
 const displayValue=(r,f)=>{const vs=[...new Set(values(r,f).filter(v=>!empty(v)))];return vs.length===1?vs[0]:vs.length?vs.join('; '):null};
 // Explicit synthetic employee links; membership is not inferred from a person's name.
 const employees=[
  {id:'DEMO-ROP1',name:'Елена Волкова',team:'DEMO-ROP1',kinds:['rop'],account:true},
  {id:'DEMO-M1',name:'Алексей Морозов',team:'DEMO-ROP1',kinds:['manager','hardware'],account:true},
  {id:'DEMO-R1',name:'Игорь Соколов',team:'DEMO-ROP1',kinds:['regional'],account:true},
  {id:'DEMO-HW1',name:'Максим Савельев',team:'DEMO-ROP1',kinds:['hardware'],account:false},
  {id:'DEMO-ROP2',name:'Дмитрий Орлов',team:'DEMO-ROP2',kinds:['rop'],account:true},
  {id:'DEMO-M2',name:'Павел Лебедев',team:'DEMO-ROP2',kinds:['manager'],account:true},
  {id:'DEMO-R2',name:'Мария Власова',team:'DEMO-ROP2',kinds:['regional'],account:true}
 ];
 const kindLabel={manager:'Менеджер',regional:'Региональный',hardware:'По фурнитуре',rop:'РОП',director:'Директор',employee:'Сотрудник'};
 const employee=id=>employees.find(e=>e.id===id);
 const assign=(r,scope,kind,id)=>{r[`${scope}_${kind}Id`]=id;r[`${scope}_${kind}`]=employee(id)?.name||null};
 clientRows.forEach((c,i)=>{assign(c,'client','regional',i<3?'DEMO-R1':'DEMO-R2');if(i===1)assign(c,'client','hardware','DEMO-M1')});
 outletRows.forEach(o=>{const c=clientRows.find(c=>c.id===o.clientId);for(const [key] of staff){o[`client_${key}`]=c[`client_${key}`];o[`client_${key}Id`]=c[`client_${key}Id`]}assign(o,'outlet','regional',c.client_regionalId)});
 for(const id of ['DEMO-C1-T2','DEMO-C3-T2']){
  const o=outletRows.find(o=>o.id===id);assign(o,'outlet','manager',id==='DEMO-C1-T2'?'DEMO-M2':null);assign(o,'outlet','regional','DEMO-R2');assign(o,'outlet','rop','DEMO-ROP2');
 }
 assign(outletRows.find(o=>o.id==='DEMO-C2-T2'),'outlet','hardware','DEMO-M1');
 assign(outletRows.find(o=>o.id==='DEMO-C4-T1'),'outlet','manager','DEMO-M1');
 assign(outletRows.find(o=>o.id==='DEMO-C4-T1'),'outlet','rop','DEMO-ROP1');
 const demoScale=window.buildTandoorDemoScale({clients:clientRows,outlets:outletRows,legals:legalRows,employees});
 clientRows.splice(0,clientRows.length,...demoScale.clients);
 outletRows.splice(0,outletRows.length,...demoScale.outlets);
 legalRows.splice(0,legalRows.length,...demoScale.legals);
 employees.splice(0,employees.length,...demoScale.employees);
 const inTeam=(e,team)=>e.teams?.includes(team)||e.team===team;
 const clientIndex=new Map(clientRows.map(c=>[c.id,c]));
 const legalIndex=new Map();
 legalRows.forEach(l=>{if(!legalIndex.has(l.clientId))legalIndex.set(l.clientId,[]);legalIndex.get(l.clientId).push(l)});
 const assignments=(r,scope,id)=>staff.filter(([k])=>r[`${scope}_${k}Id`]===id).map(([k])=>kindLabel[k]);
 const direct=(r,scope,id)=>assignments(r,scope,id).length>0;
 const teamCache=new Map();
 const teamRows=(entity,team)=>{
  const key=`${entity}:${team}`;
  if(!teamCache.has(key)){
   const scope=entity==='clients'?'client':'outlet';
   teamCache.set(key,(entity==='clients'?clientRows:outletRows).filter(r=>r[`${scope}_ropId`]===team));
  }
  return teamCache.get(key);
 };
 const roleEmployee=()=>({manager:'DEMO-M1',regional:'DEMO-R1',rop:'DEMO-ROP1'})[prototypeRole]||'';
 const assistantDirectory=()=>Boolean(window.AssistantDirectory?.active());
 const directoryOpen=()=>current==='exchange'||assistantDirectory();
 const baseRows=entity=>{
  if(assistantDirectory())return window.AssistantDirectory.rows(entity);
  if(prototypeRole==='admin')return entity==='clients'?clientRows:outletRows;
  if(prototypeRole==='director'){const allowed=new Set(directorRopIds.flatMap(id=>teamRows(entity,id)).map(r=>r.id));return (entity==='clients'?clientRows:outletRows).filter(r=>allowed.has(r.id))}
  if(prototypeRole==='rop')return teamRows(entity,'DEMO-ROP1');
  return (entity==='clients'?clientRows:outletRows).filter(r=>direct(r,entity==='clients'?'client':'outlet',roleEmployee()));
 };
 const sales=window.TandoorClientSales.create({clients:clientRows,outlets:outletRows,legals:legalRows,legalFor});
 registry.push(...sales.fields);
 const groupNames=[...new Set(registry.map(f=>f.group))];
 // Owner-approved policy: all fields of an accessible record; scope still restricts records.
 const canSee=f=>Boolean(f);
 const isClientField=f=>f&&(['Клиент и холдинг','Ответственные клиента'].includes(f.group)||!!f.relation);
 const availableFields=()=>registry.filter(f=>(state.entity==='outlets'||isClientField(f))&&canSee(f));
 const filterFields=()=>registry.filter(canSee);
 const find=id=>registry.find(f=>f.id===id);
 const empty=v=>v===null||v===undefined||v==='';
 const format=(v,f)=>sales.formatted(v,f)??(empty(v)?(f.group.startsWith('Ответственные')?'Не назначен в 1С':assistantDirectory()?'Данные появятся после выгрузки из 1С':'Не передано'):f.type==='bool'?(v?'Да':'Нет'):String(v));
 const directorRopIds=demoScale.teams.map(t=>t.id);
 const defaultMode=()=>prototypeRole==='rop'?'staff':['director','admin'].includes(prototypeRole)?'teams':'list';
 const defaultColumns=entity=>entity==='clients'?['clientName','topCategory','salesRub','salesByLegal','client_manager','client_rop']:['clientName','storeAddress','outlet_manager','lprName','club'];
 let state={entity:'clients',mode:'list',q:'',rules:[],columns:defaultColumns('clients'),page:1,selected:'',fieldSearch:'',filterOpen:false,team:'',employee:'',tab:'overview',focus:false,focusColumns:[],focusScroll:{top:0,left:0}};
 let trail=[];
 let focusFilterTimer;
 const cancelFocusFilterTimer=()=>{clearTimeout(focusFilterTimer);focusFilterTimer=null};
 const isFocus=()=>state.focus&&state.mode==='list';
 const defaultFocusColumns=(base=state.columns)=>[
  'clientName',...(state.entity==='clients'?['clientAddress','topCategory','legalName','inn','contractNumber','paymentType','deferDays','creditLimit','discountAmount','markupPercentage']:['storeAddress','deliveryAddress','route','loadingTime','lprName','storePhone','accountantEmail','club','clubBonus','closed']),
  ...base.filter(id=>!/^((client|outlet)_(manager|regional|hardware|rop)(Id)?)$/.test(id))
 ].filter((id,i,all)=>all.indexOf(id)===i&&availableFields().some(f=>f.id===id));
 function captureFocusScroll(){
  const pane=document.getElementById('x14-focus-scroll');
  if(isFocus()&&pane)state.focusScroll={top:pane.scrollTop,left:pane.scrollLeft};
 }
 function toggleFocus(on){
  cancelFocusFilterTimer();
  captureFocusScroll();state.focus=on;
  if(on&&!state.focusColumns.length)state.focusColumns=defaultFocusColumns();
  write();document.querySelector(on?'[data-x6="focus-exit"]':'[data-x6="focus-enter"]')?.focus({preventScroll:true});
 }
 const snapshot=()=>JSON.parse(JSON.stringify(state));
 function move(patch){
  cancelFocusFilterTimer();
  captureFocusScroll();
  if(isFocus())history.replaceState({...history.state,focusScroll:state.focusScroll},'');
  trail.push(snapshot());state={...state,...patch};write(true);window.scrollTo(0,0);
 }
 function back(){
  if(trail.length){state=trail.pop();write();window.scrollTo(0,0);return}
  if(state.mode==='card'){state.mode='list';state.selected=''}
  else if(state.employee){state.employee='';state.mode='staff';state.q='';state.rules=[]}
  else if(state.mode==='staff'&&prototypeRole!=='rop'){state.mode='teams';state.team=''}
  else {state.mode=defaultMode();state.team=prototypeRole==='rop'?'DEMO-ROP1':'';state.employee=''}
  write();window.scrollTo(0,0);
 }
 function allowedHeads(){return demoScale.teams.map(t=>employee(t.id)).filter(e=>prototypeRole==='admin'||prototypeRole==='rop'?prototypeRole==='admin'||e.id===roleEmployee():directorRopIds.includes(e.id))}
 function normalizeContext(){
  if(assistantDirectory()){
   state.team='';state.employee='';
   if(!['list','card','fields'].includes(state.mode))state.mode='list';
   if(['work','plan'].includes(state.tab))state.tab='overview';
   if(state.mode==='card'&&!baseRows(state.entity).some(r=>r.id===state.selected)){state.mode='list';state.selected=''}
   if(!['list','card'].includes(state.mode))state.focus=false;
   return;
  }
  if(prototypeRole==='rop')state.team='DEMO-ROP1';
  if(['manager','regional'].includes(prototypeRole)){state.team='';state.employee='';if(['teams','staff'].includes(state.mode))state.mode='list'}
  if(state.team&&!allowedHeads().some(e=>e.id===state.team)){state.team='';state.employee='';state.mode=defaultMode()}
  if(state.employee&&!employees.some(e=>e.id===state.employee&&inTeam(e,state.team))){state.employee='';state.mode='staff'}
  if(state.mode==='staff'&&!state.team)state.mode=defaultMode();
  if(!['list','card'].includes(state.mode))state.focus=false;
 }
 function portfolioRows(entity){
  let rows=baseRows(entity);
  if(state.team){const allowed=new Set(teamRows(entity,state.team).map(r=>r.id));rows=rows.filter(r=>allowed.has(r.id))}
  if(state.employee)rows=rows.filter(r=>direct(r,entity==='clients'?'client':'outlet',state.employee));
  return rows;
 }
 const scoped=()=>portfolioRows(state.entity);
 function matches(r,rule){
   const f=find(rule.field);if(!f||!canSee(f))return false;const v=r[f.id],s=empty(v)?'':String(v).toLowerCase(),q=rule.value.toLowerCase();
   if(rule.op==='empty')return empty(v);if(rule.op==='filled')return !empty(v);
   if(rule.op==='yes')return v===true;if(rule.op==='no')return v===false;
   if(rule.op==='eq')return s===q;if(rule.op==='in')return q.split('|').includes(s);if(rule.op==='gte')return !empty(v)&&(f.type==='number'?Number(v)>=Number(q):s>=q);if(rule.op==='lte')return !empty(v)&&(f.type==='number'?Number(v)<=Number(q):s<=q);
   return s.includes(q);
 }
 function matchesWithRelations(r,rules){
  const ordinary=rules.filter(rule=>!['legal','contract'].includes(find(rule.field)?.relation));
  if(!ordinary.every(rule=>matches(find(rule.field).relation==='client'?clientFor(r):r,rule)))return false;
  const lr=rules.filter(rule=>find(rule.field)?.relation==='legal'),cr=rules.filter(rule=>find(rule.field)?.relation==='contract');
  if(!lr.length&&!cr.length)return true;
  const ls=legalFor(r);
  // Missing related records count as empty fields, but never satisfy filled/value conditions.
  return (ls.length?ls:[{contracts:[]}]).some(l=>lr.every(rule=>matches(l,rule))&&(!cr.length||(l.contracts.length?l.contracts:[{}]).some(c=>cr.every(rule=>matches(c,rule)))));
 }
 function filtered(){
  const own=state.rules.filter(rule=>isClientField(find(rule.field))),tt=state.rules.filter(rule=>!isClientField(find(rule.field)));
  const matchingClientIds=state.entity==='clients'&&tt.length?new Set(portfolioRows('outlets').filter(o=>tt.every(rule=>matches(o,rule))).map(o=>o.clientId)):null;
  const rows=scoped().filter(r=>{
   if(state.q&&!availableFields().some(f=>values(r,f).some(v=>!empty(v)&&String(v).toLowerCase().includes(state.q.toLowerCase()))))return false;
   if(state.entity==='outlets')return matchesWithRelations(r,state.rules);
   return matchesWithRelations(r,own)&&(!matchingClientIds||matchingClientIds.has(r.id));
  });
  const f=find(state.sort);
  if(f)rows.sort((a,b)=>{
   const key=r=>{
    if(f.type!=='number')return displayValue(r,f);
    const nums=values(r,f).filter(v=>!empty(v)).map(Number).filter(Number.isFinite);
    return nums.length?Math.max(...nums):null;
   };
   const av=key(a),bv=key(b);
   if(empty(av)||empty(bv))return empty(av)===empty(bv)?0:empty(av)?1:-1;
   return (f.type==='number'?Number(av)-Number(bv):String(av).localeCompare(String(bv),'ru',{numeric:true}))*(state.sortDir==='asc'?1:-1);
  });
  return rows;
 }
 function write(push=false){
  captureFocusScroll();
  normalizeContext();
  const p=new URLSearchParams({role:prototypeRole,entity:state.entity,mode:state.mode});
  if(state.q)p.set('q',state.q);if(state.rules.length)p.set('filters',JSON.stringify(state.rules));
  if(state.team)p.set('team',state.team);if(state.employee)p.set('employee',state.employee);
  p.set('cols',state.columns.join(','));if(state.selected)p.set('record',state.selected);
  p.set('page',state.page);if(state.tab!=='overview')p.set('tab',state.tab);
  p.set('filterOpen',state.filterOpen?'1':'0');
  p.set('month',sales.month);if(state.salesLegal)p.set('salesLegal',state.salesLegal);
  if(state.sort){p.set('sort',state.sort);p.set('sortDir',state.sortDir||'desc')}
  if(state.focus){p.set('focus','1');p.set('focusCols',state.focusColumns.join(','))}
  if(assistantDirectory())Object.entries(window.AssistantDirectory.params()).forEach(([k,v])=>p.set(k,v));
  history[push?'pushState':'replaceState']({territoryTrail:trail,role:prototypeRole,focusScroll:state.focusScroll},'',`#${assistantDirectory()?current:'exchange'}?${p}`);paint();
 }
 function read(){
  cancelFocusFilterTimer();
  const p=new URLSearchParams(location.hash.split('?')[1]||'');state.entity=p.get('entity')==='outlets'?'outlets':'clients';
  state.mode=['fields','teams','staff','card','list'].includes(p.get('mode'))?p.get('mode'):defaultMode();state.q=p.get('q')||'';
  state.team=p.get('team')||'';state.employee=p.get('employee')||'';
  try{const v=JSON.parse(p.get('filters')||'[]');state.rules=Array.isArray(v)?v.filter(r=>r&&typeof r.value==='string'&&filterFields().some(f=>f.id===r.field)&&['empty','filled','yes','no','eq','in','contains','gte','lte'].includes(r.op)).slice(0,registry.length*2):[]}catch{state.rules=[]}
  state.columns=(p.get('cols')||defaultColumns(state.entity).join(',')).split(',').filter(id=>availableFields().some(f=>f.id===id));
  if(!state.columns.includes('clientName'))state.columns.unshift('clientName');
  state.selected=p.get('record')||'';
  state.page=Math.max(1,Number(p.get('page'))||1);state.tab=p.get('tab')||'overview';state.filterOpen=p.get('filterOpen')==='1';
  sales.setMonth(p.get('month'));state.salesLegal=p.get('salesLegal')||'';
  state.sort=availableFields().some(f=>f.id===p.get('sort'))?p.get('sort'):'';
  state.sortDir=p.get('sortDir')==='asc'?'asc':'desc';
  state.focus=p.get('focus')==='1'&&['list','card'].includes(state.mode);
  state.focusColumns=(p.get('focusCols')||'').split(',').filter((id,i,all)=>all.indexOf(id)===i&&availableFields().some(f=>f.id===id));
  if(state.focus){if(!state.focusColumns.length)state.focusColumns=defaultFocusColumns();state.focusColumns=['clientName',...state.focusColumns.filter(id=>id!=='clientName')]}
  state.focusScroll=history.state?.focusScroll||{top:0,left:0};
  trail=history.state?.role===prototypeRole?history.state.territoryTrail||[]:[];
  normalizeContext();
 }
 const button=(label,action,value='',cls='')=>`<button class="${cls}" data-x6="${action}" data-value="${esc(value)}">${label}</button>`;
 function fieldRow(f,r){
  return `<div class="x6-field"><div><div class="label">${esc(f.label)} ${f.planned?'<span class="x6-new">Целевой блок</span>':''}</div></div><div><strong class="${empty(r[f.id])?'x6-muted':''}">${esc(empty(r[f.id])?'Не заполнено в демо':format(r[f.id],f))}</strong></div></div>`;
 }
 function legalCards(r){
  const rows=legalFor(r);
  return `<section class="x7-legals" id="x7-legals"><div class="x7-section-title"><h3>Юридические лица и договоры</h3><span>${rows.length} юрлиц · демо-связи по GUID</span></div><p class="small muted">Это целевая модель отображения. ИНН, счета и договоры вымышлены; JSON-пути и связи 1С ещё нужно подтвердить.</p>${rows.length?rows.map((l,i)=>`<details class="x6-group x7-legal" ${i===0?'open':''}><summary><span class="x7-identity"><b>${esc(l.legalName)}</b><small>${esc(l.inn)} · ${l.contracts.length} договор</small></span><span class="x7-badge">${l.contracts.some(c=>c.contractStatus==='Действующий')?'Действующий':'Архив'}</span></summary><div class="x7-fields">${registry.filter(f=>f.relation==='legal').map(f=>fieldRow(f,l)).join('')}</div><div class="x7-linked">Связанные доступные ТТ: ${portfolioRows('outlets').filter(o=>l.outletIds.includes(o.id)).map(o=>button(esc(o.storeAddress),'related-outlet',o.id)).join(' ')||'нет в текущей области'}</div>${l.contracts.map(c=>`<details class="x7-contract" open><summary>Договор ${esc(c.contractNumber)}<span>${esc(c.contractStatus)}</span></summary><div class="x7-fields">${registry.filter(f=>f.relation==='contract').map(f=>fieldRow(f,c)).join('')}</div><p class="x7-unit-note">Лимит приведён в демонстрационной валюте RUB. Валюту и уровень учёта подтвердить в источнике; по ТТ не суммировать.</p></details>`).join('')}</details>`).join(''):`<div class="x6-empty">В этом демонстрационном примере нет связанных юрлиц. Это не утверждение о файле 1С.</div>`}</section>`;
 }
 function cardData(id){
  const r=scoped().find(x=>x.id===id),d=document.createElement('div');d.className='x6-dialog';
  if(!r)return '<div class="x6-empty">Запись недоступна в выбранной территории.</div>';
  d.innerHTML=`<div class="x6-dialog-head"><div><span class="small muted">Эталон интерфейса · только демонстрационные данные</span><h2>${esc(r.clientName)}${state.entity==='outlets'?' / Торговая точка':''}</h2></div>${button('Закрыть','close')}</div><div class="x6-dialog-body x6"><div class="x7-card-summary"><span class="x7-badge">${esc(clientFor(r).topCategory||'ТОП не задан')}</span><span>${legalFor(r).length} юрлиц</span><span>${state.entity==='outlets'?'Контекст выбранной ТТ':'Карточка клиента'}</span></div><div class="x6-note small">Целевое отображение всего согласованного состава данных. Исправления выполняются в 1С. Заполненные демо-поля не подтверждают наличие этих полей в текущем обмене.</div>${groupNames.filter(g=>!['Юридические лица и реквизиты','Договоры и условия'].includes(g)&&(state.entity==='outlets'||registry.some(f=>f.group===g&&isClientField(f)))).map((g,i)=>`<details class="x6-group" ${i<1||g==='Контакт ЛПР'?'open':''}><summary>${g}<span>${registry.filter(f=>f.group===g).length} полей</span></summary>${registry.filter(f=>f.group===g).map(f=>fieldRow(f,f.relation==='client'?clientFor(r):r)).join('')}</details>`).join('')}${legalCards(r)}</div>`;
  const body=d.querySelector('.x6-dialog-body');
  body.querySelectorAll('.x6-group').forEach(group=>{if(group.querySelector('summary')?.textContent.startsWith('Ответственные'))group.remove()});
  body.insertAdjacentHTML('afterbegin',responsibilityCards(r));
  body.insertAdjacentHTML('beforeend',state.entity==='clients'?`<section class="x6-group"><summary>Доступные ТТ этого клиента</summary>${portfolioRows('outlets').filter(o=>o.clientId===r.id).map(o=>`<div class="x6-teamrow"><span>${esc(o.storeAddress)}</span>${button('Открыть ТТ','related-outlet',o.id)}</div>`).join('')||'<p class="pad muted">Нет доступных ТТ. Назначение клиента не раскрывает точки автоматически.</p>'}</section>`:`<div class="x6-note"><b>Клиент: ${esc(r.clientName)}</b><p class="small">Сведения родителя показаны в контексте этой ТТ. Это не открывает соседние точки и не добавляет родителя в «Мои клиенты» без назначения на клиента.</p></div>`);
  body.querySelectorAll('[data-x6="related-outlet"]').forEach(b=>{if(!portfolioRows('outlets').some(o=>o.id===b.dataset.value)){b.closest('.x6-teamrow')?.remove();b.remove()}});
  return body.innerHTML;
 }
 const cardTabs=[['overview','Обзор'],['sales','Продажи'],['data','Данные'],['work','Работа'],['display','Витрина'],['orders','Заказы'],['finance','Финансы'],['documents','Документы'],['claims','Рекламации'],['plan','План']];
 function workTab(r,related){
  const name=esc(r.clientName),legal=legalFor(r),owner=esc(r[state.entity==='clients'?'client_manager':'outlet_manager']||'Не назначен');
  const row=(title,subtitle,status)=>`<div class="x13-demo-row"><div><strong>${title}</strong><small>${subtitle}</small></div><span class="x7-badge">${status}</span></div>`;
  const cash=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(n);
  const demoId=esc(r.id);
  let body='';
  if(state.tab==='work')body=row('Согласовать следующий заказ',`${name} · Ответственный: ${owner} · Плановая дата: 20 октября`,'Запланировано')+
   row('Проверить контакты и договор',`${name} · ${legal.length} юрлиц · Проверка данных перед заказом`,'В работе');
  if(state.tab==='orders')body=legal.length?legal.map((l,i)=>row(`Заказ ДЕМО-${demoId}-${i+1}`,`${esc(l.legalName)} · 15 октября 2026 · ${cash(120000+i*40000)}`,i?'Комплектация':'Согласование')).join(''):'<p class="muted">Нет связанных юрлиц — демонстрационные заказы не сформированы.</p>';
  if(state.tab==='finance')body=legal.length?legal.map((l,i)=>`<div class="x13-demo-row"><div><strong>${esc(l.legalName)}</strong><small>Договор ${esc(l.contracts[0]?.contractNumber||'не задан')} · валюта RUB</small></div><div><strong>${cash(72000+i*24000)}</strong><small>Текущая задолженность · из неё просрочено ${cash(i?0:12000)}</small></div></div>`).join(''):'<p class="muted">Нет связанных юрлиц. Финансовые показатели не представлены.</p>';
  if(state.tab==='documents')body=legal.map(l=>row(`Договор ${esc(l.contracts[0]?.contractNumber||'не задан')}`,`${esc(l.legalName)} · ${esc(l.contracts[0]?.contractDate||'Дата не задана')}`,esc(l.contracts[0]?.contractStatus||'Не задан'))).join('')+
   '<p class="small muted">Это примеры строк реестра. Файлы и скачивание в демо не подключены.</p>'+legalCards(r);
  if(state.tab==='display')body=related.length?related.map(o=>row(esc(o.storeAddress),`${name} · Проверка экспозиции · 8 из 12 демонстрационных позиций`, 'Требует проверки')+button('Открыть карточку ТТ →','related-outlet',o.id,'x13-related')).join(''):'<p class="muted">В этой территории нет связанных торговых точек.</p>';
  if(state.tab==='claims')body=row(`Рекламация ДЕМО-${demoId}-01`,`${name} · Проверка комплектации · Ответственный: ${owner}`,'На рассмотрении')+
   '<p class="small muted">Учебный пример обращения, не реальная претензия клиента.</p>';
  if(state.tab==='plan')body=`<div class="x13-kpis"><div><span>План на октябрь</span><b>${cash(300000)}</b></div><div><span>Демо-факт</span><b>${cash(180000)}</b></div><div><span>Выполнение</span><b>60%</b></div></div><progress value="60" max="100" aria-label="Демонстрационное выполнение плана: 60%"></progress>`+
   row('Следующий шаг','Согласовать заказ и проверить актуальность контактов','План действий');
  return `<section class="card pad x13-demo-section"><header><div><span class="x7-badge">Вымышленный пример · не данные 1С</span><h3>${esc(cardTabs.find(t=>t[0]===state.tab)?.[1]||'Раздел')} · ${name}</h3></div></header>${body}<p class="small muted">Все примеры относятся только к выбранной записи ${demoId}. Операции и внешние источники не подключены.</p></section>`;
 }
 function recordView(){
  const r=scoped().find(x=>x.id===state.selected);
  if(!r)return '<div class="x6-empty"><h3>Запись вне выбранной территории</h3><p>Вернитесь к списку доступных клиентов.</p></div>';
  const related=portfolioRows('outlets').filter(o=>o.clientId===clientFor(r).id);
  const overview=`<div class="x13-kpis"><div><span>Торговые точки</span><b>${related.length}</b></div><div><span>Юридические лица</span><b>${legalFor(r).length}</b></div><div><span>Категория</span><b>${esc(clientFor(r).topCategory||'Не передано')}</b></div></div>${responsibilityCards(r)}<div class="x13-card-grid"><section class="card pad"><h3>Контакты и адрес</h3><p>${esc(r.storeAddress||r.clientAddress||'Не передано')}</p><p>${esc(r.lprName||r.clientPhones||'Не передано')}</p><p class="small muted">${esc(r.lprPhone||'Контакт ЛПР не передан')}</p>${button('Все данные клиента →','card-tab','data','primary')}</section><section class="card pad"><h3>Торговые точки территории</h3>${related.map(o=>button(`${esc(o.storeAddress)} →`,'related-outlet',o.id,'x13-related')).join('')||'<p class="muted">Нет торговых точек в этой территории.</p>'}</section></div>${legalCards(r)}`;
  const validLegal=sales.rowsFor(r).some(l=>l.legalId===state.salesLegal)?state.salesLegal:'';
  const tabsContent=state.tab==='data'?cardData(r.id):state.tab==='overview'?sales.panel(r)+overview:state.tab==='sales'?sales.panel(r,{detail:true,legalId:validLegal}):workTab(r,related);
  return `<div class="x13-record-title"><span class="x7-badge">${state.entity==='clients'?'Клиент':'Торговая точка'}</span><h2>${esc(r.clientName)}</h2><p>${esc(r.storeAddress||r.clientAddress||'Адрес не передан')}</p></div><nav class="x13-card-tabs" aria-label="Разделы карточки">${cardTabs.map(([id,label])=>button(label,'card-tab',id,state.tab===id?'selected':'')).join('')}</nav>${tabsContent}`;
 }
 function responsibilityCards(r){
  const scopes=state.entity==='clients'?['client']:['client','outlet'];
  return `<div class="x6-responsibilities">${scopes.map(scope=>`<section class="x6-group"><summary>Ответственные ${scope==='client'?'клиента':'этой ТТ'}</summary>${staff.map(([key,label])=>`<div class="x6-assignment"><span>${label}</span><strong>${esc(r[`${scope}_${key}`]||'Не назначен в 1С')}</strong><code>GUID: ${esc(r[`${scope}_${key}Id`]||'не назначен')}</code>${scope==='outlet'&&r[`outlet_${key}Id`]!==r[`client_${key}Id`]?'<small>Отличается от назначения клиента</small>':''}</div>`).join('')}</section>`).join('')}</div>`;
 }
 function scopeIntro(){
  const who=employee(state.employee||roleEmployee()),cs=portfolioRows('clients'),os=portfolioRows('outlets');
  if(assistantDirectory())return `<section class="x6-scopebar"><div><b>Назначенные мне клиенты</b><span>Только действующие согласованные назначения. Информация доступна для просмотра до окончания периода.</span></div><div>${button(`Клиенты · ${cs.length}`,'entity','clients',state.entity==='clients'?'selected':'')}${button(`ТТ · ${os.length}`,'entity','outlets',state.entity==='outlets'?'selected':'')}</div></section>`;
  return `<section class="x6-scopebar"><div><b>${state.employee?`Территория: ${esc(who?.name||'Недоступный сотрудник')}`:state.team?`Территория команды: ${esc(employee(state.team)?.name)}`:prototypeRole==='admin'?'Вся база':'Моя клиентская база'}</b><span>Только записи этой территории. Поиск и фильтры не расширяют область.</span></div><div>${button(`Клиенты · ${cs.length}`,'entity','clients',state.entity==='clients'?'selected':'')}${button(`ТТ · ${os.length}`,'entity','outlets',state.entity==='outlets'?'selected':'')}</div></section>`;
 }
 function reason(r){
  if(assistantDirectory())return 'Временный доступ · только просмотр';
  const id=state.employee||roleEmployee(),scope=state.entity==='clients'?'client':'outlet';
  if(id&&direct(r,scope,id))return `Прямое назначение: ${assignments(r,scope,id).join(' + ')}`;
  if(prototypeRole==='rop'||state.team)return 'Назначения подтверждённой команды';
  return 'Область директора / администратора';
 }
 function teamView(){
  const heads=allowedHeads().filter(e=>!state.q||`${e.name} ${ctTeams.find(t=>t.name===e.name)?.area||''}`.toLowerCase().includes(state.q.toLowerCase()));
  return `<section class="card x13-directory"><div class="x13-directory-tools"><div><h2>${prototypeRole==='admin'?'РОПы и команды':'Мои РОПы'} · ${heads.length}</h2><p>Выберите РОПа, затем сотрудника его команды.</p></div><input id="x6-search" aria-label="Поиск РОПа" placeholder="Найти РОПа…" value="${esc(state.q)}"></div><div class="x13-people">${heads.map(h=>{
   const cs=teamRows('clients',h.id),os=teamRows('outlets',h.id),members=employees.filter(e=>inTeam(e,h.id)&&e.id!==h.id);
   return `<button class="x13-person" data-x6="open-team" data-value="${h.id}"><span class="avatar">${ctInit(h.name)}</span><span class="x13-person-info"><strong>${esc(h.name)}</strong><small>РОП · ${esc(ctTeams.find(t=>t.name===h.name)?.area||'Моя территория')}</small><span>${members.length} сотрудников · ${cs.length} клиентов · ${os.length} ТТ</span></span><span class="x13-arrow" aria-hidden="true">→</span></button>`;
  }).join('')||'<div class="x6-empty">РОПы не найдены. Измените поиск.</div>'}</div></section>`;
 }
 function staffView(){
  const head=employee(state.team),members=employees.filter(e=>inTeam(e,state.team)&&e.id!==state.team),shown=members.filter(e=>!state.q||`${e.name} ${e.kinds.map(k=>kindLabel[k]).join(' ')}`.toLowerCase().includes(state.q.toLowerCase()));
  return `<section class="card x13-directory"><div class="x13-directory-tools"><div><h2>Сотрудники · ${esc(head?.name||'Моя команда')}</h2><p>${members.length} сотрудников · откройте территорию сотрудника: тот же список, который видит он.</p></div><input id="x6-search" aria-label="Поиск сотрудника" placeholder="Найти сотрудника…" value="${esc(state.q)}"></div><div class="x13-people">${shown.map(e=>{
   const cs=teamRows('clients',state.team).filter(c=>direct(c,'client',e.id)),os=teamRows('outlets',state.team).filter(o=>direct(o,'outlet',e.id));
   return `<button class="x13-person" data-x6="open-person" data-value="${e.id}"><span class="avatar">${ctInit(e.name)}</span><span class="x13-person-info"><strong>${esc(e.name)}</strong><small>${e.kinds.map(k=>kindLabel[k]).join(' · ')}${e.account?'':' · Нет аккаунта ЛК'}</small><span>${cs.length} клиентов · ${os.length} ТТ</span></span><span class="x13-arrow" aria-hidden="true">→</span></button>`;
  }).join('')||`<div class="x6-empty">${members.length?'Сотрудники не найдены. Измените поиск.':'У этого РОПа пока нет назначенных сотрудников, клиентов и ТТ — как в текущей структуре ЛК.'}</div>`}</div></section><p class="x13-directory-note">Клиенты с несколькими ответственными могут встречаться у нескольких сотрудников. Общий итог команды считается без повторов.</p>`;
 }
 function contextNav(){
  const root=prototypeRole==='rop'?'Моя команда':['director','admin'].includes(prototypeRole)?'Мои РОПы':'Мои клиенты';
  const parts=[root];
  if(state.team&&prototypeRole!=='rop')parts.push(employee(state.team)?.name||'РОП');
  if(state.employee)parts.push(employee(state.employee)?.name||'Сотрудник');
  if(['list','card'].includes(state.mode)&&['director','admin','rop'].includes(prototypeRole))parts.push('Клиентская база');
  if(state.mode==='card')parts.push(scoped().find(r=>r.id===state.selected)?.clientName||'Карточка');
  const hasParent=trail.length||state.mode==='card'||state.employee||(state.mode==='staff'&&prototypeRole!=='rop')||state.mode==='fields';
  return `<div class="x13-context-nav">${hasParent?button('← Назад','back','','x13-back'):''}<nav aria-label="Путь к выбранной территории">${parts.map((p,i)=>`<span ${i===parts.length-1?'aria-current="page"':''}>${esc(p)}</span>`).join('<i aria-hidden="true">/</i>')}</nav><span class="x13-viewing">${esc(roleProfile().label)}${state.employee?' · Просмотр территории сотрудника':''}</span></div>`;
 }
 function columns(){
  const d=document.getElementById('dialog');d.className='x6-dialog';
  const activeColumns=isFocus()?state.focusColumns:state.columns;
  const scroll=d.querySelector('.x6-dialog-body')?.scrollTop||0;
  const fields=[...activeColumns.map(find).filter(Boolean),...availableFields().filter(f=>!activeColumns.includes(f.id))];
  d.innerHTML=`<div class="x6-dialog-head"><h2>Колонки реестра</h2>${button('Готово','close')}</div><div class="x6-dialog-body x6"><p class="muted">Выберите поля и расположите их в нужном порядке: перетаскивайте выбранные строки или используйте стрелки. Название клиента закреплено первым.</p><div class="x16-column-actions"><button type="button" data-x6="columns-all" ${availableFields().every(f=>activeColumns.includes(f.id))?'disabled':''}>Выбрать все</button><button type="button" data-x6="columns-default" title="Восстановить стандартный набор и порядок колонок">По умолчанию</button></div><div class="x6-column-grid x16-columns">${fields.map(f=>{const i=activeColumns.indexOf(f.id),movable=i>0;return `<div class="x16-column" data-column-order="${f.id}" draggable="${movable}"><label><input type="checkbox" data-x6-column="${f.id}" ${i>=0?'checked':''} ${f.id==='clientName'?'disabled':''}>${esc(f.label)}</label>${movable?`<div class="x16-arrows"><button type="button" data-x6="column-up" data-value="${f.id}" aria-label="Вверх: ${esc(f.label)}" ${i===1?'disabled':''}>↑</button><button type="button" data-x6="column-down" data-value="${f.id}" aria-label="Вниз: ${esc(f.label)}" ${i===activeColumns.length-1?'disabled':''}>↓</button></div>`:''}</div>`}).join('')}</div></div>`;if(!d.open)d.showModal();d.querySelector('.x6-dialog-body').scrollTop=scroll;
 }
 function reorderColumn(id,target){
  const key=isFocus()?'focusColumns':'columns',list=state[key],from=list.indexOf(id);
  if(from<1||target<1||target>=list.length)return;
  list.splice(from,1);list.splice(target,0,id);write();columns();
 }
 function fieldRegistry(){
  const q=state.fieldSearch.toLowerCase();
  return `<div class="x6-tools card"><input id="x6-field-search" aria-label="Поиск поля обмена" placeholder="Найти поле по названию или ключу 1С" value="${esc(state.fieldSearch)}"></div><div class="x6-registry">${groupNames.map(g=>{
   const fs=registry.filter(f=>f.group===g&&(`${f.label} ${f.source}`).toLowerCase().includes(q));if(!fs.length)return '';
   return `<details class="x6-group" open><summary>${g}<span>${fs.length} полей</span></summary>${fs.map(f=>`<div class="x6-field"><div>${esc(f.label)}<code>${esc(f.source)}</code></div><div>${f.planned?'<span class="x6-new">Макет готов · источник сопоставить</span>':'<span class="small muted">Известный ключ обмена</span>'}<div class="small muted">Все поля доступной записи · фильтр по типу${f.relation==='contract'?' · один договор':f.relation==='legal'?' · одно юрлицо':''}</div></div></div>`).join('')}</details>`;
  }).join('')}</div><section class="x6-pending"><h3>Полный целевой состав, без пропущенных блоков</h3><p>Все ${registry.length} полей имеют отображение и рабочие демо-фильтры. Ключи со статусом «источник сопоставить» — требования интерфейса, не выдуманный контракт 1С.</p><p>Cursor должен связать их с реальным JSON или перечислить необходимые дополнения выгрузки. Юрлица, договоры и ТТ связываются только подтверждёнными идентификаторами.</p></section>`;
 }
 function cell(r,f,i){
  if(f.id==='salesByLegal')return `<td data-label="${esc(f.label)}">${sales.breakdown(r)}</td>`;
  const v=displayValue(r,f);
  return `<td data-label="${esc(f.label)}">${i===0?`${button(esc(format(v,f)),'record',r.id)}<small>${esc(state.entity==='outlets'?r.outletId:r.clientId)}</small><small class="x6-reason">${esc(reason(r))}</small>`:`<span class="${empty(v)?'x6-muted':''}">${esc(format(v,f))}</span>`}</td>`;
 }
 function focusCell(r,f,i){
  if(f.id==='salesByLegal')return `<td>${sales.breakdown(r)}</td>`;
  const value=format(displayValue(r,f),f),content=`<span class="x14-cell-content">${esc(value)}</span>`;
  return `<td title="${esc(value)}">${i===0?button(content,'record',r.id):content}</td>`;
 }
 function focusHeader(f){
  const rules=state.rules.filter(r=>r.field===f.id),rule=op=>rules.find(r=>r.op===op)?.value||'';
  const attrs=`data-focus-field="${f.id}" aria-label="Фильтр: ${esc(f.label)}"`;
  let control;
  if(f.type==='bool'){
   const op=rules.find(r=>['yes','no','empty','filled'].includes(r.op))?.op||'';
   control=`<select ${attrs} data-focus-op="bool">${[['','Все'],['yes','Да'],['no','Нет'],['empty','Не передано'],['filled','Передано']].map(([v,l])=>`<option value="${v}" ${v===op?'selected':''}>${l}</option>`).join('')}</select>`;
  }else if(f.type==='enum'){
   const options=[...new Set(scoped().flatMap(r=>values(r,f)).filter(v=>!empty(v)))].map(String).sort((a,b)=>a.localeCompare(b,'ru'));
   const selected=rule('eq');if(selected&&!options.includes(selected))options.unshift(selected);
   control=`<select ${attrs} data-focus-op="eq"><option value="">Все</option>${options.map(v=>`<option value="${esc(v)}" ${v===selected?'selected':''}>${esc(v)}</option>`).join('')}</select>`;
  }else if(f.type==='number'){
   control=`<div class="x15-range">${['gte','lte'].map(op=>`<input type="number" step="any" inputmode="decimal" data-focus-field="${f.id}" data-focus-op="${op}" aria-label="Фильтр: ${esc(f.label)} ${op==='gte'?'от':'до'}" placeholder="${op==='gte'?'От':'До'}" value="${esc(rule(op))}">`).join('')}</div>`;
  }else{
   const type=['date','time'].includes(f.type)?f.type:'search',op=type==='search'?'contains':'eq';
   control=`<input type="${type}" ${attrs} data-focus-op="${op}" placeholder="Найти…" value="${esc(rule(op))}">`;
  }
  return `<th scope="col" class="${rules.length?'x15-filtered':''}"><div class="x15-col-heading"><span>${esc(f.label)}</span>${rules.length?`<button type="button" class="x15-clear-field" data-x6="focus-clear-field" data-value="${f.id}" aria-label="Сбросить фильтр: ${esc(f.label)}" title="Сбросить условия по колонке">×</button>`:''}</div>${control}</th>`;
 }
 function refreshFocusResults(editor){
  cancelFocusFilterTimer();if(!isFocus())return;
  const pane=document.getElementById('x14-focus-scroll');if(pane)pane.scrollTop=0;
  state.page=1;state.focusScroll.top=0;write();
  const el=editor?.id?document.getElementById(editor.id):editor?.field?document.querySelector(`[data-focus-field="${editor.field}"][data-focus-op="${editor.op}"]`):null;
  if(el){el.focus({preventScroll:true});if(['search','text'].includes(el.type)&&editor.position!==null&&editor.position!==undefined)el.setSelectionRange(editor.position,editor.position)}
 }
 function editFocusFilter(el,immediate=false){
  if(!isFocus())return;
  const field=el.dataset.focusField,op=el.dataset.focusOp,value=el.value;
  const editor={id:el.id,field,op,position:el.selectionStart};
  if(el.id==='x15-search')state.q=value;
  else{
   if(!find(field))return;
   const remove=op==='bool'?r=>r.field===field&&['yes','no','empty','filled'].includes(r.op):r=>r.field===field&&r.op===op;
   state.rules=state.rules.filter(r=>!remove(r));
   if(value!=='')state.rules.push({field,op:op==='bool'?value:op,value:op==='bool'?'':value});
  }
  cancelFocusFilterTimer();
  if(immediate){refreshFocusResults(editor);return}
  const context=[prototypeRole,state.entity,state.team,state.employee].join(':');
  focusFilterTimer=setTimeout(()=>{if(context===[prototypeRole,state.entity,state.team,state.employee].join(':'))refreshFocusResults(editor)},180);
 }
 function focusList(){
  const rows=filtered(),fs=state.focusColumns.map(find).filter(f=>f&&canSee(f));
  return `<div class="x6 x13 x14-focus"><div class="x14-focusbar"><label class="x15-search"><input id="x15-search" type="search" aria-label="Поиск в полноэкранном реестре" placeholder="Поиск по клиентам, ИНН, адресам…" value="${esc(state.q)}"></label><span role="status">${rows.length} из ${scoped().length} · демо</span>${sales.period()}${state.rules.length||state.q?button(`Сбросить${state.rules.length?' · '+state.rules.length:''}`,'focus-reset','','x15-reset'):''}${button('Колонки','columns')}${button('Выйти <kbd>Esc</kbd>','focus-exit','','primary')}</div><div class="x14-focus-scroll" id="x14-focus-scroll" role="region" aria-label="Полнооконный список клиентов" tabindex="0"><table aria-label="Клиентская база" style="--focus-table-min:${200+Math.max(0,fs.length-1)*120}px"><thead><tr>${fs.map(f=>focusHeader(f)).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr data-client-row>${fs.map((f,i)=>focusCell(r,f,i)).join('')}</tr>`).join(''):`<tr class="x15-empty"><td colspan="${fs.length}"><h3>Нет совпадений</h3><p>Измените поиск или условия в заголовках колонок.</p>${button('Сбросить поиск и фильтры','focus-reset')}</td></tr>`}</tbody></table></div></div>`;
 }
 function list(){
  const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/6));state.page=Math.min(state.page,pages);
  const fs=state.columns.map(find).filter(f=>f&&canSee(f));
  return `<section class="card"><div class="x6-tools"><input id="x6-search" aria-label="Поиск по данным 1С" placeholder="Клиент, адрес, контакт, ответственный..." value="${esc(state.q)}">${button('Клиенты','entity','clients',state.entity==='clients'?'primary':'')}${button('Торговые точки','entity','outlets',state.entity==='outlets'?'primary':'')}${button('Колонки','columns')}${button('На весь экран','focus-enter','','x14-focus-enter')}</div>
  <div class="x13-quick-filters"><label>Город<select id="x13-city"><option value="">Все города</option>${[...new Set(scoped().map(r=>(r.storeAddress||r.clientAddress||'').split(',')[0]).filter(Boolean))].map(city=>`<option ${state.rules.some(rule=>rule.field===(state.entity==='clients'?'clientAddress':'storeAddress')&&rule.op==='contains'&&rule.value===city)?'selected':''} value="${esc(city)}">${esc(city)}</option>`).join('')}</select></label><label>Категория<select id="x13-category"><option value="">Все категории</option>${[...new Set(scoped().map(r=>clientFor(r).topCategory).filter(Boolean))].map(category=>`<option ${state.rules.some(rule=>rule.field==='topCategory'&&rule.op==='eq'&&rule.value===category)?'selected':''} value="${esc(category)}">${esc(category)}</option>`).join('')}</select></label>${button('Сбросить фильтры','reset','','link')}<span class="small muted">Только выбранная территория</span></div>
  <details class="x6-filter" ${state.filterOpen?'open':''}><summary>Фильтры по всем полям · ${state.rules.length}</summary><div class="x7-quick">${[['topCategory','ТОП'],['legalName','Юрлицо'],['inn','ИНН'],['contractNumber','Договор'],['lprName','ЛПР'],['clubBonus','Бонус Club'],['monday','День приёмки']].map(([id,l])=>button(l,'choose-field',id)).join('')}</div><div class="small muted">Все условия одновременно. Условия по ТТ относятся к одной доступной точке; реквизиты к одному юрлицу, условия договора к одному его договору.</div><div class="x6-builder"><label>Поле<select id="x6-field">${filterFields().map(f=>`<option value="${f.id}" ${f.id===(state.entity==='clients'?'client_manager':'outlet_manager')?'selected':''}>${esc(f.label)}</option>`).join('')}</select></label><label>Условие<select id="x6-op"><option value="contains">Содержит</option><option value="eq">Равно</option><option value="empty">Не заполнено</option><option value="filled">Заполнено</option></select></label><label>Значение<input id="x6-value" placeholder="Введите значение"></label>${button('Добавить','add','', 'primary')}</div>
  <div class="x6-chips">${state.rules.map((r,i)=>button(`${esc(find(r.field).label.replace('GUID: ',''))}: ${esc(({empty:'не заполнено',filled:'заполнено',yes:'Да',no:'Нет',eq:'=',in:'любой из',contains:'содержит',gte:'от',lte:'до'})[r.op])} ${esc(r.value.split('|').map(v=>employee(v)?.name||v).join(', '))} ×`,'remove',i,'x6-chip')).join('')}${state.rules.length||state.q?button('Сбросить','reset','','link'):''}</div></details>
  <div class="x6-count"><span><b>${rows.length}</b> ${state.entity==='outlets'?'торговых точек':'клиентов'} из ${scoped().length} в области роли</span><span>Данные 1С · без редактирования в ЛК</span></div>
  ${rows.length?`<div class="x6-scroll x13-desktop-list"><table><thead><tr>${fs.map(f=>`<th>${esc(f.label)}</th>`).join('')}</tr></thead><tbody>${rows.slice((state.page-1)*6,state.page*6).map(r=>`<tr>${fs.map((f,i)=>cell(r,f,i)).join('')}</tr>`).join('')}</tbody></table></div><div class="x13-mobile-list">${rows.slice((state.page-1)*6,state.page*6).map(r=>`<button class="x13-client-card" data-x6="record" data-value="${r.id}"><span class="x13-client-card-title"><strong>${esc(r.clientName)}</strong><span aria-hidden="true">→</span></span><span class="x13-client-card-address">${esc(r.storeAddress||r.clientAddress||'Адрес не передан')}</span><span class="x7-badge">${esc(clientFor(r).topCategory||'Категория не передана')}</span><span class="x13-mobile-fields">${fs.filter(f=>f.id!=='clientName'&&f.id!=='storeAddress'&&f.id!=='topCategory').map(f=>`<span><small>${esc(f.label)}</small>${f.id==='salesByLegal'?sales.breakdown(r):`<b>${esc(format(displayValue(r,f),f))}</b>`}</span>`).join('')}</span><span class="x13-open-card">Открыть карточку клиента</span></button>`).join('')}</div><div class="x6-pages">${button('Предыдущая','page',Math.max(1,state.page-1))}<span>${state.page} / ${pages}</span>${button('Следующая','page',Math.min(pages,state.page+1))}</div>`:`<div class="x6-empty"><h3>Нет совпадений в вашей области</h3><p>Измените условия или сбросьте фильтры. Это не ошибка загрузки.</p>${button('Сбросить фильтры','reset')}</div>`}</section>`;
 }
 function html(){
  if(isFocus())return focusList();
  return `<div class="x6 x13">${contextNav()}<div class="x13-section-heading"><div><span class="x7-eyebrow">КЛИЕНТЫ И ТЕРРИТОРИИ</span><h2>${state.mode==='card'?'Карточка клиента':state.mode==='staff'?'Сотрудники команды':state.mode==='teams'?'РОПы и команды':state.mode==='fields'?'Карта полей':'Клиентская база'}</h2><p>${state.mode==='card'?'Полная информация по выбранной записи':state.mode==='staff'?'Выберите сотрудника, чтобы открыть его территорию':state.mode==='teams'?'Выберите своего РОПа, чтобы открыть его команду':'Поиск, фильтры и карточки в пределах выбранной территории'}</p></div>${state.mode!=='card'?button('Карта полей','mode','fields','link'):''}</div>${state.mode==='fields'?fieldRegistry():state.mode==='card'?recordView():state.mode==='staff'?staffView():state.mode==='teams'?teamView():scopeIntro()+sales.toolbar()+list()}<p class="x13-prototype-note">Интерактивный прототип · вымышленные данные · рабочий ЛК, 1С и права не изменяются</p></div>`;
 }
 function paint(){
  const embedded=assistantDirectory(),target=document.querySelector(embedded?'.as-directory':'.screenbody');
  document.body.classList.toggle('x14-focus-mode',directoryOpen()&&isFocus());
  if(!target||!directoryOpen())return;
  target.innerHTML=html();
  const sortable=isFocus()?state.focusColumns:state.columns;
  target.querySelectorAll(isFocus()?'.x14-focus thead th':'.x13-desktop-list thead th').forEach((th,i)=>{
   const f=find(sortable[i]);if(!f)return;
   th.setAttribute('aria-sort',state.sort===f.id?(state.sortDir==='asc'?'ascending':'descending'):'none');
   const control=button(esc(f.label)+(state.sort===f.id?(state.sortDir==='asc'?' ↑':' ↓'):''),'sort',f.id,'x17-sort');
   const label=th.querySelector('.x15-col-heading>span');
   if(label)label.outerHTML=control;else if(!isFocus())th.innerHTML=control;
   const sortButton=th.querySelector('[data-x6="sort"]');
   if(sortButton)sortButton.title=f.type==='number'?'Сортировать. Если значений несколько, используется наибольшее.':'Сортировать по этому полю';
  });
  if(!isFocus()&&!embedded){
   const details=document.createElement('details');details.className='cs-demo-details';
   details.innerHTML='<summary>О прототипе и демонстрационных данных</summary><p data-demo-scale>Масштаб ЛК: 6 РОПов · 43 сотрудника ОПТ · 13 ответственных вне ОПТ. В командах: 20 / 16 / 18 / 0 / 0 / 0. База: 2 206 клиентов · 2 743 юрлица · 3 773 ТТ (1 550 без холдинга). Размеры команд соответствуют ЛК; имена, карточки и назначения клиентов вымышленные.</p>';
   target.querySelector('.x13')?.append(details);
  }
  syncOperator();const heading=document.querySelector('.heading h1');if(heading)heading.textContent='Клиенты';
  document.querySelector('.heading .sub')?.remove();
  document.title=`Tandoor RF · ${roleProfile().label} · Клиенты`;
  if(embedded){
   document.title='Тандор · Ассистент · Клиенты';
   const context=target.querySelector('.x13-context-nav');
   if(context)context.innerHTML=`<nav aria-label="Область доступа">${state.mode==='list'?'':button('← К списку','back')}<span>Назначенные клиенты</span></nav><span>Ассистент · временный доступ · только просмотр</span>`;
   target.querySelector('.x13-scope-title')?.remove();
   target.querySelectorAll('[data-x6="card-tab"][data-value="work"],[data-x6="card-tab"][data-value="plan"]').forEach(b=>b.remove());
   window.AssistantDirectory.onPaint?.();
  }
  if(state.mode==='card')target.querySelectorAll('[data-x6="related-outlet"]').forEach(b=>{if(!portfolioRows('outlets').some(o=>o.id===b.dataset.value))b.remove()});
  if(isFocus()){const pane=document.getElementById('x14-focus-scroll');if(pane){pane.scrollTop=state.focusScroll.top;pane.scrollLeft=state.focusScroll.left}}
 }
 function syncOperator(){
  const field=document.getElementById('x6-field'),op=document.getElementById('x6-op');if(!field||!op)return;
  const f=find(field.value),isAssignment=/^(client|outlet)_(manager|regional|hardware|rop)(Id)?$/.test(f.id),choices=isAssignment?[['eq','Сотрудник'],['in','Любой из сотрудников'],['empty','Не назначен'],['filled','Назначен']]:f.type==='bool'?[['yes','Да'],['no','Нет'],['empty','Не передано'],['filled','Передано']]:[...(f.type==='enum'||f.type==='number'?[]:[['contains','Содержит']]),['eq','Равно'],...(['date','time','number'].includes(f.type)?[['gte','От'],['lte','До']]:[]),['empty','Не заполнено'],['filled','Заполнено']];
  const old=op.value;op.innerHTML=choices.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');if(choices.some(([v])=>v===old))op.value=old;
  let inp=document.getElementById('x6-value');
  if(isAssignment){
   const id=f.id.endsWith('Id')?f.id:f.id+'Id',scopeRows=scoped(),clientIds=new Set(scopeRows.map(c=>c.id)),source=state.entity==='clients'&&!isClientField(f)?portfolioRows('outlets').filter(o=>clientIds.has(o.clientId)):scopeRows,ids=new Set(source.map(r=>r[id]).filter(Boolean)),prior=inp.value;
   inp.outerHTML=`<select id="x6-value" aria-label="Сотрудник" ${op.value==='in'?'multiple':''}>${employees.filter(e=>ids.has(e.id)).map(e=>`<option value="${e.id}" ${e.id===prior?'selected':''}>${esc(e.name)}</option>`).join('')}</select>`;
  }else if(f.type==='enum'){
   const vs=[...new Set(scoped().flatMap(r=>values(r,f)).filter(v=>!empty(v)))];
   inp.outerHTML=`<select id="x6-value" aria-label="${esc(f.label)}">${vs.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select>`;
  }else if(inp.tagName==='SELECT')inp.outerHTML='<input id="x6-value" placeholder="Введите значение">';
  inp=document.getElementById('x6-value');if(inp.tagName==='INPUT'){inp.type=['date','time','number'].includes(f.type)?f.type:'text';if(f.type==='number')inp.step='any'}inp.disabled=['empty','filled','yes','no'].includes(op.value);
 }
 add('exchange','Клиенты, ТТ и ответственные','Все данные 1С, личные базы и команды без смешения назначений','Администратор','exchange','', 'Единый реестр полей, типизированные фильтры и существующая область доступа.');
 roleProfiles.director.scope='Мои РОПы и их подтверждённые команды';
 const oldNav=roleNav;roleNav=items=>{const rows=oldNav(items).filter(r=>r[0]!=='clients'&&r[3]!=='teams');rows.splice(2,0,['exchange','Клиенты','database','exchange']);return rows};
 const originalRender=render;render=function(){
  document.body.classList.remove('x14-focus-mode');
  originalRender();document.body.classList.toggle('x7-active',current==='exchange');if(current==='exchange'){read();document.querySelector('.r-other-example')?.remove();paint()}
  else if(current==='clients'||screens.find(s=>s.id===current)?.section==='client')document.querySelector('.screenbody').insertAdjacentHTML('afterbegin',`<div class="x6-entry">${button('Все данные 1С и фильтры →','enter')}</div>`);
 };
 const oldSwitch=switchPrototypeRole;switchPrototypeRole=function(role){
  if(current!=='exchange'){oldSwitch(role);return}
  document.getElementById('dialog').close();prototypeRole=role;trail=[];state.rules=[];state.q='';state.selected='';state.page=1;state.team=role==='rop'?'DEMO-ROP1':'';state.employee='';state.mode=defaultMode();state.tab='overview';state.entity=role==='regional'?'outlets':'clients';state.columns=defaultColumns(state.entity);state.focus=false;state.focusColumns=[];state.focusScroll={top:0,left:0};write();render();
 };
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-x6]');if(!b)return;const a=b.dataset.x6,v=b.dataset.value;
  if(a==='sort'){const f=find(v);if(!f)return;state.sortDir=state.sort===v?(state.sortDir==='asc'?'desc':'asc'):(f.type==='number'?'desc':'asc');state.sort=v;state.page=1;write();return}
  if(isFocus()&&focusFilterTimer)refreshFocusResults();
  if(a==='focus-clear-field'){state.rules=state.rules.filter(r=>r.field!==v);refreshFocusResults();return}
  if(a==='focus-reset'){state.q='';state.rules=[];refreshFocusResults();return}
  if(a==='focus-enter'){if(state.mode==='list')toggleFocus(true);return}
  if(a==='focus-exit'){toggleFocus(false);return}
  if(a==='enter'){change('exchange');return}
  if(a==='choose-field'){document.querySelector('.x6-filter').open=true;document.getElementById('x6-field').value=v;syncOperator();document.getElementById('x6-value').focus();return}
  if(a==='close'){document.getElementById('dialog').close();state.selected='';if(directoryOpen())write();return}
  if(a==='columns'){columns();return}
  if(a==='columns-default'){
   if(!document.getElementById('dialog').open)return;
   state[isFocus()?'focusColumns':'columns']=isFocus()?defaultFocusColumns(defaultColumns(state.entity)):defaultColumns(state.entity);
   write();columns();return;
  }
  if(a==='column-up'||a==='column-down'){if(document.getElementById('dialog').open)reorderColumn(v,state[isFocus()?'focusColumns':'columns'].indexOf(v)+(a==='column-up'?-1:1));return}
  if(a==='columns-all'){
   if(!document.getElementById('dialog').open)return;
   const key=isFocus()?'focusColumns':'columns';state[key]=['clientName',...state[key].filter(id=>id!=='clientName'),...availableFields().filter(f=>!state[key].includes(f.id)&&f.id!=='clientName').map(f=>f.id)];
   write();columns();return;
  }
  if(a==='back'){back();return}
  if(a==='open-team'){if(!allowedHeads().some(h=>h.id===v))return;move({mode:'staff',team:v,employee:'',q:'',rules:[],page:1});return}
  if(a==='open-person'){if(!employees.some(e=>e.id===v&&inTeam(e,state.team)))return;move({mode:'list',employee:v,entity:'clients',q:'',rules:[],page:1,columns:defaultColumns('clients')});return}
  if(a==='card-tab'){state.tab=v;write();return}
  if(a==='sales-legal'){
   const r=scoped().find(x=>x.id===state.selected);
   if(!r||!sales.rowsFor(r).some(l=>l.legalId===v))return;
   state.salesLegal=v;state.tab='sales';write();return;
  }
  if(a==='record'){if(!(isFocus()?filtered():scoped()).some(r=>r.id===v))return;move({mode:'card',selected:v,tab:'overview'});return}
  if(a==='related-outlet'){if(!portfolioRows('outlets').some(r=>r.id===v))return;move({entity:'outlets',mode:'card',selected:v,tab:'overview',columns:defaultColumns('outlets')});return}
  if(a==='back-teams'){state.mode=['admin','director','rop'].includes(prototypeRole)?'teams':'list';state.team='';state.employee='';state.rules=[];state.q=''}
  if(a.startsWith('team-')||a.startsWith('person-')){
   state.team=a.startsWith('team-')?v:employee(v)?.team||'';state.employee=a.startsWith('person-')?v:'';state.entity=a.endsWith('clients')?'clients':'outlets';state.mode='list';state.q='';state.rules=[];state.page=1;
   state.columns=state.entity==='clients'?['clientName','client_manager','client_regional','client_hardware','client_rop']:['clientName','storeAddress','outlet_manager','outlet_regional','outlet_hardware','outlet_rop'];
  }
  if(a==='mode'){move({mode:v,page:1});return}
  if(a==='entity'){state.focusColumns=[];state.focusScroll={top:0,left:0}}
  if(a==='entity'){state.entity=v;state.rules=[];state.q='';state.page=1;state.columns=defaultColumns(v)}
  if(a==='reset'){state.q='';state.rules=[];state.page=1}
  if(a==='remove'){state.rules.splice(Number(v),1);state.page=1}
  if(a==='page')state.page=Number(v);
  if(a==='add'){
   let field=document.getElementById('x6-field').value;const op=document.getElementById('x6-op').value,inp=document.getElementById('x6-value');
   if(!inp.disabled&&!inp.value.trim()){inp.focus();inp.setCustomValidity('Введите значение или выберите условие «Не заполнено».');inp.reportValidity();return}
   if(/^(client|outlet)_(manager|regional|hardware|rop)$/.test(field))field+='Id';
   state.rules.push({field,op,value:inp.disabled?'':inp.multiple?[...inp.selectedOptions].map(o=>o.value).join('|'):inp.value.trim()});state.page=1;
  }
  write();
 });
 document.addEventListener('change',e=>{
  if(e.target.matches('[data-cs-period]')){sales.setMonth(e.target.value);state.page=1;write();return}
  if(e.target.matches('[data-cs-legal-select]')){state.salesLegal=e.target.value;write();return}
  if(e.target.dataset.focusField&&(e.target.tagName==='SELECT'||['date','time'].includes(e.target.type))){editFocusFilter(e.target,true);return}
  if(['x13-city','x13-category'].includes(e.target.id)){
   const field=e.target.id==='x13-city'?(state.entity==='clients'?'clientAddress':'storeAddress'):'topCategory',op=e.target.id==='x13-city'?'contains':'eq';
   state.rules=state.rules.filter(r=>r.field!==field);if(e.target.value)state.rules.push({field,op,value:e.target.value});state.page=1;write();return;
  }
  if(['x6-field','x6-op'].includes(e.target.id))syncOperator();
  if(e.target.dataset.x6Column){const id=e.target.dataset.x6Column,key=isFocus()?'focusColumns':'columns';if(id==='clientName')return;state[key]=e.target.checked?[...new Set([...state[key],id])]:state[key].filter(k=>k!==id);write();columns()}
 });
 document.addEventListener('dragstart',e=>{const row=e.target.closest('[data-column-order][draggable="true"]');if(row&&e.dataTransfer){e.dataTransfer.setData('text/plain',row.dataset.columnOrder);e.dataTransfer.effectAllowed='move'}});
 document.addEventListener('dragover',e=>{if(e.target.closest('#dialog [data-column-order][draggable="true"]'))e.preventDefault()});
 document.addEventListener('drop',e=>{const row=e.target.closest('#dialog [data-column-order][draggable="true"]');if(!row||!e.dataTransfer)return;e.preventDefault();const key=isFocus()?'focusColumns':'columns';reorderColumn(e.dataTransfer.getData('text/plain'),state[key].indexOf(row.dataset.columnOrder))});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&isFocus()&&!document.getElementById('dialog').open){e.preventDefault();toggleFocus(false)}});
 let timer;
 document.addEventListener('toggle',e=>{if(e.target.matches?.('.x6-filter'))state.filterOpen=e.target.open},true);
 document.addEventListener('input',e=>{
  if(e.target.id==='x15-search'||e.target.dataset.focusField){if(!['date','time'].includes(e.target.type))editFocusFilter(e.target);return}
  if(e.target.id==='x6-value')e.target.setCustomValidity('');
  if(!['x6-search','x6-field-search'].includes(e.target.id))return;const id=e.target.id,value=e.target.value,position=e.target.selectionStart;
  clearTimeout(timer);timer=setTimeout(()=>{if(!directoryOpen())return;if(id==='x6-search'){state.q=value;state.page=1;write()}else{state.fieldSearch=value;paint()}const el=document.getElementById(id);el?.focus();el?.setSelectionRange(position,position)},180);
 });
 window.exchangePrototype={registry,filtered,baseRows,teamRows,employees,clientRows,outletRows,legalRows,sales,teams:demoScale.teams,totals:demoScale.totals,getState:()=>state,mountAssistant:()=>{read();paint()}};
 document.getElementById('dialog').addEventListener('cancel',()=>{if(directoryOpen()){state.selected='';write()}});
 if(!location.hash){current='exchange';prototypeRole='manager';history.replaceState(null,'','#exchange?role=manager')}
 if(location.hash.split('?')[0]==='#exchange')current='exchange';
 render();
})();
