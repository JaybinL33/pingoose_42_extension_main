const {Clutter, Gio, GLib, Meta, Pango, St} = imports.gi;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

var Controller = class Controller {
    _renderEvaluations(changedId = null) {
        const rows = this._evaluations || [];
        this._syncOptionalSections();
        const key = JSON.stringify([rows, this._feedback, rows.map(row => Date.parse(row.begin) <= Date.now())]);
        if (key === this._evaluationKey) return;
        this._evaluationKey = key;
        const section = this._indicator.evaluations;
        const existing = changedId && this._evaluationActors?.get(changedId);
        // Keep focus off the button being destroyed, without selecting the first menu item.
        if (existing) this._indicator.evaluationScroll?.grab_key_focus();
        const adjustment = this._indicator.evaluationScroll?.get_vscroll_bar().get_adjustment();
        // Rebuilding actors resets the adjustment; restore after the new layout is allocated.
        const scrollPosition = this._evaluationScrollPosition ?? adjustment?.value ?? 0;
        if (this._evaluationScrollRestore) Meta.later_remove(this._evaluationScrollRestore);
        this._evaluationScrollRestore = 0;
        if (adjustment && !existing) {
            this._evaluationScrollPosition = scrollPosition;
            this._evaluationScrollRestore = Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
                this._evaluationScrollRestore = 0;
                adjustment.value = Math.max(adjustment.lower,
                    Math.min(scrollPosition, adjustment.upper - adjustment.page_size));
                this._evaluationScrollPosition = null;
                return GLib.SOURCE_REMOVE;
            });
        }
        if (!existing) {
            section.removeAll();
            this._evaluationActors = new Map();
        }
        if (!rows.length) return;
        for (const row of rows) {
            if (existing && row.id !== changedId) continue;
            const item = existing || new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            item.remove_all_children();
            item.set_style('padding: 6px 0; spacing: 0;');
            const box = new St.BoxLayout({vertical: true, x_expand: false, x_align: Clutter.ActorAlign.START, style_class: 'pingoose-evaluation-card'});
            const label = (text, style_class = '') => {
                const actor = new St.Label({text, style_class});
                actor.clutter_text.line_wrap = true;
                actor.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                box.add_child(actor);
            };
            label(`${row.project || 'Evaluation'}: ${['evaluator', 'corrector'].includes(row.kind) ? 'Evaluator' : 'Evaluatee'}`, 'pingoose-evaluation-title');
            for (const login of row.users?.length ? row.users : [null]) {
                const person = new St.BoxLayout({style_class: 'pingoose-evaluation-person'});
                const avatar = new St.Bin({width: 44, height: 44, style_class: 'pingoose-avatar pingoose-counterpart-avatar', y_align: Clutter.ActorAlign.CENTER});
                let image = new St.Icon({icon_name: 'avatar-default-symbolic', icon_size: 34});
                if (login && row.avatars?.includes(login) && /^[a-zA-Z0-9_-]{1,64}$/.test(login)) {
                    const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_state_dir(), 'pingoose', `counterpart-${login}`]));
                    if (file.query_exists(null)) {
                        avatar.set_style(`background-image: url("${file.get_uri()}"); background-size: cover;`);
                        image = null;
                    }
                }
                avatar.set_child(image);
                person.add_child(avatar);
                const details = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'pingoose-person-details'});
                details.add_child(new St.Label({text: login ? `@${login}` : 'Awaiting match', style_class: 'pingoose-person-login'}));
                details.add_child(new St.Label({text: `Seat · ${login ? row.seats?.[login] || 'Unavailable' : 'Unavailable'}`, style_class: 'pingoose-person-seat'}));
                person.add_child(details);
                box.add_child(person);
            }
            label(`Starts · ${new Date(row.begin).toLocaleString('en-GB')}`, 'pingoose-evaluation-time');
            let actionRow = box;
            const paired = Date.parse(row.begin) <= Date.now() && ['confirm', 'later'].includes(this._feedback[row.id]);
            const button = (text, action) => {
                const control = new St.Button({can_focus: true, x_expand: true, style_class: paired ? 'pingoose-feedback-button pingoose-feedback-half' : 'pingoose-feedback-button'});
                const caption = new St.Label({text, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
                caption.clutter_text.line_wrap = true;
                caption.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                caption.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
                control.set_child(caption);
                control.connect('clicked', action);
                actionRow.add_child(control);
            };
            const evaluator = ['evaluator', 'corrector'].includes(row.kind);
            const question = evaluator ? 'Has the evaluation ended?' : 'Have you submitted your evaluation feedback?';
            const step = value => {
                this._feedback[row.id] = value;
                this._renderEvaluations(row.id);
            };
            if (Date.parse(row.begin) <= Date.now()) {
                if (this._feedback[row.id] === 'confirm') {
                    label(question, 'pingoose-feedback-question');
                    actionRow = new St.BoxLayout({style_class: 'pingoose-feedback-actions', x_expand: true});
                    box.add_child(actionRow);
                    button('Yes', () => {
                        if (!row.devTest) { this._send(`feedback:${row.id}`); return; }
                        this._evaluations = this._evaluations.filter(item => item.id !== row.id);
                        delete this._feedback[row.id];
                        this._renderEvaluations();
                    });
                    button('Not yet', () => step(evaluator ? null : 'later'));
                } else if (this._feedback[row.id] === 'later') {
                    actionRow = new St.BoxLayout({style_class: 'pingoose-feedback-actions', x_expand: true});
                    box.add_child(actionRow);
                    button('Open Project', () => {
                        const profile = this._indicator.lastProfile;
                        const slug = row.slug || profile?.projects?.find(project => project.name.toLowerCase() === row.project.toLowerCase())?.slug;
                        if (!slug || !profile?.login) { Main.notify('Pingoose', 'Project link unavailable. Open Intra to submit your feedback.'); return; }
                        try { Gio.AppInfo.launch_default_for_uri(`https://projects.intra.42.fr/${encodeURIComponent(slug)}/${encodeURIComponent(profile.login)}`, global.create_app_launch_context(0, -1)); }
                        catch (_) { Main.notify('Pingoose', 'Unable to open the project.'); }
                    });
                    button('Later', () => step(null));
                } else button(question, () => step('confirm'));
            }
            item.add_child(box);
            if (!existing) section.addMenuItem(item);
            this._evaluationActors.set(row.id, item);
        }
    }

};
