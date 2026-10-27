var STAGE1_RESULT=await(async function(){
  var checks=[];
  function ok(v,label){if(!v)throw Error("Stage1 QA: "+label);checks.push(label);}
  async function role(name){await page.getByRole("button",{name,exact:true}).click();}
  async function view(name){await page.locator(".as-tabs").getByRole("button",{name,exact:true}).click();}
  async function open(id){await page.locator(".as-table tbody tr").filter({hasText:id}).getByRole("button",{name:"Открыть",exact:true}).click();}
  async function decide(name,reason){await page.getByRole("button",{name,exact:true}).click();if(reason)await page.locator("#as-dialog-reason").fill(reason);await page.locator("[data-as-action=modal-confirm]").click();}
  async function clock(value){if(!await page.locator(".as-clock").getAttribute("open"))await page.locator(".as-clock summary").click();await page.locator("#as-clock-value").fill(value);await page.getByRole("button",{name:"Применить время",exact:true}).click();}
  await page.goto("http://127.0.0.1:4317/#assistant?role=manager");await page.reload();
  ok(await page.locator(".as-client-row").count()===1,"assistant starts in restricted Clients");
  ok(await page.locator(".sidebar nav button[data-go]:visible").count()===2,"assistant navigation limited to Clients and access conditions");
  ok(!/Рабочая очередь|Задачи по клиенту|Передать итоги|Взять в работу/.test(await page.locator("body").innerText()),"no tasks or reports in assistant UI");
  await page.locator("[data-as-action=client]").first().click();
  ok((await page.locator("#as-content").innerText()).toLowerCase().includes("только просмотр"),"client card is read-only");
  await page.getByRole("button",{name:"Данные клиента",exact:true}).click();
  ok(await page.locator(".as-info-field").count()>70,"all information fields and legal data available");
  await page.locator(".as-info-group summary").filter({hasText:"Контакт ЛПР"}).click();
  ok((await page.locator("#as-content").innerText()).includes("Данные появятся после выгрузки из 1С"),"missing information explained");
  ok(await page.locator("#as-content input,#as-content textarea").count()===0,"information card has no editors");
  await page.getByRole("button",{name:"Продажи",exact:true}).click();
  ok(await page.locator("[data-cs-total]").count()===1,"existing client sales renderer reused");
  ok(await page.locator("[data-as-period]").count()===1,"one period selector");
  await page.locator("[data-as-action=legal]").first().click();
  ok(await page.locator("[data-as-legal-select]").count()===1,"read-only sales drilldown works");
  await page.locator("[data-as-action=legal-clear]").click();
  await page.locator("[data-as-period]").selectOption("2026-08");
  ok(await page.locator("[data-as-period]").inputValue()==="2026-08","sales period change works");
  await role("Менеджер");await page.getByRole("button",{name:"Новое назначение",exact:true}).click();
  await page.getByRole("button",{name:"Отправить на согласование",exact:true}).click();
  ok(!!await page.locator("#as-form-error").innerText(),"incomplete request blocked");
  await page.locator("[data-as-field=assistant]").selectOption("a1");
  await page.locator("[data-as-field=start]").fill("2026-10-27T10:00");
  await page.locator("[data-as-field=end]").fill("2026-10-30T18:00");
  await page.locator("[data-as-client=c9]").check();
  await page.locator("[data-as-field=reason]").fill("Временный доступ к информации о клиенте.");
  await page.getByRole("button",{name:"Отправить на согласование",exact:true}).click();
  ok((await page.locator("#as-content").innerText()).includes("Н-110"),"manager submits access request");
  await role("Ассистент");ok(await page.locator(".as-client-row").count()===1,"pending request grants no access");
  await role("РОП");ok(!await page.locator(".as-table tbody tr").filter({hasText:"Н-107"}).count(),"ROP isolated from other team");
  await open("Н-110");await decide("Согласовать");
  await role("Ассистент");ok(await page.locator(".as-client-row").count()===2,"approved request adds only selected client");
  await role("Менеджер");await open("Н-110");await page.getByRole("button",{name:"Изменить условия",exact:true}).click();
  await page.locator("[data-as-field=assistant]").selectOption("a2");
  await page.locator("[data-as-field=reason]").fill("Временная замена получателя доступа.");
  await page.getByRole("button",{name:"Отправить изменения на согласование",exact:true}).click();
  await role("Ассистент");ok(await page.locator(".as-client-row").count()===1,"pending amendment pauses old access");
  await role("РОП");await open("Н-110");
  ok((await page.locator(".as-diff").innerText()).includes("Павел Черняк"),"approver sees proposed access change");
  await decide("Отклонить изменения","Сохраняем прежнего получателя доступа.");
  await role("Ассистент");ok(await page.locator(".as-client-row").count()===2,"rejected amendment restores prior access");
  await role("Менеджер");await open("Н-110");await decide("Отозвать доступ","Доступ больше не нужен.");
  await role("Ассистент");ok(await page.locator(".as-client-row").count()===1,"revocation removes access immediately");
  await view("История доступа");
  ok((await page.locator("#as-content").innerText()).includes("Доступ отозван"),"safe revoked access history retained");
  await view("Клиенты");await page.locator("[data-as-person]").selectOption("a2");
  ok((await page.locator("#as-content").innerText()).includes("Нет доступных клиентов"),"future assignment does not expose Clients");
  await clock("2026-10-29T08:59");
  ok(await page.locator(".as-client-row").count()===0,"future access closed one minute before start");
  await clock("2026-10-29T09:00");
  ok(await page.locator(".as-client-row").count()===1,"access starts at exact boundary");
  await page.locator("[data-as-action=client]").click();
  await clock("2026-10-31T18:00");
  ok(await page.locator(".as-client-row").count()===0&&!await page.locator(".as-card-tabs").count(),"exact end closes client card and directory");
  await role("Координатор");await view("Создать назначение");
  ok(await page.locator("[data-as-field=manager] option").count()===2,"coordinator can assign only own team");
  await view("Назначения команды");await open("Н-101");
  ok(!await page.getByRole("button",{name:"Согласовать",exact:true}).count(),"coordinator cannot approve");
  await role("Директор");ok(await page.locator(".as-table tbody tr").filter({hasText:"Н-107"}).count()===1,"director can review all teams");
  await view("Доступы по датам");
  ok((await page.locator("#as-content").innerText()).includes("Доступы по датам"),"calendar describes access not task workload");
  await page.goto("http://127.0.0.1:4317/#assistant-tasks?as_role=assistant&as_view=tasks");
  await page.locator(".as-tabs").getByRole("button",{name:"Клиенты",exact:true}).waitFor();
  ok(!/Рабочая очередь|Взять в работу|Передать итоги/.test(await page.locator("body").innerText()),"legacy task hash redirects to Clients");
  await page.getByRole("button",{name:"Сбросить демо",exact:true}).click();await page.locator("[data-as-action=modal-confirm]").click();
  ok(await page.locator(".as-client-row").count()===1,"reset restores first-stage fixture");
  return {passed:checks.length,checks};
})();
console.log(JSON.stringify(STAGE1_RESULT,null,2));
