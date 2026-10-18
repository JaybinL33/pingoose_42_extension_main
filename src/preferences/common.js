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
