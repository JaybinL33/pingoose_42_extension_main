const {Clutter, GLib, St} = imports.gi;
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
        this._slotsBusy = true;
        this._slotsError = null;
        this._send(command);
        this._renderSlots();
    }

    _renderSlots() {
        this._syncOptionalSections();
        const indicator = this._indicator;
        indicator.visitIntra.get_child().text = this._slotsExpanded ? 'Evaluation Slots ▴' : 'Evaluation Slots ▾';
        const section = indicator.slotItems;
        section.removeAll();
        const textRow = text => {
            const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            item.remove_all_children(); item.set_style('padding: 6px 24px 6px 0;');
            const label = new St.Label({text, style_class: 'pingoose-slot-label'});
            label.clutter_text.line_wrap = true;
            item.add_child(label); section.addMenuItem(item);
        };

        if (this._slotsBusy) {
            const loading=new PopupMenu.PopupBaseMenuItem({reactive:false,can_focus:false});
            loading.add_child(imports.misc.extensionUtils.getCurrentExtension().imports.ui.spinner.create(20));
            section.addMenuItem(loading);return;
        }
        if (this._slotsError) textRow(this._slotsError);
        for (const slot of this._slots || []) {
            const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            item.remove_all_children(); item.set_style('padding: 6px 24px 6px 0; spacing: 8px;');
            const format = value => new Date(value).toLocaleString('en-GB', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
            const label = new St.Label({text: `${format(slot.start)} – ${format(slot.end)}`, x_expand: true, style_class: 'pingoose-slot-label'});
            label.clutter_text.line_wrap = true;
            item.add_child(label);
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
        if(imports.misc.extensionUtils.getCurrentExtension().imports.models.featureFlags.enabled(this._settings,'hidden-auto-slots')){
            const auto=new St.Button({label:'Auto Open',can_focus:true,style_class:'pingoose-clear-button'});
            auto.connect('clicked',()=>this._requestSlots('slots:open-auto'));
            footer.add_child(auto);
        }
        section.addMenuItem(footer);
        if (this._slots?.length) {
            const closeRow=new PopupMenu.PopupBaseMenuItem({reactive:false,can_focus:false});
            closeRow.remove_all_children();closeRow.set_style('padding: 6px 24px 6px 0;');
            const all = new St.Button({label: 'Close All Slots', can_focus: true, x_expand: true, x_align: Clutter.ActorAlign.END, style_class: 'pingoose-clear-button'});
            all.connect('clicked', () => this._requestSlots('slots:all'));
            closeRow.add_child(all);section.addMenuItem(closeRow);
        }
    }

};
