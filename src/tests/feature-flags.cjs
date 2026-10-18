const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync('src/models/featureFlags.js','utf8'),c);
const s={get_user_value:()=>null,get_boolean:()=>true};
c.HIDDEN_OPTIONS=false;assert.equal(c.enabled(s,'hidden-cluster-chat'),false);
c.HIDDEN_OPTIONS=true;c.DEVELOPMENT_DEFAULTS=true;assert.equal(c.enabled(s,'hidden-cluster-chat'),true);
s.get_user_value=()=>({});s.get_boolean=()=>false;assert.equal(c.enabled(s,'hidden-cluster-chat'),false);
c.HIDDEN_OPTIONS=false;s.get_boolean=()=>true;assert.equal(c.enabled(s,'hidden-cluster-chat'),false);
console.log('PASS: hard release gate, development defaults and explicit user disable');
