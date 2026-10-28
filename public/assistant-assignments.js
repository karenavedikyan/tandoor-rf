(function () {
  "use strict";
  var api = window.TandoorRf, shell = window.ClientsShell, dt = window.AccessDatetime;
  var app = document.getElementById("access-workspace-app"), user, view, current = null, editing = null;
  var listPage = 1, listQuery = "", listStatus = "", historyAction = "", listSeq = 0, pickerSeq = 0, detailSeq = 0;
  var assistants = [], managers = [], selected = new Map(), pickData = null, pickPage = 1, filters = {};
  var TRANSFER_KEY = "tandoor:admin-assignment-transfer:v1";
  function previewState() { return shell.getPreviewState && shell.getPreviewState() || { active: false }; }
  function previewReadOnly() {
    var p = previewState();
    return Boolean(p.active && !p.workMode);
  }
  function previewWriteHint() {
    return previewReadOnly()
      ? '<p class="aa-note aa-preview-block" role="status">Изменения запрещены в режиме просмотра. Включите «Работать от имени сотрудника» в плашке сверху — данные не отправятся автоматически.</p>'
      : "";
  }
  var pendingTransfer = null;
  function transferIdentity() {
    var p = previewState();
    var actor = shell.getActorUser && shell.getActorUser();
    return {
      targetUserId: user && user.id,
      actorUserId: actor && actor.id,
    };
  }
  function saveTransferState() {
    if (!document.getElementById("aa-assignment-form")) return;
    try {
      var id = transferIdentity();
      sessionStorage.setItem(TRANSFER_KEY, JSON.stringify({
        v: 1,
        targetUserId: id.targetUserId,
        actorUserId: id.actorUserId,
        editingId: editing && editing.id,
        rowVersion: editing && editing.row_version,
        managerId: $("aa-manager") && $("aa-manager").value,
        assistantId: $("aa-assistant") && $("aa-assistant").value,
        start: $("aa-start") && $("aa-start").value,
        end: $("aa-end") && $("aa-end").value,
        basis: $("aa-basis") && $("aa-basis").value,
        selected: Array.from(selected.entries()),
        filters: filters,
        pickPage: pickPage,
      }));
    } catch (_err) { /* ignore */ }
  }
  function transferMatches(data) {
    if (!data || data.v !== 1 || !user) return false;
    var id = transferIdentity();
    if (data.targetUserId && data.targetUserId !== id.targetUserId) return false;
    if (data.actorUserId && data.actorUserId !== id.actorUserId) return false;
    if (data.editingId) {
      if (!editing || editing.id !== data.editingId) return false;
      if (data.rowVersion != null && editing.row_version !== data.rowVersion) return false;
    } else if (editing) return false;
    return true;
  }
  function takePendingTransfer() {
    var raw = sessionStorage.getItem(TRANSFER_KEY);
    if (!raw) return null;
    try {
      var data = JSON.parse(raw);
      sessionStorage.removeItem(TRANSFER_KEY);
      if (!transferMatches(data)) return null;
      return data;
    } catch (_err) {
      sessionStorage.removeItem(TRANSFER_KEY);
      return null;
    }
  }
  var labels = { create: "Создание", edit: "Исправление", submit: "Отправка заявки", approve: "Согласование",
    reject: "Отклонение", return: "Возврат на уточнение", cancel: "Отмена заявки", revoke: "Отзыв доступа",
    propose_change: "Изменение условий", approve_change: "Согласование изменений", reject_change: "Отклонение изменений",
    return_change: "Возврат изменений", cancel_change: "Отмена изменений" };
  function e(v) { return String(v == null ? "" : v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function $(id) { return document.getElementById(id); }
  function money(v) { return v == null ? "Нет данных" : Number(v).toLocaleString("ru-RU",{maximumFractionDigits:2})+" ₽"; }
  function button(action,title,extra,cls) { return '<button type="button" data-aa="'+action+'" '+(extra||"")+' class="'+(cls||"")+'">'+e(title)+"</button>"; }
  function note(message, error) { if(!$("aa-status")){app.className="aa";app.innerHTML='<p id="aa-status" role="status"></p>';} $("aa-status").textContent=message; $("aa-status").className=error?"aa-error":"aa-muted"; }
  async function request(path, body) {
    if (body !== undefined && previewReadOnly()) {
      throw Error("Изменения запрещены в режиме просмотра от имени сотрудника.");
    }
    var r=await api.apiRequest("/api/access"+path,body === undefined?{}:{method:"POST",body:body});
    if(r.response.status===401){window.location.replace("/login");throw Error("Войдите в кабинет.");}
    if(r.response.status===403&&r.data&&r.data.error&&r.data.error.code==="PASSWORD_CHANGE_REQUIRED"){window.location.replace("/change-password");}
    if(!r.response.ok) throw Error(api.extractErrorMessage(r.data,"Не удалось выполнить запрос. Повторите попытку."));
    return r.data;
  }
  function opts(rows, currentId, empty) {
    return '<option value="">'+e(empty||"Выберите")+'</option>'+rows.map(function(r){return '<option value="'+e(r.id)+'" '+(r.id===currentId?"selected":"")+">"+e(r.full_name)+(r.email?" · "+e(r.email):"")+"</option>";}).join("");
  }
  function pager(data, prefix) {
    var pageSize = data.pageSize || 50;
    var totalPages = data.totalPages || Math.max(1, Math.ceil((data.total || 0) / pageSize));
    var page = Math.min(Math.max(1, data.page || 1), totalPages);
    return '<div class="aa-pager"><span class="aa-muted">Всего: '+(data.total||0)+' · Страница '+page+" из "+totalPages+'</span><div class="aa-actions">'+
      button(prefix+"-prev","Назад",page<=1?"disabled":"")+button(prefix+"-next","Далее",page>=totalPages?"disabled":"")+"</div></div>";
  }
  function mount() {
    if(window.AssignmentReviews)window.AssignmentReviews.close();
    detailSeq++;
    app.className="aa";
    app.innerHTML='<nav class="aa-tabs" aria-label="Представления назначений">'+
      button("list","Назначения",'aria-pressed="'+(view==="list")+'"')+
      (["manager","coordinator"].includes(user.role)?button("new","Новое назначение","",view==="new"?"aa-primary":""):"")+
      (["coordinator","director"].includes(user.role)?button("activity","Активность РОА",'aria-pressed="'+(view==="activity")+'"'):"")+
      (["manager","coordinator","director"].includes(user.role)?button("reviews",user.role==="manager"?"Оценить работу":"Оценки ассистентов",'aria-pressed="'+(view==="reviews")+'"'):"")+
      '</nav><p id="aa-status" class="aa-muted" role="status" aria-live="polite"></p><div id="aa-view"></div><div id="aa-detail"></div>'+
      '<dialog id="aa-decision" class="aa-dialog"><form id="aa-decision-form"><h2 id="aa-decision-title"></h2><p id="aa-decision-note"></p><label>Основание или комментарий<textarea id="aa-decision-reason" minlength="5" maxlength="2000" required></textarea></label><p id="aa-decision-error" class="aa-error" role="alert"></p><div class="aa-actions">'+button("close-dialog","Отмена")+'<button type="submit" class="aa-primary">Подтвердить</button></div></form></dialog>';
    app.onclick=function(ev){ var b=ev.target.closest("[data-aa]"); if(b) run(function(){return click(b.dataset.aa,b);}); };
    $("aa-decision-form").onsubmit=decisionSubmit;
    if(view==="reviews"&&window.AssignmentReviews)run(function(){return window.AssignmentReviews.render($("aa-view"),user);});
    else if(view==="new") renderForm(); else renderList();
  }
  async function run(fn) { try{await fn();}catch(err){note(err.message||"Ошибка запроса.",true);} }
  function renderList() {
    var activity=view==="activity";
    $("aa-view").innerHTML='<section class="aa-box" id="aa-list-box"><div class="aa-toolbar"><h2>'+ (activity?"Активность координатора":"Назначения и заявки")+"</h2>"+button("fullscreen","На весь экран")+'</div>'+
      (activity?'<p class="aa-muted">Решения, основания и условия на момент действия. Директору доступен только просмотр.</p>':user.role==="coordinator"?'<p class="aa-note">Вы РОА (руководитель отдела ассистентов), координатор и единственный согласующий. В очереди заявки всех территорий.</p>':user.role==="admin"?'<p class="aa-note">Технический просмотр назначений. Согласование выполняет РОА. Оценки доступны автору оценки, РОА и директору.</p>':"")+
      '<form id="aa-list-filter" class="aa-toolbar"><label>Поиск<input name="q" type="search" placeholder="'+(activity?"Сотрудник, основание":"Менеджер, ассистент, номер")+'" value="'+e(listQuery)+'"></label>'+
      (activity?'<label>Действие<select name="action"><option value="">Все действия</option>'+Object.keys(labels).map(function(k){return '<option value="'+k+'" '+(k===historyAction?"selected":"")+">"+e(labels[k])+"</option>";}).join("")+'</select></label>':
        '<label>Статус<select name="status">'+[["","Все назначения"],["queue","На согласовании"],["active","Согласованные"],["draft","Черновики и возвраты"],["archive","Архив"]].map(function(x){return '<option value="'+x[0]+'" '+(x[0]===listStatus?"selected":"")+">"+x[1]+"</option>";}).join("")+'</select></label>')+
      '<button type="submit">Применить</button>'+button("reset-list","Сбросить")+'</form><div id="aa-list-data" aria-live="polite">Загружаем…</div></section>';
    $("aa-list-filter").onsubmit=function(ev){ev.preventDefault(); var f=new FormData(ev.target);listQuery=f.get("q");listStatus=f.get("status")||"";historyAction=f.get("action")||"";listPage=1;run(loadList);};
    run(loadList);
  }
  async function loadList() {
    var seq=++listSeq, activity=view==="activity";
    var p=new URLSearchParams({page:String(listPage),q:listQuery});
    p.set(activity?"action":"status",activity?historyAction:listStatus);
    var data=await request((activity?"/assignments/activity?":"/assignments?")+p);
    if(seq!==listSeq||!$("aa-list-data"))return;
    var html="";
    if(!activity&&data.coordinatorCount===0&&["manager","coordinator"].includes(user.role)) html+='<p class="aa-note">РОА (координатор) пока не назначен. Заявки сохранятся в очереди, но доступ не откроется до согласования.</p>';
    if(!data.items.length) html+='<p class="aa-muted">Здесь пока нет '+(activity?"действий координатора":"назначений с выбранными условиями")+'. '+(!listQuery&&!listStatus&&user.role==="manager"?"Создайте новое назначение.":"Попробуйте изменить фильтры.")+"</p>";
    else html+='<div class="aa-scroll" tabindex="0" aria-label="Таблица назначений, прокрутка в двух направлениях"><table><thead><tr>'+
      (activity?"<th>Когда и кто</th><th>Действие</th><th>Назначение и условия</th><th>Основание</th>":"<th>Менеджер</th><th>Ассистент</th><th>Клиенты / юрлица</th><th>Период, МСК</th><th>Статус</th><th></th>")+
      "</tr></thead><tbody>"+data.items.map(function(d){
        if(activity){var s=d.snapshot;return "<tr><td>"+e(dt.formatMskDisplay(d.changed_at))+"<small>"+e(d.actor_name)+"</small></td><td>"+e(labels[d.change_type]||d.change_type)+"</td><td>"+
          (s?e(s.delegator_name)+" → "+e(s.assistant_name)+"<small>"+e(dt.formatMskDisplay(s.starts_at))+" — "+e(dt.formatMskDisplay(s.ends_at))+"</small>":"Состав ограничен правами")+
          button("open","Открыть",'data-id="'+e(d.delegation_id)+'"')+"</td><td>"+e(d.comment)+"</td></tr>";}
        return "<tr><td>"+e(d.delegator_name)+'</td><td>'+e(d.assistant_name)+"</td><td>"+d.client_count+" юрлиц</td><td>"+e(dt.formatMskDisplay(d.starts_at))+"<small>до "+e(dt.formatMskDisplay(d.ends_at))+'</small></td><td><span class="aa-tag '+(d.effective_status==="active"?"aa-tag--active":"")+'">'+e(d.effective_label)+'</span></td><td>'+button("open","Открыть",'data-id="'+e(d.id)+'"')+"</td></tr>";
      }).join("")+"</tbody></table></div>";
    $("aa-list-data").innerHTML=html+pager(data,"list");
    if(!activity)data.items.forEach(function(d){
      if(!d.review||!d.review.label)return;
      var b=$("aa-list-data").querySelector('[data-id="'+d.id+'"]');
      if(b){var cell=b.closest("tr").children[4],small=document.createElement("small");small.className="aa-review-status";small.textContent=d.review.label;cell.appendChild(small);}
    });
  }
  function clientNames(rows) {
    if(!Array.isArray(rows))return '<p class="aa-muted">Состав клиентов ограничен правами.</p>';
    return '<div class="aa-scroll" tabindex="0" aria-label="Состав клиентов">'+rows.map(function(c){return '<div class="aa-check"><span>'+e(c.name)+"<small>"+e(c.guid)+"</small></span></div>";}).join("")+"</div>";
  }
  async function openDetail(id) {
    var seq=++detailSeq;var data=await request("/delegations/"+encodeURIComponent(id));if(seq!==detailSeq)return;current=data.delegation;
    var d=current, p=d.proposal, actions="", author=d.canAuthor, review=d.canReview;
    if(d.status==="draft"&&author)actions+=button("edit","Исправить условия")+button("submit","Отправить на согласование","","aa-primary");
    if(d.status==="pending_approval"&&review)actions+=button("approve","Согласовать","","aa-primary")+button("return","Вернуть на уточнение")+button("reject","Отклонить","","aa-danger");
    if(d.status==="active"&&p&&review)actions+=button("approve_change","Согласовать изменения","","aa-primary")+button("return_change","Вернуть изменения")+button("reject_change","Отклонить изменения","","aa-danger");
    if(d.status==="active"&&!p&&author&&new Date(d.ends_at)>new Date())actions+=button("change",d.returnedProposal?"Исправить возвращённые изменения":"Изменить условия");
    if(p&&author)actions+=button("cancel_change","Отменить запрос изменений");
    if(["draft","pending_approval"].includes(d.status)&&author)actions+=button("cancel","Отменить заявку");
    if(d.status==="active"&&review)actions+=button("revoke","Отозвать доступ","","aa-danger");
    $("aa-detail").innerHTML='<section class="aa-box"><div class="aa-toolbar"><h2>Назначение №'+e(d.id.slice(0,8))+"</h2>"+button("close-detail","Закрыть")+'</div><div class="aa-grid"><div><span class="aa-muted">Передающий менеджер</span><p>'+e(d.delegator_name)+'</p></div><div><span class="aa-muted">Ассистент</span><p>'+e(d.assistant_name)+'</p></div></div><p><span class="aa-tag">'+e(d.effective_label)+'</span></p><p>'+e(dt.formatMskDisplay(d.starts_at))+" — "+e(dt.formatMskDisplay(d.ends_at))+' МСК, окончание не включая.</p><p>'+e(d.basis||"Основание сохранено в истории прежней версии.")+'</p>'+
      (p?'<div class="aa-note"><h3>Предложенные условия</h3><p>До решения координатора доступ приостановлен.</p><p>'+e(p.assistant_name)+" · "+e(dt.formatMskDisplay(p.starts_at))+" — "+e(dt.formatMskDisplay(p.ends_at))+"</p><p>"+e(p.basis)+"</p>"+clientNames(p.clients)+"</div>":d.returnedProposal?'<p class="aa-note">Последние изменения возвращены на уточнение. Прежние согласованные условия сохранены; возвращённые условия можно исправить и отправить снова.</p>':"")+
      '<h3>Согласованный / текущий состав</h3>'+clientNames(d.clients)+'<div class="aa-actions">'+actions+'</div>'+
      (d.history&&d.history.length?'<h3>История назначения</h3><ol class="aa-history">'+d.history.map(function(h){var s=h.snapshot;var adminNote=s&&s.performed_by_admin?"<p class=\"aa-note\">Выполнено администратором "+e(s.performed_by_admin.name)+" от имени "+e(s.performed_by_admin.effective_employee_name)+".</p>":"";return "<li><strong>"+e(labels[h.change_type]||h.change_type)+"</strong><time>"+e(dt.formatMskDisplay(h.changed_at))+"</time><span class=\"aa-muted\">"+e(h.actor_name||"Событие прежней версии")+(h.actor_role==="admin"?" (администратор)":"")+"</span><p>"+e(h.comment)+"</p>"+adminNote+(s?'<details><summary>Условия на момент действия</summary><p>'+e(s.delegator_name)+" → "+e(s.assistant_name)+"</p><p>"+e(dt.formatMskDisplay(s.starts_at))+" — "+e(dt.formatMskDisplay(s.ends_at))+"</p>"+clientNames(s.clients)+(s.proposal?"<h3>Предложенные изменения</h3><p>"+e(s.proposal.assistant_name)+" · "+e(dt.formatMskDisplay(s.proposal.starts_at))+" — "+e(dt.formatMskDisplay(s.proposal.ends_at))+"</p>"+clientNames(s.proposal.clients):"")+"</details>":"")+"</li>";}).join("")+"</ol>":"")+"</section>";
    if(window.AssignmentReviews)$("aa-detail").querySelector(".aa-grid").insertAdjacentHTML("afterend",window.AssignmentReviews.summary(d));
    $("aa-detail").scrollIntoView({behavior:"smooth",block:"start"});
  }
  function formTerms() {
    return {delegatorUserId:$("aa-manager").value,assistantUserId:$("aa-assistant").value,
      startsAt:dt.parseMskLocalInput($("aa-start").value),endsAt:dt.parseMskLocalInput($("aa-end").value),
      basis:$("aa-basis").value,clientGuids:Array.from(selected.keys()),rowVersion:editing&&editing.row_version};
  }
  function renderForm() {
    var transferApply = pendingTransfer;
    pendingTransfer = null;
    var d=editing||{}, proposal=d.proposal||d.returnedProposal||null, initial=proposal||d;
    var starts=initial.starts_at||new Date().toISOString(), ends=initial.ends_at||new Date(Date.now()+7*86400000).toISOString();
    if (transferApply) {
      selected = new Map(transferApply.selected || []);
      filters = transferApply.filters || {};
      pickPage = transferApply.pickPage || 1;
      if (transferApply.start) starts = dt.parseMskLocalInput(transferApply.start) || starts;
      if (transferApply.end) ends = dt.parseMskLocalInput(transferApply.end) || ends;
    } else {
      selected=new Map((initial.clients||[]).map(function(c){return [c.guid,c.name];}));
      pickPage=1;filters={};
    }
    pickData=null;
    var managerId = transferApply && transferApply.managerId ? transferApply.managerId : (d.delegator_user_id || (user.role==="manager"?user.id:""));
    var assistantId = transferApply && transferApply.assistantId ? transferApply.assistantId : initial.assistant_user_id;
    var basisText = transferApply && transferApply.basis ? transferApply.basis : (proposal?proposal.basis:d.basis||"");
    $("aa-detail").innerHTML="";
    $("aa-view").innerHTML='<section class="aa-box"><h2>'+(editing?(d.status==="draft"?"Исправить заявку":"Запрос изменения условий"):"Новое назначение")+'</h2><p class="aa-muted">На первом этапе предоставляется только просмотр выбранных клиентов. Задачи и другие права не передаются.</p><form id="aa-assignment-form"><div class="aa-grid">'+
      '<label>Чьих клиентов передаём<select id="aa-manager" required '+(editing||user.role==="manager"?"disabled":"")+">"+(user.role==="manager"?opts([{id:user.id,full_name:user.fullName}],user.id):opts(managers,managerId,"Выберите менеджера"))+'</select></label>'+
      '<label>Ассистент<select id="aa-assistant" required>'+opts(assistants,assistantId,"Выберите ассистента")+'</select></label>'+
      '<label>Начало, Москва (МСК)<input id="aa-start" type="datetime-local" value="'+e(dt.isoToMskLocalInput(starts))+'" required></label><label>Окончание, МСК (не включая)<input id="aa-end" type="datetime-local" value="'+e(dt.isoToMskLocalInput(ends))+'" required></label></div>'+
      '<h3>Выбор клиентов</h3><p class="aa-muted">Клиент выбирается вместе с доступными вам юрлицами. Скрытые фильтрами отметки сохраняются.</p><div id="aa-picker"></div>'+
      '<label>Основание<textarea id="aa-basis" minlength="5" maxlength="2000" required placeholder="Для чего и на какой период нужен доступ">'+e(basisText)+'</textarea></label>'+
      previewWriteHint()+
      '<div class="aa-actions" style="margin-top:16px">'+
      '<button type="submit" class="aa-primary" '+(previewReadOnly()?"disabled":"")+'>'+(editing&&d.status==="active"?"Отправить изменения на согласование":"Отправить на согласование")+'</button>'+
      (!editing||d.status==="draft"?'<button type="submit" data-draft="true" '+(previewReadOnly()?"disabled":"")+'>Сохранить черновик</button>':"")+button("abandon","Отменить редактирование")+'</div></form></section>';
    $("aa-assignment-form").onsubmit=saveForm;
    $("aa-manager").onchange=function(){selected.clear();pickPage=1;filters={};run(loadPicker);};
    $("aa-start").onchange=$("aa-end").onchange=function(){pickPage=1;run(loadPicker);};
    renderPickerShell();run(loadPicker);
  }
  function renderPickerShell() {
    var fields=[["q","Поиск: клиент, ИНН, телефон, договор","search"],["city","Город","text"],["category","Категория","text"],["month","Месяц продаж","month"],["min","Продажи от, ₽","text"],["max","Продажи до, ₽","text"],["legalMin","Юрлиц не менее","number"],["retailMin","Торговых точек не менее","number"]];
    $("aa-picker").innerHTML='<div class="aa-filters">'+fields.map(function(f){return '<label>'+f[1]+'<input data-picker-filter="'+f[0]+'" type="'+f[2]+'" value="'+e(filters[f[0]]||"")+'" '+(f[2]==="number"?'min="1"':"")+"></label>";}).join("")+
      '<label>Пересечения доступа<select data-picker-filter="conflict"><option value="">Все</option><option value="free">Без пересечений</option><option value="busy">Есть пересечения</option></select></label>'+
      '<label>Сортировка<select data-picker-filter="sort"><option value="">По названию</option><option value="sales_desc">Продажи по убыванию</option><option value="sales_asc">Продажи по возрастанию</option></select></label></div>'+
      '<div class="aa-actions">'+button("apply-picker","Применить фильтры")+button("reset-picker","Сбросить фильтры")+button("select-found","Выбрать все найденные")+button("clear-selected","Очистить выбор")+'</div>'+
      '<p id="aa-selected" class="aa-muted"></p><details id="aa-selected-details"><summary>Показать выбранные юрлица</summary><div id="aa-selected-list" class="aa-scroll"></div></details><div id="aa-picker-data" aria-live="polite"></div>';
  }
  async function fetchPicker(page) {
    var terms=formTerms(), p=new URLSearchParams(Object.assign({},filters,{page:String(page)}));
    if(terms.startsAt&&terms.endsAt){p.set("startsAt",terms.startsAt);p.set("endsAt",terms.endsAt);}
    if(editing)p.set("excludeId",editing.id);
    return request("/delegators/"+encodeURIComponent(terms.delegatorUserId)+"/clients?"+p);
  }
  async function loadPicker() {
    var seq=++pickerSeq;if(!$("aa-manager").value){$("aa-picker-data").textContent="Сначала выберите менеджера.";return;}
    pickData=null;
    $("aa-picker-data").textContent="Загружаем клиентов…";
    var data;
    try{data=await fetchPicker(pickPage);}catch(err){if(seq===pickerSeq&&$("aa-picker-data"))$("aa-picker-data").textContent="Не удалось загрузить клиентов. Нажмите «Применить фильтры», чтобы повторить.";throw err;}
    if(seq!==pickerSeq||!$("aa-picker-data"))return;
    if (data.page && data.page !== pickPage) pickPage = data.page;
    pickData=data;
    if(!filters.month&&data.month){filters.month=data.month;document.querySelector('[data-picker-filter="month"]').value=data.month;}
    $("aa-picker-data").innerHTML=(data.items.length?'<div class="aa-scroll" id="aa-picker-scroll" tabindex="0" aria-label="Выбор клиентов">'+data.items.map(function(r){
      return '<label class="aa-check"><input type="checkbox" data-pick="'+e(r.key)+'" '+(r.guids.every(function(id){return selected.has(id);})?"checked":"")+'><span><strong>'+e(r.name)+'</strong><small>'+e(r.city||"Город не передан")+" · "+e(r.category||"Категория не передана")+" · "+r.legal_count+" юрлиц · "+r.tt_count+" ТТ</small><small>Продажи: "+e(money(r.sales))+(r.conflict?" · Есть пересечение периода":"")+"</small></span></label>";
    }).join("")+"</div>":'<p class="aa-muted">Клиенты не найдены. Измените фильтры.</p>')+pager(data,"pick");
    $("aa-picker-data").onchange=function(ev){var key=ev.target.dataset.pick;if(!key)return;var row=pickData.items.find(function(r){return r.key===key;});row.guids.forEach(function(id){if(ev.target.checked)selected.set(id,row.name);else selected.delete(id);});selectionCount();};
    selectionCount();
  }
  function selectionCount() {
    if($("aa-selected"))$("aa-selected").textContent="Выбрано юрлиц: "+selected.size+". Выбор сохраняется между страницами и фильтрами.";
    if($("aa-selected-list"))$("aa-selected-list").innerHTML=selected.size?Array.from(selected.entries()).map(function(c){return '<div class="aa-check"><span>'+e(c[1])+'<small>'+e(c[0])+"</small></span>"+button("unpick","Убрать",'data-guid="'+e(c[0])+'"')+"</div>";}).join(""):'<p class="aa-muted">Пока ничего не выбрано.</p>';
  }
  async function saveForm(ev) {
    ev.preventDefault();if(!selected.size){note("Выберите хотя бы одного клиента.",true);return;}
    var form=ev.target, submitter=ev.submitter, body=formTerms();body.submit=!(submitter&&submitter.dataset.draft);
    var buttons=Array.from(form.querySelectorAll("button"));buttons.forEach(function(b){b.disabled=true;});
    try {
      var result;
      if(editing) {
        result=await request("/delegations/"+editing.id+"/"+(editing.status==="draft"?"edit":"change-requests"),body);
        if(editing.status==="draft"&&body.submit) result=await request("/delegations/"+editing.id+"/submit",{basis:body.basis,rowVersion:result.rowVersion});
      } else result=await request("/delegations",body);
      var id=result.id;editing=null;view="list";listStatus="";mount();note(body.submit?"Заявка отправлена координатору. Доступ изменится только после согласования.":"Черновик сохранён.");
      if(id)await openDetail(id);window.dispatchEvent(new Event("tandoor:notifications-refresh"));
    } catch(err){note(err.message,true);} finally{buttons.forEach(function(b){b.disabled=false;});}
  }
  var decisionAction="";
  function decision(action) {
    decisionAction=action;$("aa-decision-title").textContent=labels[action]||"Отправка";
    $("aa-decision-note").textContent=action==="revoke"?"Доступ прекратится немедленно.":action==="approve"||action==="approve_change"?"Проверьте ассистента, клиентов и период. После подтверждения доступ может начать действовать.":"Решение и основание сохранятся в истории.";
    $("aa-decision-reason").value=action==="approve"||action==="approve_change"?"Условия проверены и согласованы.":"";
    $("aa-decision-error").textContent="";$("aa-decision").showModal();$("aa-decision-reason").focus();
  }
  async function decisionSubmit(ev) {
    ev.preventDefault();var submit=ev.target.querySelector('[type="submit"]');submit.disabled=true;
    try{await request("/delegations/"+current.id+"/"+decisionAction.replace(/_/g,"-"),{basis:$("aa-decision-reason").value,rowVersion:current.row_version});
      $("aa-decision").close();note("Решение сохранено. Уведомления доступны участникам в ЛК.");await openDetail(current.id);await loadList();window.dispatchEvent(new Event("tandoor:notifications-refresh"));
    }catch(err){$("aa-decision-error").textContent=err.message;}finally{submit.disabled=false;}
  }
  async function click(action,b) {
    if(action==="reviews"){editing=null;view="reviews";mount();return;}
    if(action==="new"){editing=null;view="new";mount();return;}
    if(action==="list"||action==="activity"){view=action;listPage=1;current=null;mount();return;}
    if(action==="open"){await openDetail(b.dataset.id);return;}
    if(action==="close-detail"){$("aa-detail").innerHTML="";current=null;return;}
    if(action==="edit"||action==="change"){editing=current;view="new";mount();return;}
    if(action==="abandon"){editing=null;view="list";mount();return;}
    if(action==="list-prev"||action==="list-next"){listPage+=action==="list-next"?1:-1;await loadList();return;}
    if(action==="pick-prev"||action==="pick-next"){pickPage+=action==="pick-next"?1:-1;await loadPicker();return;}
    if(action==="reset-list"){listQuery="";listStatus="";historyAction="";listPage=1;renderList();return;}
    if(action==="fullscreen"){var box=$("aa-list-box");box.classList.toggle("aa-fullscreen");b.textContent=box.classList.contains("aa-fullscreen")?"Выйти из полного экрана":"На весь экран";return;}
    if(action==="apply-picker"){document.querySelectorAll("[data-picker-filter]").forEach(function(f){filters[f.dataset.pickerFilter]=f.value;});pickPage=1;await loadPicker();return;}
    if(action==="reset-picker"){filters={};pickPage=1;renderPickerShell();await loadPicker();return;}
    if(action==="clear-selected"){selected.clear();await loadPicker();return;}
    if(action==="unpick"){selected.delete(b.dataset.guid);await loadPicker();return;}
    if(action==="select-found"){
      if(!pickData)throw Error("Сначала дождитесь списка клиентов или повторите загрузку фильтрами.");
      if(pickData.total>1000)throw Error("Сузьте фильтры: массовый выбор доступен до 1000 клиентов.");
      b.disabled=true;try{var seq=pickerSeq;for(var p=1;p<=Math.ceil(pickData.total/50);p++){var data=await fetchPicker(p);if(seq!==pickerSeq)return;data.items.forEach(function(r){r.guids.forEach(function(id){selected.set(id,r.name);});});}await loadPicker();}finally{b.disabled=false;}return;
    }
    if(action==="close-dialog"){$("aa-decision").close();return;}
    if(labels[action]||action==="submit"){decision(action);return;}
  }
  document.addEventListener("keydown",function(ev){if(ev.key==="Escape"){var full=document.querySelector(".aa-fullscreen");if(full){full.classList.remove("aa-fullscreen");var b=full.querySelector('[data-aa="fullscreen"]');if(b)b.textContent="На весь экран";}}});
  shell.mountAuthenticatedShell("access-workspace",function(u,reason){
    if(reason||!u){app.className="aa";app.innerHTML='<p role="alert">Не удалось открыть назначения. Обновите страницу или войдите заново.</p>';return;}
    user=u;if(!["admin","manager","coordinator","director","rop","assistant"].includes(u.role)){app.className="aa";app.textContent="Назначения недоступны для этой роли.";return;}
    window.AssignmentWorkspace={user:u,request:request,formatDate:dt.formatMskDisplay,
      reviews:function(){view="reviews";mount();},detail:openDetail,note:note,saveTransferState:saveTransferState};
    view=u.role==="director"?"activity":"list";listStatus=u.role==="coordinator"?"queue":"";
    run(async function(){
      if(["manager","coordinator"].includes(u.role))assistants=(await request("/assignments/assistants")).users;
      if(u.role==="coordinator")managers=(await request("/coordinator-managers")).managers;
      var params=new URLSearchParams(window.location.search);
      if(["manager","coordinator","director"].includes(u.role)&&(params.has("reviews")||params.has("review")))view="reviews";
      pendingTransfer = takePendingTransfer();
      if (pendingTransfer) view = "new";
      mount();
      var id=params.get("assignment");if(id)await openDetail(id);
      var reviewId=params.get("review");if(reviewId&&/^[0-9a-f-]{36}$/i.test(reviewId)&&window.AssignmentReviews)await window.AssignmentReviews.open(reviewId);
    });
  });
})();
