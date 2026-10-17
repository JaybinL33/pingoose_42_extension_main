const {Clutter, Gio, GLib, GObject, Pango, St} = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const ByteArray = imports.byteArray;

const STATUS = Object.fromEntries([
    'authenticated', 'loading', 'watching', 'login-needed', 'auth-error',
    'permission-error', 'account-error', 'rate-limit', 'retry-wait', 'network-error',
    'api-error', 'response-error', 'storage-error', 'worker-error', 'worker-busy',
].map(state => [state, state]));

function deadlineText(deadline, today = new Date()) {
    if (typeof deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return '—';
    const [year, month, day] = deadline.split('-').map(Number);
    const target = Date.UTC(year, month - 1, day);
    if (new Date(target).toISOString().slice(0, 10) !== deadline) return '—';
    const parts = new Intl.DateTimeFormat('en', {timeZone: 'Asia/Seoul',
        year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(today);
    const get = type => Number(parts.find(part => part.type === type).value);
    const current = Date.UTC(get('year'), get('month') - 1, get('day'));
    const remaining = Math.round((target - current) / 86400000);
    const suffix = remaining < 0 ? `${-remaining} Days Overdue` : `${remaining} Days Remain`;
    return `${year}. ${month}. ${day}. (${suffix})`;
}

function releasePointerHighlight(item) {
    item.connect('leave-event', () => {
        item.active = false;
        if (global.stage.get_key_focus() === item) global.stage.set_key_focus(null);
        return Clutter.EVENT_PROPAGATE;
    });
    return item;
}

const Indicator = GObject.registerClass(class PingooseIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Pingoose');
        this.accessible_name = 'Pingoose Notifications';
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this.icon = new St.Icon({icon_name: 'preferences-system-notifications-symbolic', style_class: 'system-status-icon'});
        box.add_child(this.icon);
        this.count = new St.Label({text: '42', y_align: Clutter.ActorAlign.CENTER, style_class: 'pingoose-count'});
        box.add_child(this.count);
        this.add_child(box);
        const profileItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const profile = new St.BoxLayout({vertical: true, style_class: 'pingoose-profile'});
        const identity = new St.BoxLayout({style_class: 'pingoose-identity'});
        this.avatar = new St.Bin({width: 56, height: 56, y_align: Clutter.ActorAlign.CENTER, style_class: 'pingoose-avatar'});
        this.avatar.set_child(new St.Icon({icon_name: 'avatar-default-symbolic', icon_size: 40}));
        identity.add_child(this.avatar);
        const names = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER});
        this.profileName = new St.Label({text: 'Loading profile…', style_class: 'pingoose-profile-name'});
        this.profileLogin = new St.Label({text: '', style_class: 'pingoose-profile-login'});
        names.add_child(this.profileName);

        identity.add_child(names);
        profile.add_child(identity);
        const stats = new St.BoxLayout({style_class: 'pingoose-profile-stats'});
        stats.add_child(this.profileLogin);
        this.profileLevel = new St.Label({text: 'Lv.—', style_class: 'pingoose-profile-level', y_align: Clutter.ActorAlign.CENTER});
        stats.add_child(this.profileLevel);
        const track = new St.Widget({style_class: 'pingoose-progress-track', height: 5, width: 90, y_align: Clutter.ActorAlign.CENTER});
        this.profileProgress = new St.Widget({style_class: 'pingoose-progress-fill', height: 5, width: 0});
        track.add_child(this.profileProgress);
        stats.add_child(track);
        this.profilePercent = new St.Label({text: '(—%)', y_align: Clutter.ActorAlign.CENTER});
        stats.add_child(this.profilePercent);
        this.profilePoints = new St.Label({text: 'Ev.P —', y_align: Clutter.ActorAlign.CENTER});
        stats.add_child(this.profilePoints);
        names.add_child(stats);
        const deadline = new St.BoxLayout({style_class: 'pingoose-deadline-row'});
        this.profilePace = new St.Label({text: 'Pace — ·', style_class: 'pingoose-profile-pace'});
        deadline.add_child(this.profilePace);
        deadline.add_child(new St.Label({text: 'Milestone Deadline :', style_class: 'pingoose-profile-caption'}));
        this.profileDeadline = new St.Label({text: '—', style_class: 'pingoose-profile-deadline'});
        deadline.add_child(this.profileDeadline);
        profile.add_child(deadline);
        profileItem.add_child(profile);
        this.menu.addMenuItem(profileItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const projectsTitle = new PopupMenu.PopupMenuItem('My Projects', {reactive: false});
        projectsTitle.label.add_style_class_name('pingoose-heading');
        this.menu.addMenuItem(projectsTitle);
        this.projects = new PopupMenu.PopupMenuSection();
        this.projects.addMenuItem(new PopupMenu.PopupMenuItem('Loading projects…', {reactive: false}));
        this.menu.addMenuItem(this.projects);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        // Keep worker diagnostics internal; the notifications area only shows cards.
        this.status = {label: {text: ''}};
        this.cards = new PopupMenu.PopupMenuSection();
        const list = new St.ScrollView({style_class: 'pingoose-list', overlay_scrollbars: false, x_expand: true});
        list.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        list.add_actor(this.cards.actor);
        const listItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        listItem.add_style_class_name('pingoose-list-container');
        listItem.add_child(list);
        this.menu.addMenuItem(listItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open && this.lastProfile) this.updateProfile(this.lastProfile);
        });
        this.setLoginOnly(true);
    }

    updateProfile(data) {
        this.lastProfile = data;
        this.updateProjects(data);
        const number = (value, max) => Number.isFinite(value) && value >= 0 && value <= max ? value : null;
        const level = number(data.level, 1000);
        const progress = number(data.progress, 100);
        this.profileName.text = typeof data.name === 'string' && data.name.trim() ? data.name.slice(0, 100) : data.login;
        this.profileLogin.text = `@${data.login}`;
        this.profileLevel.text = `Lv.${level ?? '—'}`;
        this.profilePercent.text = `(${progress ?? '—'}%)`;
        this.profileProgress.width = 90 * (progress ?? 0) / 100;
        this.profilePoints.text = `Ev.P ${number(data.points, 1000000) ?? '—'}`;
        this.profilePace.text = `Pace ${number(data.pace, 1000) ?? '—'} ·`;
        this.profileDeadline.text = deadlineText(data.deadline);
        if (number(data.pace, 1000) === 24)
            this.profileDeadline.add_style_class_name('pingoose-deadline-danger');
        else
            this.profileDeadline.remove_style_class_name('pingoose-deadline-danger');
    }

    updateProjects(data) {
        if (!Array.isArray(data.projects) || !/^[a-zA-Z0-9_-]{1,64}$/.test(data.login)) return;
        const projects = data.projects.slice(0, 20).filter(project => project &&
            typeof project.name === 'string' && project.name.trim() &&
            typeof project.slug === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(project.slug));
        const key = JSON.stringify([data.login, projects]);
        if (key === this.projectsKey) return;
        this.projectsKey = key;
        this.projects.removeAll();
        if (!projects.length) {
            this.projects.addMenuItem(new PopupMenu.PopupMenuItem('No active projects.', {reactive: false}));
            return;
        }
        for (const project of projects) {
            const item = releasePointerHighlight(new PopupMenu.PopupMenuItem(project.name.slice(0, 80)));
            item.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            item.connect('activate', () => {
                const url = `https://projects.intra.42.fr/${project.slug}/${data.login}`;
                try { Gio.AppInfo.launch_default_for_uri(url, global.create_app_launch_context(0, -1)); }
                catch (_) { Main.notify('Pingoose', 'Unable to open the project. Check your default browser settings.'); }
            });
            this.projects.addMenuItem(item);
        }
    }

    setLoginOnly(loginOnly) {
        this.loginOnly = loginOnly;
        this.icon.visible = !loginOnly;
        this.accessible_name = loginOnly ? 'Intra Login' : 'Pingoose Notifications';
        if (loginOnly) {
            this.count.text = 'Intra Login';
            this.menu.close();
        }
    }

    vfunc_event(event) {
        if (!this.loginOnly) return super.vfunc_event(event);
        const type = event.type();
        if ((type === Clutter.EventType.BUTTON_PRESS && event.get_button() === 1) ||
            type === Clutter.EventType.TOUCH_BEGIN ||
            (type === Clutter.EventType.KEY_PRESS &&
                [Clutter.KEY_Return, Clutter.KEY_KP_Enter, Clutter.KEY_space].includes(event.get_key_symbol()))) {
            this.onLogin?.();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }
});

