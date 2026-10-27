(function () {
  "use strict";
  // Self-contained synthetic workflow. No API calls, storage, real identities or rights.
  const routes = new Set(["handover", "assistant", "coordinator", "assistant-clients", "assistant-tasks"]);
  const roles = { manager:"Менеджер", coordinator:"РОА / координатор", rop:"РОП", director:"Директор", assistant:"Ассистент" };
  const people = {
    m1:{name:"Алексей Морозов",team:"Юг"}, m2:{name:"Дмитрий Петров",team:"Юг"},
    m3:{name:"Иван Орлов",team:"Восток"}, a1:{name:"Анна Белова"}, a2:{name:"Павел Черняк"},
    r1:{name:"Елена Волкова",team:"Юг"}, r2:{name:"Максим Серов",team:"Восток"},
    c1:{name:"Наталья Савельева"}, d1:{name:"Андрей Власов"},
  };
  const clients = [
    ["c1","Южный дом","Краснодар","m1",2,2],["c2","Дверной квартал","Армавир","m1",1,2],
    ["c3","Линия интерьера","Краснодар","m1",2,3],["c4","Галерея дверей","Сочи","m2",1,1],
    ["c5","Мастерская пространства","Майкоп","m1",1,1],["c6","Новый интерьер","Анапа","m1",1,2],
    ["c7","Дом и стиль","Сочи","m2",2,2],["c8","Восточный квартал","Ставрополь","m3",1,1],
    ["c9","Точка дизайна","Краснодар","m1",1,1],["c10","Дверная студия","Новороссийск","m2",1,2],
  ].map(([id,name,city,manager,legals,outlets])=>({id,name,city,manager,legals,outlets}));
  const byClient = id => clients.find(c=>c.id===id);
  const E = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const T = value => new Date(value+"+03:00").getTime();
  const initialClock = T("2026-10-27T11:00");
  const local = value => new Date(value+10800000).toISOString().slice(0,16);
  const dt = value => new Intl.DateTimeFormat("ru-RU",{timeZone:"Europe/Moscow",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(value);
  const person = id => people[id]?.name || "Не выбран";
  // Use the same synthetic client records and read-only sales as the base directory.
  const directory=window.exchangePrototype;
  const usedRecords=new Set();
  clients.forEach(c=>{
    const owner={m1:"DEMO-M1",m2:"DEMO-E12",m3:"DEMO-E14"}[c.manager];
    const pool=directory.clientRows.filter(r=>r.client_managerId===owner);
    const r=pool.find(r=>!usedRecords.has(r.id)&&r.clientName.startsWith(c.name))||pool.find(r=>!usedRecords.has(r.id));
    if(r){usedRecords.add(r.id);c.record={...r,client_manager:person(c.manager)};c.name=r.clientName;c.city=(r.clientAddress||c.city).split(",")[0];c.legals=directory.sales.rowsFor(r).length;c.outlets=directory.outletRows.filter(o=>o.clientId===r.clientId).length;}
  });
  // Default fixtures represent working-sized portfolios, not a one-row layout.
  // Reuse canonical synthetic records so legal entities, TT and sales stay linked.
  const volume={m1:[],m2:[]};
  for(const [manager,owner,count] of [["m1","DEMO-M1",32],["m2","DEMO-E12",28]]){
    directory.clientRows.filter(r=>r.client_managerId===owner&&!usedRecords.has(r.id)).slice(0,count).forEach((r,i)=>{
      const id=`volume-${manager}-${i+1}`;
      usedRecords.add(r.id);volume[manager].push(id);
      clients.push({id,name:r.clientName,city:(r.clientAddress||"").split(",")[0],manager,
        legals:directory.sales.rowsFor(r).length,outlets:directory.outletRows.filter(o=>o.clientId===r.id).length,
        record:{...r,client_manager:person(manager)}});
    });
  }
  for(const [manager,owner] of [["m1","DEMO-M1"],["m2","DEMO-E12"],["m3","DEMO-E14"]]){
    directory.clientRows.filter(r=>r.client_managerId===owner&&!usedRecords.has(r.id)).forEach(r=>{
      usedRecords.add(r.id);
      clients.push({id:`pool-${manager}-${r.id}`,name:r.clientName,city:(r.clientAddress||"").split(",")[0],manager,
        legals:directory.sales.rowsFor(r).length,outlets:directory.outletRows.filter(o=>o.clientId===r.id).length,
        record:{...r,client_manager:person(manager)}});
    });
  }
  const state = {role:"manager",person:"m1",view:"list",clock:initialClock,query:"",filter:"all",detail:null,client:null,clientTab:"overview",legal:"",form:null,modal:null,toast:"",next:110,eventSeq:0,audit:{q:"",kind:"",assistant:"",from:"",to:""}};
  let assignments = [];
  const rolePerson = {manager:"m1",coordinator:"c1",rop:"r1",director:"d1",assistant:"a1"};
  function seed() {
    const make=(id,manager,assistant,ids,start,end,status,reason)=>({
      id,manager,assistant,clients:ids,start:T(start),end:T(end),status,reason,createdBy:manager,
      history:[{at:T(start)-86400000,actor:person(manager),text:status==="draft"?"Сохранён черновик":"Подготовлено демонстрационное назначение"}],change:null,
    });
    assignments=[
      make("Н-101","m1","a1",["c1","c2"],"2026-10-27T09:00","2026-10-30T18:00","pending","Командировка: сопровождение выбранных клиентов."),
      make("Н-102","m1","a1",["c3"],"2026-10-26T09:00","2026-10-29T18:00","approved","Отпуск менеджера, сопровождение клиентов."),
      make("Н-103","m2","a2",["c4"],"2026-10-29T09:00","2026-10-31T18:00","approved","Плановая командировка менеджера."),
      make("Н-104","m1","a1",["c5"],"2026-10-20T09:00","2026-10-24T18:00","approved","Завершённый период доступа к информации о клиенте."),
      make("Н-105","m1","a2",["c9"],"2026-10-27T09:00","2026-10-28T18:00","rejected","Помощь в сопровождении клиента."),
      make("Н-106","m2","a1",["c7"],"2026-10-25T09:00","2026-10-30T18:00","revoked","Менеджер вернулся раньше срока."),
      make("Н-107","m3","a2",["c8"],"2026-10-27T09:00","2026-10-30T18:00","pending","Заявка другой территории в единую очередь руководителя ассистентов."),
      make("Н-108","m1","a1",["c6"],"2026-10-26T09:00","2026-10-29T18:00","approved","Сопровождение выбранного клиента."),
      make("Н-109","m1","a2",["c9"],"2026-10-28T09:00","2026-10-30T18:00","draft","Подготовка подмены на время обучения."),
      make("Н-090","m1","a1",volume.m1.slice(0,20),"2026-10-26T09:00","2026-10-29T18:00","approved","Временный доступ к группе клиентов на период командировки менеджера."),
      make("Н-091","m1","a1",volume.m1.slice(20),"2026-10-27T09:00","2026-10-29T18:00","approved","Дополнительная группа клиентов для информационного сопровождения."),
      make("Н-092","m2","a1",volume.m2.slice(0,8),"2026-10-26T09:00","2026-10-29T18:00","approved","Временный доступ к выбранным клиентам второго менеджера."),
      make("Н-093","m2","a2",volume.m2.slice(8),"2026-10-26T09:00","2026-10-31T18:00","approved","Рабочая группа клиентов на период отсутствия менеджера."),
    ];
    assignments.filter(a=>["approved","revoked"].includes(a.status)).forEach(a=>a.history.push({
      at:Math.min(a.start-3600000,initialClock-10800000),actor:person("c1"),actorId:"c1",role:"coordinator",kind:"approve",
      text:"Назначение согласовано руководителем ассистентов.",snapshot:decisionSnapshot(a)
    }));
    assignments[4].history.push({at:initialClock-7200000,actor:person("c1"),actorId:"c1",role:"coordinator",kind:"reject",text:"Отклонено: согласуйте нагрузку ассистента.",snapshot:decisionSnapshot(assignments[4])});
    assignments[4].history.push({at:initialClock-18000000,actor:person("c1"),actorId:"c1",role:"coordinator",kind:"return",text:"Возвращено на уточнение: укажите цель и объём временного доступа.",snapshot:decisionSnapshot(assignments[4])});
    assignments[5].history.push({at:initialClock-3600000,actor:person("c1"),actorId:"c1",role:"coordinator",kind:"revoke",text:"Доступ отозван: менеджер вернулся раньше срока.",snapshot:decisionSnapshot(assignments[5])});
    assignments[7].change={assistant:"a2",clients:["c6"],start:T("2026-10-26T09:00"),end:T("2026-10-30T18:00"),reason:"Передать замещение Павлу: Анна перегружена."};
    assignments[7].history.push({at:initialClock-1800000,actor:person("m1"),text:"Предложено изменение. Доступ приостановлен до решения руководителя."});
  }
  seed();
  function effective(a) {
    if(a.status!=="approved") return a.status;
    if(a.change) return "change_pending";
    if(state.clock>=a.end) return "completed";
    return state.clock<a.start?"planned":"active";
  }
  const labels={draft:"Черновик",pending:"На согласовании",revision:"Нужно уточнение",rejected:"Отклонено",cancelled:"Отменено автором",active:"Действует",planned:"Ожидает начала",completed:"Завершено",revoked:"Доступ отозван",change_pending:"Изменения на согласовании"};
  const tones={active:"good",pending:"warn",revision:"warn",change_pending:"warn",planned:"blue",rejected:"bad",revoked:"bad"};
  const badge=a=>`<span class="as-badge ${tones[effective(a)]||""}">${labels[effective(a)]}</span>${window.AssistantFeedback?.closure(a)?`<small class="as-feedback-closure">${E(window.AssistantFeedback.closure(a))}</small>`:""}`;
  const actor=()=>person(state.person);
  const teamOf=id=>people[id]?.team;
  function canSee(a) {
    if(state.role==="director") return true;
    if(state.role==="coordinator") return a.status!=="draft"||a.createdBy===state.person;
    if(state.role==="assistant") return a.assistant===state.person && ["approved","revoked"].includes(a.status);
    if(state.role==="manager") return a.manager===state.person;
    return teamOf(a.manager)===teamOf(state.person);
  }
  const visible=()=>assignments.filter(canSee);
  const canReview=a=>a && state.role==="coordinator";
  const canAuthor=a=>a && (state.role==="manager"&&a.manager===state.person || state.role==="coordinator"&&a.createdBy===state.person);
  const canRevoke=a=>a && (canAuthor(a)||canReview(a));
  const active=a=>a && canSee(a)&&effective(a)==="active";
  const availableClients=()=>[...new Set(visible().filter(active).flatMap(a=>a.clients))];
  const isAssistant=()=>state.role==="assistant";
  const isWriter=()=>["manager","coordinator"].includes(state.role);
  function decisionSnapshot(a,value=a){return {manager:a.manager,assistant:value.assistant,clients:[...value.clients],start:value.start,end:value.end};}
  function history(a,text,value=a,kind="") { a.history.push({at:state.clock,seq:++state.eventSeq,actor:actor(),actorId:state.person,role:state.role,kind:kind||(state.role==="coordinator"?"request":""),text,snapshot:decisionSnapshot(a,value)}); document.dispatchEvent(new CustomEvent("assistant:event",{detail:{id:a.id,kind:kind||"request",text}})); }
  function notify(text) {state.toast=text;}
  function empty(title,text,button="") {return `<section class="as-panel as-empty"><h2>${E(title)}</h2><p>${E(text)}</p>${button}</section>`;}
  function button(action,text,attrs="",cls="") {return `<button type="button" data-as-action="${action}" ${attrs} class="${cls}">${text}</button>`;}
  function writeUrl() {
    const params=new URLSearchParams(location.hash.split("?")[1]||"");params.set("as_role",state.role);params.set("as_view",state.view);params.set("as_person",state.person);
    historyReplace("#"+current+"?"+params);
  }
  function historyReplace(hash) {window.history.replaceState(null,"",hash);}
  function tabs() {
    if(isAssistant()) return [["clients","Клиенты"],["list","Условия доступа"],["archive","История доступа"]];
    if(state.role==="coordinator")return [["review","На согласовании"],["list","Все назначения"],["create","Создать назначение"],["load","Доступы по датам"],["audit","История моей работы"],["ratings","Оценки ассистентов"]];
    if(state.role==="manager") return [["list","Мои назначения"],["create","Создать назначение"],["ratings","Оценить работу"]];
    if(state.role==="director")return [["audit","Активность координатора"],["list","Все назначения"],["load","Доступы по датам"],["ratings","Оценки ассистентов"]];
    return [["list","Назначения команды"],["load","Доступы по датам"]];
  }
  function scopeText() {
    return {manager:"Только ваши клиенты. Все заявки направляются координатору — руководителю ассистентов.",coordinator:"Координатор — руководитель ассистентов. Единая очередь всех территорий, согласование назначений и изменений, контроль доступа и нагрузки.",rop:"Просмотр назначений своей команды. Согласование выполняет координатор; от РОПа действий не требуется.",director:"Контроль всей активности координатора — руководителя ассистентов. Только просмотр, без согласования.",assistant:"Только клиенты из действующих согласованных назначений. Без назначения база пуста."}[state.role];
  }
  function personOptions() {
    const ids={manager:["m1","m2"],coordinator:["c1"],rop:["r1","r2"],director:["d1"],assistant:["a1","a2"]}[state.role];
    return ids.map(id=>`<option value="${id}" ${state.person===id?"selected":""}>${E(person(id))}${teamOf(id)?" · "+teamOf(id):""}</option>`).join("");
  }
  function renderWorkspace() {
    if(!routes.has(current)) return;
    if(state.view==="review"&&state.role!=="coordinator")state.view=defaultView(state.role);
    if(state.view==="audit"&&!["coordinator","director"].includes(state.role))state.view="list";
    if(state.detail&&!canSee(assignments.find(a=>a.id===state.detail)||{})) state.detail=null;
    if(isAssistant()&&state.client&&!availableClients().includes(state.client)) state.client=null;
    document.title="Тандор · Назначения ассистентам · "+roles[state.role];
    const main=document.querySelector(".main"); if(!main)return;
    const avatar=document.querySelector(".head .avatar");if(avatar){avatar.textContent=actor().split(" ").map(x=>x[0]).join("");avatar.title=actor();}
    const sideNote=document.querySelector(".r-sidebar-note");
    if(sideNote)sideNote.innerHTML=E(actor())+"<br>"+E(scopeText());
    const sourceNote=document.querySelector(".sidebar .source-note");
    if(sourceNote)sourceNote.innerHTML="1С · информация о клиентах<br>ЛК · временный доступ для просмотра";
    if(isAssistant())document.querySelectorAll(".sidebar .nav button[data-go]").forEach(b=>{
      const pageView=state.client?"clients":state.view==="archive"?"list":state.view;
      const match=pageView==="clients"?"assistant-clients":"assistant";
      b.classList.toggle("active",b.dataset.go===match);
    });
    main.innerHTML=`<div class="as-work" data-testid="assistant-workspace">
      <div class="as-head"><div><div class="as-kicker">Клиенты и временный доступ · первый этап</div><h1>${isAssistant()&&state.view==="clients"?"Клиенты":"Назначения ассистентам"}</h1><p>Доступ к информации по выбранным клиентам на определённый период. Только просмотр.</p></div>${button("reset","Сбросить демо")}</div>
      <p class="as-demo">Интерактивный прототип · вымышленные сотрудники и клиенты. Действия связаны между ролями только в этой вкладке; после перезагрузки примеры сбросятся. Реальные права, 1С и Битрикс24 не меняются.</p>
      <div class="as-rolebar"><div><p class="as-muted">Посмотреть сценарий роли</p><div class="as-roles">${Object.entries(roles).map(([k,v])=>button("role",v,`data-role="${k}" aria-pressed="${state.role===k}"`)).join("")}</div></div><label>Сотрудник в демо<select data-as-person aria-label="Сотрудник в демо">${personOptions()}</select></label></div>
      <div class="as-scope"><span><strong>${E(actor())}</strong> · ${roles[state.role]}</span><span>${E(scopeText())}</span></div>
      <nav class="as-tabs" aria-label="Сценарии назначений">${tabs().map(([k,v])=>button("view",v,`data-view="${k}" ${state.view===k?'aria-current="page"':""}`)).join("")}</nav>
      ${state.toast?`<div class="as-toast" role="status">${E(state.toast)}</div>`:""}
      <div id="as-content">${state.client?clientView():state.detail?detailView():state.view==="ratings"?(window.AssistantFeedback?.view()||""):state.view==="audit"?auditView():state.view==="create"?formView():state.view==="load"?loadView():state.view==="clients"?clientsView():isAssistant()?assistantView():listView()}</div>
      <details class="as-clock"><summary>Демо-время: ${dt(state.clock)} МСК · проверить начало и окончание доступа</summary><div><label>Дата и время в Москве<input id="as-clock-value" type="datetime-local" value="${local(state.clock)}"></label>${button("clock","Применить время")}${button("clock-reset","27 октября, 11:00")}</div><p class="as-muted">Начало включительно, окончание не включительно. Изменение времени влияет только на этот прототип.</p></details>
      <p class="as-muted">Ролевой просмотр является демонстрацией интерфейса, а не системой авторизации. Другие разделы прототипа остаются самостоятельными примерами.</p>
      ${state.modal?modalView():""}
    </div>`;
    document.body.classList.toggle("x7-active",window.AssistantDirectory.active());
    if(window.AssistantDirectory.active()){
      document.getElementById("as-content").innerHTML='<div class="as-directory"></div>';
      directory.mountAssistant();
    }else document.body.classList.remove("x14-focus-mode");
    if(state.modal) {
      document.body.style.overflow="hidden";
      requestAnimationFrame(()=>(document.querySelector("#as-dialog-reason")||document.querySelector("[data-as-action=modal-cancel]"))?.focus());
    } else document.body.style.overflow="";
    writeUrl();
    document.dispatchEvent(new CustomEvent("assistant:paint"));
  }
  function listView() {
    let rows=visible().filter(a=>state.view!=="review" || a.status==="pending" || a.change);
    const all=rows.slice();
    rows=rows.filter(a=>(state.filter==="all"||effective(a)===state.filter)&&
      [a.id,person(a.manager),person(a.assistant),...a.clients.map(id=>byClient(id).name)].join(" ").toLowerCase().includes(state.query.toLowerCase()));
    return `<section class="as-panel"><div class="as-between"><h2>${state.view==="review"?"Требуют решения руководителя":"Назначения и статусы"}</h2>${isWriter()?button("new","Новое назначение","","primary"):""}</div>
    <div class="as-counts"><span><strong>${all.length}</strong> в вашей области</span><span><strong>${all.filter(a=>effective(a)==="active").length}</strong> действуют</span><span><strong>${all.filter(a=>["pending","change_pending"].includes(effective(a))).length}</strong> ждут решения</span></div>
    <div class="as-toolbar"><label>Поиск<input data-as-search value="${E(state.query)}" placeholder="Клиент, сотрудник или номер"></label><label>Статус<select data-as-status><option value="all">Все статусы</option>${Object.entries(labels).map(([k,v])=>`<option value="${k}" ${state.filter===k?"selected":""}>${v}</option>`).join("")}</select></label></div>
    <div id="as-list-results">${assignmentTable(rows)}</div></section>`;
  }
  function assignmentTable(rows) {
    if(!rows.length)return empty("Назначений не найдено","Измените поиск или статус. Руководитель ассистентов видит заявки всех территорий.");
    return `<div class="as-table-scroll" tabindex="0" aria-label="Таблица назначений, можно прокручивать"><table class="as-table"><thead><tr><th>Назначение</th><th>Менеджер → ассистент</th><th>Период, МСК</th><th>Клиенты</th><th>Статус</th><th></th></tr></thead><tbody>${rows.map(a=>`<tr><td><strong>${a.id}</strong><small>Команда «${teamOf(a.manager)}»</small></td><td><strong>${E(person(a.manager))}</strong><small>${E(person(a.assistant))}</small></td><td>${dt(a.start)}<small>до ${dt(a.end)}</small></td><td>${a.clients.length}<small>${E(a.clients.map(id=>byClient(id).name).join(", "))}</small></td><td>${badge(a)}</td><td>${button("detail","Открыть",`data-id="${a.id}"`)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  const auditKinds={approve:"Согласование",reject:"Отклонение",return:"Возврат на уточнение",revoke:"Отзыв доступа",request:"Работа с заявкой"};
  function auditEvents(){
    return assignments.flatMap(a=>a.history.filter(h=>h.role==="coordinator"&&h.kind in auditKinds).map(h=>({a,h,s:h.snapshot||decisionSnapshot(a)})))
      .sort((a,b)=>b.h.at-a.h.at||(b.h.seq||0)-(a.h.seq||0));
  }
  function filteredAudit(){
    const f=state.audit,q=f.q.trim().toLocaleLowerCase("ru");
    return auditEvents().filter(({a,h,s})=>(!f.kind||h.kind===f.kind)&&(!f.assistant||s.assistant===f.assistant)&&
      (!f.from||h.at>=T(f.from+"T00:00"))&&(!f.to||h.at<T(f.to+"T00:00")+86400000)&&
      (!q||[a.id,h.actor,h.text,person(s.manager),person(s.assistant),...s.clients.map(id=>byClient(id).name)].join(" ").toLocaleLowerCase("ru").includes(q)));
  }
  function auditResults(){
    const rows=filteredAudit(),all=auditEvents();
    return `<p class="as-muted" role="status">Найдено действий: ${rows.length} из ${all.length}. Условия применяются одновременно; дата относится к решению, не к периоду доступа.</p>
    ${rows.length?`<div class="as-table-scroll" tabindex="0" aria-label="Журнал руководителя ассистентов, можно прокручивать"><table class="as-table as-audit-table"><thead><tr><th>Когда и кто</th><th>Заявка и решение</th><th>Менеджер → ассистент</th><th>Условия на момент решения</th><th>Комментарий и основание</th><th></th></tr></thead><tbody>${rows.map(({a,h,s})=>`<tr><td><strong>${dt(h.at)} МСК</strong><small>${E(h.actor)}<br>Руководитель ассистентов</small></td><td><strong>${a.id}</strong><small>${auditKinds[h.kind]}</small></td><td>${E(person(s.manager))}<small>→ ${E(person(s.assistant))} · ${E(teamOf(s.manager))}</small></td><td>${dt(s.start)} → ${dt(s.end)} МСК<details><summary>Клиентов: ${s.clients.length}</summary><ul>${s.clients.map(id=>`<li>${E(byClient(id).name)}</li>`).join("")}</ul></details></td><td>${E(h.text)}</td><td>${button("detail","Открыть заявку",`data-id="${a.id}"`)}</td></tr>`).join("")}</tbody></table></div>`:empty("Действий по фильтрам нет","Измените период, тип решения, ассистента или поисковый запрос.")}`;
  }
  function auditView(){
    if(!["director","coordinator"].includes(state.role))return empty("Журнал недоступен","Журнал предназначен директору и руководителю ассистентов.");
    const f=state.audit,events=auditEvents(),pending=assignments.filter(a=>a.status==="pending"||a.change).length;
    return `<section class="as-panel"><h2>Активность координатора</h2><p>Координатор — руководитель ассистентов · все территории · ${E(person("c1"))}. Директор наблюдает за работой координатора, но не участвует в согласовании.</p>
    <div class="as-counts"><span>Ждут решения: <strong>${pending}</strong></span>${["approve","reject","return","revoke"].map(k=>`<span>${({approve:"Согласовано",reject:"Отклонено",return:"Возвращено",revoke:"Отозвано"})[k]}: <strong>${events.filter(e=>e.h.kind===k).length}</strong></span>`).join("")}</div>
    <p class="as-muted">Сводка выше за всю историю демонстрации. Фильтры ниже ограничивают только журнал действий.</p>
    <div class="as-audit-filters"><label>Поиск<input data-as-audit="q" value="${E(f.q)}" placeholder="Заявка, сотрудник, клиент или комментарий"></label>
    <label>Решение<select data-as-audit="kind"><option value="">Все решения</option>${Object.entries(auditKinds).map(([k,v])=>`<option value="${k}" ${f.kind===k?"selected":""}>${v}</option>`).join("")}</select></label>
    <label>Ассистент<select data-as-audit="assistant"><option value="">Все ассистенты</option>${["a1","a2"].map(id=>`<option value="${id}" ${f.assistant===id?"selected":""}>${E(person(id))}</option>`).join("")}</select></label>
    <label>Решения с даты<input type="date" data-as-audit="from" value="${E(f.from)}"></label><label>По дату включительно<input type="date" data-as-audit="to" value="${E(f.to)}"></label>${button("audit-reset","Сбросить фильтры")}</div>
    <div id="as-audit-results">${auditResults()}</div></section>`;
  }
  const pickerDefaults=()=>({city:"",category:"",minSales:"",maxSales:"",legalMin:"",ttMin:"",access:"",selected:false,sort:"name",month:"2026-09"});
  function newForm(a,change=false) {
    const value=change&&a.change?a.change:a;
    return {id:a?.id||null,change,manager:a?.manager||(state.role==="manager"?state.person:"m1"),assistant:value?.assistant||"",
      clients:[...(value?.clients||[])],start:local(value?.start||state.clock+3600000),end:local(value?.end||state.clock+86400000*2),reason:value?.reason||"",q:"",filters:pickerDefaults(),error:""};
  }
  const pickerSales=c=>directory.sales.summary(directory.sales.rowsFor(c.record),state.form.filters.month).revenue;
  const pickerConflict=c=>assignments.find(a=>a.id!==state.form.id&&a.status==="approved"&&overlap(a,T(state.form.start),T(state.form.end))&&a.clients.includes(c.id));
  function pickerRows(){
    const f=state.form,p=f.filters,q=f.q.trim().toLocaleLowerCase("ru");
    const rows=clients.filter(c=>{
      if(c.manager!==f.manager)return false;
      const legal=directory.sales.rowsFor(c.record);
      if(q&&![c.name,c.city,c.record.clientId,c.record.clientPhones,...legal.flatMap(l=>[l.legalName,l.inn,...l.contracts.map(d=>d.contractNumber)])].join(" ").toLocaleLowerCase("ru").includes(q))return false;
      if(p.city&&c.city!==p.city||p.category&&(c.record.topCategory||"empty")!==p.category)return false;
      const sales=pickerSales(c);
      if((p.minSales!==""||p.maxSales!=="")&&(!Number.isFinite(sales)||(p.minSales!==""&&sales<Number(p.minSales))||(p.maxSales!==""&&sales>Number(p.maxSales))))return false;
      if(p.legalMin!==""&&c.legals<Number(p.legalMin)||p.ttMin!==""&&c.outlets<Number(p.ttMin))return false;
      if(p.selected&&!f.clients.includes(c.id))return false;
      if(p.access==="free"&&pickerConflict(c)||p.access==="busy"&&!pickerConflict(c))return false;
      return true;
    });
    return rows.sort((a,b)=>{
      if(p.sort==="name")return a.name.localeCompare(b.name,"ru",{numeric:true});
      const av=pickerSales(a),bv=pickerSales(b);
      if(!Number.isFinite(av)||!Number.isFinite(bv))return Number.isFinite(av)===Number.isFinite(bv)?0:Number.isFinite(av)?-1:1;
      return (av-bv)*(p.sort==="sales-asc"?1:-1);
    });
  }
  function pickerSelectionText(){
    const shown=new Set(pickerRows().map(c=>c.id)),hidden=state.form.clients.filter(id=>!shown.has(id)).length;
    return `Выбрано клиентов: ${state.form.clients.length}${hidden?` · скрыто фильтрами: ${hidden}`:""}. Выбор сохраняется при смене фильтров.`;
  }
  function refreshPicker(preserve=false){
    const list=document.getElementById("as-client-picker"),top=preserve?list.scrollTop:0;
    const focused=document.activeElement?.dataset.asClient;
    const index=focused?[...list.querySelectorAll("input")].findIndex(e=>e.dataset.asClient===focused):-1;
    list.innerHTML=picker();list.scrollTop=top;
    if(focused){
      const boxes=[...list.querySelectorAll("input")],next=boxes.find(e=>e.dataset.asClient===focused)||boxes[Math.min(index,boxes.length-1)];
      if(next)next.focus({preventScroll:true});else document.querySelector('[data-as-pick="selected"]').focus({preventScroll:true});
    }
    document.getElementById("as-picked").textContent=pickerSelectionText();
    document.getElementById("as-picker-found").textContent=`Найдено: ${pickerRows().length} из ${clients.filter(c=>c.manager===state.form.manager).length}`;
  }
  function pickerFilters(){
    const p=state.form.filters,own=clients.filter(c=>c.manager===state.form.manager);
    const select=(key,label,items)=>`<label>${label}<select data-as-pick="${key}">${items.map(([v,t])=>`<option value="${E(v)}" ${p[key]===v?"selected":""}>${E(t)}</option>`).join("")}</select></label>`;
    const minimum=(key,label)=>`<label>${label}<input type="number" min="0" step="1" data-as-pick="${key}" value="${E(p[key])}" placeholder="Не ограничено"></label>`;
    return `<div class="as-picker-filters">
      ${select("city","Город",[["","Все города"],...[...new Set(own.map(c=>c.city))].sort().map(v=>[v,v])])}
      ${select("category","Категория",[["","Все категории"],...[...new Set(own.map(c=>c.record.topCategory).filter(Boolean))].sort().map(v=>[v,v]),["empty","Не передана"]])}
      ${select("month","Период продаж",window.TandoorClientMetrics.months.map(v=>[v,`${window.TandoorClientMetrics.monthNames[+v.slice(5)-1]} ${v.slice(0,4)}`]))}
      ${minimum("minSales","Продажи от, ₽")}${minimum("maxSales","Продажи до, ₽")}
      ${select("access","Доступ в выбранные даты",[["","Все клиенты"],["free","Без пересечений доступа"],["busy","Есть пересечение доступа"]])}
      ${minimum("legalMin","Юрлиц не меньше")}${minimum("ttMin","Торговых точек не меньше")}
      ${select("sort","Сортировка",[["name","По названию"],["sales-desc","Продажи: сначала крупные"],["sales-asc","Продажи: сначала небольшие"]])}
    </div><div class="as-picker-toolbar"><label class="as-pick-check"><input type="checkbox" data-as-pick="selected" ${p.selected?"checked":""}>Только выбранные</label>${button("picker-reset","Сбросить фильтры","","as-link")}</div>
    <p class="as-muted">Все условия применяются одновременно. Сумма продаж за выбранный месяц; отсутствие данных не считается нулём.</p>`;
  }
  function picker() {
    const f=state.form,rows=pickerRows();
    return rows.length?rows.map(c=>{
      const conflict=pickerConflict(c),sales=pickerSales(c);
      return `<label class="as-check"><input type="checkbox" data-as-client="${c.id}" ${f.clients.includes(c.id)?"checked":""}><span><strong>${E(c.name)}</strong><small>${E(c.city)} · ${E(c.record.topCategory||"Категория не передана")} · ${c.legals} юрлиц · ${c.outlets} ТТ</small><small>Продажи: ${Number.isFinite(sales)?new Intl.NumberFormat("ru-RU").format(sales)+" ₽":"нет данных"}${conflict?` · пересечение с ${E(conflict.id)}`:""}</small></span></label>`;
    }).join(""):`<p class="as-muted" style="padding:16px">Нет клиентов по выбранным условиям. Измените фильтры; ранее выбранные клиенты сохранены.</p>`;
  }
  function formView() {
    if(!isWriter())return empty("Создание недоступно","Назначение готовит менеджер или координатор. Решение принимает только руководитель ассистентов; директор наблюдает.");
    if(!state.form)state.form=newForm();
    const f=state.form,managerOptions=(state.role==="manager"?[state.person]:["m1","m2","m3"]).map(id=>`<option value="${id}" ${id===f.manager?"selected":""}>${E(person(id))}</option>`).join("");
    return `<div class="as-grid"><section class="as-panel"><h2>${f.change?"Изменить согласованное назначение":f.id?"Редактировать заявку":"Новое назначение"}</h2>
    <form id="as-assignment-form" class="as-form" novalidate>
      <label>Чьих клиентов передаём<select data-as-field="manager" ${state.role==="manager"?"disabled":""}>${managerOptions}</select></label>
      <label>Ассистент<select data-as-field="assistant" required><option value="">Выберите ассистента</option>${["a1","a2"].map(id=>`<option value="${id}" ${f.assistant===id?"selected":""}>${E(person(id))}</option>`).join("")}</select></label>
      <div class="as-fields"><label>Начало, МСК<input data-as-field="start" type="datetime-local" value="${f.start}" required></label><label>Окончание, МСК · не включая<input data-as-field="end" type="datetime-local" value="${f.end}" required></label></div>
      <div><label>Поиск по своим клиентам<input data-as-field="q" value="${E(f.q)}" placeholder="Название, город, ИНН, юрлицо или договор"></label>
      ${pickerFilters()}<div class="as-picker-toolbar"><strong id="as-picker-found" role="status">Найдено: ${pickerRows().length} из ${clients.filter(c=>c.manager===f.manager).length}</strong>${button("picker-select","Выбрать найденных")}${button("picker-unselect","Снять найденных")}${button("picker-clear","Очистить выбор","","as-link")}</div>
      <p class="as-muted" id="as-picked" aria-live="polite">${pickerSelectionText()}</p><div id="as-client-picker" class="as-client-picker">${picker()}</div></div>
      <label>Основание назначения<textarea data-as-field="reason" placeholder="Например: временный доступ к информации на время отпуска менеджера">${E(f.reason)}</textarea></label>
      <p class="as-error" id="as-form-error" role="alert">${E(f.error)}</p>
      <div class="as-actions">${button("submit",f.change?"Отправить изменения на согласование":"Отправить на согласование","","primary")}${!f.change?button("draft","Сохранить черновик"):""}${button("back","Отмена")}</div>
    </form></section><aside class="as-panel"><h2>Перед выдачей доступа</h2><p>Передаются только выбранные клиенты. Постоянный менеджер и кадровая структура не меняются.</p><ol class="as-history"><li>Менеджер или координатор готовит заявку.</li><li>Все заявки поступают руководителю ассистентов. Только он согласовывает назначения и изменения.</li><li>Ассистент видит клиентов только в утверждённый период.</li><li>Директор видит назначения и историю решений руководителя без участия в согласовании.</li></ol>
    ${f.change?`<div class="as-notice warn">Пока изменения на согласовании, доступ по этому назначению приостановлен. После отклонения или отмены изменений возвращаются прежние условия.</div>`:`<div class="as-notice">Черновик и неподтверждённая заявка не предоставляют доступ.</div>`}
    <div id="as-load-hint">${loadHint(f.assistant,T(f.start),T(f.end))}</div></aside></div>`;
  }
  function overlap(a,start,end) {return a.start<end&&start<a.end;}
  function loadHint(assistant,start,end) {
    if(!assistant)return `<p class="as-muted">Выберите ассистента, чтобы увидеть пересечения периодов доступа.</p>`;
    const rows=assignments.filter(a=>a.id!==state.form?.id&&a.assistant===assistant&&["approved","pending"].includes(a.status)&&overlap(a,start,end));
    return `<div class="as-notice"><strong>${E(person(assistant))}</strong><br>Пересечений по датам: ${rows.length}; клиентов в этих назначениях: ${new Set(rows.flatMap(a=>a.clients)).size}. Назначение предоставляет только просмотр информации.</div>`;
  }
  function validate(f,draft=false) {
    if(!["m1","m2","m3"].includes(f.manager)||state.role==="manager"&&f.manager!==state.person)return "Нельзя назначать клиентов другого менеджера.";
    if(!draft&&!["a1","a2"].includes(f.assistant))return "Выберите ассистента.";
    if(!f.clients.length)return "Выберите хотя бы одного клиента.";
    if(f.clients.some(id=>byClient(id)?.manager!==f.manager))return "В списке есть клиент вне выбранной базы.";
    const start=T(f.start),end=T(f.end);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return "Окончание должно быть позже начала.";
    if(!draft&&end<=state.clock)return "Период уже закончился. Укажите актуальные даты.";
    if(!draft&&f.reason.trim().length<5)return "Укажите понятное основание назначения (не менее 5 символов).";
    const collision=assignments.find(a=>a.id!==f.id&&a.status==="approved"&&overlap(a,start,end)&&a.clients.some(id=>f.clients.includes(id)));
    if(!draft&&collision)return `Клиент уже включён в ${collision.id} на пересекающийся период. Сначала измените или отзовите это назначение.`;
    return "";
  }
  function submit(draft=false) {
    if(!isWriter()||!state.form)return;
    const f=state.form,err=validate(f,draft);if(err){f.error=err;document.getElementById("as-form-error").textContent=err;return;}
    const values={assistant:f.assistant,clients:[...f.clients],start:T(f.start),end:T(f.end),reason:f.reason.trim()};
    let a=assignments.find(a=>a.id===f.id);
    if(f.change) {
      if(!a||!canAuthor(a)||a.status!=="approved"||a.end<=state.clock)return notifyAndRender("Назначение больше нельзя изменить.");
      a.change=values;history(a,"Изменения отправлены на согласование. Доступ приостановлен.",values);
    } else if(a) {
      if(!canAuthor(a)||!["draft","revision"].includes(a.status))return notifyAndRender("Заявка недоступна для редактирования.");
      Object.assign(a,values,{status:draft?"draft":"pending"});history(a,draft?"Черновик сохранён":"Заявка отправлена на согласование");
    } else {
      a={...values,id:"Н-"+state.next++,manager:f.manager,status:draft?"draft":"pending",createdBy:state.person,history:[],change:null};
      history(a,draft?"Создан черновик":"Заявка отправлена на согласование");assignments.unshift(a);
    }
    state.form=null;state.view="list";state.detail=a.id;notify(draft?"Черновик сохранён. Доступ не выдан.":"Отправлено руководителю. До согласования доступ не выдан.");renderWorkspace();
  }
  function detailView() {
    const a=assignments.find(x=>x.id===state.detail);if(!a||!canSee(a))return empty("Назначение недоступно","У выбранного сотрудника нет такого назначения.");
    if(isAssistant())return assistantDetail(a);
    const status=effective(a),pending=a.status==="pending"||a.change;
    const author=canAuthor(a);
    return `${button("back","← К списку")}<section class="as-panel" style="margin-top:16px"><div class="as-between"><h2>${a.id} · ${E(person(a.manager))} → ${E(person(a.assistant))}</h2>${badge(a)}</div>
      <dl class="as-meta"><div><dt>Начало</dt><dd>${dt(a.start)} МСК</dd></div><div><dt>Окончание, не включая</dt><dd>${dt(a.end)} МСК</dd></div><div><dt>Команда и автор</dt><dd>${teamOf(a.manager)} · ${E(person(a.createdBy))}</dd></div></dl>
      <h3>Основание</h3><p>${E(a.reason||"Черновик ещё не заполнен")}</p>
      ${status==="change_pending"?`<div class="as-notice warn">Доступ приостановлен до решения по изменениям.</div>${diffView(a)}`:""}
      <h3>Клиенты · ${a.clients.length}</h3>${a.clients.map(id=>{const c=byClient(id);return `<div class="as-client-row"><div><strong>${E(c.name)}</strong><small>${c.city} · ${c.legals} юрлиц · ${c.outlets} ТТ</small></div></div>`;}).join("")}
      <div class="as-actions" style="margin-top:20px">
      ${canReview(a)&&pending?(state.clock<(a.change?.end||a.end)?button("decision",a.change?"Согласовать изменения":"Согласовать",`data-id="${a.id}" data-kind="approve"`,"primary"):"")+button("decision",a.change?"Отклонить изменения":"Отклонить",`data-id="${a.id}" data-kind="reject"`)+(a.change?"":button("decision","Вернуть на уточнение",`data-id="${a.id}" data-kind="return"`)):""}
      ${author&&["draft","revision"].includes(a.status)?button("edit","Редактировать",`data-id="${a.id}"`,"primary"):""}
      ${author&&["draft","pending","revision"].includes(a.status)?button("decision","Отменить заявку",`data-id="${a.id}" data-kind="cancel"`):""}
      ${author&&a.status==="approved"&&a.end>state.clock&&!a.change?button("edit-change","Изменить условия",`data-id="${a.id}"`):""}
      ${author&&a.change?button("decision","Отменить изменения",`data-id="${a.id}" data-kind="withdraw-change"`):""}
      ${canRevoke(a)&&a.status==="approved"&&a.end>state.clock?button("decision","Отозвать доступ",`data-id="${a.id}" data-kind="revoke"`,"as-danger"):""}
      </div>${pending&&state.clock>=(a.change?.end||a.end)?`<div class="as-notice bad">Период заявки закончился. Выдать доступ задним числом нельзя.</div>`:""}
      ${["completed","revoked"].includes(status)?`<div class="as-notice">Доступ ассистента к этим клиентам закрыт. Постоянный менеджер клиента не менялся.</div>`:""}
    </section><section class="as-panel"><h2>История решений</h2><ol class="as-history">${a.history.slice().reverse().sort((x,y)=>y.at-x.at).map(h=>`<li>${E(h.text)}<small>${E(h.actor)} · ${dt(h.at)} МСК</small></li>`).join("")}</ol></section>`;
  }
  function diffView(a) {
    const col=(value,title)=>`<div><h3>${title}</h3><p>${E(person(value.assistant))}</p><p>${dt(value.start)} → ${dt(value.end)} МСК</p><p>${E(value.clients.map(id=>byClient(id).name).join(", "))}</p><p>${E(value.reason)}</p></div>`;
    return `<div class="as-diff">${col(a,"Ранее согласовано")}${col(a.change,"Предложено")}</div>`;
  }
  function assistantView() {
    const rows=visible().filter(a=>state.view==="archive"?["completed","revoked"].includes(effective(a)):!["completed","revoked"].includes(effective(a)));
    const count=availableClients().length;
    return `<div class="as-counts"><span><strong>${count}</strong> клиентов доступны сейчас</span><span><strong>${visible().filter(a=>effective(a)==="planned").length}</strong> назначений ожидают начала</span></div>
    ${!count&&state.view!=="archive"?`<div class="as-notice">Сейчас нет действующих назначений. Клиентская база недоступна.</div>`:""}
    ${rows.length?rows.map(a=>`<article class="as-assignment"><div class="as-between"><div><h2>${E(person(a.manager))}</h2><small>${a.id} · команда «${teamOf(a.manager)}»</small></div>${badge(a)}</div><p>${dt(a.start)} → ${dt(a.end)} МСК</p>
    <p>${active(a)?E(a.clients.map(id=>byClient(id).name).join(" · ")):`Клиентов в назначении: ${a.clients.length}. ${effective(a)==="planned"?"Состав откроется с начала периода.":effective(a)==="change_pending"?"Состав скрыт, пока руководитель рассматривает изменения.":"Состав и карточки больше недоступны."}`}</p>
    ${button("detail","Посмотреть условия",`data-id="${a.id}"`)}</article>`).join(""):empty("Назначений нет",state.view==="archive"?"Здесь появятся завершённые и отозванные назначения.":"Попросите менеджера создать назначение и дождитесь согласования руководителем.")}`;
  }
  function assistantDetail(a) {
    const allowed=active(a);
    return `${button("back","← К условиям доступа")}<section class="as-panel" style="margin-top:16px"><div class="as-between"><h2>${a.id} · клиенты ${E(person(a.manager))}</h2>${badge(a)}</div><p>${dt(a.start)} → ${dt(a.end)} МСК</p>
    ${allowed?`<p>Доступ только для просмотра информации. Постоянный менеджер остаётся прежним.</p>${a.clients.map(id=>clientRow(id)).join("")}`:
    `<div class="as-notice ${effective(a)==="change_pending"?"warn":""}">${effective(a)==="planned"?"Назначение согласовано, но ещё не началось.":effective(a)==="change_pending"?"Руководитель рассматривает изменения, доступ приостановлен.":"Доступ завершён."} Карточки клиентов не открываются.</div><p>Клиентов в назначении: ${a.clients.length}.</p>`}</section>`;
  }
  function clientRow(id) {
    const c=byClient(id),a=visible().find(a=>active(a)&&a.clients.includes(id));
    if(!a)return "";
    return `<div class="as-client-row"><div><strong>${E(c.name)}</strong><small>${c.city} · ${c.legals} юрлиц · ${c.outlets} ТТ</small><small>Менеджер: ${E(person(a.manager))} · доступ до ${dt(a.end)} МСК</small></div>${button("client","Открыть карточку",`data-client="${id}"`)}</div>`;
  }
  function clientsView() {
    if(!isAssistant())return empty("Сценарий ассистента","Переключитесь на роль «Ассистент».");
    const ids=availableClients();return ids.length?`<section class="as-panel"><h2>Клиентская база · ${ids.length}</h2><p class="as-muted">Только выбранные клиенты из действующих согласованных назначений. Информация доступна для просмотра, без редактирования.</p>${ids.map(clientRow).join("")}</section>`:empty("Нет доступных клиентов","Клиенты появятся после согласования назначения и наступления начала периода. Проверьте «Условия доступа».");
  }
  function clientView() {
    const c=byClient(state.client);if(!isAssistant()||!c||!availableClients().includes(c.id))return empty("Доступ к карточке закрыт","Срок закончился, назначение отозвано или изменения ещё не согласованы.");
    const a=visible().find(a=>active(a)&&a.clients.includes(c.id));
    const r=c.record;
    const value=v=>v==null||v===""?"Данные появятся после выгрузки из 1С":typeof v==="boolean"?(v?"Да":"Нет"):Array.isArray(v)?v.join(", "):typeof v==="object"?"Данные появятся после выгрузки из 1С":String(v);
    const field=(f,row)=>`<div class="as-info-field"><dt>${E(f.label)}</dt><dd>${E(value(row?.[f.id]))}</dd></div>`;
    const groups=[...new Set(directory.registry.filter(f=>!["legal","contract"].includes(f.relation)&&f.group!=="Продажи за выбранный месяц").map(f=>f.group))];
    let body;
    if(state.clientTab==="sales"){
      const panel=directory.sales.panel(r,{detail:!!state.legal,legalId:state.legal})
        .replace(/data-x6="sales-legal"/g,'data-as-action="legal"')
        .replace(/data-x6="sales-all"/g,'data-as-action="legal-clear"')
        .replace(/data-value=/g,'data-legal=')
        .replace(/data-cs-period/g,"data-as-period")
        .replace(/data-cs-legal-select/g,"data-as-legal-select");
      body=`<div class="as-sales">${state.legal?button("legal-clear","← Все юридические лица"):""}${panel}</div>`;
    }else if(state.clientTab==="data"){
      body=groups.map((g,i)=>`<details class="as-info-group" ${i===0?"open":""}><summary>${E(g)}</summary><dl>${directory.registry.filter(f=>f.group===g).map(f=>field(f,r)).join("")}</dl></details>`).join("");
      const legalIds=new Set(directory.sales.rowsFor(r).map(s=>s.legalId));
      body+=`<h3>Юридические лица и договоры</h3>`+directory.legalRows.filter(l=>legalIds.has(l.id)||l.clientId===r.clientId).map(l=>`<details class="as-info-group"><summary>${E(l.legalName)}</summary><dl>${directory.registry.filter(f=>f.relation==="legal").map(f=>field(f,l)).join("")}</dl>${(l.contracts||[]).map(contract=>`<h3>${E(contract.contractNumber||"Договор")}</h3><dl>${directory.registry.filter(f=>f.relation==="contract").map(f=>field(f,contract)).join("")}</dl>`).join("")}</details>`).join("");
    }else{
      body=`<dl class="as-meta"><div><dt>Город</dt><dd>${E(c.city)}</dd></div><div><dt>Постоянный менеджер</dt><dd>${E(person(a.manager))}</dd></div><div><dt>Юридические лица / ТТ</dt><dd>${c.legals} / ${c.outlets}</dd></div></dl><dl>${directory.registry.filter(f=>["clientName","clientAddress","topCategory","lprName","lprPhone","lprEmail"].includes(f.id)).map(f=>field(f,r)).join("")}</dl>`;
    }
    return `${button("client-back","← К клиентам")}<section class="as-panel" style="margin-top:16px"><div class="as-kicker">Карточка клиента · только просмотр</div><h2>${E(c.name)}</h2>
    <div class="as-notice">Основание: ${a.id}. Доступ до ${dt(a.end)} МСК. Постоянный менеджер не меняется. Представлены вымышленные данные прототипа.</div>
    <nav class="as-card-tabs" aria-label="Информация о клиенте">${[["overview","Обзор"],["data","Данные клиента"],["sales","Продажи"]].map(([key,label])=>button("client-tab",label,`data-tab="${key}" aria-pressed="${state.clientTab===key}"`,state.clientTab===key?"as-selected":"")).join("")}</nav>${body}</section>`;
  }
  function loadView() {
    if(!["coordinator","rop","director"].includes(state.role))return empty("Нет доступа к обзору команды","Этот обзор предназначен координатору и руководителям.");
    const days=Array.from({length:5},(_,i)=>T("2026-10-27T00:00")+i*86400000);
    return `<section class="as-panel"><h2>Доступы по датам · 27–31 октября</h2><p class="as-muted">Только согласованные назначения в вашей области. Приостановленные изменения показаны отдельно, а не как действующий доступ.</p>
      <div class="as-table-scroll" tabindex="0" aria-label="Периоды доступа, горизонтальная прокрутка"><table class="as-table as-calendar"><thead><tr><th>Ассистент</th>${days.map(d=>`<th>${new Intl.DateTimeFormat("ru-RU",{timeZone:"Europe/Moscow",day:"numeric",month:"short",weekday:"short"}).format(d)}</th>`).join("")}</tr></thead><tbody>
      ${["a1","a2"].map(id=>`<tr><td><strong>${E(person(id))}</strong></td>${days.map(d=>{const rows=visible().filter(a=>a.assistant===id&&a.status==="approved"&&!a.change&&overlap(a,d,d+86400000));return `<td>${rows.length?`<div class="as-day ${rows.length>1?"warn":""}"><strong>${new Set(rows.flatMap(a=>a.clients)).size} клиентов</strong><small>${rows.map(a=>E(person(a.manager))).join("<br>")}</small>${rows.length>1?"<small>Проверить пересечение нагрузки</small>":""}</div>`:`<span class="as-muted">Нет назначений</span>`}</td>`;}).join("")}</tr>`).join("")}</tbody></table></div>
      <div class="as-notice">Обзор показывает только периоды доступа к клиентской информации. Доступ к другим разделам не предоставляется.</div>
      <h3>Заявки и изменения, по которым доступ ещё не действует</h3>${assignmentTable(visible().filter(a=>a.status==="pending"||a.change))}</section>`;
  }
  function modalView() {
    const {kind,id}=state.modal,a=assignments.find(a=>a.id===id);
    const titles={approve:a?.change?"Согласовать изменения":"Согласовать назначение",reject:a?.change?"Отклонить изменения":"Отклонить назначение",return:"Вернуть на уточнение",cancel:"Отменить заявку",revoke:"Отозвать доступ","withdraw-change":"Отменить предложенные изменения",reset:"Сбросить демонстрацию"};
    const isApprove=kind==="approve",isReset=kind==="reset";
    return `<div class="as-modal"><section class="as-dialog" role="dialog" aria-modal="true" aria-labelledby="as-dialog-title"><h2 id="as-dialog-title">${titles[kind]}</h2><p>${isReset?"Примеры и решения в этой вкладке вернутся в исходное состояние. Реальный ЛК не затрагивается.":isApprove?"Проверьте ассистента, список клиентов и период. Только после этого доступ может начать действовать.":kind==="revoke"?"Доступ прекратится немедленно, даже если исходный период ещё не закончился.":"Решение и основание сохранятся в истории этого демонстрационного назначения."}</p>
    ${!isReset?`<label class="as-form">Комментарий${isApprove?" (необязательно)":" / основание"}<textarea id="as-dialog-reason"></textarea></label>`:""}
    <p id="as-dialog-error" class="as-error" role="alert"></p><div class="as-actions">${button("modal-cancel","Отмена")}${button("modal-confirm",isReset?"Сбросить":isApprove?"Подтвердить":"Сохранить решение","",["revoke","reject"].includes(kind)?"as-danger":"primary")}</div></section></div>`;
  }
  function decide() {
    const m=state.modal;if(!m)return;
    const reason=document.getElementById("as-dialog-reason")?.value.trim()||"";
    const error=text=>{document.getElementById("as-dialog-error").textContent=text;};
    if(m.kind==="reset"){seed();state.clock=initialClock;state.next=110;state.form=null;state.detail=null;state.client=null;state.modal=null;notify("Демонстрация сброшена.");renderWorkspace();return;}
    const a=assignments.find(a=>a.id===m.id);if(!a||!canSee(a))return error("Назначение недоступно для выбранной роли.");
    if(m.kind!=="approve"&&reason.length<5)return error("Укажите основание или результат: не менее 5 символов.");
    if(["approve","reject","return"].includes(m.kind)) {
      if(!canReview(a)||a.status!=="pending"&&!a.change)return error("Нет заявки, которую вы можете согласовать.");
      const proposal=a.change||a;
      if(m.kind==="approve") {
        if(proposal.end<=state.clock)return error("Период закончился. Согласование не выдаст доступ задним числом.");
        const collision=assignments.find(x=>x.id!==a.id&&x.status==="approved"&&overlap(x,proposal.start,proposal.end)&&x.clients.some(id=>proposal.clients.includes(id)));
        if(collision)return error("Пересекающийся период клиента в "+collision.id+". Сначала устраните конфликт.");
        if(a.change){Object.assign(a,a.change);a.change=null;history(a,"Изменения согласованы. Утверждён новый состав и период."+(reason?" Комментарий: "+reason:""),proposal,"approve");}
        else{a.status="approved";history(a,"Назначение согласовано."+(reason?" Комментарий: "+reason:""),proposal,"approve");}
      } else if(a.change){a.change=null;history(a,"Изменения отклонены, сохранены прежние условия: "+reason,proposal,"reject");}
      else{a.status=m.kind==="return"?"revision":"rejected";history(a,(m.kind==="return"?"Возвращено на уточнение: ":"Отклонено: ")+reason,proposal,m.kind);}
    } else if(m.kind==="cancel") {
      if(!canAuthor(a)||!["draft","pending","revision"].includes(a.status))return error("Отменить можно только свою неподтверждённую заявку.");
      a.status="cancelled";history(a,"Заявка отменена: "+reason);
    } else if(m.kind==="withdraw-change") {
      if(!canAuthor(a)||!a.change)return error("Нет ваших предложенных изменений.");
      a.change=null;history(a,"Предложенные изменения отменены, восстановлены прежние условия: "+reason);
    } else if(m.kind==="revoke") {
      if(!canRevoke(a)||a.status!=="approved"||a.end<=state.clock)return error("Отзыв этого назначения недоступен.");
      a.status="revoked";a.change=null;history(a,"Доступ отозван немедленно: "+reason,a,"revoke");
    }
    state.modal=null;notify("Решение сохранено только в прототипе.");renderWorkspace();
  }
  function notifyAndRender(text){notify(text);renderWorkspace();}
  function back(){state.detail=null;state.client=null;state.form=null;state.view=canReview({manager:"m1"})?"review":"list";state.query="";state.filter="all";renderWorkspace();}
  function defaultView(role){return role==="assistant"?"clients":role==="coordinator"?"review":role==="director"?"audit":"list";}
  document.addEventListener("click",event=>{
    const b=event.target.closest("[data-as-action]");if(!b)return;
    const action=b.dataset.asAction,a=assignments.find(a=>a.id===b.dataset.id);
    if(action==="audit-reset"){if(!["director","coordinator"].includes(state.role))return;state.audit={q:"",kind:"",assistant:"",from:"",to:""};renderWorkspace();return;}
    if(action.startsWith("picker-")){
      if(!isWriter()||!state.form)return;
      const f=state.form,ids=new Set(pickerRows().map(c=>c.id));
      if(action==="picker-select")f.clients=[...new Set([...f.clients,...ids])];
      if(action==="picker-unselect")f.clients=f.clients.filter(id=>!ids.has(id));
      if(action==="picker-clear")f.clients=[];
      if(action==="picker-reset"){f.q="";f.filters=pickerDefaults();renderWorkspace();return}
      refreshPicker(true);return;
    }
    if(action==="role") {
      state.role=b.dataset.role;state.person=rolePerson[state.role];state.view=defaultView(state.role);state.form=null;state.detail=null;state.client=null;state.modal=null;state.query="";state.filter="all";state.toast="";writeUrl();render();return;
    }
    if(action==="view"){state.view=b.dataset.view;state.detail=null;state.client=null;state.query="";state.filter="all";state.toast="";if(state.view==="create")state.form=newForm();}
    if(action==="new"){if(!isWriter())return;state.view="create";state.form=newForm();state.detail=null;}
    if(action==="back"){back();return;}
    if(action==="detail"){if(!a||!canSee(a))return;state.detail=a.id;state.client=null;state.toast="";}
    if(action==="edit"||action==="edit-change"){
      if(!a||!canAuthor(a))return;
      state.form=newForm(a,action==="edit-change");state.detail=null;state.view="create";
    }
    if(action==="submit"){submit(false);return;}
    if(action==="draft"){submit(true);return;}
    if(action==="decision"){
      if(!a||!canSee(a))return;
      if(["approve","reject","return"].includes(b.dataset.kind)&&!canReview(a))return;
      if(b.dataset.kind==="revoke"&&!canRevoke(a))return;
      if(["cancel","withdraw-change"].includes(b.dataset.kind)&&!canAuthor(a))return;
      state.modal={kind:b.dataset.kind,id:a.id};
    }
    if(action==="modal-cancel"){state.modal=null;}
    if(action==="modal-confirm"){decide();return;}
    if(action==="reset"){state.modal={kind:"reset"};}
    if(action==="client"){
      if(!isAssistant()||!availableClients().includes(b.dataset.client))return;
      state.client=null;state.detail=null;state.view="clients";
      const p=new URLSearchParams(location.hash.split("?")[1]||"");p.set("record",byClient(b.dataset.client).record.id);p.set("mode","card");p.set("entity","clients");p.set("tab","overview");
      historyReplace("#"+current+"?"+p);
    }
    if(action==="client-back"){state.client=null;state.view="clients";}
    if(action==="client-tab"){if(!isAssistant()||!availableClients().includes(state.client))return;state.clientTab=b.dataset.tab;state.legal="";}
    if(action==="legal"||action==="legal-clear"){if(!isAssistant()||!availableClients().includes(state.client))return;state.legal=action==="legal"?b.dataset.legal:"";}
    if(action==="clock"){
      const value=document.getElementById("as-clock-value").value,ts=T(value);
      if(!Number.isFinite(ts))return notifyAndRender("Укажите корректное демо-время.");
      state.clock=ts;state.client=null;state.detail=null;notify("Демо-время изменено. Доступы пересчитаны.");
    }
    if(action==="clock-reset"){state.clock=initialClock;state.client=null;state.detail=null;notify("Демо-время восстановлено.");}
    renderWorkspace();
  });
  document.addEventListener("input",event=>{
    if(event.target.matches("[data-as-period]")&&isAssistant()&&availableClients().includes(state.client)){directory.sales.setMonth(event.target.value);state.legal="";renderWorkspace();return;}
    if(event.target.matches("[data-as-legal-select]")&&isAssistant()&&availableClients().includes(state.client)){state.legal=event.target.value;renderWorkspace();return;}
    const e=event.target;
    if(e.dataset.asAudit&&["director","coordinator"].includes(state.role)){
      state.audit[e.dataset.asAudit]=e.value;document.getElementById("as-audit-results").innerHTML=auditResults();return;
    }
    if(e.dataset.asPick&&state.form&&isWriter()){
      state.form.filters[e.dataset.asPick]=e.type==="checkbox"?e.checked:e.value;refreshPicker();return;
    }
    if(e.hasAttribute("data-as-search")){
      state.query=e.value;
      const rows=visible().filter(a=>(state.view!=="review"||a.status==="pending"||a.change)&&(state.filter==="all"||effective(a)===state.filter)&&[a.id,person(a.manager),person(a.assistant),...a.clients.map(id=>byClient(id).name)].join(" ").toLowerCase().includes(state.query.toLowerCase()));
      document.getElementById("as-list-results").innerHTML=assignmentTable(rows);return;
    }
    if(!e.dataset.asField||!state.form)return;
    state.form[e.dataset.asField]=e.value;
    if(e.dataset.asField==="q")refreshPicker();
    if(["assistant","start","end"].includes(e.dataset.asField))document.getElementById("as-load-hint").innerHTML=loadHint(state.form.assistant,T(state.form.start),T(state.form.end));
    if(["start","end"].includes(e.dataset.asField))refreshPicker();
  });
  document.addEventListener("change",event=>{
    const e=event.target;
    if(e.hasAttribute("data-as-person")){
      state.person=e.value;state.form=null;state.detail=null;state.client=null;state.query="";state.filter="all";state.toast="";writeUrl();renderWorkspace();return;
    }
    if(e.hasAttribute("data-as-status")){state.filter=e.value;renderWorkspace();return;}
    if(e.dataset.asClient&&state.form){
      const ids=new Set(state.form.clients);e.checked?ids.add(e.dataset.asClient):ids.delete(e.dataset.asClient);state.form.clients=[...ids];refreshPicker(true);return;
    }
    if(e.dataset.asField==="manager"&&state.form){state.form.manager=e.value;state.form.clients=[];state.form.q="";state.form.filters=pickerDefaults();renderWorkspace();}
  });
  document.addEventListener("submit",event=>{if(event.target.id==="as-assignment-form"){event.preventDefault();submit(false);}});
  document.addEventListener("keydown",event=>{
    if(!state.modal)return;
    if(event.key==="Escape"){state.modal=null;renderWorkspace();return;}
    if(event.key==="Tab"){
      const nodes=[...document.querySelectorAll(".as-dialog button,.as-dialog textarea")],first=nodes[0],last=nodes.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  add("assistant-clients","Клиенты ассистента","Только действующие назначения","Ассистент","handover","","");
  const priorNav=roleNav;
  roleNav=function(items){
    if(routes.has(current)&&state.role==="assistant")return [
      ["assistant-clients","Клиенты","users","handover"],
      ["assistant","Условия доступа","repeat-2","handover"],
    ];
    return priorNav(items).map(row=>row[0]==="handover"?[row[0],"Назначения ассистентам",row[2],row[3]]:row);
  };
  function readRole() {
    const p=new URLSearchParams(location.hash.split("?")[1]||""),requested=p.get("as_role"),role=requested==="assistant_lead"?"coordinator":requested;
    state.role=Object.hasOwn(roles,role)?role:current.startsWith("assistant")?"assistant":current==="coordinator"?"coordinator":Object.hasOwn(roles,prototypeRole)?prototypeRole:"manager";
    const id=p.get("as_person");
    const allowed={manager:["m1","m2"],coordinator:["c1"],rop:["r1","r2"],director:["d1"],assistant:["a1","a2"]}[state.role];
    state.person=allowed.includes(id)?id:rolePerson[state.role];
    state.view=p.get("as_view")|| (current==="assistant-clients"||current==="assistant-tasks"?"clients":defaultView(state.role));
    if(state.view==="tasks")state.view="clients";
    if(!tabs().some(([k])=>k===state.view))state.view=defaultView(state.role);
  }
  let lastRoute="";
  const beforeRender=render;
  render=function(){
    if(current==="assistant-tasks"){current="assistant-clients";state.view="clients";}
    if(lastRoute!==current){state.detail=null;state.client=null;state.modal=null;lastRoute=current;}
    if(routes.has(current))readRole();
    beforeRender();document.body.classList.toggle("as-active",routes.has(current));
    if(routes.has(current))renderWorkspace();else{state.modal=null;document.body.style.overflow="";}
  };
  // Expose only synthetic model helpers to the local regression harness.
  window.AssistantPrototype={effective,availableClients,roles,state,people,person,byClient,assignments:()=>assignments,render:renderWorkspace,
    routeActive:()=>routes.has(current),initialClock,dt,
    open:id=>{const a=assignments.find(x=>x.id===id);if(!a||!canSee(a))return false;state.detail=id;state.client=null;state.form=null;renderWorkspace();return true;},
    go:view=>{state.detail=null;state.client=null;state.form=null;state.view=view;renderWorkspace();}};
  window.AssistantDirectory={
    active:()=>routes.has(current)&&isAssistant()&&state.view==="clients"&&!state.detail,
    rows:entity=>{
      const allowed=availableClients().map(id=>byClient(id).record);
      if(entity==="clients")return allowed;
      const ids=new Set(allowed.map(r=>r.clientId));
      return directory.outletRows.filter(r=>ids.has(r.clientId));
    },
    params:()=>({as_role:"assistant",as_person:state.person,as_view:"clients"}),
    onPaint:()=>{
      const target=document.querySelector(".as-directory");
      if(!availableClients().length&&target){
        const notice=document.createElement("div");notice.className="as-notice";notice.textContent="Нет доступных клиентов. Для просмотра нужно действующее согласованное назначение.";target.prepend(notice);
      }
    }
  };
  // The base app renders before this module registers assistant-only routes.
  // Restore a direct link after registration rather than keeping its fallback.
  const requestedRoute=location.hash.slice(1).split("?")[0];
  if(routes.has(requestedRoute))current=requestedRoute;
  render();
})();
