/* Progressive disclosure of existing demo card content; no API or business writes. */
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>Number.isFinite(v)?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(v):'Нет данных из 1С';
 const action=(text,tab)=>`<button type="button" data-x6="card-tab" data-value="${tab}">${esc(text)} →</button>`;
 function fold(title,nodes,cls=''){
  const d=document.createElement('details');d.className='f20-fold '+cls;
  const s=document.createElement('summary');s.textContent=title;d.append(s);
  const body=document.createElement('div');body.className='f20-fold-body';
  nodes.filter(Boolean).forEach(n=>body.append(n));d.append(body);return d;
 }
 function wrap(node,title,cls=''){
  const parent=node.parentNode,next=node.nextSibling,d=fold(title,[node],cls);
  parent.insertBefore(d,next);
 }
 function apply({target,record,legals,outlets,hidden}){
  const panel=target.querySelector('.m14-panel'),facts=panel?.querySelector('.m14-facts');
  if(!facts||facts.classList.contains('f20-primary'))return;
  target.querySelector('.x13')?.classList.add('f20-focus-card');
  const old=[...facts.children],[sales,conversion,debt,...staticFacts]=old;
  const salesGroup=document.createElement('div');salesGroup.className='f20-sales-group';
  salesGroup.append(sales,conversion);conversion.classList.add('f20-conversion-mini');
  salesGroup.hidden=hidden('salesRub')&&hidden('conversionPct');
  const distribution=document.createElement('div');distribution.className='f20-distribution';
  distribution.innerHTML=`<dt>Дистрибуция</dt><dd class="f20-distribution-rows">${['Входные двери','Межкомнатные двери','Фурнитура'].map(n=>`<span><span>${n}</span><span aria-label="Нет данных из 1С">—</span></span>`).join('')}</dd><small>В демо не подключены данные по категориям из 1С</small>${action('Открыть дистрибуцию','display')}`;
  const summary=root.TandoorFinanceDisplay.debtSummary(legals),alert=document.createElement('div');
  alert.className='f20-debt-alert';alert.innerHTML=`<span>${summary.overdue===null?'Просрочка не определена':summary.overdue>0?'Просрочено':'Просрочки нет'}</span><strong class="${summary.overdue>0?'f20-negative':''}">${summary.overdue===null?'Нужны сроки из 1С':money(summary.overdue)}</strong>`;
  debt.querySelector('dd')?.after(alert);debt.insertAdjacentHTML('beforeend',action('Юрлица и сроки','finance'));
  facts.replaceChildren(salesGroup,distribution,debt);facts.classList.add('f20-primary');
  panel.querySelector('header h3').textContent='Главное по клиенту';
  const badge=panel.querySelector('header .m14-demo');if(badge)badge.textContent='Демо-данные';
  const table=panel.querySelector('.m14-table-scroll');if(table)panel.append(fold('Продажи и конверсия по юрлицам',[table]));
  const debtPanel=panel.querySelector('.d19-card-panel');if(debtPanel)panel.append(fold('Дебиторка по юрлицам и сроки',[debtPanel],'f20-debt-details'));
  const staticDl=document.createElement('dl');staticDl.className='f20-static-facts';staticFacts.forEach(n=>staticDl.append(n));
  const shipping=panel.querySelector('.m14-shipping'),notes=[...panel.querySelectorAll(':scope>.m14-note')].filter(n=>!n.textContent.startsWith('Продажи и долг связаны'));
  panel.append(fold('Отгрузка и пояснения',[staticDl,shipping,...notes],'f20-shipping-details'));
  const grid=target.querySelector('.x13-card-grid'),contact=grid?.firstElementChild,points=grid?.lastElementChild;
  if(contact){
   const lprs=document.createElement('div');lprs.className='f20-lprs';
   const scoped=record.outletId?[record]:outlets;
   lprs.innerHTML=scoped.length?scoped.map(o=>`<div><span class="f20-contact-point" data-personal-field="storeAddress">${esc(o.storeAddress||'Адрес не передан')}</span><strong data-personal-field="lprName">${esc(o.lprName||'ЛПР не передан из 1С')}</strong><span data-personal-field="lprPost">${esc(o.lprPost||'Должность не передана')}</span><span data-personal-field="lprPhone">${esc(o.lprPhone||'Телефон не передан из 1С')}</span><span data-personal-field="lprEmail">${esc(o.lprEmail||'Email не передан из 1С')}</span></div>`).join(''):'<p>Нет доступных ТТ с контактами ЛПР</p>';
   contact.append(lprs);const contactFold=fold('Контакты и ЛПР',[contact],'f20-contact-details');contactFold.id='f20-contacts';grid.before(contactFold);
   if(points)grid.before(fold(`Торговые точки · ${outlets.length}`,[points],'f20-points-details'));grid.remove();
  }
  const responsibility=target.querySelector('.x6-responsibilities');if(responsibility)wrap(responsibility,'Ответственные');
  const legal=target.querySelector('.x7-legals');if(legal){wrap(legal,`Юрлица и договоры · ${legals.length}`,'f20-legal-details');target.querySelector('.f20-legal-details').id='f20-legal'}
  const kpis=target.querySelector('.x13-kpis');if(kpis)kpis.classList.add('f20-static-kpis');
  const archive=target.querySelector('[data-demo-scale]');if(archive){wrap(archive,'О макете и демонстрационных данных','f20-demo-notice');target.querySelector('.x13')?.append(target.querySelector('.f20-demo-notice'))}
  const nav=target.querySelector('.x13-card-tabs');
  if(nav){['overview','sales','display','finance','data'].reverse().forEach(id=>{const b=nav.querySelector(`[data-value="${id}"]`);if(b)nav.prepend(b)});nav.querySelectorAll('button').forEach(b=>b.classList.toggle('f20-secondary-tab',!['overview','sales','display','finance','data'].includes(b.dataset.value)))}
  target.querySelector('.x17-card-settings')?.insertAdjacentHTML('afterbegin',`<button type="button" data-x6="focus-detail" data-value="f20-contacts" aria-controls="f20-contacts">Контакты и ЛПР</button><button type="button" data-x6="focus-detail" data-value="f20-legal" aria-controls="f20-legal">Юрлица · ${legals.length}</button>`);
  target.querySelectorAll('[data-personal-field]').forEach(el=>el.hidden=hidden(el.dataset.personalField));
 }
 root.TandoorCardFocus={version:'focus1',apply};
})(window);
