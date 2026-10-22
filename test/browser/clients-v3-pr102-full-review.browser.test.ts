import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { before, after, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { Pool } from "pg";
import { closePool, resetPoolForTests } from "../../src/db/pool";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "../helpers/onec-clients-employee-roster-fixtures";
import { prepareDatabase, setIntegrationEnv, getIntegrationDatabaseUrl, createTestUser } from "../helpers/test-db";
import { linkUserToEmployee } from "../helpers/access-db-fixtures";
import { parseWholesaleEmployeeRosterBytes } from "../../src/onec-clients/employee-roster";
import { applyAuthoritativeWholesaleOrgSnapshot } from "../../src/onec-clients/roster-authoritative-org";

const M1="22222222-2222-4222-8222-222222222222", M2="33333333-3333-4333-8333-333333333333";
const REG="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ROP="55555555-5555-4555-8555-555555555555";
const TEAM="ab000000-0000-4000-8000-000000000001", DIR="dd000000-0000-4000-8000-000000000001";
const ASSIST="99000000-0000-4000-8000-000000000001";
const TYPES=["ee000000-0000-4000-8000-000000000150","ee000000-0000-4000-8000-000000000350","ee000000-0000-4000-8000-000000000500"];
const CAT="ee000000-0000-4000-8000-000000000999";
const PW="SyntheticOnly102!"; const TOP="#v3-focus-filter-category_name-enum";
const OUT=process.env.PR102_QA_DIR || "/home/user/workspace/pr102-full-qa";
const LIST="/clients?v3mode=1&v3entity=legal_grouped&view=all&v3view=all&v3focus=1";
const failures:string[]=[];

describe("PR102 independent full matrix", {concurrency:false}, () => {
  let browser:Browser, server:http.Server, base:string, db:string;
  const userIds:Record<string,string>={};
  const sessions=new Map<string,any>();
  const traces=new WeakMap<Page,string[]>();
  before(async()=>{
    fs.mkdirSync(OUT,{recursive:true});
    db=getIntegrationDatabaseUrl(); setIntegrationEnv(db,"http://127.0.0.1:0");
    await resetPoolForTests(); await prepareDatabase(db);
    const fixture=JSON.parse(fs.readFileSync("test/fixtures/onec-exchange-v3/all_clients.json","utf8"));
    const retailTemplate=JSON.parse(fs.readFileSync("test/fixtures/onec-exchange-v3/all_retail.json","utf8"))[0];
    const holdings:any[]=[], clients:any[]=[], retail:any[]=[];
    for(let i=0;i<9;i++){
      const holding=`a1000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`;
      const client=`b2000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`;
      const manager=i<6?M1:M2;
      const tc={guid_type:TYPES[i%3],name_type:["ТОП150","ТОП350","ТОП500"][i%3],guid_category:CAT,name_category:"Категория НЕ ТОП"};
      holdings.push({guid_holding:holding,name_holding:`QA Holding ${i}`,type_category:tc,managers:{guid_manager:manager,name_manager:manager===M1?"QA Manager One":"QA Foreign"},legal_entities:[],retail_outlets:[]});
      clients.push({...fixture[0],guid_client:client,name_client:`QA Legal ${i}`,guid_holding:holding,name_holding:`QA Holding ${i}`,type_category:tc,guid_manager:manager,name_manager:manager===M1?"QA Manager One":"QA Foreign",guid_regional_manager:i<6?REG:"",name_regional_manager:i<6?"QA Regional":"",guid_head_of_the_sales_department:i<6?ROP:"",name_head_of_the_sales_department:i<6?"QA ROP":"",other:{"Оптовик_КрайГород":i<6?"QA City":"Foreign City","Кредитный лимит":1000+i}});
      for(let j=0;j<8;j++) retail.push({...retailTemplate,guid_store:`c3000000-0000-4000-8000-${String(i*8+j+1).padStart(12,"0")}`,guid_holding:holding,type_category:tc,address:{store_address:"SAME ADDRESS",city:i<6?"QA City":"Foreign City"},managers:{guid_manager:manager,name_manager:manager===M1?"QA Manager One":"QA Foreign",guid_regional_manager:i<6?REG:"",name_regional_manager:i<6?"QA Regional":"",guid_head_of_the_sales_department:i<6?ROP:"",name_head_of_the_sales_department:i<6?"QA ROP":""}});
    }
    const member={guid_team:TEAM,name_team:"QA Team",guid_team_leader:ROP,name_team_leader:"QA ROP"};
    const roster=buildEmployeeRosterBytes([
      buildEmployeeRosterEntry(M1,{name_manager:"QA Manager One",...member}),
      buildEmployeeRosterEntry(M2,{name_manager:"QA Foreign",guid_team:"ab000000-0000-4000-8000-000000000002",name_team:"Foreign Team",guid_team_leader:M2,name_team_leader:"QA Foreign"}),
      buildEmployeeRosterEntry(REG,{name_manager:"QA Regional",post:"Региональный менеджер",...member}),
      buildEmployeeRosterEntry(ROP,{name_manager:"QA ROP",post:"Руководитель отдела продаж",...member}),
      buildEmployeeRosterEntry(DIR,{name_manager:"QA Director",post:"Директор",guid_team:"",name_team:"",guid_team_leader:"",name_team_leader:""}),
      buildEmployeeRosterEntry(ASSIST,{name_manager:"QA Assistant",...member}),
    ]);
    const args={env:{...process.env,DATABASE_URL:db},holdingsBytes:Buffer.from(JSON.stringify(holdings)),clientsBytes:Buffer.from(JSON.stringify(clients)),retailBytes:Buffer.from(JSON.stringify(retail)),employeesBytes:roster};
    const dry=await runExchangeV3RegularUpdate({...args,argv:["--dry-run"]}); assert.equal(dry.status,"SUCCESS");
    const applied=await runExchangeV3RegularUpdate({...args,argv:["--apply","--expected-fingerprint",dry.verificationFingerprint!]}); assert.equal(applied.status,"SUCCESS");
    const parsed=parseWholesaleEmployeeRosterBytes(roster); assert.ok(parsed.ok); if(!parsed.ok)throw Error("roster");
    const pool=new Pool({connectionString:db,max:1}); const client=await pool.connect();
    try {await client.query("BEGIN");await applyAuthoritativeWholesaleOrgSnapshot(client,parsed.roster);await client.query("INSERT INTO onec_wholesale_roster_state(id,source_sha256,employee_count,imported_at) VALUES(1,$1,$2,NOW()) ON CONFLICT(id) DO UPDATE SET source_sha256=EXCLUDED.source_sha256,employee_count=EXCLUDED.employee_count,imported_at=NOW()",[parsed.roster.sourceSha256,6]);await client.query("COMMIT");}finally{client.release();await pool.end();}
    const admin=await createTestUser({databaseUrl:db,email:"qa-admin@example.test",password:PW,fullName:"QA Admin",role:"admin"});
    userIds.admin=admin.id;
    for(const [key,role,employee] of [["manager","manager",M1],["regional","regional_manager",REG],["rop","rop",ROP],["director","director",DIR],["foreign","manager",M2],["unlinked","manager",null],["assistant","assistant",ASSIST],...["marketer","analyst","category_manager","coordinator"].map(r=>[r,r,null])]){
      const user=await createTestUser({databaseUrl:db,email:`qa-${key}@example.test`,password:PW,fullName:`QA ${key}`,role:role!});
      userIds[key!]=user.id;
      if(employee)await linkUserToEmployee({databaseUrl:db,userId:user.id,employeeId:employee,confirmedByUserId:admin.id});
    }
    browser=await chromium.launch({headless:true});
    const {createApp}=await import("../../src/server");server=http.createServer(createApp());
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const addr=server.address();assert.ok(addr&&typeof addr==="object");base=`http://127.0.0.1:${addr.port}`;setIntegrationEnv(db,base);
  });
  after(async()=>{await browser?.close(); if(server)await new Promise<void>(r=>server.close(()=>r())); await closePool();fs.writeFileSync(path.join(OUT,"page-errors.json"),JSON.stringify(failures,null,2));assert.deepEqual(failures,[],"no unexpected page exceptions");});
  async function pageFor(role="admin", mobile=false){
    const p=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},...(sessions.has(role)?{storageState:sessions.get(role)}:{})});
    traces.set(p,[]);p.on("request",r=>{if(r.url().includes("/api/clients/v3/list")){const t=traces.get(p)!;t.push(r.url());if(t.length>15)t.shift();}});
    p.setDefaultTimeout(10000);p.on("pageerror",e=>failures.push(JSON.stringify({role,url:p.url(),message:e.message,stack:e.stack})));
    if(sessions.has(role))return p;
    await p.goto(base+"/login");await p.fill("#email",`qa-${role}@example.test`);await p.fill("#password",PW);await p.click("#login-button");await p.waitForURL(u=>u.pathname!=="/login");
    const auth=await p.context().storageState();sessions.set(role,{cookies:auth.cookies,origins:[]});
    return p;
  }
  async function open(p:Page, url=LIST){
    const res=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&r.status()===200); await p.goto(base+url.replace("&v3focus=1",""));await res;
    await p.waitForLoadState("networkidle");
    const focused=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&r.status()===200);await p.locator('[data-testid="v3-focus-enter"]:visible').click();await focused;
    await p.locator('[data-testid="v3-focus-root"]').waitFor({state:"visible"});await p.locator(TOP).waitFor({state:"visible"});
    await p.waitForLoadState("networkidle");
  }
  async function select(p:Page, value:string, expected:number){
    const options=await p.locator(TOP+" option").evaluateAll(els=>els.map(el=>({value:(el as HTMLOptionElement).value,label:el.textContent})));
    assert.ok(options.some(o=>o.value===value),JSON.stringify({missing:value,options,url:p.url()}));
    const response=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&r.status()===200&&(value?decodeURIComponent(r.url()).includes(value):!TYPES.some(t=>decodeURIComponent(r.url()).includes(t))));
    await p.locator(TOP).selectOption(value);let matched;try{matched=await response;}catch(error){console.log("SELECT DIAGNOSTIC",JSON.stringify({value,url:p.url(),requests:traces.get(p),state:await p.evaluate(()=>window.ClientsV3.readState())}));throw error;}const data=await matched.json();assert.equal(data.total,expected);
    await p.waitForFunction(({s,v})=>(document.querySelector(s)as HTMLSelectElement)?.value===v,{s:TOP,v:value});
    await p.locator('[data-testid="v3-focus-root"] tbody tr').first().waitFor();return data;
  }
  async function noError(p:Page){assert.equal(await p.locator('[data-testid="v3-focus-error"]').count(),0);assert.ok(await p.locator("#v3-focus-exit").isVisible());}
  it("pending search draft survives metadata repaint and continued native typing",async()=>{
    const p=await pageFor();let release!:()=>void,seen!:()=>void;const gate=new Promise<void>(r=>release=r),arrived=new Promise<void>(r=>seen=r);
    await p.route("**/api/clients/v3/options?*",async route=>{const res=await route.fetch();seen();await gate;await route.fulfill({response:res});});
    await p.goto(base+LIST);await p.locator('[data-testid="v3-focus-root"] tbody a.clients-link:visible').first().waitFor();await arrived;
    await p.locator("#v3-focus-search").fill("QA Leg");const late=p.waitForResponse(r=>r.url().includes("/api/clients/v3/options"));release();await(await late).finished();
    await p.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
    assert.equal(await p.locator("#v3-focus-search").inputValue(),"QA Leg","uncommitted draft retained during options update");
    const result=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&new URL(r.url()).searchParams.get("q")==="QA Legal 0");
    await p.locator("#v3-focus-search").pressSequentially("al 0");assert.equal((await(await result).json()).total,1);await p.close();
  });

  it("direct fullscreen bookmark: slow options must populate TOP choices",async()=>{
    const p=await pageFor();
    await p.route("**/api/clients/v3/options?*",async route=>{const res=await route.fetch();await new Promise(r=>setTimeout(r,500));await route.fulfill({response:res});});
    await p.goto(base+LIST);await p.waitForLoadState("networkidle");
    const actual=await p.request.get(base+"/api/clients/v3/options?entity=legal_grouped");const api=await actual.json();
    const values=await p.locator(TOP+" option").evaluateAll(els=>els.map(el=>(el as HTMLOptionElement).value));
    console.log("direct bookmark options",JSON.stringify({apiTypes:api.types?.length,domValues:values,cache:await p.evaluate(()=>window.__lktandoorFilterOptions?.types?.length)}));
    assert.ok(TYPES.every(t=>values.includes(t)),"TOP choices absent after successful delayed options response");
    await select(p,TYPES[0],3);
    await p.close();
  });
  it("cold fullscreen bookmark: Esc exits without missing context/page exception",async()=>{
    const p=await pageFor();await p.goto(base+LIST);await p.locator("#v3-focus-exit").waitFor({state:"visible"});await p.waitForLoadState("networkidle");
    await p.keyboard.press("Escape");await p.waitForFunction(()=>!document.body.classList.contains("x14-focus-mode"));await p.close();
  });
  it("options500: explicit recoverable error, never pretend empty successful TOP options",async()=>{
    const p=await pageFor();
    const handler=async(route:any)=>route.fulfill({status:500,contentType:"application/json",body:JSON.stringify({error:"Synthetic metadata failure"})});
    await p.route("**/api/clients/v3/options?*",handler);await p.goto(base+LIST);await p.waitForLoadState("networkidle");
    await p.locator("#v3-focus-exit").waitFor({state:"visible"});
    const hasError=await p.locator('[data-testid="v3-focus-error"]').count();
    assert.ok(hasError>0 || ((await p.locator(TOP).isDisabled())&&/не удалось|недоступ|ошиб/i.test(await p.locator('[data-testid="v3-focus-root"]').innerText())),"metadata failure must not masquerade as successful 'Все' only");
    await p.unroute("**/api/clients/v3/options?*",handler);await p.locator("#v3-focus-exit").click();await p.waitForFunction(()=>!document.body.classList.contains("x14-focus-mode"));await p.close();
  });
  for(const [role,total,perTop] of [["admin",9,3],["director",9,3],["rop",6,2],["regional",6,2],["manager",6,2],["foreign",3,1]] as const){
    it(`${role}: TOP150/350/500/all, own scope and no foreign rows`,async()=>{
      const p=await pageFor(role);await open(p);
      for(const type of TYPES){const data=await select(p,type,perTop); for(const item of data.items) {assert.ok(item.type_name?.includes("ТОП"),"actual type not category");if(["manager","rop","regional","foreign"].includes(role)){const own=role==="foreign"?[7,8,9]:[1,2,3,4,5,6];assert.ok(item.legal_entities.length>0);for(const legal of item.legal_entities)assert.ok(own.some(n=>String(legal.guid||legal.guid_client).toLowerCase()===`b2000000-0000-4000-8000-${String(n).padStart(12,"0")}`),"no foreign legal GUID in scoped group");}}}
      await select(p,"",total);await noError(p);await p.close();
    });
  }
  it("unlinked user: denied by server, no foreign data in list",async()=>{
    const p=await pageFor("unlinked");
    const response=await p.request.get(base+"/api/clients/v3/list?entity=legal_grouped&page=1&pageSize=50");const data=await response.json();
    assert.ok(response.status()===403 || (response.status()===200&&data.total===0));await p.close();
  });
  it("non-client roles cannot read list",async()=>{
    for(const role of ["marketer","analyst","category_manager","coordinator"]){const p=await pageFor(role);const r=await p.request.get(base+"/api/clients/v3/list?entity=legal_grouped");assert.equal(r.status(),403,role);await p.close();}
  });
  it("assistant: no delegation gives no clients; active grant shows only one client and TOP",async()=>{
    let p=await pageFor("assistant");let r=await p.request.get(base+"/api/clients/v3/list?entity=legal_grouped");let data=await r.json();assert.ok(r.status()===403||(r.status()===200&&data.total===0));await p.close();
    const pool=new Pool({connectionString:db,max:1});try{const grant=await pool.query("INSERT INTO delegations(delegator_user_id,assistant_user_id,status,starts_at,ends_at,approved_by_user_id,approved_at) VALUES($1,$2,'active',NOW()-INTERVAL '1 hour',NOW()+INTERVAL '1 day',$3,NOW()) RETURNING id",[userIds.manager,userIds.assistant,userIds.admin]);await pool.query("INSERT INTO delegation_clients(delegation_id,guid_client) VALUES($1,$2)",[grant.rows[0].id,"b2000000-0000-4000-8000-000000000001"]);}finally{await pool.end();}
    p=await pageFor("assistant");await open(p);data=await select(p,TYPES[0],1);assert.ok(data.items.every((row:any)=>row.legal_entities.length===1&&String(row.legal_entities[0].guid||row.legal_entities[0].guid_client).toLowerCase()==="b2000000-0000-4000-8000-000000000001"));r=await p.request.get(base+`/api/clients/v3/list?entity=legal_grouped&managerGuid=${M2}`);data=await r.json();assert.ok(r.status()===403||(r.status()===200&&data.total===0));await noError(p);await p.close();
  });
  for(const role of ["admin","rop"]){
    it(`${role}: selected team/member + city + TOP; reset preserves territory`,async()=>{
      const p=await pageFor(role);
      const territory=LIST.replace("view=all&v3view=all","view=teams&v3view=teams")+`&ropEmployee=${ROP}&orgTeamGuid=${TEAM}&responsibleGuid=${M1}&responsibleKind=manager&teamKind=manager&v3manager=${M1}`;
      await open(p,territory);await select(p,TYPES[1],2);
      await p.locator("#v3-focus-columns").click();const changed=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&r.status()===200);await p.locator('#v3-lktandoor-columns-dialog input[data-v3-column-id="city"]').check();await changed;await p.locator("#v3-columns-done").click();
      const city=p.locator("#v3-focus-filter-city-text");
      await city.waitFor({state:"visible"});
      const cityResponse=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&r.status()===200);await city.fill("Foreign City");const cityResult=await cityResponse;assert.equal((await cityResult.json()).total,0,"city intersects selected team/member, never widens it");
      const response=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&r.status()===200);await p.locator("#v3-focus-reset").click();const data=await(await response).json();assert.equal(data.total,6);
      const u=new URL(p.url());assert.equal(u.searchParams.get("orgTeamGuid"),TEAM);assert.equal(u.searchParams.get("responsibleGuid"),M1);assert.equal(u.searchParams.get("ropEmployee"),ROP);await noError(p);await p.close();
    });
  }
  it("manager cannot widen scope by URL responsible/team spoof",async()=>{
    const p=await pageFor("manager");
    for(const tail of [`&responsibleGuid=${M2}&responsibleKind=manager`,`&managerGuid=${M2}`,`&ropBranchGuid=${M2}`]){
      const r=await p.request.get(base+"/api/clients/v3/list?entity=legal_grouped&page=1&pageSize=50"+tail);
      const d=await r.json();assert.ok(r.status()===403||r.status()===200);if(r.status()===200)for(const row of d.items)for(const legal of row.legal_entities)assert.ok([1,2,3,4,5,6].some(n=>String(legal.guid||legal.guid_client).toLowerCase()===`b2000000-0000-4000-8000-${String(n).padStart(12,"0")}`),"foreign scope leak");
    }
    await p.close();
  });
  for(const mobile of [false,true]){
    it(`${mobile?"mobile390":"desktop"}: visible controls, empty200 reset, columns, Esc and card Back`,async()=>{
      const p=await pageFor("admin",mobile);await open(p);await select(p,TYPES[0],3);
      const target=p.locator('[data-testid="v3-focus-root"] tbody a.clients-link:visible').first();
      const before=p.url();await target.click();await p.waitForURL(u=>/\/clients\/.+/.test(u.pathname));
      const back=p.locator('[data-testid="v3-back-to-list"]:visible');
      await back.waitFor({state:"visible"});const response=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&r.status()===200);await back.click();await response;
      await p.locator(TOP).waitFor({state:"visible"});await p.waitForLoadState("networkidle");
      console.log("back diagnostics",JSON.stringify({mobile,url:p.url(),options:await p.locator(TOP+" option").evaluateAll(els=>els.map(el=>(el as HTMLOptionElement).value)),cache:await p.evaluate(()=>window.__lktandoorFilterOptions?.types?.length)}));
      assert.equal(await p.locator(TOP).inputValue(),TYPES[0]);assert.equal(new URL(p.url()).searchParams.get("view"),new URL(before).searchParams.get("view"));await noError(p);
      await select(p,TYPES[1],3);await select(p,TYPES[0],3);
      await p.locator("#v3-focus-columns").click();await p.locator("#v3-lktandoor-columns-dialog").waitFor({state:"visible"});await p.keyboard.press("Escape");await p.locator("#v3-lktandoor-columns-dialog").waitFor({state:"hidden"});
      const empty=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&r.status()===200);await p.locator("#v3-focus-search").fill("NO_SUCH_SYNTHETIC_NAME");assert.equal((await(await empty).json()).total,0);
      await p.getByRole("heading",{name:"Нет совпадений"}).waitFor({state:"visible"});await noError(p);
      const reset=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&r.status()===200);await p.locator("#v3-focus-reset-empty").click();assert.equal((await(await reset).json()).total,9);
      await p.locator(TOP).waitFor({state:"visible"});assert.equal(await p.locator(TOP).inputValue(),"");
      assert.equal(await p.locator("#v3-focus-search").inputValue(),"","Reset must clear old applied search text, not resurrect it as draft");
      assert.equal(new URL(p.url()).searchParams.get("q")||"","");
      await p.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
      assert.equal(await p.locator("#v3-focus-search").inputValue(),"");
      await p.screenshot({path:path.join(OUT,mobile?"mobile.png":"desktop.png")});
      await p.keyboard.press("Escape");await p.waitForFunction(()=>!document.body.classList.contains("x14-focus-mode"));await p.close();
    });
  }
  for(const mode of ["400","500","network"]){
    it(`${mode}: fullscreen error retry, columns, reset and scope survive`,async()=>{
      const p=await pageFor("manager");await open(p);await select(p,TYPES[0],2);
      const handler=async(route:any)=> mode==="network"?route.abort("failed"):route.fulfill({status:Number(mode),contentType:"application/json",body:JSON.stringify({error:"Synthetic request failure"})});
      await p.route("**/api/clients/v3/list?*",handler);await p.locator("#v3-focus-search").fill("QA");
      await p.locator('[data-testid="v3-focus-error"]').waitFor({state:"visible"});assert.ok(!/Совпало\s*0/.test(await p.locator(".x14-focusbar [role=status]").innerText()));
      await p.locator("#v3-focus-columns").click();await p.locator("#v3-lktandoor-columns-dialog").waitFor({state:"visible"});await p.keyboard.press("Escape");
      await p.unroute("**/api/clients/v3/list?*",handler);const recovered=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&r.status()===200);await p.locator("#v3-focus-retry-load").click();assert.equal((await(await recovered).json()).total,2);await noError(p);
      await p.route("**/api/clients/v3/list?*",handler);await p.locator("#v3-focus-search").fill("triggeragain");await p.locator('[data-testid="v3-focus-error"]').waitFor({state:"visible"});await p.unroute("**/api/clients/v3/list?*",handler);
      const reset=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&r.status()===200);await p.locator("#v3-focus-reset").click();assert.equal((await(await reset).json()).total,6);assert.equal(await p.locator("#v3-focus-search").inputValue(),"","error-state reset must clear search field");await noError(p);await p.close();
    });
  }
  for(const status of [400,500,403]){
    it(`late metadata after list${status} never resurrects cached rows`,async()=>{
      const p=await pageFor("manager");await open(p);await select(p,TYPES[0],2);await p.waitForLoadState("networkidle");
      let release!:()=>void,seen!:()=>void;const gate=new Promise<void>(r=>release=r),arrived=new Promise<void>(r=>seen=r);
      await p.route("**/api/clients/v3/options?*",async route=>{const res=await route.fetch();seen();await gate;await route.fulfill({response:res});});
      await p.route("**/api/clients/v3/list?*",route=>route.fulfill({status,contentType:"application/json",body:JSON.stringify({error:"Synthetic denied or failed request"})}));
      await p.locator("#v3-focus-search").fill("NEW_FAILED_CRITERIA");await arrived;
      await p.locator('[data-testid="v3-focus-error"]').waitFor({state:"visible"});
      const late=p.waitForResponse(r=>r.url().includes("/api/clients/v3/options"));release();await(await late).finished();
      await p.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
      assert.ok(await p.locator('[data-testid="v3-focus-error"]').isVisible(),"metadata must preserve actual request error");
      assert.equal(await p.locator('[data-testid="v3-focus-root"] tbody a.clients-link:visible').count(),0,"no cached data under failed criteria");
      await p.close();
    });
  }
  it("race: stale TOP150 response cannot overwrite TOP350, abort deliberately ignored",async()=>{
    const p=await pageFor();
    await p.addInitScript(()=>{const orig=window.fetch;window.fetch=(input,init)=>orig(input,{...init,signal:undefined});});
    await open(p);let release!:()=>void,seen!:()=>void;const gate=new Promise<void>(r=>release=r),arrived=new Promise<void>(r=>seen=r);
    await p.route("**/api/clients/v3/list?*",async route=>{
      if(decodeURIComponent(route.request().url()).includes(TYPES[0])){const r=await route.fetch();seen();await gate;await route.fulfill({response:r});}else await route.continue();
    });
    const old=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&decodeURIComponent(r.url()).includes(TYPES[0]));
    await p.locator(TOP).selectOption(TYPES[0]);await arrived;await select(p,TYPES[1],3);release();await(await old).finished();await p.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
    assert.equal(await p.locator(TOP).inputValue(),TYPES[1]);assert.ok((await p.locator('[data-testid="v3-focus-root"] tbody').innerText()).includes("ТОП350"));await noError(p);await p.close();
  });
  it("rapid TOP switching with native abort, then reload URL preserves filter",async()=>{
    const p=await pageFor();await open(p);
    const responses:string[]=[];p.on("response",r=>{if(r.url().includes("/api/clients/v3/list"))responses.push(r.status()+" "+r.url());});
    const latest=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&r.status()===200&&decodeURIComponent(r.url()).includes(TYPES[2]));
    for(const type of TYPES)await p.locator(TOP).selectOption(type);
    let r;try{r=await latest;}catch(error){console.log("RAPID DIAGNOSTIC",JSON.stringify({url:p.url(),requests:traces.get(p),responses,state:await p.evaluate(()=>window.ClientsV3.readState()),selected:await p.locator(TOP).inputValue()}));throw error;}assert.equal((await r.json()).total,3);
    await p.waitForLoadState("networkidle");
    await p.waitForFunction(({s,v})=>(document.querySelector(s)as HTMLSelectElement)?.value===v,{s:TOP,v:TYPES[2]});
    assert.ok(decodeURIComponent(p.url()).includes(TYPES[2]),"latest filter committed to URL before reload");
    const res=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&r.status()===200&&decodeURIComponent(r.url()).includes(TYPES[2]));await p.reload();const data=await(await res).json();assert.equal(data.total,3);
    await p.locator(TOP).waitFor({state:"visible"});assert.equal(await p.locator(TOP).inputValue(),TYPES[2]);await noError(p);await p.close();
  });
  it("pending search commits after gated list repaint before debounce settles",async()=>{
    const p=await pageFor();await open(p);
    let release!:()=>void,seen!:()=>void;const gate=new Promise<void>(r=>release=r),arrived=new Promise<void>(r=>seen=r);
    await p.route("**/api/clients/v3/list?*",async route=>{
      const u=new URL(route.request().url());
      if(decodeURIComponent(u.toString()).includes(TYPES[0])&&!u.searchParams.get("q")){
        const data=await route.fetch();seen();await gate;await route.fulfill({response:data});
      }else await route.continue();
    });
    const first=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&decodeURIComponent(r.url()).includes(TYPES[0])&&!new URL(r.url()).searchParams.get("q"));
    await p.locator(TOP).selectOption(TYPES[0]);await arrived;
    const searched=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&new URL(r.url()).searchParams.get("q")==="QA Legal 0"&&r.status()===200);
    await p.locator("#v3-focus-search").fill("QA Legal 0");release();await(await first).finished();
    assert.equal((await(await searched).json()).total,1);
    await p.waitForLoadState("networkidle");
    assert.equal(await p.locator("#v3-focus-search").inputValue(),"QA Legal 0");
    assert.equal(await p.evaluate(()=>window.ClientsV3.readState().q),"QA Legal 0");
    await p.unrouteAll({behavior:"wait"});await p.close();
  });
  it("retail equal addresses: all72 GUIDs exactly once over8 pages; UI next/back",async()=>{
    const p=await pageFor();const seen=new Set<string>();
    for(let page=1;page<=8;page++){const res=await p.request.get(base+`/api/clients/v3/list?entity=retail&page=${page}&pageSize=10`);assert.equal(res.status(),200);const data=await res.json();assert.equal(data.total,72);for(const row of data.items){assert.ok(!seen.has(row.guid),"duplicate GUID across pages");seen.add(row.guid);}}
    assert.equal(seen.size,72);
    await open(p,LIST.replace("legal_grouped","retail")+"&v3pageSize=10");const a=await p.locator('[data-testid="v3-focus-root"] tbody').innerText();
    let res=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&r.status()===200);await p.locator("#v3-focus-page-next").click();assert.equal((await(await res).json()).items.length,10);
    await p.locator("#v3-focus-page-prev").waitFor({state:"visible"});res=p.waitForResponse(r=>r.url().includes("/api/clients/v3/list")&&r.status()===200);await p.locator("#v3-focus-page-prev").click();await res;await p.waitForFunction(()=>window.ClientsV3.readState().page===1);assert.equal(await p.locator('[data-testid="v3-focus-root"] tbody').innerText(),a);await p.close();
  });
});

