// Plane №1179. Исполнитель: Кодекс Астра 6. Isolated synthetic stack only.
const {chromium}=require('/home/erda/.codex/worktrees/roster-1175/Smart Josparlau/Backend/PersonnelStatus/PersonalRecordFront/node_modules/playwright');
const {expect}=require('/home/erda/.codex/worktrees/roster-1175/Smart Josparlau/Backend/PersonnelStatus/PersonalRecordFront/node_modules/@playwright/test');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const credentials=JSON.parse(fs.readFileSync('/tmp/staffing-portable-1179/qa-null-ui-credentials.json','utf8'));
const APP='http://127.0.0.1:13379',API='http://127.0.0.1:18379';
(async()=>{
 const browser=await chromium.launch({headless:true});
 const errors=[],badResponses=[];
 try {
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1100}});
  // No mocks: only the explicitly authorized test portal/API may be reached.
  await context.route('**/*',r=>[APP,API].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
  const req=context.request;
  const csrf=await req.get(APP+'/api/auth/csrf/'); assert.equal(csrf.status(),200,'CSRF endpoint');
  const auth=await req.post(APP+'/api/auth/callback/credentials/',{form:{csrfToken:(await csrf.json()).csrfToken,...credentials,json:'true'}});
  assert.equal(auth.status(),200,'NextAuth callback');
  const session=await (await req.get(APP+'/api/auth/session/')).json();
  assert.ok(session.user?.accessToken,'Real NextAuth session must contain backend access token');
  console.log('PASS real NextAuth credentials login on isolated stack');
  const headers={Authorization:`Bearer ${session.user.accessToken}`};
  const core=await req.get(API+'/api/core/employees/',{headers}); assert.equal(core.status(),200,'core employees list');
  const coreBody=await core.json(); const people=Array.isArray(coreBody)?coreBody:coreBody.results;
  assert.equal(people.length,2); assert.deepEqual(people.map(e=>e.external_id).sort(),['42','43']);
  for(const e of people){
   for(const field of ['hire_date','birth_date','gender'])assert.equal(e[field],null,`core ${field}`);
   const single=await req.get(API+`/api/core/employees/${e.id}/`,{headers});assert.equal(single.status(),200);
   const full=await single.json();for(const field of ['hire_date','birth_date','gender'])assert.equal(full[field],null);
   const service=await req.get(API+`/api/core/service-employees/${e.id}/`,{headers});assert.equal(service.status(),200,'service employee detail');
   assert.equal((await service.json()).hire_date,null);
  }
  console.log('PASS real API: 2 imported employees, core nullable facts + service hire_date=null, detail HTTP 200');
  const page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)badResponses.push({path:new URL(r.url()).pathname,status:r.status()});});
  await page.goto(APP+'/service-employees');
  await page.getByTestId('service-employee-row').first().waitFor();
  assert.equal(await page.getByTestId('service-employee-row').count(),2);
  for(const e of people){
   await page.goto(APP+`/security-ops/profile/${e.id}?directory=1`);
   await page.getByText('В Службе с —',{exact:true}).waitFor();
  }
  await page.screenshot({path:__dirname+'/live-service-null.png',fullPage:true});
  console.log('PASS old UI: real service list has 2 employees; both profiles display В Службе с —');
  await page.goto(APP+'/employees?view=forces&tab=table');
  const first=people[0];const name=`${first.last_name} ${first.first_name}`;
  await page.getByText(name,{exact:true}).first().waitFor();
  const employeeRows=page.getByRole('row').filter({has:page.getByText(name,{exact:true})});
  await expect(employeeRows).toHaveCount(2);
  for(const row of await employeeRows.all()){
   const cells=await row.getByRole('cell').allTextContents(); assert.equal(cells[7],'—','hire date cell');
  }
  await page.screenshot({path:__dirname+'/live-employees-table-null.png',fullPage:true});
  await employeeRows.first().getByText(name,{exact:true}).click();
  await page.getByRole('tab',{name:'Профиль сотрудника',exact:true}).click();
  for(const label of ['Дата рождения','Дата найма']){
   const field=page.getByText(label,{exact:true});await field.waitFor();
   assert.match(await field.locator('..').innerText(),new RegExp(label+'\\s+—'));
  }
  await page.screenshot({path:__dirname+'/live-employees-profile-null.png',fullPage:true});
  await page.getByRole('tab',{name:'Карточки',exact:true}).click();
  const fields=page.getByText('Дата найма',{exact:true});await expect(fields).toHaveCount(2);
  for(const field of await fields.all())assert.match(await field.locator('..').innerText(),/Дата найма\s+—/);
  console.log('PASS old UI: real employees table/profile/tiles render null dates as —; gender=null tolerated');
  console.log('Browser pageerrors:',JSON.stringify(errors));
  console.log('HTTP failures:',JSON.stringify(badResponses));
  assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);
  console.log('PASS end-to-end: old frontend + actual backend overlay, no mocked responses, no rebuild');
 }catch(e){console.error('FAIL',e.message);console.error('Browser pageerrors:',JSON.stringify(errors));console.error('HTTP failures:',JSON.stringify(badResponses));process.exitCode=1;}
 finally{await browser.close();}
})();
