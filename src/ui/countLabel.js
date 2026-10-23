const {GLib} = imports.gi;

function update(label, title, count, expanded) {
    const heading = GLib.markup_escape_text(title, -1);
    const value = GLib.markup_escape_text(String(count), -1);
    const suffix = count ? ` · ${expanded ? value : `<span foreground="#85d6cb">${value}</span>`}` : '';
    label.clutter_text.set_markup(heading + suffix);
}
