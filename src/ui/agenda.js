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
            const box = new St.BoxLayout({vertical: true, x_expand: false, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.START, style_class: 'pingoose-evaluation-card pingoose-agenda-card'});
            {
                const header=new St.BoxLayout({x_expand:true});
                const title=new St.Label({text:row.name,x_expand:true,style_class:'pingoose-evaluation-title'});
                title.clutter_text.line_wrap=true;header.add_child(title);
                const remove=new St.Button({label:'⋮',accessible_name:'Agenda options',can_focus:true,
                    style_class:'pingoose-note-options',x_align:Clutter.ActorAlign.END,y_align:Clutter.ActorAlign.CENTER});
                remove.connect('clicked',()=>{this._agendaOptions=this._agendaOptions===row.id?null:row.id;this._agendaConfirm=null;this._renderAgenda();});
                header.add_child(remove);box.add_child(header);
            }
            for (const text of [ `${new Date(row.begin).toLocaleString('en-GB')} – ${new Date(row.end).toLocaleString('en-GB')}`, row.location,
                row.feedback ? 'Feedback pending' : ''].filter(Boolean)) {
                const label = new St.Label({text});
                label.clutter_text.line_wrap = true;
                label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                box.add_child(label);
            }
            if(this._agendaOptions===row.id && this._agendaConfirm!==row.id){
                const remove=new St.Button({label:'Delete',can_focus:true,style_class:'pingoose-clear-button'});
                remove.connect('clicked',()=>{this._agendaOptions=null;this._agendaConfirm=row.id;this._renderAgenda();});
                box.add_child(remove);
            }
            if(this._agendaConfirm===row.id){
                box.add_child(new St.Label({text:'Have you checked this agenda?',style_class:'pingoose-feedback-question pingoose-agenda-question'}));
                const actions=new St.BoxLayout({style_class:'pingoose-feedback-actions',x_expand:true});
                const yes=new St.Button({label:'Yes',can_focus:true,x_expand:true,style_class:'pingoose-feedback-button pingoose-feedback-half'});
                yes.connect('clicked',()=>{
                    this._dismissedAgendaIds ||= new Set();
                    if (row.devTest) {
                        this._agendaAll=(this._agendaAll || []).filter(item=>item.id!==row.id);
                        this._dismissedAgendaIds.delete(String(row.id));
                    } else {
                        this._dismissedAgendaIds.add(String(row.id));
                    }
                    this._agenda=this._agenda.filter(item=>item.id!==row.id);
                    this._agendaConfirm=null;this._agendaOptions=null;
                    this._settings.set_strv('dismissed-agenda-ids',[...this._dismissedAgendaIds]);
                    this._renderAgenda();
                });
                const cancel=new St.Button({label:'No',can_focus:true,x_expand:true,style_class:'pingoose-feedback-button pingoose-feedback-half'});
                cancel.connect('clicked',()=>{this._agendaConfirm=null;this._renderAgenda();});
                actions.add_child(yes);actions.add_child(cancel);box.add_child(actions);
            }
            item.add_child(box);
            section.addMenuItem(item);
        }
    }

    _restoreAgenda() {
        this._settings.set_strv('dismissed-agenda-ids',[]);
        this._dismissedAgendaIds = new Set();
        this._agendaOptions = null;
        this._agendaConfirm = null;
        this._agenda = [...(this._agendaAll || [])];
        this._renderAgenda();
    }

};
