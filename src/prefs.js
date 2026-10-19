const {Gtk} = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
function init() {}
function buildPrefsWidget() {
    const settings = ExtensionUtils.getSettings();
    const preferences = ExtensionUtils.getCurrentExtension().imports.preferences;
    const tabs = new Gtk.Notebook({hexpand: true, vexpand: true, focusable: true});
    for (const [module, title] of [['general','General'], ['notifications','Notifications'], ['appearance','Appearance'],
        ['projects','Projects'], ['services','42 Services']]) {
        const page = preferences[module].build(settings);
        page.margin_top = page.margin_bottom = page.margin_start = page.margin_end = 24;
        tabs.append_page(page, new Gtk.Label({label:title}));
    }
    const flags=ExtensionUtils.getCurrentExtension().imports.models.featureFlags;
    let hidden=null,signal=0;
    const syncHidden=()=>{
        if(flags.unlocked(settings)){
            if(hidden)return;
            hidden=preferences.hidden.build(settings);
            hidden.margin_top=hidden.margin_bottom=hidden.margin_start=hidden.margin_end=24;
            tabs.append_page(hidden,new Gtk.Label({label:'Hidden Options'}));
            hidden.show();
        }else if(hidden){
            tabs.remove_page(tabs.page_num(hidden));
            hidden=null;
        }
    };
    // Keep initial/restored focus on the tab strip so GTK does not scroll a
    // lower entry or button into view when opening preferences or changing tabs.
    tabs.connect('switch-page', () => tabs.grab_focus());
    tabs.connect('map',()=>{
        tabs.grab_focus();
        if(!signal)signal=settings.connect('changed::hidden-options-unlocked',syncHidden);
        syncHidden();
    });
    tabs.connect('unmap',()=>{if(signal)settings.disconnect(signal);signal=0;});
    syncHidden();
    preferences.hiddenAccess.attach(tabs,settings);
    return tabs;
}
