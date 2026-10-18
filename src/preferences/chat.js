const {Gtk, Gio} = imports.gi;
const {row} = imports.misc.extensionUtils.getCurrentExtension().imports.preferences.common;
function build(settings) {
    const chat = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 18});
    const chatToggle = new Gtk.Switch({valign: Gtk.Align.CENTER});
    settings.bind('chat-enabled', chatToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
    row(chat, 'Enable Cluster Chat', chatToggle);
    chat.append(new Gtk.Label({label: 'Turn off to stop sending and receiving messages.\nBlocked rules remain saved after logout.', xalign: 0, wrap: true}));
    const type = new Gtk.ComboBoxText();
    for (const [id, name] of [['seat','Seat'], ['line','Line'], ['cluster','Cluster']]) type.append(id, name);
    type.set_active_id('seat');
    const input = new Gtk.Entry({placeholder_text: 'c2r3s4', hexpand: true});
    type.connect('changed', () => input.set_placeholder_text({seat:'c2r3s4',line:'c2r3',cluster:'c2'}[type.get_active_id()]));
    const add = new Gtk.Button({label: 'Block'});
    const entryRow = new Gtk.Box({spacing: 8});
    entryRow.append(type); entryRow.append(input); entryRow.append(add); chat.append(entryRow);
    const error = new Gtk.Label({label: '', xalign: 0, wrap: true}); chat.append(error);
    const rules = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8});
    const scroll = new Gtk.ScrolledWindow({vexpand: true, min_content_height: 160});
    scroll.set_child(rules); chat.append(scroll);
    const refresh = () => {
        let child;
        while ((child = rules.get_first_child())) rules.remove(child);
        const values = settings.get_strv('blocked-chat-seats');
        if (!values.length) rules.append(new Gtk.Label({label: 'No blocked seats, lines or clusters.', xalign: 0}));
        for (const value of values) {
            const remove = new Gtk.Button({label: 'Unblock'});
            remove.connect('clicked', () => {
                settings.set_strv('blocked-chat-seats', settings.get_strv('blocked-chat-seats').filter(rule => rule !== value));
                refresh();
            });
            const label = /^c[0-9]+$/.test(value) ? 'Cluster' : /^c[0-9]+r[0-9]+$/.test(value) ? 'Line' : 'Seat';
            row(rules, `${label} · ${value}`, remove);
        }
    };
    const block = () => {
        const value = input.get_text().trim().toLowerCase();
        const patterns = {seat:/^c[0-9]+r[0-9]+s[0-9]+$/,line:/^c[0-9]+r[0-9]+$/,cluster:/^c[0-9]+$/};
        if (!patterns[type.get_active_id()].test(value)) { error.label = 'Enter a valid identifier for the selected type.'; return; }
        settings.set_strv('blocked-chat-seats', [...new Set([...settings.get_strv('blocked-chat-seats'), value])]);
        input.set_text(''); error.label = ''; refresh();
    };
    add.connect('clicked', block); input.connect('activate', block); refresh();
    chat.connect('map',refresh);
    return chat;
}
