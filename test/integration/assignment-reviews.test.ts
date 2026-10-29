import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import { assertTestDatabaseUrl } from "../helpers/test-db";
import { seedAssignmentQa, QA_PASSWORD, LEGAL } from "../helpers/assistant-assignment-fixtures";
const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl)throw new Error("TEST_DATABASE_URL required");
assertTestDatabaseUrl(databaseUrl,"assignment reviews integration");
describe("reviews: mandatory closure, scope and private notifications",()=>{
  let app:express.Express,pool:Pool,users:Record<string,any>;
  const cookies:Record<string,string>={},feedback={score:4,comment:"Работа выполнена качественно, клиенты возвращены вовремя."};
  const get=(who:string,path:string)=>request(app).get("/api/access"+path).set("Cookie",cookies[who]!);
  const post=(who:string,path:string,body:Record<string,unknown>)=>request(app).post("/api/access"+path)
    .set({Origin:"http://127.0.0.1:3000",Cookie:cookies[who]!}).send(body);
  async function create(){
    const r=await post("manager","/delegations",{assistantUserId:users.assistant.id,clientGuids:[LEGAL],submit:true,
      startsAt:new Date(Date.now()-3600000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),
      basis:"Тест временного доступа и обязательного итога."});
    assert.equal(r.status,201,JSON.stringify(r.body));
    const a=await post("coordinator","/delegations/"+r.body.id+"/approve",{basis:"Проверено РОА."});
    assert.equal(a.status,200,JSON.stringify(a.body));return r.body.id as string;
  }
  async function finished(){
    const id=await create();
    await pool.query(`UPDATE delegations SET starts_at=NOW()-INTERVAL '3 hours',approved_at=NOW()-INTERVAL '2 hours',
      ends_at=NOW()-INTERVAL '1 hour' WHERE id=$1`,[id]);return id;
  }
  before(async()=>{
    users=await seedAssignmentQa(databaseUrl!);app=(await import("../../src/server")).createApp();
    pool=new Pool({connectionString:databaseUrl});
    for(const [key,user]of Object.entries(users)){
      const r=await request(app).post("/api/auth/login").set("Origin","http://127.0.0.1:3000").send({email:user.email,password:QA_PASSWORD});
      assert.equal(r.status,200);
      cookies[key]=(r.headers["set-cookie"] as unknown as string[]).map(c=>c.split(";")[0]).join("; ");
    }
  });
  beforeEach(async()=>{await pool.query("DELETE FROM assistant_assignment_notifications;DELETE FROM access_denials;DELETE FROM delegations");});
  after(async()=>{await pool?.end();await(await import("../../src/db/pool")).closePool();});
  it("requires feedback after expiry; reading messages does not clear it or reopen access",async()=>{
    const id=await finished(),d=await get("manager","/delegations/"+id);
    assert.equal(d.body.delegation.review.state,"required");
    const first=await get("manager","/notifications");assert.equal(first.body.reviewPendingCount,1);
    assert.equal(first.body.reviewPendingAssignmentId,id);
    assert.equal(first.body.items.filter((n:any)=>n.kind==="review_required").length,1);
    await get("manager","/notifications");await post("manager","/notifications/read-all",{});
    const read=await get("manager","/notifications?unread=1");
    assert.equal(read.body.items.length,0);assert.equal(read.body.reviewPendingCount,1);
    const clients=await request(app).get("/api/clients/v3/list?entity=legal_grouped").set("Cookie",cookies.assistant!);
    assert.equal(clients.body.total,0);
  });
  it("rejects active/future/draft/unapproved work and validates stars/comment on server",async()=>{
    const id=await create(),path="/delegations/"+id+"/review";
    assert.equal((await post("manager",path,feedback)).status,409);
    await pool.query("UPDATE delegations SET starts_at=NOW()+INTERVAL '1 day',ends_at=NOW()+INTERVAL '2 days' WHERE id=$1",[id]);
    assert.equal((await post("manager",path,feedback)).status,409);
    await pool.query("UPDATE delegations SET status='draft',starts_at=NOW()-INTERVAL '3 days',ends_at=NOW()-INTERVAL '1 day',approved_at=NULL WHERE id=$1",[id]);
    assert.equal((await post("manager",path,feedback)).status,409);
    for(const body of [{score:0,comment:feedback.comment},{score:"4",comment:feedback.comment},{score:5,comment:"мало"},{comment:feedback.comment}])
      assert.equal((await post("manager",path,body)).status,400);
  });
  it("stores one immutable review, closes obligation and notifies only author/ROA/director",async()=>{
    const id=await finished(),path="/delegations/"+id+"/review";
    const sent=await post("manager",path,{...feedback,score:2});assert.equal(sent.status,201,JSON.stringify(sent.body));
    assert.equal((await post("manager",path,feedback)).status,409);
    for(const who of ["manager","coordinator","director"]){
      const r=await get(who,path);assert.equal(r.status,200,JSON.stringify(r.body));
      assert.equal(r.body.review.score,2);assert.equal(r.body.review.comment,feedback.comment);
      assert.equal(r.body.review.snapshot.clients.length,1);
    }
    assert.equal((await get("manager","/notifications")).body.reviewPendingCount,0);
    assert.equal((await get("manager","/delegations/"+id)).body.delegation.review.state,"rated");
    for(const who of ["coordinator","director"])assert.ok((await get(who,"/notifications")).body.items.some((n:any)=>n.kind==="review_received"&&/Низкая/.test(n.title)));
    for(const who of ["assistant","rop","manager2"])assert.ok(!(await get(who,"/notifications")).body.items.some((n:any)=>/^review_/.test(n.kind)));
    const rop=await get("rop","/delegations/"+id);
    assert.ok(!JSON.stringify(rop.body).includes(feedback.comment));assert.ok(!rop.body.delegation?.review);
  });
  it("scopes reads: admin and ROA/director see review; assistant/ROP forbidden; only manager may submit",async()=>{
    const id=await finished(),path="/delegations/"+id+"/review";assert.equal((await post("manager",path,feedback)).status,201);
    assert.equal((await get("manager2",path)).status,404);
    assert.equal((await get("manager2","/assignments/reviews")).body.total,0);
    for(const who of ["assistant","rop"]){
      assert.equal((await get(who,"/assignments/reviews")).status,403,who+" list");
      assert.equal((await get(who,path)).status,403,who+" detail");
    }
    const adminList=await get("admin","/assignments/reviews");
    assert.equal(adminList.status,200,JSON.stringify(adminList.body));
    assert.ok(adminList.body.total>=1);
    const adminDetail=await get("admin",path);
    assert.equal(adminDetail.status,200,JSON.stringify(adminDetail.body));
    assert.equal(adminDetail.body.review.score,feedback.score);
    assert.equal(adminDetail.body.review.comment,feedback.comment);
    for(const who of ["assistant","coordinator","director","admin","rop"])assert.equal((await post(who,path,feedback)).status,403,who+" write");
  });
  it("serializes competing submissions: one review and private audit record",async()=>{
    const id=await finished(),path="/delegations/"+id+"/review";
    const results=await Promise.all([post("manager",path,feedback),post("manager",path,feedback)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM assistant_assignment_reviews")).rows[0].n,1);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM access_audit_log WHERE action='assignment.review_submitted' AND entity_id=$1",[id])).rows[0].n,1);
  });
  it("rates actual early revocation, never revoked-before-start even after scheduled end",async()=>{
    const id=await create();
    await pool.query(`UPDATE delegations SET status='revoked',starts_at=NOW()-INTERVAL '3 hours',
      approved_at=NOW()-INTERVAL '4 hours',revoked_at=NOW()-INTERVAL '2 hours',ends_at=NOW()-INTERVAL '1 hour' WHERE id=$1`,[id]);
    assert.equal((await post("manager","/delegations/"+id+"/review",feedback)).status,201);
    const r=(await get("manager","/delegations/"+id+"/review")).body.review;
    assert.ok(new Date(r.worked_ends_at)<new Date(r.snapshot.agreedEndsAt));
    await pool.query("DELETE FROM delegations");const cancelled=await create();
    await pool.query(`UPDATE delegations SET status='revoked',starts_at=NOW()-INTERVAL '2 hours',
      approved_at=NOW()-INTERVAL '4 hours',revoked_at=NOW()-INTERVAL '3 hours',ends_at=NOW()-INTERVAL '1 hour' WHERE id=$1`,[cancelled]);
    assert.equal((await post("manager","/delegations/"+cancelled+"/review",feedback)).status,409);
    assert.equal((await get("manager","/notifications")).body.reviewPendingCount,0);
  });
  it("filters with unfiltered summaries and rejects invalid filters and foreign origins",async()=>{
    const id=await finished();assert.equal((await post("manager","/delegations/"+id+"/review",{...feedback,score:2})).status,201);
    const low=await get("director","/assignments/reviews?score=low&status=rated&q="+encodeURIComponent("Морозов"));
    assert.equal(low.status,200,JSON.stringify(low.body));assert.equal(low.body.total,1);assert.equal(low.body.stats.low,1);
    assert.equal((await get("director","/assignments/reviews?score=5")).body.total,0);
    assert.equal((await get("director","/assignments/reviews?score=6")).status,400);
    assert.equal((await get("director","/assignments/reviews?assistantId=invalid")).status,400);
    assert.equal((await request(app).post("/api/access/delegations/"+id+"/review").set({Cookie:cookies.manager!,Origin:"https://foreign.invalid"}).send(feedback)).status,403);
  });
  it("redacts denied client snapshots and old private messages after role change",async()=>{
    const id=await finished();assert.equal((await post("manager","/delegations/"+id+"/review",feedback)).status,201);
    await pool.query(`INSERT INTO access_denials(user_id,scope_type,object_id,reason,basis,created_by_user_id)
      VALUES($1,'client',$2,'Тестовый запрет','Тест',$3)`,[users.manager.id,LEGAL,users.admin.id]);
    const r=await get("manager","/delegations/"+id+"/review");
    assert.equal(r.status,200);assert.equal(r.body.review.snapshot.clients,null);
    await pool.query("UPDATE users SET role='assistant' WHERE id=$1",[users.manager.id]);
    try{
      assert.equal((await get("manager","/delegations/"+id+"/review")).status,403);
      assert.ok(!(await get("manager","/notifications")).body.items.some((n:any)=>/^review_/.test(n.kind)));
    }finally{await pool.query("UPDATE users SET role='manager' WHERE id=$1",[users.manager.id]);}
  });
  it("paginates required work with stable totals and excludes clientless legacy periods",async()=>{
    const id=await finished();
    const inserted=await pool.query(`INSERT INTO delegations(delegator_user_id,assistant_user_id,starts_at,ends_at,
      status,created_by_user_id,approved_by_user_id,approved_at,basis,workflow_state)
      SELECT delegator_user_id,assistant_user_id,starts_at,ends_at,status,created_by_user_id,approved_by_user_id,
      approved_at,basis,workflow_state FROM delegations CROSS JOIN generate_series(1,34) WHERE id=$1 RETURNING id`,[id]);
    const withoutClients=await get("director","/assignments/reviews");assert.equal(withoutClients.body.total,1);
    await pool.query("INSERT INTO delegation_clients(delegation_id,guid_client) SELECT unnest($1::uuid[]),$2::uuid",
      [inserted.rows.map(r=>r.id),LEGAL]);
    const one=await get("manager","/assignments/reviews?status=required&page=1"),two=await get("manager","/assignments/reviews?status=required&page=2");
    assert.equal(one.body.total,35);assert.equal(one.body.items.length,30);assert.equal(two.body.items.length,5);
    assert.equal(new Set([...one.body.items,...two.body.items].map((r:any)=>r.id)).size,35);
  });
});
