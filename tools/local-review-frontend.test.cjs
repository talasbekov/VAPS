const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateReviewRuntime}=require('./local-review-frontend.cjs');

const settings={PR_DB_NAME:'smart_soak_20261007',BACKEND_URL:'http://127.0.0.1:18345'};
const rewrites=[
 ...Array.from({length:19},(_,i)=>({source:'/api/check-'+i+'/:path*',destination:'http://127.0.0.1:18345/api/check-'+i+'/:path*'})),
 {source:'/media/employees/photos/:path*',destination:'http://127.0.0.1:18348/media/employees/photos/:path*'},
];
test('review frontend accepts the real API and media origins',()=>{
 assert.doesNotThrow(()=>validateReviewRuntime(settings,{rewrites:{beforeFiles:rewrites,afterFiles:[],fallback:[]}}));
});
for(const change of [
 {PR_DB_NAME:'smart_eight_hours_20261009'},
 {BACKEND_URL:'http://127.0.0.1:18351'},
])test('review frontend rejects a mismatched runtime '+Object.keys(change)[0],()=>{
 assert.throws(()=>validateReviewRuntime({...settings,...change},{rewrites}),/runtime/i);
});
test('a clone build cannot be started with the main environment',()=>{
 assert.throws(()=>validateReviewRuntime(settings,{rewrites:rewrites.map(r=>({...r,destination:r.destination.replace(':18345',':18351')}))}),/API/i);
});
test('a wrong photo origin is rejected before opening the port',()=>{
 assert.throws(()=>validateReviewRuntime(settings,{rewrites:rewrites.map(r=>({...r,destination:r.destination.replace(':18348',':18352')}))}),/photo/i);
});
test('an incomplete manifest cannot masquerade as a checked build',()=>{
 assert.throws(()=>validateReviewRuntime(settings,{rewrites:[]}),/API/i);
});
