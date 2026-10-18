const {Gtk,Gio}=imports.gi;
const Common=imports.misc.extensionUtils.getCurrentExtension().imports.preferences.common;
function build(settings){
    const box=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:8});
    box.append(new Gtk.Separator());
    box.append(new Gtk.Label({label:'Popup Position & Panel Spacing',xalign:0}));
    box.append(new Gtk.Label({label:'Margins apply immediately. Left margin moves the popup away from the right edge. Set a gap to 0 to join adjacent panels.',xalign:0,wrap:true}));
    for(const [key,label] of [['popup-top-margin','Top margin (px)'],['popup-left-margin','Left margin (px)'],
        ['main-panel-gap','Main page ↔ panel gap (px)'],['panel-gap','Panel ↔ panel gap (px)']]){
        const value=Gtk.SpinButton.new_with_range(0,100,1);
        settings.bind(key,value,'value',Gio.SettingsBindFlags.DEFAULT);
        Common.row(box,label,value);
    }
    return box;
}
