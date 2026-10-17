const {Clutter, Pango, St} = imports.gi;
const PopupMenu = imports.ui.popupMenu;

var Controller = class Controller {
    _renderAgenda() {
        this._syncOptionalSections();
        const section = this._indicator.agenda;
        section.removeAll();
        if (!this._agenda?.length) return;
        const title = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        title.remove_all_children();
        title.set_style('padding-left: 0;');
        title.add_child(new St.Label({text: 'Agenda', style_class: 'pingoose-heading'}));
        section.addMenuItem(title);
        for (const row of this._agenda) {
            const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            item.remove_all_children();
            item.set_style('padding: 6px 0; spacing: 0;');
            const box = new St.BoxLayout({vertical: true, x_expand: false, x_align: Clutter.ActorAlign.START, style_class: 'pingoose-evaluation-card'});
            for (const text of [row.name, `${new Date(row.begin).toLocaleString('en-GB')} – ${new Date(row.end).toLocaleString('en-GB')}`, row.location,
                row.feedback ? 'Feedback pending' : ''].filter(Boolean)) {
                const label = new St.Label({text});
                label.clutter_text.line_wrap = true;
                label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                box.add_child(label);
            }
            item.add_child(box);
            section.addMenuItem(item);
        }
    }

};
