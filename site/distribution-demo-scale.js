/* Entirely fictional, deterministic demo scenarios. Never reads production. */
(() => {
  const presets={
    medium:{label:'Средне',clients:120,cities:12,managers:12,rops:3,models:90},
    large:{label:'Много',clients:2200,cities:40,managers:48,rops:6,models:600}
  };
  const cities=['Краснодар','Армавир','Майкоп','Ростов-на-Дону','Сочи','Новороссийск','Ставрополь','Анапа','Таганрог','Волгодонск','Тихорецк','Геленджик'];
  const cache=new Map();
  function get(key){
    if(!Object.hasOwn(presets,key))return null;
    if(cache.has(key))return cache.get(key);
    const config=presets[key],catalog=[],points=[];
    for(const seg of ['mk','vh','hw'])for(let i=0;i<config.models/3;i++)
      catalog.push({id:`S-${seg}-${i}`,seg,name:`${{mk:'Дверь Галант',vh:'Входная дверь Норд',hw:'Ручка Линия'}[seg]} ${String(i+1).padStart(3,'0')}`});
    const bySeg=Object.fromEntries(['mk','vh','hw'].map(seg=>[seg,catalog.filter(m=>m.seg===seg)]));
    for(let c=0;c<config.clients;c++)for(let p=0;p<2;p++){
      const manager=c%config.managers,rop=manager%config.rops;
      const fact={date:'2026-10-01',dates:{mk:'2026-10-01',vh:'2026-10-01',hw:'2026-10-01'},mk:{},vh:{},hw:{}};
      ['mk','vh','hw'].forEach((seg,si)=>{
        if((c*2+p)%41===40)return;
        const items=Array.from({length:4},(_,k)=>{
          const code=(c*17+p*7+k*3+si)%19;
          return {id:bySeg[seg][(c*7+p*11+k*13)%bySeg[seg].length].id,qty:1,
            demoAge:[4,5,6].includes(code)?1:code===8?2:6,
            demoCase:code===0?'missing':[1,2,3].includes(code)?'stale':[4,5].includes(code)?'fast':code===6?'slow':code===7?'paused':'steady'};
        });
        fact[seg].stand={cap:12+(c+p+si)%8,ours:4,other:5,unknown:1,restVerified:true,items};
      });
      points.push({id:`S-${key}-TT${c*2+p+1}`,client:`S-${key}-C${c+1}`,
        clientName:`Демо-клиент ${String(c+1).padStart(4,'0')}`,
        city:cities[c%config.cities]||`Демо-город ${c%config.cities+1}`,
        address:`Демонстрационная улица, ${c*2+p+1}`,closed:false,
        manager:manager===0?'Алексей Морозов':`Демо-менеджер ${String(manager+1).padStart(2,'0')}`,
        rop:rop===0?'Елена Волкова':`Демо-РОП ${String(rop+1).padStart(2,'0')}`,
        regional:manager===0?'Игорь Соколов':`Демо-региональный ${manager+1}`,fact});
    }
    const value={key,config,catalog,points};cache.set(key,value);return value;
  }
  window.DistributionDemoScale={get,presets};
})();
