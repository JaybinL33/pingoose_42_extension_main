const {Clutter, GLib, Pango, St} = imports.gi;
const PopupMenu = imports.ui.popupMenu;

var Controller = class Controller {
    _sessionSlotRequest(command, callback) {
        // Reuse an in-flight list request rather than opening a second WebKit session.
        this._sessionSlotsCallback = callback;
        if (this._sessionSlotsTimer) GLib.source_remove(this._sessionSlotsTimer);
        this._sessionSlotsTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 65, () => {
            this._sessionSlotsTimer = 0;
            const pending = this._sessionSlotsCallback;
            this._sessionSlotsCallback = null;
            pending?.({error: 'Slot request timed out.'});
            return GLib.SOURCE_REMOVE;
        });
        if (!this._slotsBusy) this._requestSlots(command);
    }

    _requestSlots(command) {
        if (this._slotsBusy) return;
        if(command.startsWith('slots:open') && !imports.misc.extensionUtils.getCurrentExtension().imports.models.featureFlags.enabled(this._settings,'hidden-auto-slots'))return;
        this._slotCreating = command.startsWith('slots:create:');
        this._slotsBusy = true;
        this._slotsError = null;
        this._send(command);
        this._renderSlots();
    }

    _renderSlots() {
        this._syncOptionalSections();
        const indicator = this._indicator;
        indicator.visitIntra.get_child().text = `Evaluation Slots${this._slots?.length ? ` · ${this._slots.length}` : ''}`;
        indicator.visitIntra.style_class='pingoose-visit-intra'+(this._slotsExpanded ? ' pingoose-toggle-active' : '');
        const section = indicator.slotItems;
        section.removeAll();
        const textRow = (text,error=false) => {
            const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            item.remove_all_children(); item.set_style('padding: 6px 24px 6px 0;');
            const label = new St.Label({text, style_class: error ? 'pingoose-slot-label pingoose-slot-error' : 'pingoose-slot-label'});
            label.clutter_text.line_wrap = true;
            label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            item.add_child(label); section.addMenuItem(item);
        };

        if (this._slotsBusy) {
            const loading=new PopupMenu.PopupBaseMenuItem({reactive:false,can_focus:false});
            loading.add_child(imports.misc.extensionUtils.getCurrentExtension().imports.ui.spinner.create(20));
            section.addMenuItem(loading);return;
        }
        if (this._slotsError) textRow(this._slotsError,true);
        for (const slot of this._slots || []) {
            const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            item.remove_all_children(); item.set_style('padding: 6px 24px 6px 0; spacing: 8px;');
            const format = value => new Date(value).toLocaleString('en-GB', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
            const label = new St.Label({text: `${format(slot.start)} – ${format(slot.end)}`, x_expand: false, y_align:Clutter.ActorAlign.CENTER, style_class: slot.matched ? 'pingoose-slot-label pingoose-slot-matched' : 'pingoose-slot-label pingoose-profile-level'});
            label.clutter_text.line_wrap = true;
            item.add_child(label);
            const minutes=Math.max(0,Math.round((Date.parse(slot.end)-Date.parse(slot.start))/60000));
            const duration=[[Math.floor(minutes/1440),'d'],[Math.floor(minutes%1440/60),'h'],[minutes%60,'m']]
                .filter(([value])=>value>0).map(([value,unit])=>`${value} ${unit}`).join(' ');
            if(duration)item.add_child(new St.Label({text:`(${duration})`,style_class:'pingoose-slot-duration',y_align:Clutter.ActorAlign.CENTER}));
            item.add_child(new St.Widget({x_expand:true}));
            if(slot.matched){
                item.add_child(new St.Label({text:'Evaluation Matched',style_class:'pingoose-slot-matched',y_align:Clutter.ActorAlign.CENTER}));
                section.addMenuItem(item);continue;
            }
            const close = new St.Button({label: '×', can_focus: true, accessible_name: 'Close slot', style_class: 'pingoose-dismiss'});
            close.connect('clicked', () => this._requestSlots(`slots:close:${slot.id}`));
            item.add_child(close); section.addMenuItem(item);
        }
        if (!this._slots?.length && !this._slotsError) textRow('No open slots.');
        const footer = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        footer.remove_all_children(); footer.set_style('padding: 6px 24px 6px 0; spacing: 6px;');
        const refresh = new St.Button({label: 'Refresh', can_focus: true, style_class: 'pingoose-clear-button'});
        refresh.connect('clicked', () => this._requestSlots('slots:list'));
        footer.add_child(refresh);
        const create=new St.Button({label:'Create Slot',can_focus:true,style_class:'pingoose-clear-button'+(this._slotCreateExpanded ? ' pingoose-toggle-active' : '')});
        create.connect('clicked',()=>{this._slotCreateExpanded=!this._slotCreateExpanded;this._renderSlots();});
        footer.add_child(create);
        if(imports.misc.extensionUtils.getCurrentExtension().imports.models.featureFlags.enabled(this._settings,'hidden-auto-slots')){
            const auto=new St.Button({label:'Auto Open',can_focus:true,style_class:'pingoose-clear-button'});
            auto.connect('clicked',()=>this._requestSlots('slots:open-auto'));
            footer.add_child(auto);
        }
        section.addMenuItem(footer);
        if(this._slotCreateExpanded){
            const schedule=imports.misc.extensionUtils.getCurrentExtension().imports.models.slotSchedule;
            const format=value=>{
                const d=new Date(value),pad=n=>String(n).padStart(2,'0');
                return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
            };
            const earliest=()=>Math.ceil((Date.now()+1800000)/900000)*900000;
            if(!Number.isFinite(this._slotDraft?.begin) || this._slotDraft.begin<earliest()){
                const begin=earliest();
                this._slotDraft={begin,end:begin+1800000};
            }

            const labels=[];
            const sync=()=>{
                for(const {key,date,hour,minute} of labels){
                    const value=new Date(this._slotDraft[key]);
                    date.text=`${String(value.getMonth()+1).padStart(2,'0')}/${String(value.getDate()).padStart(2,'0')}`;
                    hour.text=String(value.getHours()).padStart(2,'0')+' h';
                    minute.text=String(value.getMinutes()).padStart(2,'0')+' m';
                }
            };
            const adjust=(key,delta)=>{
                const draft=this._slotDraft;
                const latest=Math.floor((Date.now()+7*86400000)/900000)*900000;
                if(key==='begin'){
                    const duration=draft.end-draft.begin;
                    draft.begin=Math.max(earliest(),Math.min(draft.begin+delta,latest-duration));
                    draft.end=draft.begin+duration;
                }else{
                    draft.end=Math.max(draft.begin+900000,Math.min(draft.end+delta,latest));
                }
                sync();
            };
            const cardItem=new PopupMenu.PopupBaseMenuItem({reactive:false,can_focus:false});
            cardItem.remove_all_children();
            cardItem.set_style('padding: 6px 24px 6px 0;');
            const card=new St.BoxLayout({vertical:true,x_expand:true,style_class:'pingoose-slot-create-card'});
            const range=new St.BoxLayout({x_expand:true,style_class:'pingoose-slot-editor'});
            card.add_child(range);
            cardItem.add_child(card);
            section.addMenuItem(cardItem);
            for(const [key,label] of [['begin','From'],['end','Until']]){
                if(key==='end')range.add_child(new St.Label({text:'–',style_class:'pingoose-slot-range-divider',y_align:Clutter.ActorAlign.CENTER}));
                const item=new St.BoxLayout({style_class:'pingoose-slot-time-group',x_expand:true});
                const parts={key};
                for(const [part,delta,name] of [['date',86400000,'day'],['hour',3600000,'hour'],['minute',900000,'15 minutes']]){
                    const column=new St.BoxLayout({vertical:true,style_class:part==='date' ? 'pingoose-slot-stepper pingoose-slot-date-stepper' : 'pingoose-slot-stepper',x_expand:true});
                    const up=new St.Button({label:'▴',can_focus:true,accessible_name:`Increase ${label} ${name}`,style_class:'pingoose-slot-step-button'});
                    const value=new St.Label({text:'',style_class:'pingoose-slot-step-value pingoose-profile-level',x_align:Clutter.ActorAlign.CENTER});
                    const down=new St.Button({label:'▾',can_focus:true,accessible_name:`Decrease ${label} ${name}`,style_class:'pingoose-slot-step-button'});
                    up.connect('clicked',()=>adjust(key,delta));
                    down.connect('clicked',()=>adjust(key,-delta));
                    column.add_child(up);column.add_child(value);column.add_child(down);
                    item.add_child(column);parts[part]=value;
                }
                labels.push(parts);range.add_child(item);
            }
            sync();
            const actions=new St.BoxLayout({x_expand:true});
            const submit=new St.Button({label:'Create',can_focus:true,x_expand:true,x_align:Clutter.ActorAlign.END,style_class:'pingoose-clear-button'});
            submit.connect('clicked',()=>{
                try{
                    const payload=schedule.manual(format(this._slotDraft.begin),format(this._slotDraft.end));
                    const conflict=(this._slots || []).find(row=>Date.parse(row.start)<Date.parse(payload.end) && Date.parse(row.end)>Date.parse(payload.begin));
                    if(conflict)throw new Error(`Could not create slot:\nOverlaps ${format(conflict.start)} – ${format(conflict.end)}.`);
                    this._requestSlots('slots:create:'+JSON.stringify(payload));
                }catch(error){this._slotsError=error.message;this._renderSlots();}
            });
            actions.add_child(submit);card.add_child(actions);
        }
        if (this._slots?.some(row=>!row.matched)) {
            const closeRow=new PopupMenu.PopupBaseMenuItem({reactive:false,can_focus:false});
            closeRow.remove_all_children();closeRow.set_style('padding: 6px 24px 6px 0;');
            const all = new St.Button({label: 'Close All Slots', can_focus: true, x_expand: true, x_align: Clutter.ActorAlign.END, style_class: 'pingoose-clear-button'});
            all.connect('clicked', () => this._requestSlots('slots:all'));
            closeRow.add_child(all);section.addMenuItem(closeRow);
        }
    }

};
