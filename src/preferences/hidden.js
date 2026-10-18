const {Gtk}=imports.gi;
const Me=imports.misc.extensionUtils.getCurrentExtension();
function build(settings){
    const box=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:18});
    box.append(new Gtk.Label({label:'Experimental features. General chat requires both clients to enable it. Evaluation chat remains available only during the final 14m 50s before the evaluation starts.',wrap:true,xalign:0}));
    for(const [key,label] of [['hidden-cluster-chat','Cluster Chat'],['hidden-auto-slots','Auto Open Evaluation Slots'],['hidden-dev-options','Add Developer Options']]){
        const toggle=new Gtk.Switch({active:Me.imports.models.featureFlags.enabled(settings,key),valign:Gtk.Align.CENTER});
        box.connect('map',()=>{toggle.active=Me.imports.models.featureFlags.enabled(settings,key);});
        toggle.connect('notify::active',()=>settings.set_boolean(key,toggle.active));
        Me.imports.preferences.common.row(box,label,toggle);
    }
    return box;
}
