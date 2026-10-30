(async function(){
  "use strict";
  const DS=window.NotificationDemoStore;
  await DS.ready;
  const P=window.AssistantPrototype,S=P.state,E=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const names={manager:"Менеджер",coordinator:"РОА",director:"Директор",assistant:"Ассистент",rop:"РОП",admin:"Администратор"};
  let source,notes=[],reviews=[],seen=new Set(),previous=new Map(),seq=0,inbox=false,unreadOnly=false,dialog=null;
  let filters={q:"",assistant:"",manager:"",score:"",status:""};
  let categoryFilter="all",profileDialog=null,connectBot=null,connectBotMsg="";
  let maxLkDemoEnabled=false;
  function maxConnectDemoEnabled(){return maxLkDemoEnabled;}
  function setMaxConnectDemoEnabled(on){
    maxLkDemoEnabled=!!on;
  }
  function personalBindToken(user,kind){return `bind_demo_${user}_${kind}`;}
  function finishChannelConnect(user,kind){const d=deliveryFor(user);d[kind].connected=true;d[kind].label=kind==="telegram"?`@demo_${user}_tg`:`MAX · demo ${user.toUpperCase()}`;persistDelivery(user,d);}
  function channelLabel(kind){return kind==="telegram"?"Telegram":"MAX";}
  const categoryLabels={all:"Все",tt:"Тан-трекер",assign:"Назначения",system:"Система"};
  const defaults={manager:"m1",coordinator:"c1",director:"d1",assistant:"a1",rop:"r1",admin:"admin"};
  const cloneStore=s=>JSON.parse(JSON.stringify(s));
  function loadStore(){return cloneStore(DS.loadStore());}
  function saveStore(store){DS.saveStore(cloneStore(store));}
  function defaultDelivery(){return {telegram:{connected:false,label:""},max:{connected:false,label:""},prefs:{tt:true,assign:true,system:true},lastError:"",lastErrorAt:0};}
  function ensureUser(store,user){if(!store.users[user])store.users[user]={read:{},delivery:defaultDelivery(),deliveryStatus:{}};const u=store.users[user];if(!u.delivery)u.delivery=defaultDelivery();if(!u.deliveryStatus)u.deliveryStatus={};return u;}
  function deliveryFor(user){return ensureUser(loadStore(),user).delivery;}
  function persistDelivery(user,delivery){const store=loadStore();ensureUser(store,user).delivery=delivery;saveStore(store);}
  function persistReadFlag(user,key,read){const store=loadStore();ensureUser(store,user).read[key]=read;saveStore(store);}
  function storedRead(user,key){return !!loadStore().users[user]?.read?.[key];}
  function storedNoteDelivery(user,key){return loadStore().users[user]?.deliveryStatus?.[key]||"";}
  function persistNoteDelivery(user,key,state){const store=loadStore();ensureUser(store,user).deliveryStatus[key]=state;saveStore(store);}
  const saveStatusFullMessage=()=>{const st=DS.getSaveStatus();return{idle:"",saved:"Демо: настройки и прочитанность сохранены на preview-сервере.",saving:"Демо: сохранение…",failed:"Демо: не удалось сохранить — изменения только в памяти вкладки.",unavailable:"Демо: preview-сервер недоступен — только память вкладки."}[st]||"";};
  const saveStatusHeaderAlert=()=>{const st=DS.getSaveStatus();if(st!=="failed"&&st!=="unavailable")return null;return{short:st==="unavailable"?"Нет сервера":"Сбой сохран.",full:saveStatusFullMessage()};};
  function isNoteDeliveryFailed(user,n){const st=storedNoteDelivery(user,n.key);if(st==="sent")return false;if(st==="failed")return true;return !!n.deliveryFailSeed;}
  function markFailedDeliveriesRetried(user){notes.filter(n=>n.user===user&&isNoteDeliveryFailed(user,n)).forEach(n=>persistNoteDelivery(user,n.key,"sent"));}
  function noteCategory(n){if(n.kind==="tt-track")return "tt";if(n.kind==="info")return "system";return "assign";}
  function categoryWanted(n){return categoryFilter==="all"||noteCategory(n)===categoryFilter;}
  function deliveryStatusLine(n,user){
    const d=deliveryFor(user),cat=noteCategory(n),prefKey=cat==="tt"?"tt":cat==="system"?"system":"assign";
    if(!d.prefs[prefKey])return "Только в ЛК · тип отключён в настройках";
    const channels=[];if(d.telegram.connected)channels.push("Telegram");if(d.max.connected)channels.push("MAX");
    if(!channels.length)return "Только в ЛК · мессенджеры не подключены";
    if(isNoteDeliveryFailed(user,n))return `В ЛК сохранено · ${channels.join(", ")}: ошибка доставки (демо)`;
    return `В ЛК · ${channels.join(" + ")} (демо-отправка)`;
  }
  const ctx=()=>P.routeActive()?{role:S.role,id:S.person}:typeof prototypeRole==="string"&&prototypeRole==="regional"?{role:"rop",id:"r1",label:"Региональный менеджер"}:{role:typeof prototypeRole==="string"?prototypeRole:"manager",id:defaults[typeof prototypeRole==="string"?prototypeRole:"manager"]||"m1"};
  const action=(key,label,id="",cls="")=>`<button type="button" class="${cls}" data-af="${key}" data-id="${E(id)}">${E(label)}</button>`;
  const revokedAt=a=>a.history.filter(h=>h.kind==="revoke"||/Доступ отозван/.test(h.text)).at(-1)?.at;
  const ended=a=>a.status==="approved"&&!a.change&&S.clock>=a.end||
    a.status==="revoked"&&Number.isFinite(revokedAt(a))&&a.start<revokedAt(a)&&S.clock>=revokedAt(a);
  const canRate=a=>!!a&&S.role==="manager"&&a.manager===S.person&&ended(a)&&!reviews.some(r=>r.assignment===a.id);
  const canRead=r=>["coordinator","director"].includes(S.role)||S.role==="manager"&&r.manager===S.person;
  const tanTrackerActive=()=>typeof location!=="undefined"&&location.hash.includes("tan-tracker")&&window.TanTrackerPrototype?.routeActive?.();
  const noticeUserId=()=>{
    if(tanTrackerActive()&&window.TanTrackerPrototype?.employeeId)return window.TanTrackerPrototype.employeeId();
    return ctx().id;
  };
  const noteVisibleAt=n=>n.kind==="tt-track"?n.at<=Date.now():n.at<=S.clock;
  const mine=()=>notes.filter(n=>n.user===noticeUserId()&&noteVisibleAt(n));
  const inboxContext=()=>{
    if(tanTrackerActive()&&window.TanTrackerPrototype?.effectiveProfile){
      const p=window.TanTrackerPrototype.effectiveProfile();
      return {role:p.role,id:p.person,label:p.label||names[p.role]||p.role};
    }
    const c=ctx();
    return {role:c.role,id:c.id,label:c.label||names[c.role]||c.role};
  };
  const fmt=P.dt,scoreWords=["","Очень слабо","Ниже ожиданий","Нужно улучшить","Хорошо","Отлично"];
  const starIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.84 5.76 6.36.92-4.6 4.48 1.09 6.33L12 17.3l-5.69 2.99 1.09-6.33-4.6-4.48 6.36-.92Z"/></svg>';
  const stars=value=>`<span class="af-stars" role="img" aria-label="${Number(value).toFixed(1)} из 5">${[1,2,3,4,5].map(v=>`<span class="af-star-glyph">${starIcon}<span class="af-star-fill" style="clip-path:inset(0 ${Math.round(100-100*Math.max(0,Math.min(1,value-v+1)))}% 0 0)">${starIcon}</span></span>`).join("")}</span>`;
  const outstanding=()=>source.filter(a=>canRate(a));
  const closure=a=>!["manager","coordinator","director"].includes(S.role)||S.role==="manager"&&a.manager!==S.person||!ended(a)?"":reviews.some(r=>r.assignment===a.id)?"Закрыто с оценкой":"Ожидает обязательной оценки";
  function add(user,key,title,text,id,kind="detail",at=S.clock,extra={}){
    const uid=user+":"+key;if(seen.has(uid))return;seen.add(uid);
    const read=storedRead(user,uid);
    notes.push({key:uid,user,title,text,id,kind,at,read,seq:++seq,deliveryFailSeed:!!extra.deliveryFailSeed});
    if(read)persistReadFlag(user,uid,true);
  }
  function upsert(user,key,title,text,id,kind,at){
    const uid=user+":"+key;seen.add(uid);
    const n=notes.find(x=>x.key===uid);
    if(n){n.title=title;n.text=text;n.id=id;n.kind=kind;n.at=at;if(storedRead(user,uid))n.read=true;return n;}
    const read=storedRead(user,uid);
    const row={key:uid,user,title,text,id,kind,at,read,seq:++seq};notes.push(row);return row;
  }
  function markReadNote(n,read=true){n.read=read;persistReadFlag(n.user,n.key,read);}
  function inboxUserId(){return noticeUserId();}
  function ensureDemoDeliveryNote(user){
    if(user!=="m1")return;
    const n=upsert(user,"delivery-demo-fail","Напоминание: срок передачи сегодня","Демо-событие Tan-трекера для проверки ошибки доставки в мессенджер. История остаётся в ЛК.","TT-2026-001","tt-track",S.clock-1800000);
    n.deliveryFailSeed=true;if(storedRead(user,n.key))n.read=true;
  }
  function syncTrackerInbox(){
    const TN=window.TanTrackerNotifications;
    const user=inboxUserId();
    if(TN?.forEmployee){
      const items=TN.forEmployee(user)||[];
      const keep=new Set(items.map(i=>user+":tt:"+i.key));
      keep.add(user+":tt:delivery-demo-fail");
      notes=notes.filter(n=>n.kind!=="tt-track"||n.user!==user||keep.has(n.key));
      items.forEach(i=>{
        const existing=notes.find(n=>n.key===user+":tt:"+i.key);
        const at=Number.isFinite(i.at)?i.at:Date.now();
        upsert(user,"tt:"+i.key,i.title,i.text,i.orderId,"tt-track",at);
        if(existing?.read||i.read){
          const n=notes.find(x=>x.key===user+":tt:"+i.key);if(n)n.read=true;
        }
      });
    }
    ensureDemoDeliveryNote(user);
  }
  function snapshot(a){return {assignment:a.id,manager:a.manager,assistant:a.assistant,clients:[...a.clients],start:a.start,
    end:a.status==="revoked"?Math.min(a.end,revokedAt(a)):a.end,agreedEnd:a.end,completion:a.status==="revoked"?"revoked":"period"};}
  function init(){
    source=P.assignments();notes=[];reviews=[];seen=new Set();previous=new Map();dialog=null;inbox=false;filters={q:"",assistant:"",manager:"",score:"",status:""};
    const comments=["Внимательно разобраны обращения клиентов, информация передана менеджеру без потерь.",
      "Ответы поступали с задержкой. При возврате клиентов не хватило понятного итога по обращениям.",
      "Сопровождение было стабильным, уточнения по клиентам переданы вовремя.",
      "В целом работа выполнена, но несколько обращений потребовали повторного уточнения.",
      "Все вопросы по выбранным клиентам обработаны аккуратно, взаимодействие было удобным.",
      "Хорошая обратная связь по клиентам. На будущее хотелось бы чуть более краткие сводки."];
    [["m1","a1",16,5],["m1","a2",20,2],["m2","a2",21,4],["m2","a1",22,3],["m3","a2",23,5],["m1","a1",25,4],["m2","a1",26,0]].forEach(([manager,assistant,day,score],i)=>{
      const base=source.find(a=>a.manager===manager),pool=[...new Set(source.filter(a=>a.manager===manager).flatMap(a=>a.clients))];
      const start=new Date(`2026-10-${String(day-2).padStart(2,"0")}T09:00:00+03:00`).getTime();
      const end=new Date(`2026-10-${String(day).padStart(2,"0")}T08:00:00+03:00`).getTime();
      const a={...base,id:"Н-0"+(81+i),assistant,clients:pool.slice(assistant==="a2"&&pool.length>8?8:0,assistant==="a2"&&pool.length>8?16:8),
        start,end,status:"approved",change:null,reason:"Завершённый демонстрационный период информационного сопровождения.",history:[]};
      a.history=[{at:start-3600000,actor:P.person("c1"),actorId:"c1",role:"coordinator",kind:"approve",text:"Период согласован РОА.",snapshot:snapshot(a)}];source.push(a);
      if(score)reviews.push({...snapshot(a),score,comment:comments[i],at:end+3600000,author:P.person(manager)});
    });
    source.forEach(a=>{
      if(a.status==="pending"||a.change)add("c1","pending:"+a.id,a.change?"Изменения ждут согласования":"Новая заявка на доступ",`${a.id} · ${P.person(a.manager)} → ${P.person(a.assistant)}. Решение принимает только РОА.`,a.id,"detail",S.clock-600000);
      if(a.status==="approved"&&ended(a)&&!reviews.some(r=>r.assignment===a.id))add(a.manager,"rate:"+a.id,"Период завершён: оцените ассистента",`${a.id} · ${P.person(a.assistant)} · клиентов: ${a.clients.length}. Доступ закрыт.`,a.id,"rate",Math.min(a.end,S.clock));
    });
    ["m1","m2","m3"].forEach(id=>{
      const a=source.find(a=>a.manager===id&&a.status==="approved"&&!ended(a));
      if(a){add(id,"approved:"+a.id,"Назначение согласовано",`${a.id} · ${P.person(a.assistant)} · ${fmt(a.start)} → ${fmt(a.end)} МСК.`,a.id,"detail",S.clock-7200000);
        add(id,"change-example","Заявка возвращалась на уточнение","Укажите точные сроки и состав клиентов. Доступ до согласования не выдаётся.",a.id,"detail",S.clock-10800000);}
    });
    ["a1","a2"].forEach(id=>{
      source.filter(a=>a.assistant===id&&a.status==="approved"&&!ended(a)).slice(0,4).forEach(a=>add(id,"access:"+a.id,P.effective(a)==="planned"?"Доступ начнётся позже":a.change?"Доступ приостановлен":"Вам назначены клиенты",
        `${a.id} · менеджер ${P.person(a.manager)} · ${fmt(a.start)} → ${fmt(a.end)} МСК.`,a.id,"clients",S.clock-3600000));
      add(id,"expired-example","Период доступа завершён","Доступ по завершённым назначениям закрыт. Остальные действующие клиенты остаются доступны.","Н-104","clients",S.clock-14400000);
    });
    reviews.forEach((r,i)=>["c1","d1"].forEach(id=>add(id,"review:"+r.assignment,r.score<=3?"Низкая оценка: зона внимания":"Получена оценка работы ассистента",
      `${P.person(r.assistant)} · ${r.score}/5 · ${r.assignment}. Оценка доступна РОА и директору.`,r.assignment,"rating",Math.min(r.at,S.clock-1000-i))));
    ["r1","r2"].forEach(id=>add(id,"team-info","Доступ ассистенту согласован РОА","Информация о временном доступе в вашей территории. Ваше согласование не требуется.",id==="r1"?"Н-102":"Н-107","detail",S.clock-7200000));
    add("m1","lk-account","Настройки учётной записи ЛК","Демо: напоминание о безопасности входа. История уведомлений персональна; доступ к клиентам и назначениям от этого не меняется.",null,"info",S.clock-5400000);
    add("admin","system","Служебные события доступны в ЛК","Уведомления персональны. Настройки доставки и прочитанность не меняют права доступа к разделам ЛК.",null,"info",S.clock-3600000);
    notes.forEach(n=>{if(storedRead(n.user,n.key))n.read=true;});
    ensureDemoDeliveryNote("m1");
    const dm=deliveryFor("m1");if(!dm.lastError){dm.lastError="Демо: Telegram не доставил push (502). Событие сохранено в центре ЛК.";dm.lastErrorAt=S.clock-900000;persistDelivery("m1",dm);}
    remember();
  }
  async function resetDemo(){await DS.resetRemote();categoryFilter="all";closeProfile();init();paint();}
  function signature(a){return {status:a.status,effective:P.effective(a),assistant:a.assistant,end:a.end,change:!!a.change,n:a.history.length};}
  function remember(){source.forEach(a=>previous.set(a.id,signature(a)));}
  function sync(){
    syncTrackerInbox();
    if(source!==P.assignments()){init();return;}
    source.forEach(a=>{
      if(P.effective(a)==="active"&&a.end-S.clock<=86400000){
        [a.manager,a.assistant,"c1"].forEach(user=>add(user,"ending:"+a.id+":"+a.end,"Период доступа скоро закончится",`${a.id} · окончание ${fmt(a.end)} МСК. Продление требует согласования РОА.`,a.id,user===a.assistant?"clients":"detail"));
      }
      const now=signature(a),old=previous.get(a.id);previous.set(a.id,now);
      if(old&&JSON.stringify(old)===JSON.stringify(now))return;
      if(!old&&a.status==="draft")return;
      const key=a.id+":"+JSON.stringify(now),title=a.change?"Изменения ждут согласования":({pending:"Новая заявка на доступ",approved:"Условия доступа обновлены",revision:"Заявка возвращена на уточнение",rejected:"Заявка отклонена",revoked:"Доступ отозван",cancelled:"Заявка отменена",draft:"Черновик обновлён"}[a.status]||"Назначение обновлено");
      if(a.status==="pending"||a.change)add("c1",key,title,`${a.id} · ${P.person(a.manager)}. Проверьте состав и период.`,a.id);
      add(a.manager,key,title,`${a.id} · ${P.person(a.assistant)} · ${fmt(a.start)} → ${fmt(a.end)} МСК.`,a.id);
      if(a.status==="approved"||a.status==="revoked"){
        const t=now.effective==="completed"?"Период доступа завершён":a.change?"Доступ приостановлен":now.effective==="planned"?"Доступ начнётся позже":a.status==="revoked"?"Доступ отозван":"Доступ к клиентам обновлён";
        add(a.assistant,key,t,`${a.id} · постоянный менеджер ${P.person(a.manager)}. Доступ действует только в согласованный период.`,a.id,"clients");
        if(old&&old.assistant!==a.assistant)add(old.assistant,key,"Клиенты переданы другому ассистенту",`${a.id} · прежний доступ закрыт.`,a.id,"clients");
      }
      if(ended(a)&&!reviews.some(r=>r.assignment===a.id))add(a.manager,"rate:"+a.id,"Период завершён: оцените ассистента",`${a.id} · ${P.person(a.assistant)}. Оценка не продлевает доступ.`,a.id,"rate");
      if(a.history.at(-1)?.role==="coordinator")add("d1",key,"Действие РОА: "+title.toLocaleLowerCase("ru"),`${a.id} · ${P.person(a.manager)} → ${P.person(a.assistant)}. Только просмотр.`,a.id);
    });
  }
  function visibleReviews(){return reviews.filter(canRead);}
  function filtered(){
    const q=filters.q.trim().toLocaleLowerCase("ru");
    return source.filter(a=>(["coordinator","director"].includes(S.role)||S.role==="manager"&&a.manager===S.person)&&ended(a)).map(a=>({a,r:reviews.find(r=>r.assignment===a.id)})).filter(({a,r})=>
      (!filters.assistant||a.assistant===filters.assistant)&&(!filters.manager||a.manager===filters.manager)&&
      (!filters.score||r&&(filters.score==="low"?r.score<=3:r.score===+filters.score))&&
      (!filters.status||(filters.status==="pending"?!r:!!r))&&
      (!q||[a.id,P.person(a.manager),P.person(a.assistant),r?.comment,...a.clients.map(id=>P.byClient(id).name)].join(" ").toLocaleLowerCase("ru").includes(q)));
  }
  function select(key,label,values){return `<label>${label}<select data-af-filter="${key}"><option value="">Все</option>${values.map(([v,t])=>`<option value="${E(v)}" ${filters[key]===v?"selected":""}>${E(t)}</option>`).join("")}</select></label>`;}
  function reviewCard(r){
    if(!canRead(r))return "";
    return `<div class="af-review ${r.score<=3?"af-attention":""}"><div class="af-line"><h3>${E(P.person(r.assistant))}</h3><div class="af-score">${stars(r.score)}<strong>${r.score}/5 · ${scoreWords[r.score]}</strong></div></div>
      <p>${E(r.comment)}</p><p class="af-muted">Оценил ${E(r.author)} · ${fmt(r.at)} МСК · ${r.assignment}</p><p class="af-muted">Период: ${fmt(r.start)} → ${fmt(r.end)} МСК · клиентов: ${r.clients.length}</p>
      <details><summary>Состав клиентов на момент оценки</summary><ul>${r.clients.map(id=>`<li>${E(P.byClient(id).name)}</li>`).join("")}</ul></details></div>`;
  }
  function view(){
    sync();
    if(!["manager","coordinator","director"].includes(S.role))return `<section class="as-panel">Оценки недоступны для этой роли.</section>`;
    const all=visibleReviews(),rows=filtered(),pending=source.filter(a=>ended(a)&&(S.role!=="manager"||a.manager===S.person)&&!reviews.some(r=>r.assignment===a.id)).length;
    return `<section class="as-panel af"><div class="as-between"><h2>${S.role==="manager"?"Оценка завершённой работы":"Оценки ассистентов"}</h2><span class="as-badge">Обязательная оценка после работы</span></div>
      <p class="af-required-copy">Период доступа завершается автоматически. Назначение считается закрытым только после оценки передающего менеджера: звёзды и комментарий.</p>
      <p>${S.role==="manager"?"Вы оцениваете только свои завершённые назначения. Отправленная оценка доступна вам, РОА и директору; ассистенту и другим менеджерам не показывается.":"Оценки передающих менеджеров, а не автоматический рейтинг по продажам. РОА и директор видят все результаты; редактировать чужую оценку нельзя."}</p>
      <div class="af-stats"><div><strong>${all.length?(all.reduce((s,r)=>s+r.score,0)/all.length).toFixed(1):"Нет оценок"}</strong>${all.length?stars(all.reduce((s,r)=>s+r.score,0)/all.length):""}<span>Средняя из 5</span></div><div><strong>${all.length}</strong><span>Получено оценок</span></div><div><strong>${all.filter(r=>r.score<=3).length}</strong><span>Зона внимания: 1–3</span></div><div><strong>${pending}</strong><span>Ожидают обязательной оценки</span></div></div>
      ${["coordinator","director"].includes(S.role)?`<div class="af-assistants">${["a1","a2"].map(id=>{const rr=all.filter(r=>r.assistant===id);return `<article><h3>${E(P.person(id))}</h3><strong>${rr.length?(rr.reduce((s,r)=>s+r.score,0)/rr.length).toFixed(1)+" / 5":"Нет оценок"}</strong>${rr.length?stars(rr.reduce((s,r)=>s+r.score,0)/rr.length):""}<p class="af-muted">${rr.length} оценок · ${rr.filter(r=>r.score<=3).length} в зоне внимания</p></article>`;}).join("")}</div>`:""}
      <div class="af-filters"><label>Поиск<input data-af-filter="q" value="${E(filters.q)}" placeholder="Сотрудник, клиент, номер, комментарий"></label>
      ${select("assistant","Ассистент",[["a1",P.person("a1")],["a2",P.person("a2")]])}
      ${S.role!=="manager"?select("manager","Передающий менеджер",["m1","m2","m3"].map(id=>[id,P.person(id)])):""}
      ${select("score","Оценка",[["low","Зона внимания: 1–3"],...Array.from({length:5},(_,i)=>[String(i+1),String(i+1)+" / 5"])])}
      ${select("status","Наличие оценки",[["pending","Ожидает оценки"],["rated","Оценено"]])}${action("reset-filters","Сбросить фильтры")}</div>
      <p class="af-muted" role="status">Найдено назначений: ${rows.length}. Сводные показатели выше относятся ко всей доступной истории.</p>
      <div class="as-table-scroll" tabindex="0" aria-label="Оценки и завершённые назначения"><table class="as-table af-table"><thead><tr><th>Назначение и период, МСК</th><th>Ассистент / менеджер</th><th>Клиенты</th><th>Оценка и закрытие</th><th>Действие</th></tr></thead><tbody>${rows.map(({a,r})=>`<tr><td><strong>${a.id}</strong><small>${fmt(a.start)} → ${fmt(a.end)}<br>${a.status==="revoked"?"Досрочно отозвано":"Период завершён"}</small></td><td>${E(P.person(a.assistant))}<small>${E(P.person(a.manager))}</small></td><td>${a.clients.length}</td><td>${r?`${stars(r.score)}<span class="af-grade ${r.score<=3?"af-low":""}">${r.score}/5</span>`:""}<small class="${r?"":"af-pending-label"}">${closure(a)}</small></td><td>${r?action("review","Посмотреть",a.id):canRate(a)?action("rate","Оценить",a.id,"primary"):"Ожидается от менеджера"}</td></tr>`).join("")||'<tr><td colspan="5">По фильтрам ничего не найдено. Измените условия поиска.</td></tr>'}</tbody></table></div></section>`;
  }
  function paint(){
    if(document.body.classList.contains("tt-recipient-shell")||document.body.classList.contains("tt-external-shell")){
      document.getElementById("af-required-reminder")?.remove();
      document.getElementById("af-context")?.remove();
      return;
    }
    sync();
    const head=document.querySelector(".head .right");if(!head)return;
    const av=document.querySelector(".head .avatar");
    let profileBtn=document.getElementById("af-profile-btn");
    if(av&&!profileBtn){
      profileBtn=document.createElement("button");profileBtn.type="button";profileBtn.id="af-profile-btn";profileBtn.className="avatar af-profile-btn";
      profileBtn.textContent=av.textContent;profileBtn.title=av.title||"";      profileBtn.setAttribute("aria-label","Профиль: настройки уведомлений и доставки");profileBtn.dataset.af="profile-open";
      av.replaceWith(profileBtn);
    }else if(profileBtn){
      const live=document.querySelector(".head span.avatar");
      if(live){profileBtn.textContent=live.textContent;profileBtn.title=live.title||profileBtn.title;live.remove();}
    }
    let saveChip=document.getElementById("af-save-status");
    const alert=saveStatusHeaderAlert();
    if(alert){
      if(!saveChip){saveChip=document.createElement("span");saveChip.id="af-save-status";saveChip.className="af-save-alert";head.insertBefore(saveChip,document.getElementById("af-bell")||head.querySelector("[data-theme]"));}
      saveChip.textContent=alert.short;
      saveChip.title=alert.full;
      saveChip.setAttribute("aria-label",alert.full);
      saveChip.setAttribute("role","status");
      saveChip.dataset.state=DS.getSaveStatus();
    }else saveChip?.remove();
    const storeLine=saveStatusFullMessage();
    const profileStore=document.getElementById("af-profile-store-status");
    if(profileStore){profileStore.textContent=storeLine;profileStore.hidden=!storeLine;}
    let bell=document.getElementById("af-bell");
    if(!bell){bell=document.createElement("button");bell.id="af-bell";bell.dataset.af="inbox";head.insertBefore(bell,head.querySelector("[data-theme]")||head.lastChild);}
    const unread=mine().filter(n=>!n.read).length;
    bell.className="af-bell";bell.setAttribute("aria-label",`Уведомления: ${unread} непрочитанных`);bell.setAttribute("aria-expanded",String(inbox));
    bell.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>${unread?`<span>${unread>99?"99+":unread}</span>`:""}`;
    const container=document.getElementById("as-content");
    if(container&&P.routeActive()&&S.view!=="ratings"&&!document.getElementById("af-context")){
      const block=document.createElement("div");block.id="af-context";block.className="af";
      const a=source.find(a=>a.id===S.detail),r=reviews.find(r=>r.assignment===a?.id);
      if(a&&r&&canRead(r))block.innerHTML=reviewCard(r);
      else if(a&&canRate(a))block.innerHTML=`<div class="af-callout"><strong>Ожидает обязательной оценки</strong><p>Оцените сопровождение ${a.clients.length} клиентов, чтобы закрыть назначение. Доступ ассистенту уже закрыт и не продлевается.</p>${action("rate","Оценить работу ассистента",a.id,"primary")}</div>`;
      else if(S.role==="manager"&&!S.detail&&!S.client&&S.view==="list"){
        const count=outstanding().length;if(count)block.innerHTML=`<div class="af-callout"><strong>Обязательная оценка: ${count} назначений</strong><p>Работа завершена. Без звёзд и комментария назначения не считаются закрытыми. Ваш отзыв увидят РОА и директор.</p>${action("ratings","Оценить завершённую работу")}</div>`;
      }
      if(block.innerHTML)container.prepend(block);
    }
    document.getElementById("af-required-reminder")?.remove();
    const c=ctx(),pending=source.filter(a=>ended(a)&&a.manager===c.id&&!reviews.some(r=>r.assignment===a.id));
    const hideFixedReminder=document.body.classList.contains("tt-create-wizard")||document.body.classList.contains("tt-detail-focus")||document.body.classList.contains("tt-code-view");
    if(!hideFixedReminder&&c.role==="manager"&&pending.length){
      const reminder=document.createElement("div");reminder.id="af-required-reminder";reminder.className="af af-required-reminder";
      const ttRegistry=document.body.classList.contains("tt-registry-list");
      if(ttRegistry){
        reminder.classList.add("af-required-reminder--tt-compact");
        reminder.innerHTML=`${action("required-rate",`★ Оценить · ${pending.length}`,pending[0].id,"af-tt-rate-pill")}<div class="af-required-reminder-expand" aria-hidden="true"><div><strong>Оцените завершённую работу · ${pending.length}</strong><span>Обязательный шаг для закрытия назначения</span></div></div>`;
      }else{
        reminder.innerHTML=`<div><strong>Оцените завершённую работу · ${pending.length}</strong><span>Обязательный шаг для закрытия назначения</span></div>${action("required-rate","Поставить оценку",pending[0].id)}`;
      }
      document.getElementById("app").append(reminder);
    }
    drawInbox();
    drawProfile();
  }
  function drawInbox(){
    const old=document.getElementById("af-inbox"),scroll=old?.querySelector(".af-inbox-list")?.scrollTop||0;
    const focus=old?.contains(document.activeElement)?{key:document.activeElement.dataset.af,id:document.activeElement.dataset.id}:null;
    old?.remove();document.getElementById("af-shade")?.remove();
    document.getElementById("app").inert=inbox||!!profileDialog;
    if(!S.modal)document.body.style.overflow=inbox||profileDialog?"hidden":"";
    if(!inbox)return;
    const shade=document.createElement("div");shade.id="af-shade";shade.dataset.af="close-inbox";shade.setAttribute("aria-hidden","true");document.body.append(shade);
    const c=inboxContext(),user=inboxUserId();
    const rows=mine().filter(n=>(!unreadOnly||!n.read)&&categoryWanted(n)).sort((a,b)=>b.at-a.at||b.seq-a.seq);
    const catTools=Object.entries(categoryLabels).map(([k,l])=>action("cat-"+k,l,"",categoryFilter===k?"af-selected":"")).join("");
    const el=document.createElement("aside");el.id="af-inbox";el.className="af af-inbox";el.setAttribute("role","dialog");el.setAttribute("aria-modal","true");el.setAttribute("aria-label","Центр уведомлений");
    el.innerHTML=`<div class="af-inbox-head"><div><h2>Центр уведомлений</h2><p class="af-muted">${E(P.person(c.id)==="Не выбран"?"Сотрудник в демо":P.person(c.id))} · ${E(c.label||names[c.role]||c.role)}</p><p class="af-muted af-inbox-lead">История событий ЛК сохраняется здесь. Telegram и MAX — дополнительные каналы доставки (демо).</p></div>${action("close-inbox","Закрыть")}</div>
      <div class="af-inbox-tools">${action("all","Все","",!unreadOnly?"af-selected":"")}${action("unread","Непрочитанные","",unreadOnly?"af-selected":"")}${action("read-all","Прочитать все")}${action("delivery-settings","Настройки доставки")}</div>
      <div class="af-inbox-cats" role="group" aria-label="Категории">${catTools}</div>
      <div class="af-inbox-list">${rows.map(n=>`<article class="af-note ${n.read?"":"af-unread"}"><div class="af-line"><strong>${E(n.title)}</strong><span class="af-cat">${E(categoryLabels[noteCategory(n)])}</span><small>${n.read?"Прочитано":"Новое"}</small></div><p>${E(n.text)}</p><p class="af-muted">${fmt(n.at)} МСК · ${E(deliveryStatusLine(n,user))}</p><div class="af-actions">${n.kind!=="info"?action("open-note",n.kind==="rate"?"Оценить":n.kind==="rating"?"Посмотреть оценку":n.kind==="clients"?"Открыть клиентов":n.kind==="tt-track"?"Открыть трек":"Открыть назначение",n.key):""}${!n.read?action("read","Прочитано",n.key):""}</div></article>`).join("")||`<div class="af-empty"><h3>${unreadOnly?"Непрочитанных нет":"По этому фильтру пусто"}</h3><p>Смените категорию или откройте «Все». События Tan-трекера, назначений и системные уведомления используют один центр.</p></div>`}</div>
      <p class="af-inbox-foot">Демо прототипа: без реальных ботов, SMS и учётных записей. Статус доставки не удаляет событие из ЛК.</p>
      ${saveStatusFullMessage()?`<p id="af-inbox-store-status" class="af-inbox-store-status" role="status">${E(saveStatusFullMessage())}</p>`:""}`;
    document.body.append(el);
    el.querySelector(".af-inbox-list").scrollTop=scroll;
    if(focus)([...el.querySelectorAll("button")].find(b=>b.dataset.af===focus.key&&b.dataset.id===focus.id)||el.querySelector("button")).focus();
  }
  function buildProfileHtml(fromInbox){
    const c=inboxContext(),user=inboxUserId(),d=deliveryFor(user);
    const consent=`<p class="af-connect-consent"><strong>Согласие (демо).</strong> Личная привязка канала включает коды Tan-трекера и дублирование уведомлений ЛК. Отключить канал или тип событий можно здесь же.</p>`;
    const botPanel=(kind)=>{const token=personalBindToken(user,kind),label=channelLabel(kind);return `<div class="af-bot-sim" data-af="bot-panel">
      <p class="af-muted">Синтетический чат бота · без реальных сообщений и API</p>
      <p><strong>Tandoor RF · личные уведомления (${E(label)})</strong></p>
      <p class="af-muted">Обычный <code>/start</code> в публичном боте <strong>не привязывает</strong> ваш аккаунт сотрудника.</p>
      <p>Персональная ссылка активации (демо): <code class="af-bind-token">${E(token)}</code></p>
      <div class="af-actions">${action("bot-start-personal","Start · активировать привязку",kind,"primary")}${action("bot-start-generic","/start (общий бот)",kind)}</div>
      ${connectBotMsg&&connectBot?.kind===kind?`<p class="af-bot-msg" role="status">${E(connectBotMsg)}</p>`:""}
    </div>`;};
    const channel=(kind,label)=>{const ch=d[kind],maxBlocked=kind==="max"&&!maxConnectDemoEnabled();
      let body=ch.connected?`<p class="af-muted">Канал ${E(ch.label||"привязан")}. Симуляция — без реальных ботов и токенов.</p><div class="af-actions">${action("disconnect-"+kind,"Отключить (демо)")}</div>`:
        maxBlocked?`<p class="af-muted">MAX в прототипе выключен по умолчанию. Включите демо MAX ниже — это не production-интеграция.</p>`:
        connectBot?.kind===kind?`${consent}${botPanel(kind)}`:
        `${consent}<div class="af-actions">${action("begin-connect-"+kind,"Подключить личный "+label,"","primary")}</div>`;
      return `<article class="af-channel" data-af="channel-${kind}"><div class="af-line"><h3>${label}</h3><span class="af-channel-state ${ch.connected?"af-channel-on":"af-channel-off"}">${ch.connected?"Подключено (демо)":maxBlocked?"Демо MAX выключен":"Не подключено"}</span></div>${body}</article>`;};
    return `<div class="af-line"><div><span class="af-eyebrow">Профиль · демо</span><h2 id="af-profile-title">Уведомления и доставка</h2></div>${action("profile-close","Закрыть")}</div>
      <p class="af-required-copy"><strong>Единый центр ЛК.</strong> Tan-трекер, назначения и другие события используют одни настройки. История остаётся в личном кабинете, даже если Telegram и MAX отключены или доставка не удалась.</p>
      <p class="af-muted">${E(P.person(c.id))} · ${E(c.label||names[c.role]||c.role)} · настройки демо-сотрудника сохраняются на изолированном preview-сервере (не в браузере).</p>
      <p id="af-profile-store-status" class="af-store-status" role="status"${saveStatusFullMessage()?"":' hidden'}>${E(saveStatusFullMessage())}</p>
      <label class="af-max-demo-toggle af-pref"><input type="checkbox" data-af="demo-max-lk" ${maxConnectDemoEnabled()?"checked":""}> Разрешить демо-привязку MAX (отдельно от production)</label>
      <fieldset class="af-delivery-prefs"><legend>Какие события дублировать в мессенджеры (демо)</legend>
        ${[["tt","Tan-трекер: передачи и сроки"],["assign","Назначения и доступ"],["system","Системные и служебные"]].map(([k,t])=>`<label class="af-pref"><input type="checkbox" data-af="pref" data-id="${k}" ${d.prefs[k]?"checked":""}> ${E(t)}</label>`).join("")}
      </fieldset>
      ${channel("telegram","Telegram")}${channel("max","MAX")}
      ${d.lastError?`<div class="af-delivery-error" role="status"><strong>Последняя ошибка доставки (демо)</strong><p>${E(d.lastError)}</p><p class="af-muted">${d.lastErrorAt?fmt(d.lastErrorAt)+" МСК":""}</p>${action("delivery-retry","Повторить отправку (демо)")}</div>`:""}
      <p class="af-muted">Привязка мессенджера для уведомлений не заменяет подтверждение передачи по коду/контакту на экране получателя Tan-трекера.</p>
      <p class="af-muted">Права доступа к разделам ЛК не меняются настройками уведомлений.</p>`;
  }
  function refreshProfileDialog(){if(!profileDialog)return;profileDialog.innerHTML=buildProfileHtml(profileDialog.dataset.fromInbox==="1");}
  function closeProfile(){connectBot=null;connectBotMsg="";document.getElementById("af-profile-dialog")?.close();document.getElementById("af-profile-dialog")?.remove();profileDialog=null;}
  function openProfile(fromInbox){
    closeProfile();inbox=false;
    const el=document.createElement("dialog");el.id="af-profile-dialog";el.className="af af-dialog af-profile-dialog";el.setAttribute("aria-labelledby","af-profile-title");
    el.dataset.fromInbox=fromInbox?"1":"0";
    el.innerHTML=buildProfileHtml(fromInbox);
    document.body.append(el);profileDialog=el;
    el.addEventListener("cancel",e=>{e.preventDefault();closeProfile();(fromInbox?document.getElementById("af-bell"):document.getElementById("af-profile-btn"))?.focus();paint();});
    el.showModal();el.querySelector("button")?.focus();
    document.getElementById("app").inert=true;if(!S.modal)document.body.style.overflow="hidden";
  }
  function drawProfile(){if(!profileDialog)return;refreshProfileDialog();document.getElementById("app").inert=true;}
  function openDialog(a,r){
    document.getElementById("af-review-dialog")?.remove();dialog={id:a.id,readonly:!!r,score:0};
    const el=document.createElement("dialog");el.id="af-review-dialog";el.className="af af-dialog";el.setAttribute("aria-labelledby","af-review-title");
    el.innerHTML=`<div class="af-line"><div><span class="af-eyebrow">${r?"Результат работы":"Обязательный итог периода"}</span><h2 id="af-review-title">${r?"Оценка работы ассистента":"Как поработал ассистент?"}</h2></div>${action("close-review",r?"Закрыть":"К списку")}</div>
      <p><strong>${E(P.person(a.assistant))}</strong> · ${a.id} · клиентов: ${a.clients.length}</p><p class="af-muted">${fmt(a.start)} → ${fmt(snapshot(a).end)} МСК. ${a.status==="revoked"?"Работа завершена досрочно; доступ отозван.":"Доступ уже закрыт."}</p>
      ${r?reviewCard(r):`<form id="af-rating-form"><div class="af-required-copy">Чтобы закрыть назначение, поставьте оценку и оставьте комментарий. Возврат к списку не отменяет эту обязанность.</div><fieldset class="af-star-field"><legend>Ваша оценка · обязательно</legend><div class="af-rating-buttons af-stars-input" role="group" aria-label="Оценка от одной до пяти звёзд" aria-describedby="af-score-hint">${[1,2,3,4,5].map(v=>`<button type="button" data-af="score" data-id="${v}" aria-pressed="false" aria-label="${v} из 5: ${scoreWords[v]}" title="${v} из 5: ${scoreWords[v]}">${starIcon}</button>`).join("")}</div><p id="af-score-hint" aria-live="polite">Выберите от 1 до 5 звёзд</p></fieldset>
      <label>Комментарий к работе · обязательно<textarea id="af-comment" maxlength="2000" rows="3" placeholder="Что получилось хорошо и что стоит улучшить. Не менее 10 символов." required minlength="10"></textarea></label>
      <p class="af-muted">Оценку увидят только автор, РОА и директор. Ассистенту, РОП и другим менеджерам она не показывается. После отправки редактирование не предусмотрено.</p>
      <p id="af-rating-error" role="alert"></p><div class="af-actions"><button type="submit" class="primary">Отправить оценку</button>${action("close-review","Вернуться к списку")}</div></form>`}`;
    document.body.append(el);el.addEventListener("cancel",e=>{e.preventDefault();closeDialog();});el.showModal();el.querySelector(r?"button":"[data-af=score]").focus();
  }
  function closeDialog(){document.getElementById("af-review-dialog")?.close();document.getElementById("af-review-dialog")?.remove();dialog=null;document.querySelector("[data-af=ratings],[data-af=rate],#af-bell")?.focus();}
  function refreshRatings(){P.go("ratings");}
  function openNote(n,frozenCtx){
    const routeCtx=frozenCtx||inboxContext();
    markReadNote(n);inbox=false;
    if(n.kind==="info"){paint();return;}
    if(n.kind==="tt-track"){
      const orderId=n.id;
      const {role,id:person}=routeCtx;
      if(window.TanTrackerNotifications?.markRead){
        const pref=n.user+":tt:";
        window.TanTrackerNotifications.markRead(inboxUserId(),n.key.startsWith(pref)?n.key.slice(pref.length):"");
      }
      const p=new URLSearchParams({role});
      if(person)p.set("tt_emp",person);
      if(orderId)p.set("tt_id",orderId);
      location.hash="#tan-tracker?"+p.toString();
      requestAnimationFrame(()=>{
        if(window.TanTrackerPrototype?.canViewOrder&&!window.TanTrackerPrototype.canViewOrder(orderId)){
          p.delete("tt_id");
          location.hash="#tan-tracker?"+p.toString();
        }
        paint();
      });
      return;
    }
    if(!P.routeActive()){location.hash="#handover?as_role="+routeCtx.role+"&as_person="+routeCtx.id+"&as_view=list";requestAnimationFrame(()=>openNote(n,routeCtx));return;}
    if(n.kind==="clients"){P.go("clients");}
    else if(n.kind==="rate"){refreshRatings();const a=source.find(a=>a.id===n.id);if(canRate(a))openDialog(a);}
    else if(n.kind==="rating"){refreshRatings();const r=reviews.find(r=>r.assignment===n.id);if(r&&canRead(r))openDialog(source.find(a=>a.id===n.id),r);}
    else P.open(n.id);
    paint();
  }
  document.addEventListener("click",event=>{
    const b=event.target.closest("[data-af]");if(!b)return;
    const k=b.dataset.af,id=b.dataset.id,a=source.find(a=>a.id===id);
    if(k==="inbox"){inbox=!inbox;paint();if(inbox)document.querySelector("#af-inbox button")?.focus();}
    if(k==="close-inbox"){inbox=false;paint();document.getElementById("af-bell")?.focus();}
    if(k==="all"||k==="unread"){unreadOnly=k==="unread";paint();}
    if(k==="read-all"){mine().forEach(n=>markReadNote(n));paint();}
    if(k==="read"){const n=mine().find(n=>n.key===id);if(n)markReadNote(n);paint();}
    if(k==="delivery-settings"){openProfile(true);}
    if(k.startsWith("cat-")){categoryFilter=k.slice(4);paint();}
    if(k==="profile-open"){openProfile(false);}
    if(k==="profile-close"){closeProfile();document.getElementById("af-profile-btn")?.focus();paint();}
    if(k==="begin-connect-telegram"||k==="begin-connect-max"){const kind=k.slice(14);if(kind==="max"&&!maxConnectDemoEnabled()){connectBotMsg="Сначала включите демо MAX в этом окне.";connectBot={kind};refreshProfileDialog();return;}connectBotMsg="";connectBot={kind};refreshProfileDialog();}
    if(k==="bot-start-personal"){const kind=id||connectBot?.kind;if(!kind)return;const user=inboxUserId();finishChannelConnect(user,kind);connectBot=null;connectBotMsg="";refreshProfileDialog();paint();}
    if(k==="bot-start-generic"){connectBotMsg="Общий /start не привязывает личный аккаунт. Используйте персональную ссылку и «Start · активировать привязку».";refreshProfileDialog();}
    if(k==="disconnect-telegram"||k==="disconnect-max"){const user=inboxUserId(),d=deliveryFor(user),kind=k.split("-")[1];d[kind].connected=false;d[kind].label="";persistDelivery(user,d);connectBot=null;connectBotMsg="";refreshProfileDialog();paint();}
    if(k==="delivery-retry"){const user=inboxUserId(),d=deliveryFor(user);d.lastError="";d.lastErrorAt=0;persistDelivery(user,d);markFailedDeliveriesRetried(user);if(P.routeActive()){S.toast="Демо: повторная отправка выполнена. События в ЛК не изменились.";P.render();}closeProfile();paint();}
    if(b.matches("[data-af=pref]")){const user=inboxUserId(),d=deliveryFor(user);d.prefs[b.dataset.id]=b.checked;persistDelivery(user,d);}
    if(b.matches('[data-af="demo-max-lk"]')){setMaxConnectDemoEnabled(!!b.checked);if(!b.checked&&connectBot?.kind==="max"){connectBot=null;connectBotMsg="";}refreshProfileDialog();}
    if(k==="open-note"){const n=mine().find(n=>n.key===id);if(n)openNote(n);}
    if(k==="ratings")refreshRatings();
    if(k==="required-rate"){
      if(!P.routeActive()){location.hash="#handover?as_role=manager&as_person="+ctx().id+"&as_view=ratings";requestAnimationFrame(()=>{if(canRate(a))openDialog(a);});}
      else if(canRate(a)){refreshRatings();openDialog(a);}
    }
    if(k==="reset-filters"){filters={q:"",assistant:"",manager:"",score:"",status:""};refreshRatings();}
    if(k==="rate"&&canRate(a))openDialog(a);
    if(k==="review"){const r=reviews.find(r=>r.assignment===id);if(r&&canRead(r))openDialog(a,r);}
    if(k==="close-review")closeDialog();
    if(k==="score"&&dialog&&!dialog.readonly){dialog.score=+id;document.querySelectorAll("[data-af=score]").forEach(x=>x.setAttribute("aria-pressed",String(x.dataset.id===id)));paintStars(dialog.score);document.getElementById("af-score-hint").textContent=`${id} из 5: ${scoreWords[+id]}`;}
  });
  function paintStars(value){document.querySelectorAll(".af-stars-input button").forEach(b=>b.classList.toggle("af-star-on",+b.dataset.id<=value));}
  document.addEventListener("pointerover",e=>{const b=e.target.closest?.(".af-stars-input button");if(b)paintStars(+b.dataset.id);});
  document.addEventListener("pointerout",e=>{const g=e.target.closest?.(".af-stars-input");if(g&&!g.contains(e.relatedTarget))paintStars(dialog?.score||0);});
  document.addEventListener("focusin",e=>{if(e.target.matches?.(".af-stars-input button"))paintStars(+e.target.dataset.id);});
  document.addEventListener("focusout",e=>{if(e.target.closest?.(".af-stars-input")&&!e.relatedTarget?.closest?.(".af-stars-input"))paintStars(dialog?.score||0);});
  document.addEventListener("change",e=>{const k=e.target.dataset.afFilter;if(k){filters[k]=e.target.value;refreshRatings();}});
  document.addEventListener("input",e=>{
    if(e.target.dataset.afFilter!=="q")return;
    filters.q=e.target.value;const start=e.target.selectionStart;refreshRatings();const input=document.querySelector('[data-af-filter=q]');input.focus();input.setSelectionRange(start,start);
  });
  document.addEventListener("submit",event=>{
    if(event.target.id!=="af-rating-form")return;event.preventDefault();
    const a=source.find(a=>a.id===dialog?.id),error=document.getElementById("af-rating-error"),comment=document.getElementById("af-comment").value.trim();
    if(!canRate(a)){error.textContent="Оценка уже отправлена или период пока не завершён.";return;}
    if(!Number.isInteger(dialog.score)||dialog.score<1||dialog.score>5){error.textContent="Выберите оценку от 1 до 5.";return;}
    if(comment.length<10){error.textContent="Комментарий должен содержать не менее 10 символов.";return;}
    const r={...snapshot(a),score:dialog.score,comment,at:S.clock,author:P.person(S.person)};reviews.push(r);
    ["c1","d1"].forEach(user=>add(user,"review:"+a.id,r.score<=3?"Низкая оценка: зона внимания":"Получена оценка работы ассистента",`${P.person(r.assistant)} · ${r.score}/5 · ${a.id}.`,a.id,"rating"));
    add(a.manager,"review-sent:"+a.id,"Ваша оценка передана РОА и директору",`${a.id} · ${r.score}/5. Доступ не продлён.`,a.id,"rating");
    closeDialog();S.toast="Оценка отправлена РОА и директору. Ассистенту не показывается.";refreshRatings();
  });
  document.addEventListener("keydown",e=>{
    if(e.target.matches?.(".af-stars-input button")&&["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(e.key)){
      e.preventDefault();const value=e.key==="Home"?1:e.key==="End"?5:Math.min(5,Math.max(1,+e.target.dataset.id+(["ArrowRight","ArrowUp"].includes(e.key)?1:-1)));
      const b=document.querySelector(`.af-stars-input [data-id="${value}"]`);b.focus();b.click();
    }
    if(e.key==="Escape"&&profileDialog&&!dialog){closeProfile();document.getElementById("af-profile-btn")?.focus();paint();}
    if(e.key==="Escape"&&inbox&&!dialog&&!profileDialog){inbox=false;paint();document.getElementById("af-bell")?.focus();}
    if(e.key==="Tab"&&inbox&&!dialog){const nodes=[...document.querySelectorAll("#af-inbox button")];const first=nodes[0],last=nodes.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  });
  document.addEventListener("assistant:paint",()=>{const person=noticeUserId();if(person!==paint.person){inbox=false;unreadOnly=false;categoryFilter="all";filters={q:"",assistant:"",manager:"",score:"",status:""};closeDialog();closeProfile();paint.person=person;}paint();});
  const beforeRender=render;render=function(){beforeRender();paint();};
  DS.onStatusChange(()=>paint());
  window.AssistantFeedback={view,closure,resetDemo,flushDemoStore:()=>DS.flush(),isMaxLkDemoEnabled:maxConnectDemoEnabled};
  init();P.render();paint();
})();