class Pingoose {
    enable() {
        this._flashActors = [];
        this._flashTimer = 0;
        this._lastFlash = -Infinity;
        this._settings = imports.misc.extensionUtils.getSettings();
        this._notificationSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._indicator = new Indicator();
        this._indicator.onLogin = () => this._send('login');
        Main.panel.addToStatusArea(Me.uuid, this._indicator);
        this._profileClock = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            if (this._indicator?.lastProfile) this._indicator.updateProfile(this._indicator.lastProfile);
            return GLib.SOURCE_CONTINUE;
        });
        this._cancel = new Gio.Cancellable();
        this._commands = [];
        this._writing = false;
        this._notifications = [];
        this._workerStatus = null;
        releasePointerHighlight(this._indicator.menu.addAction('Open Intra', () => this._send('show')));
        releasePointerHighlight(this._indicator.menu.addAction('Send Test Notification', () => this._send('test')));
        const flashMenu = new PopupMenu.PopupSubMenuMenuItem('');
        const choices = [];
        for (let count = 0; count <= 5; count++) {
            const choice = new PopupMenu.PopupMenuItem(count ? `${count}` : 'Off');
            choice.activate = () => this._settings.set_int('flash-count', count);
            flashMenu.menu.addMenuItem(choice);
            choices.push(choice);
        }
        const syncFlashCount = () => {
            this._clearFlash();
            const count = this._settings.get_int('flash-count');
            flashMenu.label.text = `Screen Flash: ${count ? `${count}` : 'Off'}`;
            choices.forEach((item, value) => item.setOrnament(
                value === count ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE));
        };
        this._settingsChanged = this._settings.connect('changed::flash-count', syncFlashCount);
        syncFlashCount();
        this._flashMenu = flashMenu;
        this._renderCards();
        this._buildSettings();
        try {
            this._process = Gio.Subprocess.new(['/usr/bin/gjs', `${Me.path}/webview.js`],
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
            const proc = this._process;
            const input = new Gio.DataInputStream({base_stream: proc.get_stdout_pipe()});
            this._read(proc, input, this._cancel);
            proc.wait_async(null, (child, result) => {
                try { child.wait_finish(result); } catch (_) { /* Already stopping. */ }
                if (this._process === child && this._indicator) {
                    this._process = null;
                    if (!['worker-busy', 'worker-error'].includes(this._workerStatus))
                        this._indicator.status.label.text = 'Intra monitoring stopped. Restart the extension.';
                }
            });
        } catch (_) {
            this._indicator.status.label.text = 'Unable to start Intra monitoring. Check your GJS installation.';
        }
    }

    _buildSettings() {
        const indicator = this._indicator;
        const mainItems = indicator.menu._getMenuItems();
        const settings = new PopupMenu.PopupMenuSection();
        indicator.menu.addMenuItem(settings);
        const footer = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const gear = new St.Button({style_class: 'pingoose-settings-button', can_focus: true,
            x_expand: true, x_align: Clutter.ActorAlign.END, accessible_name: 'Settings'});
        gear.set_child(new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 18}));
        footer.add_child(gear);
        indicator.menu.addMenuItem(footer);
        const showSettings = visible => {
            for (const item of mainItems) item.actor.visible = !visible;
            settings.actor.visible = visible;
            footer.actor.visible = !visible;
        };
        const keepOpenAction = (label, action) => {
            const item = new PopupMenu.PopupMenuItem(label);
            // Normal PopupMenuItem activation closes the parent menu. These
            // controls switch pages in place, including keyboard activation.
            item.activate = () => action();
            settings.addMenuItem(item);
            return item;
        };
        keepOpenAction('‹ Back', () => showSettings(false));
        settings.addMenuItem(new PopupMenu.PopupMenuItem('Settings', {reactive: false}));
        const dark = keepOpenAction('Dark Mode', () => { this._settings.set_string('theme', 'dark'); showSettings(false); });
        const light = keepOpenAction('Light Mode', () => { this._settings.set_string('theme', 'light'); showSettings(false); });
        settings.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        settings.addMenuItem(this._flashMenu);
        settings.addAction('Logout Intra', () => { this._send('logout'); showSettings(false); });
        const sync = () => {
            const theme = this._settings.get_string('theme');
            indicator.menu.actor.remove_style_class_name('pingoose-dark');
            indicator.menu.actor.remove_style_class_name('pingoose-light');
            indicator.menu.actor.add_style_class_name(`pingoose-${theme}`);
            dark.setOrnament(theme === 'dark' ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
            light.setOrnament(theme === 'light' ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
        };
        this._themeChanged = this._settings.connect('changed::theme', sync);
        sync();
        indicator.menu.connect('open-state-changed', (_menu, open) => {
            if (open) { this._flashMenu.menu.close(); showSettings(false); }
        });
        gear.connect('clicked', () => showSettings(true));
        showSettings(false);
    }

    _clearProfile() {
        const indicator = this._indicator;
        indicator.lastProfile = null;
        indicator.projectsKey = null;
        indicator.profileName.text = 'Loading profile…';
        indicator.profileLogin.text = '';
        indicator.profileLevel.text = 'Lv.—';
        indicator.profilePercent.text = '(—%)';
        indicator.profileProgress.width = 0;
        indicator.profilePoints.text = 'Ev.P —';
        indicator.profilePace.text = 'Pace — ·';
        indicator.profileDeadline.text = '—';
        indicator.avatar.set_style('');
        indicator.avatar.set_child(new St.Icon({icon_name: 'avatar-default-symbolic', icon_size: 40}));
        indicator.projects.removeAll();
        indicator.projects.addMenuItem(new PopupMenu.PopupMenuItem('Loading projects…', {reactive: false}));
        this._notifications = [];
        indicator.setLoginOnly(true);
        this._renderCards();
    }

    _read(proc, input, cancel) {
        input.read_line_async(GLib.PRIORITY_DEFAULT, cancel, (stream, result) => {
            try {
                const [line] = stream.read_line_finish_utf8(result);
                if (this._process !== proc || cancel.is_cancelled() || line === null)
                    return;
                if (line.length <= 8192) {
                    try { this._message(JSON.parse(line)); }
                    catch (_) {
                        if (this._indicator)
                            this._indicator.status.label.text = 'Unable to display the notification. Restart the extension.';
                    }
                }
                this._read(proc, stream, cancel);
            } catch (_) {
                if (!cancel.is_cancelled() && this._indicator)
                    this._indicator.status.label.text = 'Unable to read from the Intra helper.';
            }
        });
    }

    _send(command) {
        if (!this._process) {
            this._indicator.status.label.text = 'Intra monitoring is stopped. Restart the extension.';
            return;
        }
        this._commands.push(command);
        this._writeNext();
    }

    _writeNext() {
        if (this._writing || !this._process || !this._commands.length)
            return;
        const proc = this._process;
        const cancel = this._cancel;
        const bytes = ByteArray.fromString(`${this._commands.shift()}\n`);
        this._writing = true;
        proc.get_stdin_pipe().write_all_async(bytes, GLib.PRIORITY_DEFAULT, cancel, (stream, result) => {
            try { stream.write_all_finish(result); }
            catch (_) {
                if (this._process === proc && this._indicator)
                    this._indicator.status.label.text = 'Unable to send a command to the Intra helper.';
            }
            if (this._process === proc) {
                this._writing = false;
                this._writeNext();
            }
        });
    }

    _message(message) {
        if (!message || typeof message !== 'object')
            return;
        if (message.type === 'signed-out') { this._clearProfile(); return; }
        if (['profile', 'profile-avatar'].includes(message.type)) {
            if (message.login !== GLib.get_user_name()) return;
            if (message.type === 'profile') this._indicator.updateProfile(message);
            else {
                const image = Gio.File.new_for_path(GLib.build_filenamev([
                    GLib.get_user_state_dir(), 'pingoose', 'profile-avatar']));
                this._indicator.avatar.set_child(null);
                this._indicator.avatar.set_style(`background-image: url("${image.get_uri()}"); background-size: cover;`);
            }
            return;
        }
        if (message.type === 'status' && Object.prototype.hasOwnProperty.call(STATUS, message.state)) {
            this._workerStatus = message.state;
            if (message.state === 'account-error') {
                this._clearProfile();
                Main.notify('Pingoose', 'Your Intra ID must match the current PC username. Information from another account cannot be loaded.');
            }
            if (message.state === 'login-needed') this._indicator.setLoginOnly(true);
            else if (['authenticated', 'watching'].includes(message.state)) {
                this._indicator.setLoginOnly(false);
                this._renderCards();
            }
            this._indicator.status.label.text = message.state;
            return;
        }
        if (message.type !== 'notification' || typeof message.body !== 'string' ||
            !message.body.trim() || message.body.length > 1000 ||
            typeof message.id !== 'string' || message.id.length > 1200)
            return;
        if (this._notifications.some(item => item.id === message.id))
            return;
        this._notifications.unshift({id: message.id, body: message.body,
            test: message.test === true, time: GLib.DateTime.new_now_local().format('%H:%M')});
        this._notifications.length = Math.min(this._notifications.length, 5);
        this._renderCards();
        // Keep evaluation details out of the notification banner/lock screen.
        // The full text is visible only inside the user's panel popover.
        Main.notify(message.test ? 'Pingoose · Test' : 'Pingoose · New Evaluation',
            'Open Pingoose in the top bar to view the details.');
        this._flashScreen();
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
        if (now - this._lastFlash < 3_000_000)
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
                opacity: 200, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => frame.ease({
                    opacity: 0, duration: 720, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        this._flashActors = this._flashActors.filter(actor => actor !== frame);
                        frame.destroy();
                        // Wait for every monitor; only one repeat timer may exist.
                        if (!this._flashActors.length && count > 1) {
                            const delay = Math.max(1, Math.ceil(
                                (3_000_000 - (GLib.get_monotonic_time() - this._lastFlash)) / 1000));
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
        const indicator = this._indicator;
        indicator.cards.removeAll();
        indicator.count.text = indicator.loginOnly ? 'Intra Login' :
            (this._notifications.length ? String(this._notifications.length) : '42');
        if (!this._notifications.length) {
            indicator.cards.addMenuItem(new PopupMenu.PopupMenuItem('No notifications.', {reactive: false}));
            return;
        }
        for (const notification of this._notifications) {
            const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            item.add_style_class_name('pingoose-card-row');
            const card = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'pingoose-card'});
            card.add_child(new St.Label({text: notification.test ? 'Test Notification' : '42 · New Evaluation',
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
        const clear = new St.Button({label: 'Clear Notifications', can_focus: true,
            x_expand: true, x_align: Clutter.ActorAlign.END, style_class: 'pingoose-clear-button'});
        clear.connect('clicked', () => {
            this._notifications = [];
            this._renderCards();
        });
        footer.add_child(clear);
        indicator.cards.addMenuItem(footer);
    }

    disable() {
        if (this._themeChanged) this._settings.disconnect(this._themeChanged);
        this._themeChanged = 0;
        if (this._profileClock) GLib.source_remove(this._profileClock);
        this._profileClock = 0;
        if (this._settingsChanged)
            this._settings.disconnect(this._settingsChanged);
        this._settingsChanged = 0;
        this._clearFlash();
        this._settings = null;
        this._notificationSettings = null;
        const proc = this._process;
        this._process = null;
        this._cancel?.cancel();
        this._cancel = null;
        this._commands = [];
        // Stop the helper's HTTP requests and private WebKit view together.
        if (proc) {
            try { proc.send_signal(15); } catch (_) { /* It already exited. */ }
        }
        this._indicator?.destroy();
        this._indicator = null;
        this._notifications = [];
    }
}

function init() {
    return new Pingoose();
}
