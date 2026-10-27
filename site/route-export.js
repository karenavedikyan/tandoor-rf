// Exports a snapshot of the visible, checked demonstration route. No external data transfer.
let routeExportBusy=false;
const routeLibraryPromises=new Map();
function routeExportControls(){return `<div class="route-export-buttons"><button data-route-export="xlsx" ${!routeReady()||routeExportBusy?'disabled':''}>Скачать Excel</button><button data-route-export="pdf" ${!routeReady()||routeExportBusy?'disabled':''}>Скачать PDF</button></div><p class="route-export-status small muted" role="status">Файлы содержат текущий порядок и пометку «Демонстрация».</p>`}
function mountRouteExports(){
 const b=document.querySelector('[data-route-preview]');
 if(b&&!b.parentElement.querySelector('[data-route-export]'))b.insertAdjacentHTML('afterend',routeExportControls());
}
function exportStatus(text,error=false){
 document.querySelectorAll('.route-export-status').forEach(el=>{el.textContent=text;el.style.color=error?'var(--bad)':'var(--muted)'});
}
function loadRouteLibrary(file,globalName){
 if(window[globalName])return Promise.resolve(window[globalName]);
 if(!routeLibraryPromises.has(file)){
  const p=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='./assets/'+file;s.onload=()=>window[globalName]?resolve(window[globalName]):reject(new Error('Библиотека не загрузилась'));s.onerror=()=>{s.remove();reject(new Error('Не удалось загрузить модуль. Проверьте соединение и повторите.'))};document.head.appendChild(s)});
  routeLibraryPromises.set(file,p.catch(e=>{routeLibraryPromises.delete(file);throw e}));
 }
 return routeLibraryPromises.get(file);
}
function downloadRouteBlob(blob,name){
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function routeFileName(d,ext){return `tandoor-route-demo-2026-09-28-v${d.version}.${ext}`}
async function exportRouteExcel(d){
 const ExcelJS=await loadRouteLibrary('exceljs.min.js','ExcelJS');
 const w=new ExcelJS.Workbook();w.creator='Perplexity Computer';w.title='Tandoor RF: маршрутный лист (демонстрация)';w.calcProperties.fullCalcOnLoad=true;
 const s=w.addWorksheet('Маршрут',{views:[{state:'frozen',xSplit:2,ySplit:7}],pageSetup:{paperSize:8,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:.25,right:.25,top:.35,bottom:.35,header:.1,footer:.1}}});
 [3,5,25,32,15,24,19,11,11,28,34].forEach((v,i)=>s.getColumn(i+1).width=v);
 function merged(row,text,bold=false,size=11){s.mergeCells(row,2,row,11);const c=s.getCell(row,2);c.value=text;c.font={name:'Calibri',size,bold,color:{argb:'FF263039'}};c.alignment={vertical:'middle',wrapText:true};s.getRow(row).height=row===2?30:28}
 merged(2,'TANDOOR RF · МАРШРУТНЫЙ ЛИСТ',true,18);
 merged(3,`28.09.2026 · Учебная машина 001 · Водитель: Иван Петров · Менеджер: Алексей Морозов · Версия ${d.version}`,true);
 merged(4,'ДЕМОНСТРАЦИЯ. Адреса и контакты вымышлены. Не использовать для реальной доставки.');
 merged(5,'Пример снимка 1С: 09:35. Сверка отмечена в макете. Ничего не отправлено в 1С, MAX или водителю.');
 const headers=['№','Клиент / место','Адрес доставки','Окно приёмки','Контакт (пример)','Реализации','Вес, кг','Объём, м³','Инструкция','Документы / возвраты'];
 headers.forEach((h,i)=>{const c=s.getCell(7,i+2);c.value=h;c.font={name:'Calibri',bold:true,size:11,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF507F22'}};c.alignment={wrapText:true,vertical:'middle',horizontal:'center'}});
 s.getRow(7).height=32;
 d.stops.forEach((stop,i)=>{
  const row=8+i,values=[i+1,stop.name,`${stop.city}, ${stop.address}`,stop.window,`${stop.contact}\nТелефон не указан`,stop.docs,stop.weight,stop.volume,stop.hint,stop.action];
  values.forEach((v,j)=>{const c=s.getCell(row,j+2);c.value=v;c.font={name:'Calibri',size:11,color:{argb:'FF263039'}};c.alignment={wrapText:true,vertical:'top',horizontal:j===0?'center':j===6||j===7?'right':'left'};c.border={bottom:{style:'thin',color:{argb:'FFDCE2E4'}}}});
  s.getCell(row,8).numFmt='#,##0';s.getCell(row,9).numFmt='0.0';s.getRow(row).height=78;
 });
 const last=7+d.stops.length,total=last+1;
 s.getCell(total,3).value='ИТОГО';
 s.getCell(total,8).value={formula:`SUM(H8:H${last})`,result:d.stops.reduce((a,v)=>a+v.weight,0)};
 s.getCell(total,9).value={formula:`SUM(I8:I${last})`,result:Math.round(d.stops.reduce((a,v)=>a+v.volume,0)*10)/10};
 s.getCell(total,8).numFmt='#,##0';s.getCell(total,9).numFmt='0.0';
 for(let j=2;j<=11;j++){s.getCell(total,j).font={name:'Calibri',bold:true,size:11};s.getCell(total,j).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEEF5E7'}}}
 s.getRow(total).height=25;
 merged(total+2,'Перед выездом нужны проверенные телефоны. Порядок посещения не является порядком погрузки.');
 merged(total+3,'Погрузка: 1С. Оперативные согласования склада: MAX. Оптимальный маршрут, пробег и время пути не рассчитывались.');
 merged(total+4,'Приём денег водителем не уточнён: поручения по сбору оплаты в этот макет не включены.');
 s.autoFilter=`B7:K${last}`;s.pageSetup.printArea=`B2:K${total+4}`;s.pageSetup.printTitlesRow='1:7';
 s.headerFooter.oddFooter='&LДемонстрация · Tandoor RF&RСтраница &P из &N';
 return new Blob([await w.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
const routeFontCache=new Map();
async function routeFont(file){
 if(!routeFontCache.has(file)){
  const p=(async()=>{const r=await fetch('./assets/'+file);if(!r.ok)throw new Error('Не удалось загрузить шрифт PDF. Повторите попытку.');const a=new Uint8Array(await r.arrayBuffer());let s='';for(let i=0;i<a.length;i+=16384)s+=String.fromCharCode(...a.subarray(i,i+16384));return btoa(s)})();
  routeFontCache.set(file,p.catch(e=>{routeFontCache.delete(file);throw e}));
 }
 return routeFontCache.get(file);
}
async function exportRoutePDF(d){
 const lib=await loadRouteLibrary('jspdf.umd.min.js','jspdf');
 const doc=new lib.jsPDF({unit:'pt',format:'a4',compress:true,putOnlyUsedFonts:true});
 for(const [f,style] of [['export-regular.ttf','normal'],['export-bold.ttf','bold']]){doc.addFileToVFS(f,await routeFont(f));doc.addFont(f,'Noto',style)}
 doc.setProperties({title:'Tandoor RF: маршрутный лист (демонстрация)',author:'Perplexity Computer',subject:`Учебный рейс 28.09.2026, версия ${d.version}`});
 const margin=32,width=doc.internal.pageSize.getWidth(),inner=width-2*margin;
 function text(t,x,y,size=10,bold=false,color=[38,48,57]){doc.setFont('Noto',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);doc.text(t,x,y)}
 function lines(t,w,size=10,bold=false){doc.setFont('Noto',bold?'bold':'normal');doc.setFontSize(size);return doc.splitTextToSize(t,w)}
 function header(continued=false){text('TANDOOR RF',margin,37,11,true,[80,127,34]);text('Маршрутный лист'+(continued?' · продолжение':''),margin,63,19,true);text(`28.09.2026 · Учебная машина 001 · Версия ${d.version}`,margin,85,10);text('Водитель: Иван Петров · Менеджер: Алексей Морозов',margin,102,10);doc.setFillColor(255,244,223);doc.rect(margin,113,inner,30,'F');text('ДЕМОНСТРАЦИЯ. Не использовать для реальной доставки.',margin+10,132,9,true,[120,81,20]);return 163}
 let y=header();
 for(const [i,stop] of d.stops.entries()){
  const body=[
   `${stop.city}, ${stop.address}`,
   `Контакт: ${stop.contact}. Телефон не указан.`,
   `Реализации: ${stop.docs} · ${stop.weight} кг · ${stop.volume.toLocaleString('ru')} м³`,
   `Инструкция: ${stop.hint}`,
   `Поручение: ${stop.action}`
  ].map(t=>lines(t,inner-24));
  const title=lines(`${i+1}. ${stop.name}`,inner-142,11,true);
  const h=20+title.length*14+body.reduce((a,l)=>a+l.length*13,0)+10;
  if(y+h>720){doc.addPage();y=header(true)}
  doc.setDrawColor(215,222,223);doc.setFillColor(249,250,248);doc.roundedRect(margin,y-9,inner,h,5,5,'FD');
  text(title,margin+12,y+8,11,true);doc.setFontSize(10);const timeX=width-margin-12-doc.getTextWidth(stop.window);text(stop.window,timeX,y+8,10,true,[80,127,34]);
  let yy=y+8+title.length*14+6;
  for(const ls of body){text(ls,margin+12,yy,10);yy+=ls.length*13}
  y+=h+8;
 }
 if(y+60>774){doc.addPage();y=header(true)}
 const kg=d.stops.reduce((a,s)=>a+s.weight,0),vol=d.stops.reduce((a,s)=>a+s.volume,0);
 text(`Итого: ${d.stops.length} остановки · ${kg} кг · ${vol.toLocaleString('ru',{maximumFractionDigits:1})} м³`,margin,y+6,10,true);
 text(lines('Перед выездом нужны проверенные телефоны. Пробег и время пути не рассчитаны. Порядок посещения не является порядком погрузки.',inner,9),margin,y+24,9,false,[97,110,120]);
 for(let n=1;n<=doc.getNumberOfPages();n++){doc.setPage(n);text(`Данные вымышлены · Снимок 1С 09:35 (пример) · Лист ${n} / ${doc.getNumberOfPages()}`,margin,814,8,false,[97,110,120])}
 return doc.output('blob');
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-route-preview')&&routeReady()){
  const ds=document.querySelector('#dialog .driver-stops');if(ds)ds.insertAdjacentHTML('beforebegin',routeExportControls());
 }
 const kind=b.dataset.routeExport;if(!kind||routeExportBusy)return;
 if(!routeReady()){exportStatus('Сначала завершите сверку маршрутного листа.',true);return}
 const snapshot=JSON.parse(JSON.stringify(routeDemo));
 routeExportBusy=true;document.querySelectorAll('[data-route-export]').forEach(x=>x.disabled=true);
 exportStatus(`Формируется ${kind==='xlsx'?'Excel':'PDF'} · версия ${snapshot.version}…`);
 try{
  const blob=kind==='xlsx'?await exportRouteExcel(snapshot):await exportRoutePDF(snapshot);
  downloadRouteBlob(blob,routeFileName(snapshot,kind));
  exportStatus(`Файл версии ${snapshot.version} сформирован. Скачивание запрошено в браузере.`);
 }catch(err){console.error('Route export failed',err);exportStatus(err.message||'Выгрузка не удалась. Попробуйте ещё раз.',true)}
 finally{routeExportBusy=false;document.querySelectorAll('[data-route-export]').forEach(x=>x.disabled=!routeReady())}
});
