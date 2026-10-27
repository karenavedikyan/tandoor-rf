(function(){
  "use strict";
  var api=window.TandoorRf;
  if(!api)return;
  var enc=function(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});};
  var time=function(v){try{return new Intl.DateTimeFormat("ru-RU",{timeZone:"Europe/Moscow",dateStyle:"short",timeStyle:"short"}).format(new Date(v));}catch(_){return String(v||"");}};
  window.mountAssignmentNotifications=function(user){
    var host=document.getElementById("assignment-notifications-mount");
    if(!host||!user||!["manager","coordinator","director","rop","assistant"].includes(user.role))return;
    var shell=window.ClientsShell;
    var preview=Boolean(shell&&shell.getPreviewState&&shell.getPreviewState().active);
    if(host.dataset.mounted)return;host.dataset.mounted="true";host.hidden=false;
    var currentPage=1,unreadOnly=false,data=null,loading=0,expiryTimer=null,inboxOpen=false,revision=null,initial=true;
    var style=document.createElement("link");style.rel="stylesheet";style.href="/assignment-notifications.css?v=reviews1";document.head.appendChild(style);
    var roles={manager:"Менеджер",coordinator:"РОА",director:"Директор",rop:"РОП",assistant:"Ассистент"};
    host.innerHTML='<button type="button" class="an-bell" id="an-bell" aria-label="Уведомления" aria-expanded="false" aria-controls="an-inbox">'+
      '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="an-count" id="an-count" hidden></span></button>'+
      '<dialog class="an-inbox" id="an-inbox" aria-labelledby="an-heading"><header><div><h2 id="an-heading">Уведомления</h2><p class="an-person">'+enc(user.fullName||user.full_name||"")+" · "+roles[user.role]+'</p></div><button type="button" data-an="close">Закрыть</button></header>'+
      '<div class="an-filters"><button type="button" data-an="all" aria-pressed="true">Все</button><button type="button" data-an="unread" aria-pressed="false">Непрочитанные</button><button type="button" data-an="read-all">Прочитать все</button></div>'+
      '<p id="an-error" role="alert"></p><div id="an-items" class="an-items" tabindex="0" aria-label="Лента уведомлений"><p>Загружаем…</p></div>'+
      '<footer><span id="an-page"></span><div><button type="button" data-an="prev">Назад</button><button type="button" data-an="next">Далее</button></div></footer><p class="an-footnote">Внутри личного кабинета. Внешняя отправка не подключена.</p></dialog>';
    var bell=host.querySelector("#an-bell"),panel=host.querySelector("#an-inbox");
    var reminder=document.createElement("aside");reminder.id="assignment-review-obligation";reminder.className="an-required";reminder.hidden=true;
    reminder.setAttribute("aria-label","Обязательная оценка завершённой работы");document.body.appendChild(reminder);
    function close(){inboxOpen=false;if(panel.open)panel.close();bell.setAttribute("aria-expanded","false");}
    panel.addEventListener("close",function(){inboxOpen=false;bell.setAttribute("aria-expanded","false");bell.focus();});
    panel.addEventListener("click",function(ev){if(ev.target===panel){var r=panel.getBoundingClientRect();if(ev.clientX<r.left||ev.clientX>r.right||ev.clientY<r.top||ev.clientY>r.bottom)close();}});
    function noticeError(message){host.querySelector("#an-error").textContent=message||"";}
    function hidePrivate(){close();host.hidden=true;reminder.hidden=true;document.body.classList.remove("has-assignment-review-obligation");}
    async function read(path){
      var r=await api.apiRequest("/api/access/notifications"+path,{method:"POST",body:{}});
      if(!r.response.ok)throw Error(api.extractErrorMessage(r.data,"Не удалось отметить уведомление. Повторите попытку."));
    }
    function destination(n){
      if(/^review_/.test(n.kind))return {href:"/access?review="+encodeURIComponent(n.delegation_id),label:n.kind==="review_required"?"Оценить работу":"Посмотреть оценку"};
      if(user.role==="assistant"&&["approve","approve_change","access_starting"].includes(n.kind))return {href:"/clients?v3mode=1&v3entity=legal_grouped",label:"Открыть клиентов"};
      return {href:"/access?assignment="+encodeURIComponent(n.delegation_id),label:"Открыть назначение"};
    }
    function draw(){
      var count=host.querySelector("#an-count");count.textContent=data.unread>99?"99+":String(data.unread);count.hidden=!data.unread;
      bell.setAttribute("aria-label","Уведомления: "+data.unread+" непрочитанных");
      host.querySelector('[data-an="all"]').setAttribute("aria-pressed",String(!unreadOnly));
      host.querySelector('[data-an="unread"]').setAttribute("aria-pressed",String(unreadOnly));
      host.querySelector('[data-an="read-all"]').disabled=preview||!data.unread;
      var box=host.querySelector("#an-items"),scroll=box.scrollTop,focused=document.activeElement&&document.activeElement.dataset.anId;
      box.innerHTML=data.items.length?data.items.map(function(n){
        var link=destination(n);
        return '<article class="an-item '+(n.read_at?"":"an-unread")+'"><div class="an-line"><strong>'+enc(n.title)+'</strong><small>'+(n.read_at?"Прочитано":"Новое")+'</small></div><p>'+enc(n.message)+'</p><time>'+enc(time(n.created_at))+' МСК</time><div class="an-actions"><a href="'+link.href+'" data-an-link="'+enc(n.id)+'">'+link.label+'</a>'+
          (n.read_at?"":'<button type="button" data-an="read" '+(preview?'disabled title="Изменения запрещены в режиме просмотра" ':"")+'data-an-id="'+enc(n.id)+'">Прочитано</button>')+"</div></article>";
      }).join(""):'<p class="an-empty">'+(unreadOnly?"Все уведомления прочитаны.":"Уведомлений пока нет.")+"</p>";
      box.scrollTop=scroll;if(focused){var f=box.querySelector('[data-an-id="'+focused+'"]');if(f)f.focus();else if(inboxOpen)panel.querySelector('[data-an="close"]').focus();}
      host.querySelector("#an-page").textContent="Всего: "+data.total+" · "+currentPage+" / "+Math.max(1,Math.ceil(data.total/30));
      host.querySelector('[data-an="prev"]').disabled=currentPage<=1;host.querySelector('[data-an="next"]').disabled=currentPage*30>=data.total;
      var needed=user.role==="manager"&&data.reviewPendingCount>0;
      reminder.hidden=!needed;document.body.classList.toggle("has-assignment-review-obligation",needed);
      if(needed)reminder.innerHTML='<div><strong>Оцените завершённую работу · '+data.reviewPendingCount+'</strong><span>Обязательный шаг для закрытия назначения</span></div><a href="/access?review='+encodeURIComponent(data.reviewPendingAssignmentId)+'">Поставить оценку</a>';
    }
    async function load(){
      var seq=++loading;
      try{
        var r=await api.apiRequest("/api/access/notifications?page="+currentPage+(unreadOnly?"&unread=1":""));
        if(seq!==loading)return;
        if(r.response.status===401||r.response.status===403){hidePrivate();return;}
        if(!r.response.ok)throw Error("Не удалось загрузить уведомления.");
        data=r.data;
        if(!initial&&user.role==="assistant"&&window.location.pathname==="/clients"&&revision!==data.scopeRevision){window.location.reload();return;}
        revision=data.scopeRevision;initial=false;draw();noticeError("");clearTimeout(expiryTimer);
        var boundaries=[data.nextScopeChangeAt,data.nextReviewDueAt].filter(Boolean).map(function(v){return new Date(v).getTime();});
        if(boundaries.length){
          var next=Math.min.apply(Math,boundaries),delay=Math.max(150,next-new Date(data.serverNow).getTime()+150);
          if(Number.isFinite(delay)&&delay<2147483000)expiryTimer=setTimeout(function(){
            // Only the assistant's client scope requires a directory reload.
            if(user.role==="assistant"&&window.location.pathname==="/clients")window.location.reload();else void load();
          },delay);
        }
      }catch(err){if(seq===loading)noticeError(err.message||"Не удалось загрузить уведомления.");}
    }
    host.addEventListener("click",function(ev){
      var b=ev.target.closest("[data-an],#an-bell"),link=ev.target.closest("[data-an-link]");
      if(link){ev.preventDefault();if(preview){window.location.assign(link.href);return;}void read("/"+link.dataset.anLink+"/read").catch(function(){}).finally(function(){window.location.assign(link.href);});return;}
      if(!b)return;
      if(b.id==="an-bell"){if(inboxOpen){close();return;}inboxOpen=true;panel.showModal();bell.setAttribute("aria-expanded","true");void load();return;}
      var a=b.dataset.an;
      if(a==="close"){close();return;}
      if(a==="all"||a==="unread"){unreadOnly=a==="unread";currentPage=1;void load();return;}
      if(a==="prev"||a==="next"){currentPage+=a==="next"?1:-1;void load();return;}
      if(a==="read"||a==="read-all"){if(preview)return;b.disabled=true;void read(a==="read-all"?"/read-all":"/"+b.dataset.anId+"/read").then(function(){if(a==="read-all")currentPage=1;return load();}).catch(function(err){noticeError(err.message);}).finally(function(){if(b.isConnected)b.disabled=false;});}
    });
    document.addEventListener("visibilitychange",function(){if(!document.hidden)void load();});
    window.addEventListener("focus",function(){void load();});
    window.addEventListener("tandoor:notifications-refresh",function(){void load();});
    var interval=setInterval(function(){if(!document.hidden)void load();},60000);
    window.addEventListener("pagehide",function(){clearInterval(interval);clearTimeout(expiryTimer);});
    window.refreshAssignmentNotifications=load;void load();
  };
})();
