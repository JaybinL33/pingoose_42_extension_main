const {Gtk,Gdk}=imports.gi;
function append(parent,settings) {
    const row=new Gtk.Box({spacing:12});
    row.append(new Gtk.Label({label:'Open Pingoose shortcut',hexpand:true,xalign:0,wrap:true}));
    const capture=new Gtk.Button({label:'Not set'});
    const reset=new Gtk.Button({label:'Reset'});
    row.append(capture);row.append(reset);parent.append(row);
    const hint=new Gtk.Label({label:'Click to record a key combination. Escape cancels. Reset disables the shortcut.',wrap:true,xalign:0});parent.append(hint);
    let recording=false;
    const update=()=>{const accelerator=settings.get_strv('panel-shortcut')[0];const [ok,key,mods]=Gtk.accelerator_parse(accelerator || '');capture.label=accelerator && ok && key?Gtk.accelerator_get_label(key,mods):'Not set';};
    capture.connect('clicked',()=>{recording=true;capture.label='Press shortcut…';capture.grab_focus();});
    reset.connect('clicked',()=>{recording=false;settings.reset('panel-shortcut');update();});
    const keys=new Gtk.EventControllerKey();keys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
    keys.connect('key-pressed',(_controller,key,_code,state)=>{
        if(!recording)return false;
        if(key===Gdk.KEY_Escape){recording=false;update();return true;}
        const mods=state & Gtk.accelerator_get_default_mod_mask();
        if(!Gtk.accelerator_valid(key,mods))return true;
        settings.set_strv('panel-shortcut',[Gtk.accelerator_name(key,mods)]);
        recording=false;update();return true;
    });
    capture.add_controller(keys);
    capture.connect('notify::has-focus',()=>{if(recording && !capture.has_focus){recording=false;update();}});
    update();
}
