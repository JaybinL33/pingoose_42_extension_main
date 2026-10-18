const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync('src/models/featureFlags.js','utf8'),c);
let unlocked=false;
const s={get_user_value:()=>null,get_boolean:key=>key==='hidden-options-unlocked'?unlocked:true,set_boolean:(_key,value)=>{unlocked=value;}};
c.HIDDEN_OPTIONS=false;assert.equal(c.enabled(s,'hidden-cluster-chat'),false);
c.HIDDEN_OPTIONS=true;c.DEVELOPMENT_DEFAULTS=true;assert.equal(c.enabled(s,'hidden-cluster-chat'),true);
s.get_user_value=()=>({});s.get_boolean=key=>key==='hidden-options-unlocked'?unlocked:false;assert.equal(c.enabled(s,'hidden-cluster-chat'),false);
c.HIDDEN_OPTIONS=false;s.get_boolean=key=>key==='hidden-options-unlocked'?unlocked:true;assert.equal(c.enabled(s,'hidden-cluster-chat'),false);
console.log('PASS: hard release gate, development defaults and explicit user disable');

assert.equal(c.unlock(s,'wrong'),false);assert.equal(unlocked,false);
assert.equal(c.unlock(s,'  Pingoose-Hidden  '),true);
assert.equal(c.unlocked(s),true);assert.equal(c.enabled(s,'hidden-cluster-chat'),true);
unlocked=false;assert.equal(c.unlocked(s),false);
console.log('PASS: phrase unlock, invalid phrase rejection and reset relock');
