const fs=require('node:fs');const vm=require('node:vm');const assert=require('node:assert/strict');
const Model=require('../models/evaluations.js');
const source=fs.readFileSync('src/worker/webview.js','utf8');
const messages=[];let callbacks=[];let saved=null;let clock=100;
const context={Model,now:()=>clock,stopped:false,emit:m=>messages.push(m),Soup:{MessageFlags:{NO_REDIRECT:1},Message:{new:()=>({set_flags(){},request_headers:{append(){}}})}}};
vm.createContext(context);vm.runInContext('class Probe {'+source.slice(source.indexOf('    pollAgenda()'),source.indexOf('    poll()'))+'};globalThis.Probe=Probe;',context);
const p=new context.Probe();p.auth={subject:'fixture',header:'fixture'};p.notBefore=0;p.session={queue_message:(m,cb)=>callbacks.push(cb)};
p.readState=()=>saved;p.writeState=s=>{saved=Model.storedState(JSON.stringify(s));};
const event={id:1,name:'Fixture event',begin_at:'2026-10-18T12:00:00Z',end_at:'2026-10-18T13:00:00Z',location:'Auditorium'};
function run(rows,feedback=[],fail=false){clock+=61;callbacks=[];p.pollAgenda();assert.equal(callbacks.length,2);callbacks.forEach((cb,index)=>cb(null,{status_code:fail&&index===1?500:200,response_body:{length:100,data:JSON.stringify(index?feedback:rows)}}));}
run([event]);assert.equal(messages.filter(m=>m.type==='notification').length,1);
run([event]);assert.equal(messages.filter(m=>m.type==='notification').length,1);
run([], [event]);assert.equal(messages.at(-1).rows[0].feedback,true);assert.equal(messages.filter(m=>m.type==='notification').length,1);
const count=messages.length;run([],[],true);assert.equal(messages.length,count);
run([]);assert.equal(messages.at(-1).rows.length,0);
run([event]);assert.equal(messages.filter(m=>m.type==='notification').length,1);
assert.equal(Model.advanceSeen(saved,'fixture',[]).state.agendaIds[0],'1');
assert.throws(()=>Model.parseAgenda([{...event,end_at:'bad'}]));
console.log('PASS: agenda creation notified once; feedback merge; disappearance; failed snapshots preserved; persisted dedup survives evaluation polling');
