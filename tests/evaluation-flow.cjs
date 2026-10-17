const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('../pingoose-v3-staging.1KaoVt/evaluations.js');
const row = {id: 123, kind: 'evaluator', begin_at: '2026-10-20T18:45:00+09:00', project_name: 'Codexion'};
let state = model.advanceSeen(null, 'subject', model.parseRows([])).state;
let plan = model.advanceSeen(state, 'subject', model.parseRows([row]));
assert.equal(plan.added.length, 1);
const event = model.notification(plan.added[0]);
assert.match(event.body, /Codexion/);
state = model.storedState(JSON.stringify(plan.state));
assert.equal(model.advanceSeen(state, 'subject', model.parseRows([row])).added.length, 0);
assert.equal(model.advanceSeen(null, 'subject', model.parseRows([row])).added.length, 1);
assert.equal(model.parseRows([{...row, kind: 'evaluated'}]).length, 1);
assert.throws(() => model.parseRows([{...row, begin_at: 'invalid'}]));
assert.equal(model.advanceSeen(state, 'subject', model.parseRows([row, {...row,id:124}])).added.length, 1);
const source = fs.readFileSync('pingoose-v3-staging.1KaoVt/extension.js', 'utf8');
class Actor {
 constructor(props={}) {Object.assign(this,props);this.children=[];this.clutter_text={};}
 add_child(child){this.children.push(child);}
 set_child(child){this.child=child;this.label=child.text;}
 set_style(){}
 add_style_class_name(){}
 connect(name, fn){this[name]=fn;}
}
class Section {constructor(){this.items=[];} removeAll(){this.items=[];} addMenuItem(i){this.items.push(i);}}
let banners=0;
const context={PopupMenu:{PopupBaseMenuItem:Actor,PopupMenuItem:Actor},St:{BoxLayout:Actor,Label:Actor,Button:Actor,Bin:Actor,Icon:Actor},Clutter:{ActorAlign:{CENTER:0,END:1}},Pango:{WrapMode:{WORD_CHAR:0},EllipsizeMode:{NONE:0}},Main:{notify(){banners++;}},GLib:{DateTime:{new_now_local:()=>({format:()=> '18:45'})}}};
vm.createContext(context);
vm.runInContext('class Probe {'+source.slice(source.indexOf('    _message(message)'),source.indexOf('    _flashScreen('))+source.slice(source.indexOf('    _renderCards()'),source.indexOf('    disable()'))+'}; globalThis.Probe=Probe;',context);
const p=new context.Probe();p._syncOptionalSections=()=>{};p._updatePanelLabel=()=>{};p._notifications=[];p._indicator={cards:new Section(),menu:{isOpen:false},count:{},profileReady:true,loginOnly:false};p._flashScreen=()=>{};
p._message(event);
assert.equal(p._notifications.length,1);assert.equal(banners,1);assert.equal(p._indicator.cards.items.length,2);
p._message(event);assert.equal(banners,1);
for(let id=124;id<130;id++)p._message(model.notification({...model.parseRows([row])[0],id:String(id)}));
assert.equal(p._notifications.length,5);
const dismiss=p._indicator.cards.items[0].children[0];dismiss.clicked();assert.equal(p._notifications.length,4);
const footer=p._indicator.cards.items.at(-1);footer.children[0].clicked();assert.equal(p._notifications.length,0);assert.equal(p._indicator.cards.items.length,0);
console.log('PASS: new evaluation → notification → card; duplicate/restart/baseline; malformed response; 5-card limit; individual and clear-all deletion');

assert.equal(model.parseRows([{...row, begin_at: '2026-10-20T09:45:00', user: 'peer'}])[0].begin, '2026-10-20T09:45:00Z');
assert.deepEqual(model.parseRows([{...row, kind:'evaluated', user:'peer'}])[0].users, ['peer']);
vm.runInContext('class EvaluationProbe {'+source.slice(source.indexOf('    _renderEvaluations()'),source.indexOf('    _renderCards()'))+'}; globalThis.EvaluationProbe=EvaluationProbe;',context);
const e=new context.EvaluationProbe();e._syncOptionalSections=()=>{};e._indicator={evaluations:new Section()};e._feedback={};e._send=command=>{e.sent=command;};
e._evaluations=[{id:'42',project:'Codexion',kind:'evaluated',begin:new Date(Date.now()-1000).toISOString(),users:['peer']}];
e._renderEvaluations();
let box=e._indicator.evaluations.items[1].children[0];
assert.equal(box.children.at(-1).label,'Have you submitted your evaluation feedback?');
box.children.at(-1).clicked();box=e._indicator.evaluations.items[1].children[0];
assert.equal(box.children.at(-2).label,'Yes');box.children.at(-1).clicked();
box=e._indicator.evaluations.items[1].children[0];assert.equal(box.children.at(-2).label,'Open Project');
box.children.at(-1).clicked();box=e._indicator.evaluations.items[1].children[0];box.children.at(-1).clicked();
box=e._indicator.evaluations.items[1].children[0];box.children.at(-2).clicked();assert.equal(e.sent,'feedback:42');
e._evaluations[0].begin=new Date(Date.now()+60000).toISOString();e._renderEvaluations();
box=e._indicator.evaluations.items[1].children[0];assert.equal(box.children.length,3);
console.log('PASS: actual user field, UTC timestamp, Evaluation Info and feedback branches; no early dismissal button');
vm.runInContext('class VisibilityProbe {'+source.slice(source.indexOf('    _syncOptionalSections()'),source.indexOf('    _renderCards()'))+'}; globalThis.VisibilityProbe=VisibilityProbe;',context);
const visibility=new context.VisibilityProbe();visibility._updatePanelLabel=()=>{};
visibility._indicator=Object.fromEntries(['evaluationItem','evaluationSeparator','notificationItem','notificationSeparator','agendaItem','agendaSeparator'].map(key=>[key,{actor:{}}]));
visibility._evaluations=[];visibility._notifications=[];visibility._syncOptionalSections();
assert.ok(Object.values(visibility._indicator).every(item=>!item.actor.visible));
visibility._evaluations=[{}];visibility._notifications=[{}];visibility._agenda=[{}];visibility._syncOptionalSections();
assert.ok(Object.values(visibility._indicator).every(item=>item.actor.visible));
visibility._settingsVisible=true;visibility._syncOptionalSections();
assert.ok(Object.values(visibility._indicator).every(item=>!item.actor.visible));
console.log('PASS: empty sections and separators hidden; populated sections visible only on main page');
vm.runInContext('class PanelProbe {'+source.slice(source.indexOf('    _updatePanelLabel()'),source.indexOf('    _syncOptionalSections()'))+'};globalThis.PanelProbe=PanelProbe;',context);
const panel=new context.PanelProbe();panel._indicator={loginOnly:false,profileReady:true,count:{}};
panel._notifications=[{unread:true}];panel._updatePanelLabel();assert.equal(panel._indicator.count.text,'New 1');
panel._agenda=[{feedback:true}];panel._updatePanelLabel();assert.equal(panel._indicator.count.text,'Feedback 1');
panel._evaluations=[{begin:new Date(Date.now()-1000).toISOString()}];panel._updatePanelLabel();assert.equal(panel._indicator.count.text,'Feedback 2');
panel._agenda=[];panel._evaluations=[];panel._notifications[0].unread=false;panel._updatePanelLabel();assert.equal(panel._indicator.count.text,'42');
console.log('PASS: panel unread count, feedback priority/count and return to 42');
