const {Gtk,Gio}=imports.gi;
const Common=imports.misc.extensionUtils.getCurrentExtension().imports.preferences.common;
const Notes=imports.misc.extensionUtils.getCurrentExtension().imports.models.projectNotes;
function build(settings){
    const root=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:14,margin_top:24,margin_bottom:24,margin_start:24,margin_end:24});
    const row=new Gtk.Box({spacing:12});row.append(new Gtk.Label({label:'Open project page directly',hexpand:true,xalign:0}));
    const toggle=new Gtk.Switch({valign:Gtk.Align.CENTER});settings.bind('project-open-direct',toggle,'active',Gio.SettingsBindFlags.DEFAULT);row.append(toggle);root.append(row);
    const firstTab=new Gtk.ComboBoxText();firstTab.append('todo','TODO List');firstTab.append('note','Note');
    settings.bind('project-default-tab',firstTab,'active-id',Gio.SettingsBindFlags.DEFAULT);
    Common.row(root,'Default project tab',firstTab);
    root.append(new Gtk.Label({label:'Off: open TODO List and Note panel.\nSaved notes below are ordered by creation date (oldest first).',xalign:0,wrap:true}));
    const actions=new Gtk.Box({spacing:8});root.append(actions);
    const refresh=new Gtk.Button({label:'Refresh Notes'});actions.append(refresh);
    const clear=new Gtk.Button({label:'Delete All'});actions.append(clear);
    const status=new Gtk.Label({label:'',xalign:0,wrap:true});root.append(status);
    const scroll=new Gtk.ScrolledWindow({vexpand:true,min_content_height:250});const list=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:12});scroll.set_child(list);root.append(scroll);
    const render = () => Common.preserveListScroll(scroll, list, () => {
        let child;while((child=list.get_first_child()))list.remove(child);
        try{
            const notes=Notes.list();
            if(!notes.length)list.append(new Gtk.Label({label:'No saved notes.',xalign:0}));
            for(const note of notes){
                const card=new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:6});
                card.append(new Gtk.Label({label:`${note.projectName || note.project} · ${note.kind==='todo'?'TODO List':'Note'}\n${note.title || note.body.split('\n')[0].slice(0,80)}`,xalign:0,wrap:true}));
                card.append(new Gtk.Label({label:`Created ${new Date(note.created).toLocaleString()}`,xalign:0}));
                const remove=new Gtk.Button({label:'Delete'});remove.connect('clicked',()=>{
                    Common.confirm(root,note.kind==='todo'?'Delete this TODO list?':'Delete this note?',
                        'This action cannot be undone.','Delete',()=>{
                            try{Notes.remove(note.id);render();}catch(_){status.label='Unable to delete. Please retry.';}
                        });
                });card.append(remove);list.append(card);
            }
        }catch(_){list.append(new Gtk.Label({label:'Unable to read notes.',xalign:0}));}
    });
    clear.connect('clicked',()=>Common.confirm(root,'Delete all notes and TODO lists?',
        'All saved project notes and TODO lists will be permanently deleted.','Delete All',()=>{
            try{Notes.clear();render();status.label='All notes and TODO lists deleted.';}catch(_){status.label='Unable to delete. Please retry.';}
        }));
    refresh.connect('clicked',render);root.connect('map',render);render();return root;
}
