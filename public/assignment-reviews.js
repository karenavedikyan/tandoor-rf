(function(){
  "use strict";
  var active=null,sequence=0,listSequence=0,filters={q:"",assistantId:"",managerId:"",score:"",status:""},page=1,root=null,currentUser=null;
  var words=["","Очень слабо","Ниже ожиданий","Нужно улучшить","Хорошо","Отлично"];
  var icon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.84 5.76 6.36.92-4.6 4.48 1.09 6.33L12 17.3l-5.69 2.99 1.09-6.33-4.6-4.48 6.36-.92Z"/></svg>';
  var e=function(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});};
  function api(path,body){return window.AssignmentWorkspace.request(path,body);}
  function date(v){return window.AssignmentWorkspace.formatDate(v);}
  function button(action,title,id,primary){return '<button type="button" data-ar="'+action+'" data-id="'+e(id||"")+'" class="'+(primary?"aa-primary":"")+'">'+e(title)+"</button>";}
  function stars(value){
    return '<span class="ar-stars" role="img" aria-label="'+e(Number(value).toFixed(1))+' из 5">'+[1,2,3,4,5].map(function(n){
      return '<span class="ar-star">'+icon+'<span style="clip-path:inset(0 '+Math.round(100-100*Math.max(0,Math.min(1,value-n+1)))+'% 0 0)">'+icon+"</span></span>";
    }).join("")+"</span>";
  }
  function options(rows,value){return '<option value="">Все</option>'+rows.map(function(r){return '<option value="'+e(r.id)+'" '+(r.id===value?"selected":"")+">"+e(r.full_name)+"</option>";}).join("");}
  function close(){
    if(active&&active.busy)return;
    sequence++;var el=document.getElementById("ar-dialog");if(el){el.close();el.remove();}
    active=null;
  }
  async function render(target,user){
    root=target;currentUser=user;page=1;filters={q:"",assistantId:"",managerId:"",score:"",status:""};
    await load();
  }
  async function load(){
    if(!root||!root.isConnected)return;var n=++listSequence,target=root;
    target.setAttribute("aria-busy","true");
    if(!target.innerHTML)target.innerHTML='<p role="status">Загружаем оценки…</p>';
    var params=new URLSearchParams(filters);params.set("page",page);
    try{
      var data=await api("/assignments/reviews?"+params);
      if(n!==listSequence||!target.isConnected)return;
      var s=data.stats,average=s.rated?Number(s.average).toFixed(1):"Нет оценок";
      target.innerHTML='<section class="aa-box ar"><div class="aa-toolbar"><h2>'+(currentUser.role==="manager"?"Оценка завершённой работы":"Оценки ассистентов")+'</h2></div><p class="ar-notice">Оценка и комментарий обязательны для закрытия назначения. Доступ ассистента прекращается по сроку независимо от оценки.</p>'+
        '<div class="ar-stats"><div><strong>'+e(average)+'</strong>'+(s.rated?stars(s.average):"")+'<span>Средняя из 5</span></div><div><strong>'+s.rated+'</strong><span>Получено оценок</span></div><div><strong>'+s.low+'</strong><span>Зона внимания: 1–3</span></div><div><strong>'+s.pending+'</strong><span>Ожидают обязательной оценки</span></div></div>'+
        (["coordinator","director"].includes(currentUser.role)?'<div class="ar-assistants">'+data.assistants.map(function(a){return '<article><h3>'+e(a.full_name)+'</h3><strong>'+(a.rated?Number(a.average).toFixed(1)+" / 5":"Нет оценок")+'</strong>'+(a.rated?stars(a.average):"")+'<p>'+a.rated+" оценок · "+a.low+" в зоне внимания · "+a.pending+" ожидают</p></article>";}).join("")+"</div>":"")+
        '<form id="ar-filters" class="ar-filters"><label>Поиск<input name="q" type="search" maxlength="200" value="'+e(filters.q)+'" placeholder="Сотрудник, номер или комментарий"></label><label>Ассистент<select name="assistantId">'+options(data.assistants,filters.assistantId)+'</select></label><label>Передающий менеджер<select name="managerId">'+options(data.managers,filters.managerId)+'</select></label><label>Оценка<select name="score">'+
        [["","Все оценки"],["low","1–3: зона внимания"],["5","5: отлично"],["4","4: хорошо"],["3","3: нужно улучшить"],["2","2: ниже ожиданий"],["1","1: очень слабо"]].map(function(a){return '<option value="'+a[0]+'" '+(filters.score===a[0]?"selected":"")+">"+a[1]+"</option>";}).join("")+
        '</select></label><label>Наличие оценки<select name="status">'+[["","Все завершённые"],["required","Обязательная оценка ожидается"],["rated","Закрыто с оценкой"]].map(function(a){return '<option value="'+a[0]+'" '+(filters.status===a[0]?"selected":"")+">"+a[1]+"</option>";}).join("")+'</select></label><div class="aa-actions"><button type="submit">Применить</button>'+button("reset","Сбросить фильтры")+'</div></form>'+
        '<p class="aa-muted">Найдено: '+data.total+'. Сводка выше учитывает всю доступную историю, без фильтров.</p><div class="aa-scroll" tabindex="0" aria-label="Оценки завершённых назначений"><table class="ar-table"><thead><tr><th>Назначение и период, МСК</th><th>Ассистент / менеджер</th><th>Клиенты</th><th>Оценка и закрытие</th><th>Действие</th></tr></thead><tbody>'+
        data.items.map(function(r){return '<tr><td><strong>№'+e(r.id.slice(0,8))+'</strong><small>'+e(date(r.worked_starts_at))+" → "+e(date(r.worked_ends_at))+'</small></td><td>'+e(r.assistant_name)+'<small>'+e(r.manager_name)+'</small></td><td>'+r.client_count+'</td><td>'+(r.score?stars(r.score)+'<strong class="ar-value">'+r.score+'/5</strong><small>Закрыто с оценкой</small>':'<strong class="ar-required">Ожидает обязательной оценки</strong>')+'</td><td>'+(r.score?button("open","Посмотреть",r.id):r.canRate?button("open","Оценить",r.id,true):"Ожидается от менеджера")+"</td></tr>";}).join("")+
        (data.items.length?"":'<tr><td colspan="5">Завершённые назначения с такими условиями не найдены.</td></tr>')+'</tbody></table></div><div class="aa-pager"><span>Страница '+page+" из "+Math.max(1,Math.ceil(data.total/30))+'</span><div class="aa-actions">'+button("prev","Назад")+button("next","Далее")+"</div></div></section>";
      target.querySelector('[data-ar="prev"]').disabled=page<=1;target.querySelector('[data-ar="next"]').disabled=page*30>=data.total;
      target.querySelector("#ar-filters").onsubmit=function(ev){ev.preventDefault();var fd=new FormData(ev.target);Object.keys(filters).forEach(function(k){filters[k]=String(fd.get(k)||"");});page=1;void load().catch(error);};
    }catch(err){if(n!==listSequence||!target.isConnected)return;target.innerHTML='<div class="aa-box"><p role="alert">'+e(err.message)+'</p>'+button("retry","Повторить загрузку")+"</div>";}
    finally{if(target.isConnected)target.removeAttribute("aria-busy");}
  }
  function summary(d){
    if(!d.review||d.review.state==="not_due")return "";
    return '<section class="aa-box ar"><h3>'+e(d.review.label)+'</h3>'+(d.review.score?stars(d.review.score)+" ":"")+
      (d.review.canRate?'<p>Поставьте звёзды и оставьте комментарий. Возврат к списку не снимает эту обязанность.</p>':"")+
      (d.review.state==="rated"?button("open","Посмотреть оценку",d.id):d.review.canRate?button("open","Оценить работу",d.id,true):'<p class="aa-muted">Ожидается от передающего менеджера.</p>')+"</section>";
  }
  function error(err){window.AssignmentWorkspace.note(err.message||"Не удалось выполнить запрос.",true);}
  function fillStars(value){document.querySelectorAll("#ar-star-input button").forEach(function(b){b.classList.toggle("ar-on",+b.dataset.score<=value);});}
  async function open(id){
    close();var n=++sequence;
    var d=(await api("/delegations/"+encodeURIComponent(id))).delegation;if(n!==sequence)return;
    if(!d.review||d.review.state==="not_due")throw Error("Оценка доступна только после завершения согласованной работы.");
    var r=d.review.state==="rated"?(await api("/delegations/"+encodeURIComponent(id)+"/review")).review:null;
    if(n!==sequence)return;
    var el=document.createElement("dialog");el.id="ar-dialog";el.className="aa-dialog ar ar-dialog";el.setAttribute("aria-labelledby","ar-title");
    active={id:id,score:0,busy:false,review:r};document.body.appendChild(el);
    var snap=r&&r.snapshot||{},name=r?snap.assistantName||r.assistant_name:d.assistant_name;
    el.innerHTML='<div class="ar-top"><div><span class="ar-eyebrow">'+(r?"Результат работы":"Обязательный итог периода")+'</span><h2 id="ar-title">'+(r?"Оценка работы ассистента":"Как поработал ассистент?")+'</h2></div>'+button("close",r?"Закрыть":"К списку")+'</div><p><strong>'+e(name)+'</strong> · №'+e(id.slice(0,8))+'</p><p class="aa-muted">'+e(date(r?r.worked_starts_at:d.starts_at))+" → "+e(date(r?r.worked_ends_at:d.revoked_at&&new Date(d.revoked_at)<new Date(d.ends_at)?d.revoked_at:d.ends_at))+' МСК. Доступ уже закрыт.</p>'+
      (r?'<article class="ar-result '+(r.score<=3?"ar-low":"")+'"><div class="ar-top">'+stars(r.score)+'<strong>'+r.score+"/5 · "+e(words[r.score])+'</strong></div><p class="ar-comment">'+e(r.comment)+'</p><p class="aa-muted">Оценил '+e(snap.managerName||r.author_name)+" · "+e(date(r.submitted_at))+(snap.performedByAdmin?'. <strong class="ar-admin-note">Выполнено администратором '+e(snap.performedByAdmin.adminName)+' от имени '+e(snap.performedByAdmin.effectiveEmployeeName)+'.</strong>':"")+'</p><details><summary>Клиенты на момент оценки</summary>'+
        (snap.clients?'<ul>'+snap.clients.map(function(c){return "<li>"+e(c.name||c.guid)+"</li>";}).join("")+"</ul>":'<p>Список недоступен в текущей области прав.</p>')+"</details></article>":
        '<form id="ar-form"><p class="ar-notice">Оценка и комментарий обязательны для закрытия назначения. Возврат к списку не отменяет эту обязанность.</p><fieldset class="ar-star-field"><legend>Ваша оценка · обязательно</legend><div id="ar-star-input" role="group" aria-label="Оценка от одной до пяти звёзд" aria-describedby="ar-hint">'+[1,2,3,4,5].map(function(v){return '<button type="button" data-ar="score" data-score="'+v+'" aria-label="'+v+" из 5: "+words[v]+'" aria-pressed="false">'+icon+"</button>";}).join("")+'</div><p id="ar-hint" aria-live="polite">Выберите от 1 до 5 звёзд</p></fieldset><label>Комментарий к работе · обязательно<textarea id="ar-comment" rows="3" required minlength="10" maxlength="2000" placeholder="Что получилось хорошо и что стоит улучшить. Не менее 10 символов."></textarea></label><p class="aa-muted">Оценку видят только автор, РОА и директор. После отправки изменить её нельзя.</p><p id="ar-error" class="aa-error" role="alert"></p><div class="aa-actions"><button type="submit" class="aa-primary">Отправить оценку</button>'+button("close","Вернуться к списку")+"</div></form>");
    el.addEventListener("cancel",function(ev){if(active&&active.busy)ev.preventDefault();});
    el.addEventListener("close",function(){if(document.getElementById("ar-dialog")===el){sequence++;el.remove();active=null;}});
    var form=el.querySelector("#ar-form");if(form)form.onsubmit=submit;
    el.showModal();
  }
  async function submit(ev){
    ev.preventDefault();if(!active||active.busy)return;var state=active,err=document.getElementById("ar-error"),comment=document.getElementById("ar-comment").value.trim();
    if(!state.score){err.textContent="Выберите от 1 до 5 звёзд.";return;}
    if(Array.from(comment).length<10){err.textContent="Комментарий должен содержать не менее 10 символов.";return;}
    state.busy=true;err.textContent="Отправляем оценку…";document.querySelectorAll("#ar-dialog button,#ar-dialog textarea").forEach(function(b){b.disabled=true;});
    try{
      await api("/delegations/"+state.id+"/review",{score:state.score,comment:comment});
      state.busy=false;close();if(root&&root.isConnected)await load();
      if(window.refreshAssignmentNotifications)await window.refreshAssignmentNotifications();
      if(!root||!root.isConnected)await window.AssignmentWorkspace.detail(state.id);
    }catch(ex){err.textContent=ex.message||"Оценка не отправлена. Повторите попытку.";state.busy=false;document.querySelectorAll("#ar-dialog button,#ar-dialog textarea").forEach(function(b){b.disabled=false;});}
  }
  document.addEventListener("click",function(ev){
    var b=ev.target.closest("[data-ar]");if(!b)return;
    var a=b.dataset.ar;
    if(a==="score"&&active&&!active.review){active.score=+b.dataset.score;document.querySelectorAll("#ar-star-input button").forEach(function(x){x.setAttribute("aria-pressed",String(x===b));});fillStars(active.score);document.getElementById("ar-hint").textContent=active.score+" из 5: "+words[active.score];}
    if(a==="close")close();if(a==="open")void open(b.dataset.id).catch(error);
    if(a==="reset"){filters={q:"",assistantId:"",managerId:"",score:"",status:""};page=1;void load().catch(error);}
    if(a==="prev"||a==="next"){page+=a==="next"?1:-1;void load().catch(error);}if(a==="retry")void load().catch(error);
  });
  document.addEventListener("pointerover",function(ev){var b=ev.target.closest("#ar-star-input button");if(b)fillStars(+b.dataset.score);});
  document.addEventListener("pointerout",function(ev){var g=ev.target.closest("#ar-star-input");if(g&&!g.contains(ev.relatedTarget))fillStars(active?active.score:0);});
  document.addEventListener("focusin",function(ev){if(ev.target.matches("#ar-star-input button"))fillStars(+ev.target.dataset.score);});
  document.addEventListener("focusout",function(ev){if(ev.target.closest("#ar-star-input")&&!(ev.relatedTarget&&ev.relatedTarget.closest("#ar-star-input")))fillStars(active?active.score:0);});
  document.addEventListener("keydown",function(ev){
    if(!ev.target.matches("#ar-star-input button")||!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(ev.key))return;
    ev.preventDefault();var v=ev.key==="Home"?1:ev.key==="End"?5:Math.min(5,Math.max(1,+ev.target.dataset.score+(["ArrowRight","ArrowUp"].includes(ev.key)?1:-1)));
    var b=document.querySelector('#ar-star-input [data-score="'+v+'"]');b.focus();b.click();
  });
  window.AssignmentReviews={render:render,open:open,close:close,summary:summary,stars:stars};
})();
