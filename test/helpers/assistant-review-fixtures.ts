import { Pool } from "pg";
import { seedAssignmentQa, EMP, FOREIGN_LEGAL } from "./assistant-assignment-fixtures";
import { submitAssignmentReview } from "../../src/access/assignment-reviews";
import { assertTestDatabaseUrl } from "./test-db";

/** Synthetic local-only fixture. Never accepts a production database URL. */
export async function seedReviewQa(databaseUrl: string, origin: string) {
  assertTestDatabaseUrl(databaseUrl, "assistant star review QA seed");
  const users = await seedAssignmentQa(databaseUrl, origin);
  const pool = new Pool({ connectionString: databaseUrl });
  const legal = (await pool.query(`SELECT guid_client FROM onec_v3_legal_entities
    WHERE managers->>'guidManager'=$1 ORDER BY guid_client LIMIT 16`, [EMP.manager])).rows.map(r => r.guid_client);
  if (legal.length < 12) throw new Error("Need realistic manager portfolio in QA fixture");
  const ids: string[] = [];
  const scores = [null,5,2,4,3,4,null];
  for (let i=0;i<9;i++) {
    const id="b310000"+String(i+1)+"-0000-4000-8000-"+String(i+1).padStart(12,"0"); ids.push(id);
    const owner=users[i===3||i===4||i===8?"manager2":"manager"]!;
    const assistant=users[i===2||i===3||i===6||i===8?"assistant2":"assistant"]!;
    const active=i>=7,now=Date.now(),start=new Date(now-(active?2:28-i*2)*3600000),
      approval=new Date(start.getTime()+60000),end=new Date(active?now+8*3600000:start.getTime()+3600000);
    await pool.query(`INSERT INTO delegations(id,delegator_user_id,assistant_user_id,starts_at,ends_at,status,
      created_by_user_id,approved_by_user_id,approved_at,basis,workflow_state)
      VALUES($1,$2,$3,$4,$5,'active',$2,$6,$7,'Синтетическая проверка временной работы','approved')`,
    [id,owner.id,assistant.id,start,end,users.coordinator!.id,approval]);
    const clients=owner.id===users.manager2!.id?[FOREIGN_LEGAL]:active?legal.slice(0,3):legal.slice(0,12-i%3);
    for (const guid of clients) await pool.query("INSERT INTO delegation_clients(delegation_id,guid_client) VALUES($1,$2)",[id,guid]);
    if(active)for(const recipient of [owner.id,assistant.id])await pool.query(`INSERT INTO assistant_assignment_notifications
      (user_id,delegation_id,event_key,kind,title,message) VALUES($1,$2,'qa-approved:'||$2::uuid::text,'approve',
      'Назначение согласовано','Открыт временный доступ к выбранным клиентам. Постоянный менеджер не меняется.')`,[recipient,id]);
    if (!active && scores[i]) await submitAssignmentReview({id:owner.id,role:"manager"},id,{
      score:scores[i],comment: i===2 ? "Ответы поступали с задержкой. При возврате клиентов не хватило понятного итога по обращениям."
        : "Клиенты сопровождались внимательно. Информация передана менеджеру вовремя и в понятном виде.",
    });
  }
  await pool.end();
  return {users,ids,legal};
}
