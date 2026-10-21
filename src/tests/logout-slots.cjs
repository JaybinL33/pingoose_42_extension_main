const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let clock=0,timers=new Map(),next=1,loggedOut=0,cancelled=0,notices=0;
class Actor{constructor(props={}){Object.assign(this,props);this.clutter_text={};}add_child(child){(this.children ||= []).push(child);}add_actor(child){this.add_child(child);}set_policy(){} }
class Modal{constructor(...args){this._init(...args);} _init(){this.contentLayout=new Actor();}setButtons(buttons){this.buttons=buttons;}connect(){}open(){return true;}destroy(){this.destroyed=true;} }
class Native{_confirm(){loggedOut++;}_stopTimer(){}close(){}cancel(){cancelled++;}}
const ctx={imports:{gi:{GLib:{get_monotonic_time:()=>clock,timeout_add_seconds:(_p,_s,cb)=>{const id=next++;timers.set(id,cb);return id;},source_remove:id=>timers.delete(id),SOURCE_REMOVE:false,SOURCE_CONTINUE:true},GObject:{registerClass:c=>c},St:{PolicyType:{NEVER:0,AUTOMATIC:1},ScrollView:Actor,BoxLayout:Actor,Icon:Actor,Label:Actor},Clutter:{KEY_Escape:27}},ui:{main:{notify(){notices++;}},modalDialog:{ModalDialog:Modal},endSessionDialog:{EndSessionDialog:Native}}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/services/systemSessionHook.js','utf8'),ctx);
const future={start:new Date(Date.now()+60000).toISOString(),end:new Date(Date.now()+120000).toISOString()};let pending=[],commands=[];
const hook=new ctx.SystemSessionHook((cmd,cb)=>{commands.push(cmd);pending.push(cb);},()=>true);hook.enable();
new Native()._confirm('ConfirmedLogout');pending.shift()({rows:[future]});assert.equal(notices,1);
clock=59000000;for(const cb of [...timers.values()])cb();assert.equal(loggedOut,0);
clock=60000000;for(const cb of [...timers.values()])cb();assert.equal(loggedOut,1);timers.clear();
new Native()._confirm('ConfirmedLogout');pending.shift()({rows:[future]});hook._dialog.buttons[2].action();assert.equal(cancelled,1);assert.equal(timers.size,0);
new Native()._confirm('ConfirmedLogout');pending.shift()({rows:[future]});hook._dialog.buttons[0].action();assert.equal(commands.at(-1),'slots:future');assert.equal(timers.size,0);
pending.shift()({error:'failed',rows:[future]});assert.equal(loggedOut,1);assert.match(hook._dialog._status.text,/still logged in/);
hook._dialog.buttons[0].action();pending.shift()({rows:[]});assert.equal(loggedOut,2);
new Native()._confirm('ConfirmedReboot');assert.equal(loggedOut,3);hook.disable();
console.log('PASS: future slot warning; no logout before 60s; timeout keeps slots; cancel clears timer; failed closure prevents logout; successful closure resumes; reboot bypass; hook cleanup');

let warningEnabled=false;
const optionalHook=new ctx.SystemSessionHook((cmd,cb)=>{commands.push(cmd);pending.push(cb);},()=>true,()=>warningEnabled);
optionalHook.enable();
const requestsBefore=commands.length,noticesBefore=notices;
new Native()._confirm('ConfirmedLogout');
assert.equal(loggedOut,4);assert.equal(commands.length,requestsBefore);assert.equal(notices,noticesBefore);assert.equal(optionalHook._dialog,undefined);
warningEnabled=true;
new Native()._confirm('ConfirmedLogout');
assert.equal(commands.length,requestsBefore+1);
pending.shift()({rows:[future]});assert.ok(optionalHook._dialog);
optionalHook._dialog.buttons[2].action();optionalHook.disable();
console.log('PASS: warning toggle bypasses slot requests/dialog/notifications and re-enables on next logout');

const reservedHook=new ctx.SystemSessionHook((cmd,cb)=>{commands.push(cmd);pending.push(cb);},()=>true);
reservedHook.enable();
const reserved={...future,matched:true,project:'Libft'};
new Native()._confirm('ConfirmedLogout');pending.shift()({rows:[reserved]});
assert(reservedHook._dialog,'reserved-only schedule must warn');
const walk=actor=>[actor,...(actor.children || []).flatMap(walk)];
assert(walk(reservedHook._dialog.contentLayout).some(a=>a.text?.includes('Libft')));
reservedHook._dialog.buttons[0].action();
pending.shift()({rows:[reserved]});
assert.equal(reservedHook._dialog,null,'remaining reservation does not fail available-slot closure');
reservedHook.disable();
console.log('PASS: reserved-only logout warning includes project and preserved reservations do not block closure result');

const past={id:'past',project:'ft_printf',begin:new Date(Date.now()-3600000).toISOString(),kind:'evaluator',users:['peer']};
const feedbackHook=new ctx.SystemSessionHook((cmd,cb)=>pending.push(cb),()=>true,()=>true,()=>[past,{...past,devTest:true},{...past,missing:true}]);
feedbackHook.enable();
new Native()._confirm('ConfirmedLogout');pending.shift()({rows:[]});
assert(feedbackHook._dialog,'past unconfirmed evaluation alone must warn');
const feedbackLabels=walk(feedbackHook._dialog.contentLayout).map(a=>a.text || '');
assert(feedbackLabels.some(t=>t==='Feedback confirmation pending · 1'));
assert(feedbackLabels.some(t=>t.includes('ft_printf') && t.includes('@peer') && t.includes('Evaluator')));
feedbackHook._dialog.buttons[2].action();feedbackHook.disable();
console.log('PASS: pending past evaluation shown with project, role, counterpart and time; missing/test cards excluded');
