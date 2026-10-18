const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Item {constructor(){this.items=[];this.menu=this;}addMenuItem(item){this.items.push(item);}}
const now=Date.parse('2026-10-18T00:00:00Z');
class Clock extends Date {static now(){return now;}}
const context={Date:Clock,imports:{ui:{popupMenu:{PopupSubMenuMenuItem:Item,PopupMenuItem:Item}}}};
vm.createContext(context);vm.runInContext(fs.readFileSync('src/dev/devOptions.js','utf8'),context);
let role='evaluated';let offset=-20;const rows=[];
const menu=context.addOptions(new Item(),()=>{},row=>rows.push(row),{get_int:()=>offset,get_string:()=>role});
menu.items[1].activate();offset=10;role='evaluator';menu.items[1].activate();offset=0;menu.items[1].activate();
assert.deepEqual(rows.map(r=>Date.parse(r.begin)-now),[-1200000,600000,0]);
assert.equal(new Set(rows.map(r=>r.id)).size,3);
assert.ok(rows.every(r=>r.devTest));
console.log('PASS: newly created evaluations use live past/future/now offset and unique IDs');

assert.equal(rows[0].kind,'evaluated');assert.equal(rows[1].kind,'evaluator');
