// Assemble method text for VM probes without loading GNOME Shell in Node.
const fs = require('node:fs');
const read = path => fs.readFileSync(`src/${path}`, 'utf8');
const original = read('extension.js');
const controller = name => {
 const text=read(`ui/${name}.js`);
 return text.slice(text.indexOf('var Controller = class Controller {')+'var Controller = class Controller {'.length,text.lastIndexOf('};'));
};
const head=original.slice(0,original.indexOf('class Pingoose {'));
const start=original.indexOf('class Pingoose {');
const end=original.indexOf('    disable()');
module.exports=head+read('ui/indicator.js')+original.slice(start,end).replace('    _clearProfile()', controller('settings')+'    _clearProfile()')+controller('notifications').split('    _renderCards()')[0]+controller('evaluations')+controller('slots')+controller('agenda')+controller('visibility')+'    _renderCards()'+controller('notifications').split('    _renderCards()')[1]+original.slice(end);
