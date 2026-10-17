// Optional development UI. Release packages omit this module entirely.
const PopupMenu = imports.ui.popupMenu;
function addOptions(settings, sendTest) {
    const menu = new PopupMenu.PopupSubMenuMenuItem('Dev Options');
    const test = new PopupMenu.PopupMenuItem('Send Test Notification');
    test.activate = () => sendTest();
    menu.menu.addMenuItem(test);
    settings.addMenuItem(menu);
}
