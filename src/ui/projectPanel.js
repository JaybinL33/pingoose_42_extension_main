const {Clutter, Gio, GLib, Meta, Pango, St} = imports.gi;
const Me=imports.misc.extensionUtils.getCurrentExtension();
const Notes=Me.imports.models.projectNotes;
var ProjectPanel=class ProjectPanel {
    constructor(indicator,visit) {
        this.indicator=indicator;this.visit=visit;this.kind='todo';this.drafts=new Map();
        this.root=new St.BoxLayout({vertical:true,reactive:true,visible:false,y_expand:false,y_align:Clutter.ActorAlign.START,
            style_class:'pingoose-chat-panel pingoose-project-panel'});
        indicator.sideColumns.insert_child_at_index(this.root,0);
        const header=new St.BoxLayout({style_class:'pingoose-chat-header'});
        this.title=new St.Label({text:'Project',x_expand:true,style_class:'pingoose-heading'});
        this.title.clutter_text.ellipsize=Pango.EllipsizeMode.NONE;
        this.title.clutter_text.line_wrap=true;this.title.clutter_text.line_wrap_mode=Pango.WrapMode.WORD_CHAR;
        header.add_child(this.title);
        const close=this.dismiss('Close project notes',()=>{this.capture();this.expanded=false;this.sync();});
        close.accessible_name='Close project notes';header.add_child(close);this.root.add_child(header);
        this.root.add_child(new St.Widget({style_class:'pingoose-project-divider'}));
        const tabs=this.tabs=new St.BoxLayout({style_class:'pingoose-chat-input-row'});
        this.todoTab=this.button('TODO List',()=>this.switchTab('todo'));
        this.noteTab=this.button('Note',()=>this.switchTab('note'));
        tabs.add_child(this.todoTab);tabs.add_child(this.noteTab);this.root.add_child(tabs);
        const scroll=new St.ScrollView({overlay_scrollbars:false,style_class:'pingoose-project-notes-scroll'});
        scroll.set_policy(St.PolicyType.NEVER,St.PolicyType.AUTOMATIC);
        this.list=new St.BoxLayout({vertical:true,style_class:'pingoose-project-note-list'});scroll.add_actor(this.list);this.root.add_child(scroll);
        this.confirmation=new St.BoxLayout({vertical:true,visible:false,style_class:'pingoose-project-note'});
        this.root.add_child(this.confirmation);
        this.add=this.button('Add Note',()=>{this.editing={};this.renderEditor();});this.root.add_child(this.add);
        this.editor=new St.BoxLayout({vertical:true,visible:false,style_class:'pingoose-project-note-list'});
        this.name=new St.Entry({hint_text:'Title',can_focus:true,style_class:'pingoose-chat-entry'});this.name.clutter_text.max_length=120;
        this.body=new St.Entry({hint_text:'Notes',can_focus:true,style_class:'pingoose-chat-entry pingoose-note-editor'});
        const text=this.body.clutter_text;
        text.set_single_line_mode(false);
        text.set_line_wrap(true);
        text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        text.set_activatable(false);
        text.set_editable(true);
        text.reactive=true;
        text.y_expand=true;
        text.y_align=Clutter.ActorAlign.FILL;
        text.max_length=12000;
        // Focus the editable Clutter.Text, including clicks in the entry's padding.
        this.body.connect('button-press-event',()=>{
            global.stage.set_key_focus(text);
            return Clutter.EVENT_PROPAGATE;
        });
        text.connect('button-press-event',()=>{
            global.stage.set_key_focus(text);
            return Clutter.EVENT_PROPAGATE;
        });
        text.connect('key-press-event',(_actor,event)=>{
            const key=event.get_key_symbol();
            if(key!==Clutter.KEY_Return && key!==Clutter.KEY_KP_Enter)return Clutter.EVENT_PROPAGATE;
            text.delete_selection();
            const position=text.get_cursor_position();
            text.insert_text('\n',position);
            text.set_cursor_position(position<0?-1:position+1);
            return Clutter.EVENT_STOP;
        });
        this.bodyScroll=new St.ScrollView({overlay_scrollbars:false,x_expand:true,
            style_class:'pingoose-note-editor-scroll'});
        this.bodyScroll.set_policy(St.PolicyType.NEVER,St.PolicyType.AUTOMATIC);
        const bodyContent=new St.BoxLayout({vertical:true,x_expand:true});
        bodyContent.add_child(this.body);
        this.bodyScroll.add_actor(bodyContent);
        this.bodyScroll.set_clip_to_allocation(true);
        const revealCursor=()=>{
            if(this.cursorLater)return;
            this.cursorLater=Meta.later_add(Meta.LaterType.BEFORE_REDRAW,()=>{
                this.cursorLater=0;
                if(!this.bodyScroll.mapped)return GLib.SOURCE_REMOVE;
                const [valid,,y,height]=text.position_to_coords(text.get_cursor_position());
                if(!valid)return GLib.SOURCE_REMOVE;
                const adjustment=this.bodyScroll.get_vscroll_bar().get_adjustment();
                const top=y+10, bottom=top+height+10;
                let value=adjustment.value;
                if(top<value)value=top;
                else if(bottom>value+adjustment.page_size)value=bottom-adjustment.page_size;
                adjustment.value=Math.max(adjustment.lower,Math.min(value,adjustment.upper-adjustment.page_size));
                return GLib.SOURCE_REMOVE;
            });
        };
        text.connect('text-changed',revealCursor);
        text.connect('notify::cursor-position',revealCursor);
        this.editor.add_child(this.name);this.editor.add_child(this.bodyScroll);
        const actions=new St.BoxLayout({style_class:'pingoose-chat-input-row'});
        actions.add_child(this.button('Save',()=>this.save()));actions.add_child(this.button('Cancel',()=>{this.editing=null;this.drafts.delete(this.key());this.renderEditor();}));
        this.editor.add_child(actions);this.root.add_child(this.editor);
        this.status=new St.Label({text:'',style_class:'pingoose-card-time'});this.status.clutter_text.line_wrap=true;this.root.add_child(this.status);
        this.root.add_child(this.button('Visit Project Page',()=>this.visit(this.project)));
        this.monitor=Notes.file().get_parent().monitor_directory(Gio.FileMonitorFlags.NONE,null);
        this.monitor.connect('changed',(_monitor,file,other,event)=>{
            if (![file?.get_basename(), other?.get_basename()].includes('projects.json')) return;
            if (![Gio.FileMonitorEvent.CHANGED, Gio.FileMonitorEvent.CHANGES_DONE_HINT,
                Gio.FileMonitorEvent.CREATED, Gio.FileMonitorEvent.DELETED, Gio.FileMonitorEvent.RENAMED,
                Gio.FileMonitorEvent.MOVED_IN, Gio.FileMonitorEvent.MOVED_OUT].includes(event)) return;
            if (this.refreshTimer) GLib.source_remove(this.refreshTimer);
            this.refreshTimer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,150,()=>{
                this.refreshTimer=0;
                if(this.project && this.root.visible)this.renderList();
                return GLib.SOURCE_REMOVE;
            });
        });
    }
    confirmDelete(title,action){
        this.confirmation.destroy_all_children();
        this.confirmation.add_child(new St.Label({text:title,style_class:'pingoose-heading'}));
        this.confirmation.add_child(new St.Label({text:'This action cannot be undone.'}));
        const buttons=new St.BoxLayout({style_class:'pingoose-chat-input-row'});
        buttons.add_child(this.button('Cancel',()=>{this.confirmation.hide();}));
        buttons.add_child(this.button('Delete',()=>{this.confirmation.hide();action();}));
        this.confirmation.add_child(buttons);this.confirmation.show();
    }
    itemMenu(container,edit,remove){
        const actions=new St.BoxLayout({visible:false,x_expand:true,x_align:Clutter.ActorAlign.END,
            style_class:'pingoose-chat-input-row'});
        actions.add_child(this.button('Edit',()=>{actions.hide();edit();}));
        actions.add_child(this.button('Delete',()=>{actions.hide();remove();}));
        container.add_child(actions);
        const toggle=new St.Button({label:'⋮',accessible_name:'Item options',can_focus:true,
            x_align:Clutter.ActorAlign.END,y_align:Clutter.ActorAlign.CENTER,
            style_class:'pingoose-note-options'});
        toggle.connect('clicked',()=>{actions.visible=!actions.visible;});
        return toggle;
    }
    dismiss(name,action){const b=new St.Button({label:'×',accessible_name:name,can_focus:true,x_expand:false,y_align:Clutter.ActorAlign.CENTER,style_class:'pingoose-dismiss'});b.connect('clicked',action);return b;}
    button(label,action){const b=new St.Button({label,can_focus:true,x_expand:true,style_class:'pingoose-visit-intra'});b.connect('clicked',action);return b;}
    key(){return this.project?`${this.project.login}:${this.project.slug}:${this.kind}`:'';}
    capture(){if(this.project && this.editing)this.drafts.set(this.key(),{...this.editing,title:this.name.text,body:this.body.text});}
    open(project){
        this.confirmation.hide();
        this.capture();
        if(this.expanded && this.project?.slug===project.slug && this.project?.login===project.login){
            this.expanded=false;
            this.sync();
            return;
        }
        this.kind=imports.misc.extensionUtils.getSettings().get_string('project-default-tab');
        this.tabs.set_child_at_index(this.kind==='note'?this.noteTab:this.todoTab,0);
        this.project=project;this.expanded=true;this.indicator.bringPanelNearMain(this.root);this.title.text=project.name;this.editing=this.drafts.get(this.key())||null;this.renderList();this.renderEditor();this.sync();}
    switchTab(kind){this.confirmation.hide();this.capture();this.kind=kind;this.editing=this.drafts.get(this.key())||null;this.renderList();this.renderEditor();}
    sync(){this.root.visible=!!this.project && this.expanded && !this.indicator.loginOnly;this.indicator.syncPanelLayout?.();}
    reset(){this.confirmation.hide();this.drafts.clear();this.project=null;this.editing=null;this.expanded=false;this.name.text='';this.body.text='';this.list.destroy_all_children();this.renderKey=null;this.sync();}
    renderEditor(){
        this.editor.visible=!!this.editing;this.add.visible=!this.editing;
        this.name.visible=this.kind!=='todo';
        this.bodyScroll.style_class=this.kind==='todo'?'pingoose-todo-editor-scroll':'pingoose-note-editor-scroll';
        this.body.set_style(this.kind==='todo'?'min-height: 20px;':'min-height: 110px;');
        this.add.label=this.kind==='todo'?'Add TODO List':'Add Note';
        if(this.editing){this.name.text=this.editing.title==='Untitled'?'':this.editing.title||'';this.body.text=this.editing.body||'';this.body.hint_text=this.kind==='todo'?'One task per line':'Write your notes…';}
        this.status.text='';
    }
    renderList(){
        this.todoTab.opacity=this.kind==='todo'?255:150;this.noteTab.opacity=this.kind==='note'?255:150;
        try {
            const rows=Notes.list().filter(n=>n.project===this.project.slug && n.login===this.project.login && n.kind===this.kind);
            const key=JSON.stringify([this.key(),rows]);
            if(key===this.renderKey)return;
            this.renderKey=key;
            this.list.destroy_all_children();
            if(!rows.length)this.list.add_child(new St.Label({text:this.kind==='todo'?'No tasks. Choose Add TODO List.':'No saved notes. Choose Add Note.'}));
            for(const note of rows){
                if(note.kind==='todo'){
                    note.body.split('\n').forEach((line,index)=>{
                        if(!line.trim())return;
                        const group=new St.BoxLayout({vertical:true,style_class:'pingoose-project-note-list'});
                        const row=new St.BoxLayout({x_expand:true,style_class:'pingoose-todo-row'});
                        group.add_child(row);
                        const done=/^\s*\[x\]/i.test(line);
                        const content=line.replace(/^\s*\[[ x]\]\s*/i,'');
                        const check=new St.Button({label:done?'☑':'☐',can_focus:true,
                            accessible_name:done?'Mark incomplete':'Mark complete',style_class:'pingoose-todo-check'});
                        check.connect('clicked',()=>{
                            const lines=note.body.split('\n');lines[index]=`${done?'[ ]':'[x]'} ${content}`;
                            try{Notes.save({...note,body:lines.join('\n')});this.renderList();}catch(_){this.status.text='Unable to save. Please retry.';}
                        });
                        row.add_child(check);
                        const label=new St.Label({text:content,y_align:Clutter.ActorAlign.CENTER,x_expand:true});
                        label.clutter_text.ellipsize=Pango.EllipsizeMode.NONE;
                        label.clutter_text.line_wrap=false;
                        const horizontal=new St.ScrollView({overlay_scrollbars:false,style_class:'pingoose-todo-scroll'});
                        horizontal.set_policy(St.PolicyType.NEVER,St.PolicyType.NEVER);
                        const contentBox=new St.BoxLayout();contentBox.add_child(label);horizontal.add_actor(contentBox);
                        let overflow=false;
                        horizontal.connect('notify::allocation',()=>{
                            const width=horizontal.width;
                            if(width<=0)return;
                            const needed=label.get_preferred_width(-1)[1]>width+1;
                            if(needed!==overflow){overflow=needed;horizontal.set_policy(needed?St.PolicyType.ALWAYS:St.PolicyType.NEVER,St.PolicyType.NEVER);}
                        });
                        row.add_child(horizontal);
                        row.add_child(this.itemMenu(group,()=>{this.editing={...note,body:content,taskIndex:index,taskDone:done};this.renderEditor();},()=>this.confirmDelete('Delete this task?',()=>{
                            try{
                                const lines=note.body.split('\n').filter((_line,i)=>i!==index);
                                if(lines.some(value=>value.trim()))Notes.save({...note,body:lines.join('\n')});
                                else Notes.remove(note.id);
                                this.renderList();
                            }catch(_){this.status.text='Unable to delete. Please retry.';}
                        })));
                        this.list.add_child(group);
                    });
                    continue;
                }
                const card=new St.BoxLayout({vertical:true,style_class:'pingoose-project-note'});
                const heading=new St.BoxLayout({style_class:'pingoose-chat-header'});
                const title=new St.Label({text:note.title,x_expand:true,style_class:'pingoose-person-login'});
                title.clutter_text.ellipsize=Pango.EllipsizeMode.NONE;
                title.clutter_text.line_wrap=true;title.clutter_text.line_wrap_mode=Pango.WrapMode.WORD_CHAR;
                heading.add_child(title);
                card.add_child(heading);
                heading.add_child(this.itemMenu(card,()=>{this.editing={...note};this.renderEditor();},()=>this.confirmDelete('Delete this note?',()=>{
                    try {
                        Notes.remove(note.id);
                        if(this.editing?.id===note.id){this.editing=null;this.renderEditor();}
                        for(const [key,draft] of this.drafts)if(draft.id===note.id)this.drafts.delete(key);
                        this.renderList();this.status.text='Note deleted.';
                    } catch(_){this.status.text='Unable to delete. Please retry.';}
                })));
                const text=new St.Label({text:note.body,style_class:'pingoose-note-body'});
                text.clutter_text.ellipsize=Pango.EllipsizeMode.NONE;
                text.clutter_text.line_wrap=true;text.clutter_text.line_wrap_mode=Pango.WrapMode.WORD_CHAR;
                const contents=new St.BoxLayout({vertical:true});contents.add_child(text);
                const noteScroll=new St.ScrollView({overlay_scrollbars:false,style_class:'pingoose-note-body-scroll'});
                noteScroll.set_policy(St.PolicyType.NEVER,St.PolicyType.AUTOMATIC);
                noteScroll.add_actor(contents);card.add_child(noteScroll);
                this.list.add_child(card);
            }
        }catch(_){this.status.text='Unable to read saved notes.';}
    }
    save(){try{
        let body=this.body.text;
        if(Number.isInteger(this.editing?.taskIndex)){
            const current=Notes.list().find(note=>note.id===this.editing.id);
            if(!current || !body.trim())throw new Error('Task unavailable');
            const lines=current.body.split('\n');
            lines.splice(this.editing.taskIndex,1,...body.split('\n').map(line=>`${this.editing.taskDone?'[x]':'[ ]'} ${line}`));
            body=lines.join('\n');
        }
        const value=Notes.save({...this.editing,project:this.project.slug,projectName:this.project.name,login:this.project.login,kind:this.kind,title:this.kind==='todo'?'':this.name.text.trim() || 'Untitled',body});
        this.editing=null;this.drafts.delete(this.key());this.renderList();this.renderEditor();this.status.text='Saved locally.';
    }catch(_){this.status.text=this.kind==='todo'?'Enter at least one task and retry.':'Enter some content and retry.';}}
    destroy(){if(this.cursorLater)Meta.later_remove(this.cursorLater);this.cursorLater=0;if(this.refreshTimer)GLib.source_remove(this.refreshTimer);this.refreshTimer=0;this.monitor.cancel();this.drafts.clear();}
};
