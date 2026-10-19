const {Gtk, Gio, GLib} = imports.gi;
const Common = imports.misc.extensionUtils.getCurrentExtension().imports.preferences.common;
function build(settings) {
    const box = new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:18});
    const theme = new Gtk.ComboBoxText();
    theme.append('dark','Dark'); theme.append('light','Light');
    settings.bind('theme',theme,'active-id',Gio.SettingsBindFlags.DEFAULT);
    Common.row(box,'Color mode',theme);
    box.append(new Gtk.Separator());
    const agendaReset=new Gtk.Button({label:'Agenda Reset'});
    agendaReset.connect('clicked',()=>Common.confirm(box,'Reset agenda cards?',
        'Restore deleted agenda cards and request the current agenda from Intra. This does not change subscriptions or submit feedback.',
        'Reset',()=>{
            settings.set_strv('dismissed-agenda-ids',[]);
            settings.set_string('agenda-reset-request',GLib.uuid_string_random());
            Gio.Settings.sync();
        }));
    box.append(agendaReset);
    const logout=new Gtk.Button({label:'Logout Intra'});
    logout.connect('clicked',()=>Common.confirm(box,'Log out of 42 Intra?',
        'You will need to log in again to view your Intra information.','Log Out',()=>{
            settings.set_string('logout-request',GLib.uuid_string_random());
            Gio.Settings.sync();
        }));
    box.append(logout);
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
