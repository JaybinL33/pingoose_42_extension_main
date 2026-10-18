const {Gtk} = imports.gi;
function row(parent, name, control) {
    const box = new Gtk.Box({spacing:24});
    box.append(new Gtk.Label({label:name, xalign:0, hexpand:true}));
    box.append(control); parent.append(box);
}
function confirm(parent, title, detail, accept, action) {
    const dialog = new Gtk.MessageDialog({transient_for:parent.get_root(), modal:true,
        message_type:Gtk.MessageType.QUESTION, buttons:Gtk.ButtonsType.NONE,
        text:title, secondary_text:detail});
    dialog.add_button('Cancel',Gtk.ResponseType.CANCEL);
    dialog.add_button(accept,Gtk.ResponseType.ACCEPT);
    dialog.set_default_response(Gtk.ResponseType.CANCEL);
    dialog.connect('response',(_dialog,response)=>{
        dialog.destroy();
        if(response===Gtk.ResponseType.ACCEPT) action();
    });
    dialog.present();
}

// Replacing a focused row lets GTK move focus to a later row and scroll to it.
// Move focus to the viewport before removal, then restore the user's position
// after allocation. Only list mutations use this; normal keyboard navigation stays intact.
function preserveListScroll(scroll, list, update) {
    if (!scroll.get_mapped()) { update(); return; }
    const adjustment = scroll.get_vadjustment();
    const previous = scroll._pingooseScrollRestore;
    const value = previous ? previous.value : adjustment.value;
    if (previous) scroll.remove_tick_callback(previous.id);
    const focus = scroll.get_root()?.get_focus();
    if (focus && (focus === list || focus.is_ancestor(list))) {
        scroll.set_focusable(true);
        scroll.grab_focus();
    }
    update();
    let frames = 0;
    const pending = {value, id: 0};
    pending.id = scroll.add_tick_callback(() => {
        if (++frames < 2) return true;
        adjustment.value = Math.max(adjustment.lower,
            Math.min(value, adjustment.upper - adjustment.page_size));
        scroll._pingooseScrollRestore = null;
        return false;
    });
    scroll._pingooseScrollRestore = pending;
    if (!scroll._pingooseScrollUnmap) {
        scroll._pingooseScrollUnmap = scroll.connect('unmap', () => {
            const pending = scroll._pingooseScrollRestore;
            if (pending) scroll.remove_tick_callback(pending.id);
            scroll._pingooseScrollRestore = null;
        });
    }
}
