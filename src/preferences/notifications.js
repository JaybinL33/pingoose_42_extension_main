const {Gtk, Gio} = imports.gi;
const Common = imports.misc.extensionUtils.getCurrentExtension().imports.preferences.common;
function build(settings) {
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 18});
    box.append(new Gtk.Label({label: 'Choose which system notifications Pingoose shows. Cards and unread messages are still saved.', wrap: true, xalign: 0}));
    for (const [key, label] of [
        ['notify-evaluations', 'Evaluation matches, reminders and locations'],
        ['notify-agenda', 'New agenda events'],
        ['notify-chat', 'Cluster Chat messages'],
    ]) {
        const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER});
        settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        Common.row(box, label, toggle);
    }
    const flash = Gtk.SpinButton.new_with_range(0, 5, 1);
    settings.bind('flash-count', flash, 'value', Gio.SettingsBindFlags.DEFAULT);
    Common.row(box, 'Screen flash (0 = Off)', flash);
    return box;
}
