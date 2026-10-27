(function () {
  "use strict";
  if (window.AssignmentNotificationsStarted || !window.TandoorRf) return;
  window.AssignmentNotificationsStarted = true;
  var api=window.TandoorRf, host=document.getElementById("assignment-notifications-mount");
  if(!host)return;
  var data=null,page=1,open=false,busy=false,revision=null,timer=null,role=host.dataset.role,initial=true;
  var style=document.createElement("link");style.rel="stylesheet";style.href="/assignment-notifications.css";document.head.appendChild(style);
  function e(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  host.innerHTML='<button type="button" id="assignment-bell" aria-expanded="false" aria-controls="assignment-inbox" aria-label="Уведомления">'+
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span id="assignment-badge" hidden></span></button>'+
    '<section id="assignment-inbox" class="an-inbox" aria-label="Уведомления о назначениях" hidden><div class="an-head"><h2>Уведомления</h2><button type="button" data-notify="close" aria-label="Закрыть уведомления">Закрыть</button></div><div class="an-tools"><button type="button" data-notify="read-all">Прочитать все</button><button type="button" data-notify="refresh">Обновить</button></div><div id="assignment-inbox-items" aria-live="polite"></div><p id="assignment-inbox-error" role="status"></p></section>';
  var bell=document.getElementById("assignment-bell"),panel=document.getElementById("assignment-inbox");
  async function req(path,body){
    var r=await api.apiRequest("/api/access/notifications"+path,body===undefined?{}:{method:"POST",body:body});
    if(!r.response.ok)throw Error(api.extractErrorMessage(r.data,"Уведомления временно недоступны."));
    return r.data;
  }
  function display(){
    if(!data)return;
    var badge=document.getElementById("assignment-badge");badge.hidden=!data.unread;badge.textContent=data.unread>99?"99+":data.unread;
    bell.setAttribute("aria-label","Уведомления"+(data.unread?", непрочитанных: "+data.unread:""));
    document.getElementById("assignment-inbox-items").innerHTML=(data.items.length?data.items.map(function(n){
      var date=new Intl.DateTimeFormat("ru-RU",{timeZone:"Europe/Moscow",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(n.created_at));
      return '<article class="an-item '+(!n.read_at?"an-unread":"")+'"><h3>'+e(n.title)+'</h3><time>'+e(date)+' МСК</time><p>'+e(n.message)+'</p><div class="an-tools"><button type="button" data-notify="open" data-id="'+e(n.id)+'" data-assignment="'+e(n.delegation_id)+'">'+(role==="assistant"?"Открыть клиентов":"Открыть назначение")+"</button>"+(!n.read_at?'<button type="button" data-notify="read" data-id="'+e(n.id)+'">Прочитано</button>':"")+"</div></article>";
    }).join(""):'<p class="an-empty">Пока нет уведомлений. Здесь появятся заявки, решения и изменения временного доступа.</p>')+
    '<div class="an-tools an-pages"><button type="button" data-notify="prev" '+(page<=1?"disabled":"")+'>Назад</button><span>'+page+" / "+Math.max(1,Math.ceil(data.total/30))+'</span><button type="button" data-notify="next" '+(page*30>=data.total?"disabled":"")+">Далее</button></div>";
  }
  async function refresh(){
    if(busy)return;busy=true;
    try {
      var next=await req("?page="+page);data=next;
      var changed=!initial&&role==="assistant"&&revision!==next.scopeRevision;
      initial=false;revision=next.scopeRevision;display();document.getElementById("assignment-inbox-error").textContent="";
      clearTimeout(timer);
      if(next.nextScopeChangeAt){
        var delay=Math.max(100,Date.parse(next.nextScopeChangeAt)-Date.parse(next.serverNow)+150);
        timer=setTimeout(function(){if(/^\/clients(?:\/|$)/.test(location.pathname))location.reload();else refresh();},Math.min(delay,2147483647));
      }
      if(changed&&/^\/clients(?:\/|$)/.test(location.pathname))location.reload();
    }catch(err){
      if(open)document.getElementById("assignment-inbox-error").textContent=err.message;
    }finally{busy=false;}
  }
  function toggle(value){open=value;panel.hidden=!open;bell.setAttribute("aria-expanded",String(open));if(open){refresh();panel.querySelector("button").focus();}else bell.focus();}
  bell.onclick=function(){toggle(!open);};
  host.onclick=async function(ev){
    var b=ev.target.closest("[data-notify]");if(!b||b.disabled)return;
    var a=b.dataset.notify;b.disabled=true;
    try{
      if(a==="close"){toggle(false);return;}
      if(a==="read-all")await req("/read-all",{});
      if(a==="read"||a==="open")await req("/"+b.dataset.id+"/read",{});
      if(a==="open"){location.assign(role==="assistant"?"/clients":"/access?assignment="+encodeURIComponent(b.dataset.assignment));return;}
      if(a==="next")page++;if(a==="prev")page--;await refresh();
    }catch(err){document.getElementById("assignment-inbox-error").textContent=err.message;}
    finally{b.disabled=false;}
  };
  document.addEventListener("keydown",function(ev){if(ev.key==="Escape"&&open)toggle(false);});
  document.addEventListener("click",function(ev){if(open&&!host.contains(ev.target))toggle(false);});
  document.addEventListener("visibilitychange",function(){if(!document.hidden)refresh();});
  window.addEventListener("focus",refresh);
  window.addEventListener("tandoor:notifications-refresh",refresh);
  setInterval(function(){if(!document.hidden)refresh();},60000);
  refresh();
})();
