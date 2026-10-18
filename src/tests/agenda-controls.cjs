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
p._renderAgenda();click('×');click('Cancel');assert.equal(p._agenda.length,1);
click('×');click('Yes');assert.equal(p._agenda.length,0);assert(p._dismissedAgendaIds.has('1'));
click('Refresh');assert.equal(p._agenda.length,1);assert.equal(p._dismissedAgendaIds.size,0);assert.equal(p.sent,'agenda:refresh');
console.log('PASS: agenda confirmation, Cancel, hide all, retained Refresh and restoration');
