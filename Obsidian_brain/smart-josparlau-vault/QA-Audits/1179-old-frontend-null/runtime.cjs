// Plane №1179. Исполнитель: Кодекс Астра 6. Synthetic fixtures only.
const { chromium } = require('/home/erda/.codex/worktrees/roster-1175/Smart Josparlau/Backend/PersonnelStatus/PersonalRecordFront/node_modules/playwright');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const container = 'sj-1179-null-qa';
const ip = execFileSync('docker', ['inspect', container, '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'], {encoding:'utf8'}).trim();
const base = `http://${ip}:3000`;
const token = execFileSync('docker', ['exec', container, 'node', '-e', 'require("next-auth/jwt").encode({token:{sub:"1179001",name:"Synthetic QA"},secret:"synthetic-1179-null-qa",maxAge:3600}).then(t=>process.stdout.write(t))'], {encoding:'utf8'});
const person = {id:1179001, external_id:'QA-NULL', last_name:'Синтетический',first_name:'Тест',middle_name:'',full_name:'Синтетический Тест', personnel_number:'QA-1179',hire_date:null,birth_date:null,gender:null,rank:'',iin_masked:'',photo:null,current_status:null,is_active:true,employment_status:'working'};
const division = {id:1179002,name:'Тестовый отдел',code:'QA-D',division_type:'division'};
const detail = {...person,callsign:'',rank:null,position:'Тестовая должность',division,current_status:{code:'IN_SERVICE',name:'В строю',date_end:null},rating:null,rating_state:'FEATURE_DISABLED',evaluations_count:0,rated_events_count:0,active_assignments_count:0,next_assignment:null,work_phone:null,work_email:null,assignments:[],history:[],evaluations:[]};
const session = {user:{id:'1179001',name:'Synthetic QA',accessToken:'synthetic-not-a-real-token',userData:{id:1179001,username:'synthetic-qa',division}},expires:'2099-01-01T00:00:00Z'};
const requests = new Set(), unknown = new Set(), errors = [];
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1100}});
 await context.addCookies([{name:'next-auth.session-token',value:token,url:base}]);
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(!u.pathname.startsWith('/api/')){
   if(u.origin===base)return route.continue();
   return route.abort();
  }
  requests.add(u.pathname); let data;
  if(u.pathname.startsWith('/api/auth/session')) data=session;
  else if(u.pathname.includes('my-permissions')) data={permissions:['*'],roles:[]};
  else if(u.pathname===`/api/core/service-employees/${person.id}/`) data=detail;
  else if(u.pathname.includes('/staff-units/directorate/')) data={division,staff_units:[{id:1179003,index:1,division,position:{id:1179004,name:'Тестовая должность'},employee:person}],total_count:1,matched_count:1,page:1,page_size:50,has_next:false,summary:{employees:1,without_status:1,overdue:0,scheduled:0}};
  else if(u.pathname==='/api/staff_unit/statistics/') data={scope_division:division,summary:{departments_count:0,directorates_count:0,divisions_count:1,staff_units_count:1,employees_count:1,vacancies_count:0},departments:[],directorates:[],divisions:[{division_id:division.id,division_name:division.name,ancestors:[]}]};
  else if(u.pathname==='/api/statuses/types/') data=[{code:'in_service',label:'В строю',color:'green'}];
  else if(u.pathname.includes('/divisions/')) data=[division];
  else {unknown.add(u.pathname);data={count:0,results:[]};}
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 const page=await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/security-ops/profile/${person.id}?directory=1`);
 await page.getByText('В Службе с —',{exact:true}).waitFor({timeout:20000});
 console.log('PASS old built service profile: hire_date=null renders В Службе с —');
 await page.screenshot({path:__dirname+'/service-null.png',fullPage:true});
 await page.goto(`${base}/employees?view=forces&tab=table`);
 await page.getByText(person.full_name,{exact:true}).first().waitFor({timeout:20000});
 const row=page.getByRole('row').filter({hasText:person.full_name});
 const cells=await row.getByRole('cell').allTextContents();
 console.log('SYNTHETIC table cells',JSON.stringify(cells));
 assert.equal(cells[7],'—');
 await page.screenshot({path:__dirname+'/employees-table-null.png',fullPage:true});
 await row.getByText(person.full_name,{exact:true}).click();
 await page.getByRole('tab',{name:'Профиль сотрудника',exact:true}).click();
 await page.getByText('Дата рождения',{exact:true}).waitFor();
 for(const label of ['Дата рождения','Дата найма']){
   const parent=page.getByText(label,{exact:true}).locator('..');
   assert.match(await parent.innerText(),new RegExp(label+'\\s+—'));
 }
 console.log('PASS old built employee card: hire_date/birth_date=null render —; gender=null causes no error');
 await page.screenshot({path:__dirname+'/employees-profile-null.png',fullPage:true});
 await page.getByRole('tab',{name:'Карточки',exact:true}).click();
 const tileHire=page.getByText('Дата найма',{exact:true}).locator('..');
 assert.match(await tileHire.innerText(),/Дата найма\s+—/);
 console.log('PASS old built employee tiles: hire_date=null renders —');
 await page.screenshot({path:__dirname+'/employees-tiles-null.png',fullPage:true});
 detail.hire_date='2020-02-03';
 await page.goto(`${base}/security-ops/profile/${person.id}?directory=1`);
 await page.getByText('В Службе с 03.02.2020',{exact:true}).waitFor();
 console.log('PASS positive control: known hire_date renders 03.02.2020');
 assert.deepEqual(errors,[]);
 console.log('PASS browser pageerror count = 0');
 console.log('Mocked API paths',JSON.stringify([...requests].sort()));
 console.log('Ancillary empty mock paths',JSON.stringify([...unknown].sort()));
 } catch(e) {console.error('FAIL',e.message);console.error('pageerrors',JSON.stringify(errors));console.error('API paths',JSON.stringify([...requests])); throw e;}
 finally {await browser.close();}
})().catch(()=>process.exitCode=1);
