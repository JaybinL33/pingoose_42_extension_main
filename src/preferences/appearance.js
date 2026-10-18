const {Gtk, Gio} = imports.gi;
const Order = imports.misc.extensionUtils.getCurrentExtension().imports.models.appearance;
function build(settings) {
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12});
    box.append(new Gtk.Label({label: 'Show or hide cards and use the arrows to change their order.\nMy Projects and Logtime share one row. Hidden cards keep their position.', xalign: 0, wrap: true}));
    const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 10});
    const scroll = new Gtk.ScrolledWindow({vexpand: true, min_content_height: 360,
        hscrollbar_policy: Gtk.PolicyType.NEVER});
    scroll.set_child(list); box.append(scroll);
    const rows = new Map();
    const refresh = () => {
        const order = Order.read(settings);
        order.forEach((key, index) => {
            const item = rows.get(key);
            list.reorder_child_after(item.row, index ? rows.get(order[index - 1]).row : null);
            item.number.label = `${index + 1}.`;
            item.up.sensitive = index > 0;
            item.down.sensitive = index < order.length - 1;
        });
    };
    for (const [key, name, toggles] of Order.sections) {
        const row = new Gtk.Box({spacing: 10});
        const number = new Gtk.Label({width_chars: 2}); row.append(number);
        const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4, hexpand: true});
        if (toggles.length > 1) content.append(new Gtk.Label({label: name, xalign: 0}));
        for (const toggleKey of toggles) {
            const line = new Gtk.Box({spacing: 12});
            const label = toggles.length === 1 ? name : {projects:'My Projects',logtime:'Logtime'}[toggleKey];
            line.append(new Gtk.Label({label, xalign: 0, hexpand: true}));
            const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER});
            settings.bind(`show-${toggleKey}`, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
            line.append(toggle); content.append(line);
        }
        row.append(content);
        const up = new Gtk.Button({label: '↑', tooltip_text: 'Move up', valign: Gtk.Align.CENTER});
        const down = new Gtk.Button({label: '↓', tooltip_text: 'Move down', valign: Gtk.Align.CENTER});
        const move = delta => {
            const order = Order.read(settings), index = order.indexOf(key), target = index + delta;
            if (target < 0 || target >= order.length) return;
            [order[index], order[target]] = [order[target], order[index]];
            settings.set_strv('section-order', order);
        };
        up.connect('clicked', () => move(-1)); down.connect('clicked', () => move(1));
        row.append(up); row.append(down); list.append(row);
        rows.set(key, {row,number,up,down});
    }
    const reset = new Gtk.Button({label:'Reset order'});
    reset.connect('clicked', () => settings.reset('section-order')); box.append(reset);
    let signal = 0;
    box.connect('map', () => {
        if (!signal) signal = settings.connect('changed::section-order', refresh);
        refresh();
    });
    box.connect('unmap', () => {
        if (signal) settings.disconnect(signal);
        signal = 0;
    });
    refresh(); return box;
}
