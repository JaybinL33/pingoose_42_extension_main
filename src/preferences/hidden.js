const {Gtk,Gio}=imports.gi;
const Me=imports.misc.extensionUtils.getCurrentExtension();
function build(settings){
    const box=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:18});
    box.append(new Gtk.Label({label:'Experimental features. General chat requires both clients to enable it. Evaluation details are requested 15 minutes before the start, then every 5 seconds until the evaluation starts. Chat is disabled when the seat is unavailable. Evaluation chat is available only during those final 15 minutes.',wrap:true,xalign:0}));
    for(const [key,label] of [['hidden-cluster-chat','Cluster Chat'],['hidden-auto-slots','Auto Open Evaluation Slots'],['hidden-dev-options','Add Developer Options']]){
        const toggle=new Gtk.Switch({active:Me.imports.models.featureFlags.enabled(settings,key),valign:Gtk.Align.CENTER});
        box.connect('map',()=>{toggle.active=Me.imports.models.featureFlags.enabled(settings,key);});
        toggle.connect('notify::active',()=>settings.set_boolean(key,toggle.active));
        Me.imports.preferences.common.row(box,label,toggle);
        if(key==='hidden-cluster-chat'){
            const blocks=new Gtk.Button({label:'Manage Block List'});
            blocks.connect('clicked',()=>Me.imports.preferences.chatBlocks.open(box,settings));
            box.append(blocks);
        }
        if(key==='hidden-auto-slots'){
            for(const [setting,title,max] of [
                ['auto-slot-duration-units','Slot length (15 min × N)',16],
                ['auto-slot-interval-units','Gap after slot (15 min × N)',96],
                ['auto-slot-count','Number of slots',20]]){
                const spin=Gtk.SpinButton.new_with_range(1,max,1);
                settings.bind(setting,spin,'value',Gio.SettingsBindFlags.DEFAULT);
                Me.imports.preferences.common.row(box,title,spin);
            }
            box.append(new Gtk.Label({label:'Starts at the earliest available 15-minute boundary, at least 30 minutes from now. The next slot starts after the previous slot ends plus the configured gap.',wrap:true,xalign:0}));
        }

    }
    const role=new Gtk.ComboBoxText();
    role.append('evaluator','Evaluator');role.append('evaluated','Evaluatee');
    settings.bind('dev-evaluation-role',role,'active-id',Gio.SettingsBindFlags.DEFAULT);
    Me.imports.preferences.common.row(box,'Test Evaluation Role',role);
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
