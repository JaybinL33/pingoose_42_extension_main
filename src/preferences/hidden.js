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
    const offset=new Gtk.SpinButton({
        adjustment:new Gtk.Adjustment({lower:-10080,upper:10080,step_increment:1,page_increment:10}),
        numeric:true,digits:0,valign:Gtk.Align.CENTER,
    });
    offset.set_value(settings.get_int('dev-evaluation-offset-minutes'));
    offset.connect('value-changed',()=>settings.set_int('dev-evaluation-offset-minutes',offset.get_value_as_int()));
    Me.imports.preferences.common.row(box,'Test Evaluation Start Offset (minutes)',offset);
    box.append(new Gtk.Label({label:'Negative: started minutes ago. Positive: starts in minutes. Applies to newly created test evaluations.',wrap:true,xalign:0}));
    return box;
}
