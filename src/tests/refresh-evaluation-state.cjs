const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const Model=require('../models/evaluations.js');
const source=fs.readFileSync('src/worker/webview.js','utf8');
const method=source.slice(source.indexOf('    receive(text, identity) {'),source.indexOf('    publishEvaluations() {'));
const notices=[],ctx={Model,Date,now:()=>100,status:()=>{},emit:event=>notices.push(event)};
vm.createContext(ctx);const Probe=vm.runInContext('(class {'+method+'})',ctx);
let saved=Model.advanceSeen(null,'me',[]).state;
const p=new Probe();
Object.assign(p,{readState:()=>JSON.parse(JSON.stringify(saved)),writeState:state=>{saved=JSON.parse(JSON.stringify(state));},publishEvaluations:()=>{},lookupSeat:()=>{},fail:()=>{},notBefore:0});
const identity={subject:'me',login:'me'};
const row={id:1,kind:'evaluator',project_name:'Test',begin_at:new Date(Date.now()+3600000).toISOString(),user:'peer'};
const receive=rows=>p.receive(JSON.stringify(rows),identity);
receive([row]);assert.equal(notices.length,1);
receive([row]);assert.equal(notices.length,1,'unchanged refresh creates no notification');
receive([]);assert.equal(saved.evaluations.length,1,'temporarily absent evaluation remains until user dismisses');
receive([row,{...row,id:2}]);assert.equal(notices.length,2,'only new evaluation announces');
saved.dismissed.push('1');saved.evaluations=saved.evaluations.filter(r=>r.id!=='1');
receive([row,{...row,id:2}]);assert.equal(notices.length,2);assert(!saved.evaluations.some(r=>r.id==='1'));
receive([{...row,id:2,begin_at:new Date(Date.now()+7200000).toISOString()}]);
assert.equal(notices.filter(n=>n.id.startsWith('rescheduled:')).length,1);
const old=JSON.stringify(saved);p.receive('invalid',identity);assert.equal(JSON.stringify(saved),old);
console.log('PASS: repeated refresh, retained evaluations, only new notices, dismissed evaluations, rescheduling and malformed response preservation');

// Exercise the actual asynchronous seat lookup completion body with stored state.
const start=source.indexOf('        const finish = seat => {',source.indexOf('    lookupSeat('));
const end=source.indexOf('\n        let attempts',start);
const finishSource=source.slice(start,end);
const seatRow={id:'2',begin:row.begin_at,project:'Test'};
const seatContext={...ctx,stopped:false,view:{destroy(){}},identity,row:seatRow,login:'peer',finished:false};
const holder={auth:identity,evaluationState:{evaluations:[{...seatRow}],reminders:[]},writeState:()=>{},publishEvaluations:()=>{}};
vm.createContext(seatContext);
function seatLookup(seat){
 seatContext.finished=false;
 vm.runInContext('(function(){'+finishSource+';finish('+JSON.stringify(seat)+');})',seatContext).call(holder);
}
seatLookup('c1r1s1');const afterFirst=notices.length;
seatLookup('c1r1s1');assert.equal(notices.length,afterFirst,'same seat must not announce again');
seatLookup('c1r1s2');assert.equal(notices.length,afterFirst+1,'changed seat announces');
holder.evaluationState.evaluations=[];seatLookup('c1r1s3');
assert.equal(notices.length,afterFirst+1,'dismissed evaluation ignores delayed seat result');
console.log('PASS: persisted seat-notice deduplication, changed seats and stale lookup completion');
