// Service windows share the authenticated worker's WebKit context.
const {Gtk, GLib, WebKit2} = imports.gi;
const System = imports.system;
const root = GLib.path_get_dirname(GLib.path_get_dirname(System.programPath));
const Sites = imports.models.serviceSites;
function open(context, name, url, project = false) {
const site = Sites.normalizeSite(name, url);
if (!site) throw new Error('Invalid service URL');
const view = new WebKit2.WebView({web_context: context});
view.get_settings().set_enable_write_console_messages_to_stdout(false);
const win = new Gtk.Window({title: site.name, default_width: 1050, default_height: 760});
win.set_wmclass('42intra', '42Intra');
win.set_icon_from_file(`${root}/assets/42intra.png`);
const header = new Gtk.HeaderBar({title: site.name, show_close_button: true});
if (project) {
    const home = new Gtk.Button({label: 'Intra Home'});
    home.connect('clicked', () => view.load_uri('https://profile-v3.intra.42.fr/'));
    header.pack_start(home);
} else {
    const navigation = new Gtk.Box({spacing: 6});
    const back = new Gtk.Button({label: 'Back', sensitive: false});
    const forward = new Gtk.Button({label: 'Forward', sensitive: false});
    back.connect('clicked', () => { if (view.can_go_back()) view.go_back(); });
    forward.connect('clicked', () => { if (view.can_go_forward()) view.go_forward(); });
    navigation.pack_start(back, false, false, 0);
    navigation.pack_start(forward, false, false, 0);
    header.pack_start(navigation);
    view.get_back_forward_list().connect('changed', () => {
        back.sensitive = view.can_go_back();
        forward.sensitive = view.can_go_forward();
    });
}
win.set_titlebar(header);
win.add(view);
view.connect('notify::title', () => { const title=view.get_title() || site.name; win.title=title; header.title=title; });
view.connect('permission-request', (_view, request) => { request.deny(); return true; });
const allowed = uri => {
    try { const u=GLib.Uri.parse(uri, GLib.UriFlags.NONE); return u.get_scheme()==='https' && !u.get_userinfo(); }
    catch (_) { return false; }
};
view.connect('decide-policy', (_view, decision, type) => {
    if (type === WebKit2.PolicyDecisionType.NAVIGATION_ACTION || type === WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION) {
        const uri = decision.get_navigation_action().get_request().get_uri();
        if (!allowed(uri)) { decision.ignore(); return true; }
        if (type === WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION) {
            decision.ignore(); view.load_uri(uri); return true;
        }
    }
    return false;
});
const downloadSignal = context.connect('download-started', (_context, download) => download.cancel());
win.connect('destroy', () => context.disconnect(downloadSignal));
view.load_uri(site.url);
win.show_all();
return win;
}
