const {Clutter, GLib, Pango, St} = imports.gi;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const PopupMenu = imports.ui.popupMenu;

var Controller = class Controller {
    _showBanner(message) {
        if (!this._bannerSource) {
            this._bannerSource = new MessageTray.Source('Pingoose', 'preferences-system-notifications-symbolic');
            this._bannerSource.connect('destroy', () => { this._bannerSource = null; });
            Main.messageTray.add(this._bannerSource);
        }
        const title = message.test ? 'Test notification' : message.category === 'agenda' ? 'New agenda event' :
            message.id.startsWith('reminder:') ? 'Evaluation reminder' :
            message.id.startsWith('seat:') ? 'Evaluation location' :
            message.id.startsWith('rescheduled:') ? 'Evaluation rescheduled' : 'Evaluation matched';
        const banner = new MessageTray.Notification(this._bannerSource, title,
            'Open Pingoose to view details.');
        banner.setTransient(true);
        banner.connect('activated', () => this._indicator?.menu.open());
        this._bannerSource.showNotification(banner);
    }

    _flashScreen(remaining = null) {
        if (!this._indicator || this._flashActors.length || this._flashTimer || Main.sessionMode.isLocked ||
            !St.Settings.get().enable_animations ||
            !this._notificationSettings.get_boolean('show-banners'))
            return;
        const count = remaining === null ? this._settings.get_int('flash-count') : remaining;
        if (count === 0)
            return;
        const now = GLib.get_monotonic_time();
        // Coalesce bursts: never turn a stream of notifications into a strobe.
        if (now - this._lastFlash < 1_000_000)
            return;
        this._lastFlash = now;
        this._flashActors = Main.layoutManager.monitors.map(monitor => new St.Widget({
            style_class: 'pingoose-flash', reactive: false, can_focus: false,
            visible: true, opacity: 0,
            x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
        }));
        for (const frame of this._flashActors) {
            Main.uiGroup.add_child(frame);
            frame.ease({
                opacity: 160, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => frame.ease({
                    opacity: 0, duration: 380, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        this._flashActors = this._flashActors.filter(actor => actor !== frame);
                        frame.destroy();
                        // Wait for every monitor; only one repeat timer may exist.
                        if (!this._flashActors.length && count > 1) {
                            const delay = Math.max(1, Math.ceil(
                                (1_000_000 - (GLib.get_monotonic_time() - this._lastFlash)) / 1000));
                            this._flashTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                                this._flashTimer = 0;
                                this._flashScreen(count - 1);
                                return GLib.SOURCE_REMOVE;
                            });
                        }
                    },
                }),
            });
        }
    }

    _clearFlash() {
        if (this._flashTimer) {
            GLib.source_remove(this._flashTimer);
            this._flashTimer = 0;
        }
        const actors = this._flashActors || [];
        this._flashActors = [];
        for (const actor of actors) {
            actor.remove_all_transitions();
            actor.destroy();
        }
    }

    _renderCards() {
        this._syncOptionalSections();
        const indicator = this._indicator;
        indicator.cards.removeAll();
        indicator.count.text = indicator.loginOnly ? 'Login Required' :
            (indicator.profileReady ? '42' : '◌');
        this._updatePanelLabel();
        if (!this._notifications.length) return;
        for (const notification of this._notifications) {
            const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            item.remove_all_children();
            item.add_style_class_name('pingoose-card-row');
            const card = new St.BoxLayout({vertical: true, reactive: true, x_expand: false, x_align: Clutter.ActorAlign.CENTER, style_class: 'pingoose-card'});
            const dismiss = new St.Button({label: '×', accessible_name: 'Dismiss notification',
                can_focus: true, style_class: 'pingoose-dismiss', y_align: Clutter.ActorAlign.CENTER});
            dismiss.connect('clicked', () => {
                this._unreadIds?.delete(notification.id);
                this._notifications = this._notifications.filter(entry => entry.id !== notification.id);
                this._renderCards();
            });
            item.add_child(dismiss);
            card.add_child(new St.Label({text: notification.test ? 'Test Notification' : notification.category === 'agenda' ? '42 · New Agenda Event' : '42 · New Evaluation',
                style_class: 'pingoose-card-title'}));
            const body = new St.Label({text: notification.body, style_class: 'pingoose-card-body'});
            body.clutter_text.line_wrap = true;
            body.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            body.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            card.add_child(body);
            card.add_child(new St.Label({text: `Received at ${notification.time}`, style_class: 'pingoose-card-time'}));
            item.add_child(card);
            indicator.cards.addMenuItem(item);
        }
        const footer = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        footer.remove_all_children();
        footer.set_style('padding: 6px 16px 6px 0; spacing: 0;');
        const clear = new St.Button({label: 'Clear All', can_focus: true,
            x_expand: true, x_align: Clutter.ActorAlign.END, style_class: 'pingoose-clear-button'});
        clear.connect('clicked', () => {
            this._notifications = [];
            this._unreadIds = new Set();
            this._renderCards();
        });
        footer.add_child(clear);
        indicator.cards.addMenuItem(footer);
    }

};
