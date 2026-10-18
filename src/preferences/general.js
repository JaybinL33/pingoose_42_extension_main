const {Gtk, Gio, GLib} = imports.gi;
const Common = imports.misc.extensionUtils.getCurrentExtension().imports.preferences.common;
function build(settings) {
    const box = new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:18});
    const theme = new Gtk.ComboBoxText();
    theme.append('dark','Dark'); theme.append('light','Light');
    settings.bind('theme',theme,'active-id',Gio.SettingsBindFlags.DEFAULT);
    Common.row(box,'Color mode',theme);
    const flash = Gtk.SpinButton.new_with_range(0,5,1);
    settings.bind('flash-count',flash,'value',Gio.SettingsBindFlags.DEFAULT);
    Common.row(box,'Screen flash (0 = Off)',flash);
    const flags=imports.misc.extensionUtils.getCurrentExtension().imports.models.featureFlags;
    const code=new Gtk.Entry({placeholder_text:'Enter an access phrase',hexpand:true});
    Common.row(box,'Advanced access',code);
    const unlockStatus=new Gtk.Label({label:flags.unlocked(settings)?'Hidden Options unlocked.':'',xalign:0});
    box.append(unlockStatus);
    code.connect('changed',()=>{
        if(!flags.unlock(settings,code.get_text()))return;
        code.set_text('');
        const active=flags.unlocked(settings);
        unlockStatus.label=active?'Hidden Options unlocked.':'Hidden Options disabled.';
        const dialog=new Gtk.MessageDialog({transient_for:box.get_root(),modal:true,
            message_type:Gtk.MessageType.INFO,buttons:Gtk.ButtonsType.OK,
            text:active?'Hidden Options unlocked':'Hidden Options disabled',
            secondary_text:active?'Open the Hidden Options tab to enable advanced features.':'Hidden Options and advanced features are now disabled.'});
        dialog.connect('response',()=>dialog.destroy());
        dialog.present();
    });
    box.append(new Gtk.Separator());
    box.append(new Gtk.Label({label:'Restore defaults, delete all local extension data and log out of Intra.',xalign:0,wrap:true}));
    const reset = new Gtk.Button({label:'Reset All Data'}); box.append(reset);
    const status = new Gtk.Label({label:'',xalign:0,wrap:true}); box.append(status);
    const refresh = () => {
        const value = settings.get_string('reset-status');
        reset.sensitive = !['pending','running'].includes(value);
        status.label = {pending:'Reset requested. Enable the extension if it is disabled.',
            running:'Resetting…',done:'Reset complete. All local data was deleted and you are logged out.',
            error:'Reset failed or was interrupted. Enable the extension and try again.'}[value] || '';
    };
    reset.connect('clicked',()=>Common.confirm(box,'Reset all data?',
        'This permanently deletes all notes, TODO lists, chat history, notifications, cached profiles and website login data. Settings return to their defaults and Intra is logged out. Server-side projects and evaluation slots are not changed.',
        'Reset All Data',()=>{
            settings.set_string('reset-status','pending');
            settings.set_string('reset-request',GLib.uuid_string_random());
            Gio.Settings.sync(); refresh();
        }));
    let signal=0;
    box.connect('map',()=>{if(!signal)signal=settings.connect('changed::reset-status',refresh);refresh();});
    box.connect('unmap',()=>{if(signal)settings.disconnect(signal);signal=0;});
    refresh(); return box;
}
