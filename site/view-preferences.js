/* Prototype-only personal presentation preferences. Not authorization.
 * No browser storage: history state + a hash snapshot keep demo choices.
 * Production must use authenticated account IDs and server-side profiles. */
(function(root){
 'use strict';
 const validIds=xs=>Array.isArray(xs)?[...new Set(xs.filter(x=>typeof x==='string'&&/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/.test(x)))].slice(0,512):[];
 function createStore(initial=[]){
  const entries=new Map();
  const key=(user,entity)=>JSON.stringify([String(user).slice(0,128),entity==='outlets'?'outlets':'clients']);
  const clean=value=>Object.fromEntries(['columns','focusColumns','hiddenCard'].filter(k=>Array.isArray(value?.[k])).map(k=>[k,validIds(value[k])]));
  if(Array.isArray(initial))for(const entry of initial.slice(0,100)){if(Array.isArray(entry)&&typeof entry[0]==='string'&&entry[0].length<300)entries.set(entry[0],clean(entry[1]));}
  return{
   load(user,entity){const v=entries.get(key(user,entity));return v?clean(v):null},
   save(user,entity,patch){const k=key(user,entity),v={...entries.get(k),...clean(patch)};entries.set(k,v);return clean(v)},
   dump(){return [...entries].map(([k,v])=>[k,clean(v)])}
  };
 }
 function allowedColumns(saved,allowed,defaults){
  const ids=new Set(allowed),selected=(Array.isArray(saved)?saved:defaults).filter(id=>ids.has(id));
  return [...new Set(['clientName',...selected])].filter(id=>ids.has(id));
 }
 function readSnapshot(hash,historyEntries){
  if(Array.isArray(historyEntries))return createStore(historyEntries).dump();
  try{
   const text=new URLSearchParams(String(hash||'').split('?')[1]||'').get('viewPrefs');
   return text&&text.length<=64000?createStore(JSON.parse(text)).dump():[];
  }catch{return []}
 }
 const initialEntries=readSnapshot(root.location?.hash,root.history?.state?.personalViews);
 root.TandoorViewPreferences={version:'personal2',createStore,allowedColumns,validIds,readSnapshot,initialEntries};
})(typeof window!=='undefined'?window:globalThis);
