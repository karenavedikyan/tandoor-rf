/* Synthetic, in-memory prototype. No production data or network calls. */
(() => {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>v==null?'Нет данных':v.toLocaleString('ru-RU',{maximumFractionDigits:1});
  const categories={mk:'Межкомнатные двери',vh:'Входные двери',hw:'Фурнитура'};
  const months=['Апр','Май','Июн','Июл','Авг','Сен'];
  const state={period:'6',q:'',signal:'all',city:'',managers:[],rops:[],compare:'city',model:'',view:'compare',drill:null,page:1};
  const rowCache=new Map(),pageSize=25;
  let lastScenario='';
  const ui={filtersOpen:false};
  const trail=[];
  const grouping={city:'Городам',manager:'Менеджерам',client:'Клиентам',model:'Моделям',rop:'РОПам'};
  let context,scopeKey='',lastRole='';
  const hash=s=>[...s].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,7);
  const button=(action,text,id='',cls='')=>`<button class="${cls}" data-dp="${action}" data-id="${esc(id)}">${text}</button>`;
  const option=(v,t,s)=>`<option value="${esc(v)}" ${v===s?'selected':''}>${esc(t)}</option>`;
  const samplesText=n=>n%10===1&&n%100!==11?'наш образец':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'наших образца':'наших образцов';
  const unit=n=>context.seg!=='hw'?'шт.':n%10===1&&n%100!==11?'пара':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'пары':'пар';
  function scopePoints(){
    return [...new Map(context.points.map(t=>[t.id,t])).values()].filter(t=>(!state.city||t.city===state.city)&&
      (!state.managers.length||state.managers.includes(t.manager))&&
      (!state.rops.length||state.rops.includes(t.rop)));
  }
  function data(){
    return build({...context,points:scopePoints()}).filter(r=>!state.model||r.model.id===state.model);
  }
  function matches(r){
    return (state.signal==='all'||(state.signal==='none'?r.units===0:r.units>0))&&
      `${r.model.name} ${r.t.clientName} ${r.t.address} ${r.t.city} ${r.t.manager||''}`.toLowerCase().includes(state.q.toLowerCase());
  }
  function summarize(rows){
    const unique=[...new Map(rows.map(r=>[r.key,r])).values()],known=unique.filter(r=>r.units!=null);
    return {units:known.length?known.reduce((n,r)=>n+r.units,0):null,partial:known.length<unique.length,
      attention:unique.filter(r=>r.status==='none').length,longZero:unique.filter(r=>attention(r).level==='stale').length,fast:unique.filter(r=>attention(r).level==='fast').length,unknown:unique.filter(r=>r.units==null).length,
      tt:new Set(unique.map(r=>r.t.id)).size};
  }
  function groups(){
    const rs=data(),map=new Map();
    if(state.compare==='model'){
      for(const r of rs){if(!map.has(r.model.id))map.set(r.model.id,{id:r.model.id,name:r.model.name,points:scopePoints(),rows:[]});map.get(r.model.id).rows.push(r)}
    }else{
      for(const t of scopePoints()){
        const id=state.compare==='client'?t.client:t[state.compare]||'Не указан';
        if(!map.has(id))map.set(id,{id,name:state.compare==='client'?t.clientName:id,points:[],rows:[]});
        map.get(id).points.push(t);
      }
      for(const r of rs){const id=state.compare==='client'?r.t.client:r.t[state.compare]||'Не указан';map.get(id)?.rows.push(r)}
    }
    return [...map.values()].filter(g=>{
      const relevant=g.rows.filter(matches);
      return state.signal==='all'&&!state.q||relevant.length>0;
    }).map(g=>({...g,summary:summarize(g.rows.filter(matches))})).sort((a,b)=>b.summary.longZero-a.summary.longZero||b.summary.attention-a.summary.attention||a.name.localeCompare(b.name,'ru'));
  }
  function multi(field,label,values){
    return `<details class="ds-multi" name="ds-people-picker" data-dp-picker="${field}"><summary>${label}: ${state[field].length||'все'}</summary><div>${values.length>12?'<input type="search" data-dp-people-search aria-label="Найти сотрудника" placeholder="Найти сотрудника">':''}${values.map(v=>`<label><input type="checkbox" data-dp-multi="${field}" value="${esc(v)}" ${state[field].includes(v)?'checked':''}>${esc(v)}</label>`).join('')}</div></details>`;
  }
  function distribution(points,seg) {
    let ours=0,capacity=0,known=0;
    const unique=[...new Map(points.map(p=>[p.id,p])).values()];
    for(const p of unique){
      const fixtures=Object.values(p.fact[seg]||{});if(!fixtures.length)continue;
      known++;
      for(const f of fixtures){ours+=f.ours??f.items.reduce((n,i)=>n+i.qty,0);capacity+=f.cap}
    }
    return {ours,capacity,known,total:unique.length,percent:capacity>0?Math.round(100*ours/capacity):null};
  }
  function build(ctx) {
    const cacheKey=ctx.cacheToken?`${ctx.cacheToken}:${ctx.seg}:${state.period}:${ctx.points.map(t=>t.id).join(',')}`:'';
    if(cacheKey&&rowCache.has(cacheKey))return rowCache.get(cacheKey);
    const result=[];
    const catalogMap=new Map(ctx.catalog.filter(m=>m.seg===ctx.seg).map(m=>[m.id,m]));
    for(const t of [...new Map(ctx.points.map(t=>[t.id,t])).values()]){
      const items=Object.values(t.fact[ctx.seg]||{}).flatMap(f=>f.items).filter(i=>i.qty>0);
      for(const id of [...new Set(items.map(i=>i.id))]){
        const model=catalogMap.get(id);if(!model)continue;
        const sample=items.find(i=>i.id===id);
        const key=`${t.id}:${id}`,h=hash(key),start=sample.demoAge?6-sample.demoAge:id==='M2'?5:0;
        // Explicit demo scenarios, not an inference from absent real records.
        const missing=sample.demoCase==='missing'||t.id==='TT-2-1',zero=sample.demoCase==='stale'||id==='M0';
        const all=months.map((label,i)=>{
          let gross=zero?0:ctx.seg==='vh'?[12,16,15,18,20,19][i]+h%3:
            ctx.seg==='hw'?[30,40,34,45,48,43][i]+h%5:[8,12,9,14,16,13][i]+h%4;
          if(sample.demoCase==='slow')gross=3;
          if(sample.demoCase==='paused'&&i===5)gross=0;
          return {label,index:i,units:missing?null:Math.max(0,gross-(gross?1:0))};
        }).filter(r=>r.index>=start);
        const records=all.filter(r=>r.index>=6-Number(state.period));
        const units=missing||!records.length?null:records.reduce((n,r)=>n+r.units,0);
        const status=units==null?'unknown':start===5?'new':units===0?'none':'sold';
        result.push({key,t,model,start,all,records,units,status,
          samples:items.filter(i=>i.id===id).reduce((n,i)=>n+i.qty,0)});
      }
    }
    result.sort((a,b)=>({none:0,unknown:1,new:2,sold:3}[a.status]-{none:0,unknown:1,new:2,sold:3}[b.status])||(b.units||0)-(a.units||0));
    if(cacheKey){if(rowCache.size>=3)rowCache.delete(rowCache.keys().next().value);rowCache.set(cacheKey,result)}
    return result;
  }
  const statusText={none:'Нет продаж',sold:'Продаётся',new:'Недавно установлен',unknown:'Нет данных'};
  function attention(r){
    if(r.units==null)return {level:'unknown',text:'Нет данных',note:'Нужны продажи именно этой модели и ТТ'};
    const history=r.all||[],fastThreshold=r.model?.seg==='hw'?30:10;
    const complete=history.length>0&&history.every(p=>p.units!=null);
    if(complete&&history.length<=2&&history.reduce((n,p)=>n+p.units,0)/history.length>=fastThreshold)
      return {level:'fast',text:'Хороший старт',note:'Проверить спрос и расширить показ в похожих ТТ'};
    if(r.status==='new')return {level:'new',text:'Новый образец',note:'Одного месяца недостаточно для оценки'};
    if(r.units===0){
      const longZero=history.length>=3&&history.every(p=>p.units===0);
      return longZero?{level:'stale',text:`${history.length} мес. без продаж`,note:'Стоит давно — в первую очередь проверить причину'}:
        {level:'none',text:'Нет продаж за период',note:'Проверить наличие, цену и показ'};
    }
    return {level:'sold',text:'Продаётся',note:'Поддерживать наличие и хороший показ'};
  }
  const advice=r=>r.status==='unknown'?'Уточнить продажи по этой точке':
    r.status==='new'?'Пока рано оценивать — наблюдаем':
    r.status==='none'?'Проверить причину. Возможно, заменить образец':
    'Поддерживать наличие и хороший показ';
  function filtered() {
    return data().filter(matches).filter(r=>{
      if(!state.drill)return true;
      const {kind,id}=state.drill;
      return (kind==='model'?r.model.id:kind==='client'?r.t.client:r.t[kind]||'Не указан')===id;
    });
  }
  function row(r) {
    const signal=attention(r);
    return `<article class="ds-row ds-attention-${signal.level}" data-testid="display-model-${esc(r.key)}">
      <div class="ds-model"><b>${esc(r.model.name)}</b><small>${esc(r.t.clientName)} · ${esc(r.t.address)}</small><small>${esc(r.t.manager||'Менеджер не указан')}</small></div>
      <div class="ds-samples"><span class="ds-label">На витрине</span><b>${r.samples} ${unit(r.samples)}</b></div>
      <div class="ds-sales"><span class="ds-label">Продано</span><b>${r.units==null?'Нет данных':`${num(r.units)} ${unit(r.units)}`}</b><small>${r.start===5?'С сентября · новый образец':`${state.period} мес. показа`}</small></div>
      <div class="ds-decision"><span class="ds-status ${signal.level}">${signal.text}</span><small>${signal.note}</small></div>
      ${button('detail',r.status==='none'?'Разобраться →':'Подробнее →',r.key,'ds-open')}
    </article>`;
  }
  function results() {
    if(state.view==='compare')return comparison();
    const rows=filtered();
    return `<div class="ds-list"><div class="ds-tablehead"><span>Модель на витрине</span><span>На витрине</span><span>Продано</span><span>Что делать</span><span></span></div>
      ${pageRows(rows).map(row).join('')||'<div class="ds-empty"><h3>Нет моделей по этим условиям</h3><p>Очистите поиск или смените категорию. Если состав витрины не внесён, сначала нужен осмотр.</p></div>'}</div>${pager(rows.length)}`;
  }
  function pageRows(rows){
    state.page=Math.max(1,Math.min(state.page,Math.ceil(rows.length/pageSize)||1));
    return rows.slice((state.page-1)*pageSize,state.page*pageSize);
  }
  function pager(total){
    if(total<=pageSize)return '';
    return `<nav class="ds-pager" aria-label="Страницы списка"><span>${num((state.page-1)*pageSize+1)}–${num(Math.min(state.page*pageSize,total))} из ${num(total)}</span><div><button data-dp="page" data-id="-1" ${state.page===1?'disabled':''}>← Назад</button><button data-dp="page" data-id="1" ${state.page*pageSize>=total?'disabled':''}>Далее →</button></div></nav>`;
  }
  function comparison(){
    const gs=groups();
    const modelMode=state.compare==='model'||!!state.model;
    return `<div class="ds-list ds-comparison"><div class="ds-tablehead"><span>${state.compare==='model'?'Модель':state.compare==='manager'?'Менеджер':state.compare==='rop'?'РОП':state.compare==='client'?'Клиент':'Город'}</span><span>${modelMode?'Стоит в ТТ':'Дистрибуция'}</span><span>Продано</span><span>Требует внимания</span><span></span></div>
      ${pageRows(gs).map(g=>{
        const d=distribution(g.points,context.seg),s=g.summary;
        const surveyed=g.points.filter(t=>Object.values(t.fact[context.seg]||{}).length).length;
        return `<article class="ds-row ${s.longZero?'ds-attention-stale':s.attention?'ds-attention-none':s.fast?'ds-attention-fast':''}" data-comparison-row="${esc(g.id)}">
          <div class="ds-model"><b>${esc(g.name)}</b><small>${state.compare==='model'?s.tt+' ТТ с моделью':new Set(g.points.map(t=>t.client)).size+' клиентов · '+g.points.length+' ТТ'}</small></div>
          <div><span class="ds-label">${modelMode?'Стоит в ТТ':'Дистрибуция'}</span><b>${modelMode?(surveyed?`${s.tt} / ${surveyed}`:'Нет осмотра'):d.percent==null?'Нет осмотра':d.percent+'%'}</b><small>${modelMode?'ТТ с моделью / обследовано':`${d.ours} / ${d.capacity} мест`}</small></div>
          <div class="ds-sales"><span class="ds-label">Продано</span><b>${s.units==null?'Нет данных':num(s.units)+' '+unit(s.units)}</b>${s.partial?'<small>Данные неполные</small>':''}</div>
          <div class="ds-decision"><span class="ds-status ${s.longZero?'stale':s.attention?'none':s.fast?'fast':s.units==null||s.units===0?'unknown':'sold'}">${s.longZero?s.longZero+' давно без продаж':s.attention?s.attention+' без продаж':s.fast?s.fast+' с хорошим стартом':s.units==null?'Нужны данные':s.units>0?'Есть продажи':'Пока нет продаж'}</span>${s.fast&&(s.longZero||s.attention)?`<small><span class="ds-status fast">${s.fast} с хорошим стартом</span></small>`:''}<small>${s.longZero?'Есть модели без продаж за 3+ месяца показа':s.attention?'Пар «модель × ТТ», не количество образцов':s.fast?'Рассмотреть расширение показа':s.unknown?'Есть позиции с неизвестными продажами':g.rows.length?'Проверить наличие ходовых моделей':'Состав витрины не внесён'}</small></div>
          ${button('drill','Открыть →',g.id,'ds-open')}</article>`;
      }).join('')||'<div class="ds-empty"><h3>Нет данных по этим условиям</h3><p>Смените фильтры или модель.</p></div>'}</div>${pager(gs.length)}`;
  }
  function content() {
    const all=data(),zero=all.filter(r=>r.status==='none').length;
    const clients=[...new Map(context.available.map(t=>[t.client,t.clientName])).entries()];
    const points=context.available.filter(t=>t.client===context.clientId);
    const missing=distribution(scopePoints(),context.seg);
    const allowedGroups=['city',...(['rop','director'].includes(context.role)?['manager']:[]),'client','model',...(context.role==='director'?['rop']:[])];
    const selections=[
      context.clientId?`Клиент: ${clients.find(([id])=>id===context.clientId)?.[1]||context.clientId}`:'',
      context.pointId?`ТТ: ${points.find(t=>t.id===context.pointId)?.address||context.pointId}`:'',
      state.city?`Город: ${state.city}`:'',
      state.rops.length?`РОПы: ${state.rops.length===1?state.rops[0]:state.rops.length}`:'',
      state.managers.length?`Менеджеры: ${state.managers.length===1?state.managers[0]:state.managers.length}`:'',
      state.model?`Модель: ${context.catalog.find(m=>m.id===state.model)?.name||state.model}`:''
    ].filter(Boolean);
    return `<div class="ds-query-panel">
      <div class="ds-query-main">
        <button class="ds-filter-toggle" data-dp="toggle-filters" aria-expanded="${ui.filtersOpen}" aria-controls="ds-filter-panel">Фильтры${selections.length?` <span class="ds-filter-count">${selections.length}</span>`:''}<span aria-hidden="true">${ui.filtersOpen?'▴':'▾'}</span></button>
        <label>Период<select data-dp-field="period">${option('6','6 месяцев · апр — сен',state.period)}${option('3','3 месяца · июл — сен',state.period)}${option('1','Сентябрь 2026',state.period)}</select></label>
        ${!state.drill?`<label>Сравнить по<select data-dp-field="compare">${allowedGroups.map(g=>option(g,grouping[g],state.compare)).join('')}</select></label>`:'<span class="ds-query-drill">Детализация выборки</span>'}
        <span class="ds-query-demo">Учебные данные</span>
      </div>
      <div class="ds-selection-summary" aria-live="polite"><span>${selections.length?selections.map(esc).join(' · '):'Вся моя территория · Все модели'}</span>${selections.length?button('reset-all','Сбросить','','ds-clear'):''}</div>
      <div id="ds-filter-panel" class="ds-filter-panel" ${ui.filtersOpen?'':'hidden'}>
      <fieldset class="ds-filter-group"><legend>Территория и клиент</legend><div class="ds-context">
      <label>Область${clients.length>30?'<input type="search" data-dp-option-search="client" aria-label="Найти клиента в списке" placeholder="Найти клиента в списке">':''}<select data-dp-client>${option('','Вся моя территория',context.clientId||'')}${clients.map(([id,name])=>option(id,name,context.clientId)).join('')}</select></label>
      <label>Город<select data-dp-field="city">${option('','Все города',state.city)}${[...new Set(context.points.map(t=>t.city))].sort().map(c=>option(c,c,state.city)).join('')}</select></label>
      ${points.length>1?`<label>Торговая точка<select data-dp-point>${option('','Все точки клиента',context.pointId)}${points.map(t=>option(t.id,t.address,context.pointId)).join('')}</select></label>`:''}
      </div></fieldset>
      ${['rop','director'].includes(context.role)?`<fieldset class="ds-filter-group"><legend>Команда</legend><div class="ds-people">${context.role==='director'?multi('rops','РОПы',[...new Set(context.points.map(t=>t.rop).filter(Boolean))]):''}${multi('managers','Менеджеры',[...new Set(context.points.map(t=>t.manager).filter(Boolean))])}</div></fieldset>`:''}
      <fieldset class="ds-filter-group"><legend>Номенклатура</legend><div class="ds-compare-controls"><label>Модель${context.catalog.filter(m=>m.seg===context.seg).length>30?'<input type="search" data-dp-option-search="model" aria-label="Найти модель в списке" placeholder="Найти модель в списке">':''}<select data-dp-field="model">${option('','Вся категория',state.model)}${context.catalog.filter(m=>m.seg===context.seg).map(m=>option(m.id,m.name,state.model)).join('')}</select></label></div></fieldset>
      <details class="ds-demo-settings"><summary>Демо-сценарий: ${{small:'Мало',medium:'Средне',large:'Много'}[context.scenario||'small']}</summary><div class="ds-scale"><div><b>Объём демо-данных</b><small>Синтетические записи, не данные рабочего ЛК</small></div><div class="ds-scale-options">${[['small','Мало'],['medium','Средне'],['large','Много']].map(([id,label])=>`<button data-dp="scenario" data-id="${id}" aria-pressed="${(context.scenario||'small')===id}">${label}</button>`).join('')}</div><p>${num(new Set(context.available.map(t=>t.client)).size)} клиентов · ${num(context.available.length)} ТТ · ${num(new Set(context.available.map(t=>t.city)).size)} городов · ${num(new Set(context.available.map(t=>t.manager)).size)} менеджеров · ${num(new Set(context.available.map(t=>t.rop)).size)} РОПов · ${num(context.catalog.length)} позиций в каталоге <span>в области выбранной роли</span></p></div></details>
      <div class="ds-filter-actions">${button('reset-all','Сбросить отборы','','ds-clear')}${button('close-filters','Показать результат','','ds-filter-done')}</div>
      </div></div>
      <div class="ds-categories" aria-label="Дистрибуция по категориям">${Object.entries(categories).map(([seg,name])=>{
        const d=distribution(scopePoints(),seg);
        return `<button class="ds-category ${context.seg===seg?'active':''}" data-dp="category" data-id="${seg}" aria-pressed="${context.seg===seg}">
          <span>${name}</span><strong>${d.percent==null?(d.known?'Нет мест':'Нет осмотра'):d.percent+'%'}</strong>
          <small>${d.known?`${d.ours} ${samplesText(d.ours)} из ${d.capacity} мест`:'Состав витрины ещё не внесён'}</small>
          <i class="ds-progress"><i style="width:${Math.min(100,d.percent??0)}%"></i></i>
          ${d.known<d.total&&d.known?`<small>Осмотрено ${d.known} из ${d.total} ТТ</small>`:''}</button>`;
      }).join('')}</div>
      <p class="ds-caption">Дистрибуция — доля наших образцов во всех обследованных местах выбранной области.</p>
      <div class="ds-heading"><div><h2>${state.drill?esc(state.drill.name):state.view==='compare'?'Где продаётся, а где нужна проверка':'Что стоит и как продаётся'}</h2><p>${zero?`${zero} без продаж · пары «модель × ТТ»`:'Сравните выставленные модели с их продажами'}</p></div>
      ${state.drill?button('back','← Назад к сравнению'):button('view',state.view==='compare'?'Показать все образцы':'Вернуться к сравнению','','ds-clear')}</div>
      <div class="ds-toolbar"><div class="ds-chips" aria-label="Фильтр продаж">${[['all','Все'],['none','Без продаж'],['sold','Есть продажи']].map(([v,t])=>`<button data-dp="filter" data-id="${v}" aria-pressed="${v===state.signal}">${t}</button>`).join('')}</div><input data-dp-field="q" type="search" aria-label="Найти модель, город или клиента" placeholder="Поиск по выборке" value="${esc(state.q)}"></div>
      <p class="ds-color-key"><span><i class="stale"></i>Давно без продаж</span><span><i class="none"></i>Нет продаж за период</span><span title="Демо: 1–2 полных месяца показа и от 10 дверей или 30 пар ручек в месяц"><i class="fast"></i>Хороший старт — расширить показ</span><span><i class="unknown"></i>Нет данных</span></p>
      <div id="ds-results">${results()}</div>
      ${missing.known<missing.total?'<p class="ds-footnote">Не по всем точкам внесён состав витрины. Отсутствие сведений не означает, что образцов или продаж нет.</p>':''}
      <p class="ds-footnote">Продажи после возвратов, только по выставленным моделям. Цифры учебные; 1С не подключена.</p>`;
  }
  function refresh() {
    const panel=document.getElementById('distribution-performance');if(!panel)return;
    const open=[...panel.querySelectorAll('[data-dp-picker][open]')].map(el=>el.dataset.dpPicker);
    panel.innerHTML=content();
    for(const id of open)panel.querySelector(`[data-dp-picker="${id}"]`)?.setAttribute('open','');
  }
  function detail(r) {
    const dialog=document.getElementById('dialog'),max=Math.max(1,...r.records.map(p=>p.units||0));
    const signal=attention(r);
    dialog.innerHTML=`<div class="ds-detail"><div class="ds-detail-top"><span class="ds-status ${signal.level}">${signal.text}</span>${button('close','Закрыть')}</div>
      <h2 id="ds-detail-title">${esc(r.model.name)}</h2><p class="ds-muted">${esc(r.t.clientName)} · ${esc(r.t.address)}</p>
      <div class="ds-detail-numbers"><div><span>На витрине</span><strong>${r.samples} ${unit(r.samples)}</strong></div><div><span>Продано за ${r.records.length} мес.</span><strong>${r.units==null?'Нет данных':`${num(r.units)} ${unit(r.units)}`}</strong></div></div>
      <h3>Продажи по месяцам</h3><div class="ds-chart">${r.records.map(p=>`<div><b>${p.units==null?'—':p.units}</b><i style="height:${Math.max(2,80*(p.units||0)/max)}px"></i><small>${p.label}</small></div>`).join('')}</div>
      <div class="ds-reason"><h3>${signal.level==='fast'?'Хорошо продаётся — где расширить показ?':r.status==='none'?'Почему может не продаваться':r.status==='unknown'?'Сначала уточним данные':r.status==='new'?'Образец недавно установлен':'Что важно поддерживать'}</h3>
      ${signal.level==='fast'?'<ul><li>Проверить наличие и сроки, чтобы поддержать продажи.</li><li>Найти похожие точки в городе или у других менеджеров, где модели ещё нет.</li><li>Согласовать пробную установку и проверить результат через месяц.</li></ul><p>Хороший старт — повод проверить масштабирование, а не обещание таких же продаж везде.</p><p class="ds-footnote">Правило демо: 1–2 полных месяца показа и от 10 дверей или 30 пар ручек в месяц. Порог можно настроить под категорию.</p>':
        r.status==='none'?'<ul><li>Есть ли модель в наличии и понятен ли срок доставки?</li><li>Конкурентна ли цена?</li><li>Хорошо ли виден образец и умеет ли продавец его предложить?</li></ul><p><b>Сначала проверить причины.</b> Если спроса нет даже после исправлений — обсудить замену образца.</p>':
        r.status==='unknown'?'<p>Нужны продажи именно этой модели и торговой точки. Пока данных нет, нельзя считать продажи нулевыми и предлагать замену.</p>':
        r.status==='new'?'<p>Витрина работает только с сентября. Проверить наличие и показ, затем оценить ещё один полный месяц. Сейчас менять образец рано.</p>':
        '<p>Следить за наличием, сроками доставки и состоянием образца, чтобы не терять продажи.</p>'}</div>
      <p class="ds-footnote">Демонстрационные данные. Продажи модели на ТТ не доказывают, что все заказы появились благодаря витрине.</p></div>`;
    dialog.setAttribute('aria-labelledby','ds-detail-title');dialog.showModal();
  }
  document.addEventListener('change',e=>{
    if(!e.target.closest('#distribution-performance'))return;
    state.page=1;
    if(e.target.hasAttribute('data-dp-client')){Object.assign(state,{q:'',signal:'all',city:'',managers:[],rops:[],drill:null,view:e.target.value?'list':'compare'});trail.length=0;context.navigate({level:e.target.value?'client':'all',object:e.target.value,q:'',city:'',fresh:'all'});return}
    if(e.target.hasAttribute('data-dp-point')){context.navigate({level:e.target.value?'tt':'client',object:e.target.value||context.clientId});return}
    if(e.target.dataset.dpMulti){
      const key=e.target.dataset.dpMulti;if(!['managers','rops'].includes(key))return;
      const allowed=context.points.map(t=>key==='managers'?t.manager:t.rop);
      if(!allowed.includes(e.target.value))return;
      state[key]=e.target.checked?[...new Set([...state[key],e.target.value])]:state[key].filter(v=>v!==e.target.value);state.drill=null;refresh();return;
    }
    const key=e.target.dataset.dpField,value=e.target.value;
    if(key==='period'&&['1','3','6'].includes(value)){state.period=value;refresh();return}
    if(key==='city'&&(!value||context.points.some(t=>t.city===value))){state.city=value;state.drill=null;refresh();return}
    if(key==='model'&&(!value||context.catalog.some(m=>m.seg===context.seg&&m.id===value))){state.model=value;state.drill=null;refresh();return}
    const allowed=['city','client','model',...(['rop','director'].includes(context.role)?['manager']:[]),...(context.role==='director'?['rop']:[])];
    if(key==='compare'&&allowed.includes(value)){state.compare=value;state.drill=null;state.view='compare';refresh()}
  });
  document.addEventListener('input',e=>{
    if(e.target.closest('#distribution-performance')&&e.target.hasAttribute('data-dp-people-search')){
      const q=e.target.value.toLowerCase();for(const label of e.target.parentElement.querySelectorAll('label'))label.hidden=!label.textContent.toLowerCase().includes(q);return;
    }
    if(e.target.closest('#distribution-performance')&&e.target.hasAttribute('data-dp-option-search')){
      const select=e.target.parentElement.querySelector('select'),q=e.target.value.toLowerCase();
      const values=e.target.dataset.dpOptionSearch==='client'?[...new Map(context.available.map(t=>[t.client,t.clientName]))]:context.catalog.filter(m=>m.seg===context.seg).map(m=>[m.id,m.name]);
      select.innerHTML=option('',e.target.dataset.dpOptionSearch==='client'?'Вся моя территория':'Вся категория',select.value)+values.filter(([id,name])=>id===select.value||name.toLowerCase().includes(q)).map(([id,name])=>option(id,name,select.value)).join('');return;
    }
    if(e.target.dataset.dpField!=='q'||!e.target.closest('#distribution-performance'))return;
    state.page=1;state.q=e.target.value;document.getElementById('ds-results').innerHTML=results();
  });
  document.addEventListener('click',e=>{
    const el=e.target.closest('[data-dp]');if(!el)return;
    const a=el.dataset.dp,id=el.dataset.id;
    if(a==='close'){document.getElementById('dialog').close();return}
    if(a==='toggle-filters'||a==='close-filters'){
      ui.filtersOpen=a==='toggle-filters'?!ui.filtersOpen:false;
      document.getElementById('ds-filter-panel').hidden=!ui.filtersOpen;
      const toggle=document.querySelector('[data-dp="toggle-filters"]');
      toggle.setAttribute('aria-expanded',String(ui.filtersOpen));
      toggle.querySelector('[aria-hidden]').textContent=ui.filtersOpen?'▴':'▾';
      if(!ui.filtersOpen)toggle.focus();return;
    }
    if(a==='reset-all'){
      Object.assign(state,{city:'',managers:[],rops:[],q:'',signal:'all',model:'',drill:null,page:1,view:'compare'});trail.length=0;
      if(context.clientId||context.pointId)context.navigate({level:'all',object:'',city:'',q:''});else refresh();return;
    }
    if(a==='scenario'&&['small','medium','large'].includes(id)){context.setScenario?.(id);return}
    if(a==='page'&&['-1','1'].includes(id)){state.page+=Number(id);document.getElementById('ds-results').innerHTML=results();document.getElementById('ds-results').scrollIntoView({block:'start'});return}
    if(!['back','detail','drill'].includes(a))state.page=1;
    if(a==='category'&&Object.hasOwn(categories,id)){state.q='';state.signal='all';state.model='';state.drill=null;trail.length=0;context.navigate({seg:id});return}
    if(a==='filter'&&['all','none','sold'].includes(id)){state.signal=id;refresh();return}
    if(a==='reset-scope'){Object.assign(state,{city:'',managers:[],rops:[],q:'',signal:'all',model:'',drill:null});trail.length=0;refresh();return}
    if(a==='view'){state.view=state.view==='compare'?'list':'compare';state.drill=null;refresh();return}
    if(a==='drill'){
      const g=groups().find(g=>g.id===id);if(!g)return;
      trail.push(structuredClone(state));state.page=1;state.drill={kind:state.compare,id,name:g.name};state.view='list';refresh();return;
    }
    if(a==='back'){const previous=trail.pop();if(previous)Object.assign(state,previous);else{state.drill=null;state.view='compare'}refresh();return}
    if(a==='detail'){const r=data().find(r=>r.key===id);if(r)detail(r)}
  });
  window.DistributionPerformance={
    render:ctx=>{
      context=ctx;const next=`${ctx.role||''}:${ctx.clientId}:${ctx.pointId||''}:${ctx.seg}`;
      if((ctx.scenario||'small')!==lastScenario){Object.assign(state,{q:'',signal:'all',city:'',managers:[],rops:[],model:'',compare:'city',view:ctx.clientId?'list':'compare',drill:null,page:1});trail.length=0;lastScenario=ctx.scenario||'small'}
      if(ctx.role!==lastRole){Object.assign(state,{city:'',managers:[],rops:[],model:'',compare:'city',view:ctx.clientId?'list':'compare',drill:null});trail.length=0;lastRole=ctx.role}
      if(next!==scopeKey){state.q='';state.signal='all';state.page=1;scopeKey=next}
      return `<section id="distribution-performance">${content()}</section>`;
    },distribution,summarize,attention,getRows:()=>context?data():[],getGroups:()=>context?groups():[],getState:()=>structuredClone(state)
  };
})();
