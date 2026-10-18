const {Gtk} = imports.gi;

// Shared by the Intra window and authenticated service/project windows.
function create(view) {
    const box = new Gtk.Box({spacing: 6});
    const iconButton = (name, icon) => {
        const button = new Gtk.Button({tooltip_text: name});
        button.set_image(Gtk.Image.new_from_icon_name(icon, Gtk.IconSize.BUTTON));
        button.get_accessible().set_name(name);
        return button;
    };
    const back = iconButton('Back', 'go-previous-symbolic');
    const forward = iconButton('Forward', 'go-next-symbolic');
    const refresh = iconButton('Refresh', 'view-refresh-symbolic');
    back.connect('clicked', () => { if (view.can_go_back()) view.go_back(); });
    forward.connect('clicked', () => { if (view.can_go_forward()) view.go_forward(); });
    refresh.connect('clicked', () => view.reload());
    for (const button of [back, forward, refresh])
        box.pack_start(button, false, false, 0);
    const sync = () => {
        back.sensitive = view.can_go_back();
        forward.sensitive = view.can_go_forward();
    };
    view.get_back_forward_list().connect('changed', sync);
    sync();
    box.show_all();
    return box;
}
