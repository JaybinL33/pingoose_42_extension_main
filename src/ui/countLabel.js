const {GLib} = imports.gi;

function update(label, title, count, expanded) {
    const heading = GLib.markup_escape_text(title, -1);
    const value = GLib.markup_escape_text(String(count), -1);
    const suffix = count ? ` · ${expanded ? value : `<span foreground="#85d6cb">${value}</span>`}` : '';
    // St.Button's built-in label can be a Clutter.Text rather than St.Label.
    const text = label.get_clutter_text?.() ?? label.clutter_text ?? label;
    text.set_markup(heading + suffix);
}
