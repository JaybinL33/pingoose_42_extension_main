const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const worker = fs.readFileSync('pingoose-v3-staging.1KaoVt/webview.js', 'utf8');
const context = {document:{body:{innerText:''},images:[],querySelector:()=>({textContent:'Fixture'}),querySelectorAll:()=>[]},navigator:{language:'en-US'}};
vm.createContext(context);
vm.runInContext(worker.slice(worker.indexOf('function readProfileDOM('),worker.indexOf('function summarizeLogtime(')),context);
for (const kind of ['Ultimate', 'Milestone']) {
 context.document.body.innerText = `${kind} Deadline : 2026. 10. 18. Projects`;
 const data = JSON.parse(context.readProfileDOM('fixture'));
 assert.equal(data.deadline,'2026-10-18');
 assert.equal(data.deadlineKind,kind.toLowerCase());
}
const source=fs.readFileSync('pingoose-v3-staging.1KaoVt/extension.js','utf8');
let time=1000000;
context.GLib={get_monotonic_time:()=>time};
vm.runInContext('class Probe {'+source.slice(source.indexOf('    checkProfileReady()'),source.indexOf('    refreshLogtimeTitle()'))+'};globalThis.Probe=Probe',context);
const p=new context.Probe();p.lastProfile={name:'Fixture',level:4};p.profileLoadStarted=time;
p.profileLoading={hide(){}};p.profileContent={show(){}};p.count={};
p.checkProfileReady();assert.ok(!p.profileReady);
time+=30000000;p.checkProfileReady();assert.equal(p.profileReady,true);assert.equal(p.count.text,'42');
console.log('PASS: Ultimate/Milestone deadline extraction; loading waits initially and recovers after missing-resource timeout');
