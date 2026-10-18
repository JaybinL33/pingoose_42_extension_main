const {Gtk} = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
function init() {}
function buildPrefsWidget() {
    const settings = ExtensionUtils.getSettings();
    const preferences = ExtensionUtils.getCurrentExtension().imports.preferences;
    const tabs = new Gtk.Notebook({hexpand: true, vexpand: true});
    for (const [module, title] of [['general','General'], ['appearance','Appearance'],
        ['projects','Projects'], ['chat','Cluster Chat'], ['services','42 Services']]) {
        const page = preferences[module].build(settings);
        page.margin_top = page.margin_bottom = page.margin_start = page.margin_end = 24;
        tabs.append_page(page, new Gtk.Label({label:title}));
    }
    return tabs;
}
