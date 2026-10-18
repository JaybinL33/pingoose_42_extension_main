const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Actor{
 constructor(props={}){Object.assign(this,props);this.children=[];this.clutter_text={};}
 add_child(child){this.children.push(child);}
 remove_all_children(){this.children=[];}
 set_style(){}
 connect(name,cb){this[name]=cb;}
}
const ctx={imports:{gi:{Clutter:{ActorAlign:{END:1,CENTER:2,START:3}},Pango:{WrapMode:{WORD_CHAR:1}},St:{BoxLayout:Actor,Label:Actor,Button:Actor}},ui:{popupMenu:{PopupBaseMenuItem:Actor}}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/ui/agenda.js','utf8'),ctx);
const p=new ctx.Controller(),section={items:[],removeAll(){this.items=[];},addMenuItem(item){this.items.push(item);}};
p._indicator={agenda:section};p._syncOptionalSections=()=>{};p._send=command=>p.sent=command;
const row={id:'1',name:'Event',begin:new Date().toISOString(),end:new Date().toISOString()};
p._agenda=[row];p._agendaAll=[row];
function all(actor){return [actor,...(actor.children || []).flatMap(all)];}
function click(label){const button=section.items.flatMap(all).find(actor=>actor.label===label);assert(button,label);button.clicked();}

let saved=[];
p._settings={set_strv:(_key,ids)=>saved=[...ids],get_strv:()=>saved};
function confirmDelete(answer){click('⋮');click('Delete');click(answer);}
p._renderAgenda();confirmDelete('No');assert.equal(p._agenda.length,1);
confirmDelete('Yes');assert.equal(p._agenda.length,0);
assert.deepEqual(saved,['1']);
assert.equal(section.items.length,0,'no title or footer after last deletion');
// Replay the actual incoming server snapshot handler, including a restart.
const source=fs.readFileSync('src/extension.js','utf8');
const start=source.indexOf("        if (message.type === 'agenda'");
const end=source.indexOf("\n        if (message.type",start+10);
const handle=vm.runInContext('(function(message){'+source.slice(start,end)+'})',ctx);
p._dismissedAgendaIds=new Set(saved);
for(let i=0;i<3;i++){
 handle.call(p,{type:'agenda',rows:[row]});
 assert.equal(p._agenda.length,0,'server refresh cannot restore acknowledged agenda');
}
p._restoreAgenda();assert.equal(p._agenda.length,1);assert.equal(saved.length,0);
const testRow={...row,id:'test:agenda',devTest:true};
p._agenda=[testRow];p._agendaAll=[row,testRow];p._renderAgenda();
confirmDelete('Yes');
handle.call(p,{type:'agenda',rows:[row]});
assert(!p._agenda.some(item=>item.devTest),'test agenda remains dismissed on refresh');
for(let i=0;i<3;i++){
 p._restoreAgenda();
 handle.call(p,{type:'agenda',rows:[row]});
 assert(!p._agenda.some(item=>item.devTest),'reset must not restore deleted test cards');
 assert.equal(p._agenda[0].id,row.id,'server agenda still restored');
}
assert(!section.items.flatMap(all).some(actor=>actor.label==='Refresh'));
console.log('PASS: options → Delete → Yes/No; persisted dismissal survives server refresh/restart; explicit reset restores cards; no footer Refresh');
