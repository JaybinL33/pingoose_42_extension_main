// Adapted from origin/deeev-seunkang-slot; GNOME 42 system logout only.
const {GLib, GObject, St, Clutter} = imports.gi;
const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;
const EndSessionDialog = imports.ui.endSessionDialog;

var SlotConfirmDialog = GObject.registerClass(class SlotConfirmDialog extends ModalDialog.ModalDialog {
    _init(slots, onAction, evaluations = [], pendingFeedback = []) {
        super._init({styleClass: 'pingoose-modal-dialog'});
        this._onAction = onAction;
        this._decided = false;
        this._hasSlots=slots.length>0;
        const box = new St.BoxLayout({vertical: true, style: 'width: 460px; spacing: 16px; padding: 16px;'});
        box.add_child(new St.Icon({icon_name: 'dialog-warning-symbolic', icon_size: 32}));
        box.add_child(new St.Label({text:'Check evaluations before logging out',style:'font-weight: bold; font-size: 1.3em;'}));
        const list=new St.BoxLayout({vertical:true,style:'spacing: 10px;'});
        const text=(value,red=false)=>{
            const label=new St.Label({text:value,style:'max-width: 440px;'+(red?'color: #ef5350;':'')});
            label.clutter_text.line_wrap=true;
            list.add_child(label);
        };
        const format=value=>new Date(value).toLocaleString('en-GB');
        text(`Open slots · ${slots.length}`);
        for(const slot of slots)text(`${format(slot.start)} – ${format(slot.end)}`);
        if(evaluations.length){
            text(`Scheduled evaluations · ${evaluations.length}`,true);
            for(const evaluation of evaluations)text(`${evaluation.project || 'Evaluation'}
${format(evaluation.start)} – ${format(evaluation.end)}`,true);
            text('Closing open slots does not cancel these evaluations.');
        }
        if(pendingFeedback.length){
            text(`Feedback confirmation pending · ${pendingFeedback.length}`,true);
            for(const evaluation of pendingFeedback){
                const role=['evaluator','corrector'].includes(evaluation.kind)?'Evaluator':'Evaluatee';
                text(`${evaluation.project || 'Evaluation'} · ${role}
${format(evaluation.begin)}
${(evaluation.users || []).map(login=>'@'+login).join(', ')}`,true);
            }
            text('These past evaluation cards have not been marked as feedback complete in Pingoose. Check Intra before leaving.');
        }
        const scroll=new St.ScrollView({style:'max-height: 260px;',overlay_scrollbars:false});
        scroll.set_policy(St.PolicyType.NEVER,St.PolicyType.AUTOMATIC);
        scroll.add_actor(list);box.add_child(scroll);
        this._status = new St.Label({text: '', style: 'max-width: 460px;'});
        this._status.clutter_text.line_wrap = true;
        box.add_child(this._status);
        this.contentLayout.add_child(box);
        this._buttons();
        this._deadline = GLib.get_monotonic_time() + 60000000;
        const tick = () => {
            const seconds = Math.max(0, Math.ceil((this._deadline - GLib.get_monotonic_time()) / 1000000));
            this._status.text = `Logging out in ${seconds}s. Open slots and scheduled evaluations will be kept.`;
            if (!seconds) { this._timer = 0; this._choose('keep'); return GLib.SOURCE_REMOVE; }
            return GLib.SOURCE_CONTINUE;
        };
        tick();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, tick);
        this.connect('destroy', () => this._stopCountdown());
    }
    _buttons() {
        this.setButtons([
            {label: 'Close Slots & Log Out', action: () => this._choose('close')},
            {label: 'Log Out Anyway', action: () => this._choose('keep')},
            {label: 'Cancel', action: () => this._choose('cancel'), key: Clutter.KEY_Escape, default: true},
        ]);
    }
    _stopCountdown() { if (this._timer) GLib.source_remove(this._timer); this._timer = 0; }
    _choose(action) {
        if (this._decided) return;
        this._decided = true;
        this._stopCountdown();
        if (action === 'close') {
            this.setButtons([]);
            this._status.text = 'Closing slots…';
        }
        this._onAction(action);
    }
    failed() {
        this._decided = false;
        this._status.text = 'Some slots could not be closed. You are still logged in.\nTry again, log out anyway, or cancel.';
        this._buttons();
    }
});

var SystemSessionHook = class SystemSessionHook {
    constructor(request, authenticated, warningEnabled = () => true, evaluations = () => []) {
        this._request = request; this._authenticated = authenticated; this._warningEnabled = warningEnabled; this._evaluations=evaluations;
    }
    enable() {
        const proto = EndSessionDialog.EndSessionDialog.prototype;
        this._original = proto._confirm;
        const hook = this;
        this._replacement = function(signal) {
            if (signal !== 'ConfirmedLogout' || !hook._authenticated() || !hook._warningEnabled()) return hook._original.call(this, signal);
            if (hook._pending) return;
            hook._pending = true;
            hook._native = this;
            this._stopTimer();
            this.close(true);
            const original = hook._original;
            const proceed = () => { hook._finish(); original.call(this, signal); };
            hook._request('slots:list', result => {
                if (!hook._pending) return;
                if (result.error || !Array.isArray(result.rows)) {
                    Main.notify('42Intra', 'Unable to check evaluation slots. Check Intra before leaving.');
                    proceed(); return;
                }
                const future = result.rows.filter(slot => !slot.matched && Date.parse(slot.end) > Date.now());
                const evaluations=result.rows.filter(slot=>slot.matched && Date.parse(slot.end)>Date.now());
                const pendingFeedback=hook._evaluations().filter(row=>!row.missing && !row.devTest && Number.isFinite(Date.parse(row.begin)) && Date.parse(row.begin)<=Date.now());
                if (!future.length && !evaluations.length && !pendingFeedback.length) { proceed(); return; }
                Main.notify('42Intra · Open evaluation slots', 'Check open slots and scheduled evaluations before logging out.');
                hook._dialog = new SlotConfirmDialog(future, action => {
                    if (action === 'keep') proceed();
                    else if (action === 'cancel') { hook._finish(); this.cancel(); }
                    else hook._request('slots:future', response => {
                        if (!hook._pending) return;
                        if (response.error || !Array.isArray(response.rows) || response.rows.some(slot => !slot.matched && Date.parse(slot.end) > Date.now()))
                            hook._dialog.failed();
                        else proceed();
                    });
                }, evaluations, pendingFeedback);
                if (!hook._dialog.open()) { hook._finish(); this.cancel(); }
            });
        };
        proto._confirm = this._replacement;
    }
    _finish() {
        this._dialog?._stopCountdown();
        this._dialog?.destroy();
        this._dialog = null; this._pending = false; this._native = null;
    }
    disable() {
        const proto = EndSessionDialog.EndSessionDialog.prototype;
        if (proto._confirm === this._replacement) proto._confirm = this._original;
        const native = this._native;
        this._finish();
        native?.cancel();
    }
};
