const {Clutter, Gio, GLib, GObject, Meta, Pango, St} = imports.gi;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const ModalDialog = imports.ui.modalDialog;
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
    const suffix = remaining < 0 ? `${-remaining} days overdue` : `${remaining} days remain`;
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
        profileItem.remove_all_children();
        this.profileItem = profileItem;
        profileItem.add_style_class_name('pingoose-overview-item');
        profileItem.add_style_class_name('pingoose-profile-container');
        const profile = new St.BoxLayout({vertical: true, style_class: 'pingoose-profile'});
        const identity = new St.BoxLayout({style_class: 'pingoose-identity'});
        this.avatar = new St.Bin({width: 64, height: 64, y_align: Clutter.ActorAlign.CENTER, style_class: 'pingoose-avatar'});
        this.avatar.set_child(new St.Icon({icon_name: 'avatar-default-symbolic', icon_size: 40}));
        identity.add_child(this.avatar);
        const names = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.profileHeader = new St.BoxLayout({x_expand: true, style_class: 'pingoose-profile-header'});
        this.profileName = new St.Label({text: 'Loading profile…', style_class: 'pingoose-profile-name'});
        this.profileLogin = new St.Label({text: '', style_class: 'pingoose-profile-login'});
        this.profileName.x_expand = true;
        this.profileName.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.profileHeader.add_child(this.profileName);
        names.add_child(this.profileHeader);

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
        this.deadlineCaption = new St.Label({text: 'Milestone Deadline :', style_class: 'pingoose-profile-caption'});
        deadline.add_child(this.deadlineCaption);
        this.profileDeadline = new St.Label({text: '—', style_class: 'pingoose-profile-deadline'});
        deadline.add_child(this.profileDeadline);
        profile.add_child(deadline);
        this.profileContent = profile;
        this.profileLoading = new St.Label({text: '◌ Loading profile…', style_class: 'pingoose-loading', x_expand: true});
        profileItem.add_child(this.profileLoading);
        profileItem.add_child(profile);
        profile.hide();
        this.profileReady = false;
        this.avatarReady = false;
        this.studyReady = false;
        let frame = 0;
        this.loadingTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            const glyph = ['◐', '◓', '◑', '◒'][frame++ % 4];
            this.checkProfileReady();
            if (!this.profileReady) {
                this.profileLoading.text = `${glyph} Loading profile…`;
                if (!this.loginOnly) this.count.text = glyph;
            }
            this.onCountChanged?.();
            return GLib.SOURCE_CONTINUE;
        });
        this.connect('destroy', () => {
            if (this.loadingTimer) GLib.source_remove(this.loadingTimer);
            this.loadingTimer = 0;
        });
        this.menu.addMenuItem(profileItem);
        this.profileSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this.profileSeparator);
        const overviewItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        overviewItem.remove_all_children();
        const overview = new St.BoxLayout({style_class: 'pingoose-overview', x_expand: true});
        const projectsColumn = new St.BoxLayout({vertical: true, style_class: 'pingoose-overview-column'});
        projectsColumn.add_child(new St.Label({text: 'My Projects', style_class: 'pingoose-heading'}));
        this.projects = new PopupMenu.PopupMenuSection();
        this.projects.addMenuItem(new PopupMenu.PopupMenuItem('Loading projects…', {reactive: false}));
        const projectScroll = new St.ScrollView({style_class: 'pingoose-project-scroll', overlay_scrollbars: false});
        projectScroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        projectScroll.add_actor(this.projects.actor);
        projectsColumn.add_child(projectScroll);
        overview.add_child(projectsColumn);
        const study = new St.BoxLayout({vertical: true, style_class: 'pingoose-overview-column pingoose-logtime-column'});
        this.logtimeTitle = new St.Label({text: '', style_class: 'pingoose-heading'});
        this.monthTime = new St.Label({text: '—', style_class: 'pingoose-study-value'});
        this.todayTime = new St.Label({text: 'Today: —', style_class: 'pingoose-study-value'});
        study.add_child(this.logtimeTitle);
        const studyRows = new PopupMenu.PopupMenuSection();
        for (const value of [this.monthTime, this.todayTime]) {
            const row = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            row.add_style_class_name('pingoose-project-item');
            row.add_child(value);
            studyRows.addMenuItem(row);
        }
        study.add_child(studyRows.actor);
        overview.add_child(study);
        overviewItem.add_style_class_name('pingoose-overview-item');
        this.overviewItem = overviewItem;
        this.projectsColumn = projectsColumn;
        this.studyColumn = study;
        overviewItem.add_child(overview);
        this.menu.addMenuItem(overviewItem);
        const visitItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        visitItem.remove_all_children();
        // Use the same outer menu-item inset as the overview above.
        visitItem.add_style_class_name('pingoose-overview-item');
        visitItem.add_style_class_name('pingoose-visit-row');
        this.visitIntra = new St.Button({can_focus: true,
            x_expand: true, x_align: Clutter.ActorAlign.FILL, style_class: 'pingoose-visit-intra'});
        this.visitIntra.set_child(new St.Label({text: 'Evaluation Slots ▾', x_expand: true,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        visitItem.add_child(this.visitIntra);
        this.menu.addMenuItem(visitItem);
        this.slotsButtonItem = visitItem;
        this.slotItems = new PopupMenu.PopupMenuSection();
        const slotScroll = new St.ScrollView({style_class: 'pingoose-evaluation-scroll pingoose-slot-scroll', overlay_scrollbars: false});
        slotScroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        slotScroll.add_actor(this.slotItems.actor);
        this.slotsItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this.slotsItem.remove_all_children();
        this.slotsItem.add_style_class_name('pingoose-scroll-container');
        this.slotsItem.add_child(slotScroll);
        this.menu.addMenuItem(this.slotsItem);
        this.slotsItem.hide();
        this.refreshLogtimeTitle();
        this.overviewSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this.overviewSeparator);
        // Keep worker diagnostics internal; the notifications area only shows cards.
        this.status = {label: {text: ''}};
        this.evaluations = new PopupMenu.PopupMenuSection();
        const evaluationScroll = new St.ScrollView({style_class: 'pingoose-evaluation-scroll pingoose-evaluation-info-scroll', can_focus: true, overlay_scrollbars: false});
        evaluationScroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        evaluationScroll.add_actor(this.evaluations.actor);
        this.evaluationScroll = evaluationScroll;
        const evaluationItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        evaluationItem.remove_all_children();
        evaluationItem.add_style_class_name('pingoose-scroll-container');
        const evaluationArea = new St.BoxLayout({vertical: true, x_expand: true});
        evaluationArea.add_child(new St.Label({text: 'Evaluation Info', style_class: 'pingoose-heading pingoose-fixed-heading'}));
        evaluationArea.add_child(evaluationScroll);
        evaluationItem.add_child(evaluationArea);
        this.evaluationItem = evaluationItem;
        this.menu.addMenuItem(evaluationItem);
        this.evaluationSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this.evaluationSeparator);
        this.agenda = new PopupMenu.PopupMenuSection();
        const agendaScroll = new St.ScrollView({style_class: 'pingoose-evaluation-scroll', overlay_scrollbars: false});
        agendaScroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        agendaScroll.add_actor(this.agenda.actor);
        this.agendaItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this.agendaItem.remove_all_children();
        this.agendaItem.add_style_class_name('pingoose-scroll-container');
        this.agendaItem.add_child(agendaScroll);
        this.menu.addMenuItem(this.agendaItem);
        this.agendaSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this.agendaSeparator);
        this.cards = new PopupMenu.PopupMenuSection();
        const list = new St.ScrollView({style_class: 'pingoose-list', overlay_scrollbars: false, x_expand: true});
        list.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        list.add_actor(this.cards.actor);
        const listItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        listItem.remove_all_children();
        listItem.add_style_class_name('pingoose-list-container');
        const notificationArea = new St.BoxLayout({vertical: true, x_expand: true});
        notificationArea.add_child(new St.Label({text: 'Notifications', style_class: 'pingoose-heading pingoose-fixed-heading'}));
        notificationArea.add_child(list);
        listItem.add_child(notificationArea);
        this.notificationItem = listItem;
        this.menu.addMenuItem(listItem);
        this.notificationSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this.notificationSeparator);
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open) this.refreshLogtimeTitle();
            if (open && this.lastProfile) this.updateProfile(this.lastProfile);
        });
        this.setLoginOnly(true);
    }

    checkProfileReady() {
        const data = this.lastProfile;
        if (!data || this.profileReady) return;
        const ready = data.name && Number.isFinite(data.level) && Number.isFinite(data.progress) &&
            Number.isFinite(data.points) && Number.isFinite(data.pace) && data.deadline &&
            Array.isArray(data.projects) && this.avatarReady && this.studyReady;
        // A missing/failed optional resource must not conceal the whole profile forever.
        const timedOut = this.profileLoadStarted && GLib.get_monotonic_time() - this.profileLoadStarted >= 30000000;
        if (!ready && !timedOut) return;
        this.profileReady = true;
        this.profileLoading.hide();
        this.profileContent.show();
        this.count.text = '42';
    }

    refreshLogtimeTitle() {
        const month = new Intl.DateTimeFormat('en-US', {month: 'short'}).format(new Date());
        this.logtimeTitle.text = `Logtime: ${month}`;
    }

    updateProfile(data) {
        if (!this.profileLoadStarted) this.profileLoadStarted = GLib.get_monotonic_time();
        const previous = this.lastProfile?.login === data.login ? this.lastProfile : {};
        const merged = {...previous};
        for (const [key, value] of Object.entries(data)) {
            if (value !== null && value !== undefined && value !== '') merged[key] = value;
        }
        data = merged;
        this.lastProfile = data;
        this.checkProfileReady();
        const renderKey = JSON.stringify([data, deadlineText(data.deadline)]);
        if (renderKey === this.profileRenderKey) return;
        this.profileRenderKey = renderKey;
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
        this.deadlineCaption.text = ({milestone: 'Milestone Deadline :', ultimate: 'Ultimate Deadline :',
            blackhole: 'Blackholed at :', alumnization: 'Alumnization :'})[data.deadlineKind] || 'Milestone Deadline :';
        this.profileDeadline.text = deadlineText(data.deadline);
        if (number(data.pace, 1000) === 24 && this.profileDeadline.text !== '—')
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
            item.add_style_class_name('pingoose-project-item');
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
        this.icon.visible = true;
        this.accessible_name = 'Pingoose 42 Info';
        if (loginOnly) this.count.text = 'Login Required';
        this.onLoginStateChanged?.();
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
        this._indicator.onCountChanged = () => this._updatePanelLabel();
        Main.panel.addToStatusArea(Me.uuid, this._indicator);
        this._profileClock = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._indicator?.refreshLogtimeTitle();
            if (this._indicator?.lastProfile) this._indicator.updateProfile(this._indicator.lastProfile);
            return GLib.SOURCE_CONTINUE;
        });
        this._cancel = new Gio.Cancellable();
        this._commands = [];
        this._writing = false;
        this._notifications = [];
        this._unreadIds = new Set();
        this._agenda = [];
        this._evaluations = [];
        this._feedback = {};
        this._renderEvaluations();
        this._evaluationClock = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => { this._renderEvaluations(); return GLib.SOURCE_CONTINUE; });
        this._workerStatus = null;
        this._slotsExpanded = false;
        this._slots = [];
        this._indicator.visitIntra.connect('clicked', () => {
            this._slotsExpanded = !this._slotsExpanded;
            if (this._slotsExpanded) this._requestSlots('slots:list');
            else this._renderSlots();
        });

        this._settingsChanged = this._settings.connect('changed::flash-count', () => this._clearFlash());
        this._renderCards();
        this._chatPanel = new Me.imports.chatPanel.ChatPanel(this._indicator);
        this._buildSettings();
        this._sessionHook = new Me.imports.systemSessionHook.SystemSessionHook(
            (command, callback) => this._sessionSlotRequest(command, callback),
            () => !!this._process && !this._indicator.loginOnly);
        this._sessionHook.enable();
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
        const toolbar = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        toolbar.remove_all_children();
        toolbar.add_style_class_name('pingoose-toolbar');
        indicator.menu.addMenuItem(toolbar, 0);
        const mainItems = indicator.menu._getMenuItems();

        const gear = new St.Button({style_class: 'pingoose-settings-button', can_focus: true,
            x_expand: false, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START, accessible_name: 'More options'});
        gear.set_child(new St.Label({text: '⋮', style_class: 'pingoose-more-icon'}));
        const toolbarSpace = new St.Widget({x_expand: true});
        toolbar.add_child(toolbarSpace);
        toolbar.add_child(gear);
        const welcome = new PopupMenu.PopupMenuSection();
        indicator.menu.addMenuItem(welcome);
        // A plain full-width container avoids menu-item ornament/indent columns.
        const welcomeContent = new St.BoxLayout({vertical: true, x_expand: true,
            style_class: 'pingoose-welcome-content'});
        welcomeContent.add_child(new St.Label({text: 'Pingoose 42 Info', x_expand: true,
            x_align: Clutter.ActorAlign.CENTER, style_class: 'pingoose-welcome-title'}));
        const loginButton = new St.Button({can_focus: true, x_expand: true,
            x_align: Clutter.ActorAlign.CENTER, style_class: 'pingoose-login-button'});
        loginButton.set_child(new St.Label({text: 'Log in to 42 Intra',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        loginButton.connect('clicked', () => { indicator.menu.close(); this._send('login'); });
        welcomeContent.add_child(loginButton);
        welcome.actor.add_child(welcomeContent);
        const settings = new PopupMenu.PopupMenu(gear, 1.0, St.Side.TOP);
        Main.uiGroup.add_child(settings.actor);
        settings.actor.hide();
        this._optionsMenu = settings;
        this._optionsManager = new PopupMenu.PopupMenuManager(indicator);
        this._optionsManager.addMenu(settings);
        settings.addAction('Visit 42 Intra', () => { indicator.menu.close(); this._send('show'); });
        settings.addAction('Settings', () => {
            indicator.menu.close();
            imports.misc.extensionUtils.openPrefs();
        });
        const devFile = Gio.File.new_for_path(`${Me.path}/devOptions.js`);
        if (devFile.query_exists(null)) Me.imports.devOptions.addOptions(settings, () => this._send('test'), row => {
            this._evaluations = [...this._evaluations, row];
            delete this._feedback[row.id];
            this._renderEvaluations();
            settings.close();
        });
        settings.addAction('Logout Intra', () => this._confirmIntraLogout());
        const showMain = () => {
            for (const item of mainItems) item.actor.visible = !indicator.loginOnly;
            welcome.actor.visible = indicator.loginOnly;
            this._settingsVisible = false;
            this._syncOptionalSections();
        };
        const sync = () => {
            const theme = this._settings.get_string('theme');
            indicator.menu.actor.remove_style_class_name('pingoose-dark');
            indicator.menu.actor.remove_style_class_name('pingoose-light');
            indicator.menu.actor.add_style_class_name(`pingoose-${theme}`);

        };
        this._themeChanged = this._settings.connect('changed', () => { sync(); showMain(); });
        sync();
        indicator.menu.connect('open-state-changed', (_menu, open) => {
            if (!open) settings.close();
            if (open) {
                settings.close(); showMain();
                this._unreadIds.clear();
                for (const notification of this._notifications) notification.unread = false;
                this._updatePanelLabel();
            }
        });
        indicator.onLoginStateChanged = () => { settings.close(); showMain(); };
        gear.connect('clicked', () => settings.toggle());
        showMain();
    }

    _confirmIntraLogout() {
        if (this._logoutDialog) return;
        this._optionsMenu?.close();
        this._indicator.menu.close();
        const dialog = new ModalDialog.ModalDialog();
        this._logoutDialog = dialog;
        dialog.contentLayout.add_child(new St.Label({text: 'Log out of 42 Intra?',
            style: 'font-weight: bold; font-size: 1.2em;'}));
        dialog.contentLayout.add_child(new St.Label({text: 'You will need to log in again to view your Intra information.'}));
        const finish = confirmed => {
            this._logoutDialog = null;
            dialog.destroy();
            if (confirmed) {
                this._chatPanel?.reset();
                this._send('logout');
            }
        };
        dialog.setButtons([
            {label: 'Cancel', action: () => finish(false), key: Clutter.KEY_Escape, default: true},
            {label: 'Log Out', action: () => finish(true)},
        ]);
        if (!dialog.open()) finish(false);
    }

    _clearProfile() {
        this._chatPanel?.reset();
        this._slots = [];
        this._slotsExpanded = false;
        this._slotsBusy = false;
        this._slotsError = null;
        this._renderSlots();
        const indicator = this._indicator;
        this._agenda = [];
        this._evaluations = [];
        this._feedback = {};
        this._renderEvaluations();
        indicator.lastProfile = null;
        indicator.profileRenderKey = null;
        indicator.profileLoadStarted = 0;
        indicator.profileReady = indicator.avatarReady = indicator.studyReady = false;
        indicator.profileContent.hide();
        indicator.profileLoading.show();
        indicator.projectsKey = null;
        indicator.profileName.text = 'Loading profile…';
        indicator.profileLogin.text = '';
        indicator.monthTime.text = '—';
        indicator.todayTime.text = 'Today: —';
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
        this._unreadIds = new Set();
        indicator.setLoginOnly(true);
        this._renderCards();
    }

    _read(proc, input, cancel) {
        input.read_line_async(GLib.PRIORITY_DEFAULT, cancel, (stream, result) => {
            try {
                const [line] = stream.read_line_finish_utf8(result);
                if (this._process !== proc || cancel.is_cancelled() || line === null)
                    return;
                if (line.length <= 4194304) {
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
        if (message.type === 'slots') {
            const callback = this._sessionSlotsCallback;
            this._sessionSlotsCallback = null;
            if (this._sessionSlotsTimer) GLib.source_remove(this._sessionSlotsTimer);
            this._sessionSlotsTimer = 0;
            this._slotsBusy = false;
            if (Array.isArray(message.rows) && message.rows.length <= 1000) this._slots = message.rows;
            this._slotsError = typeof message.error === 'string' ? message.error.slice(0, 200) : null;
            this._renderSlots();
            callback?.(message);
            return;
        }
        if (message.type === 'evaluation-dismissed' && typeof message.id === 'string') {
            const id = message.id;
            this._notifications = this._notifications.filter(item => item.id !== `intrapy:${id}` &&
                !['seat', 'reminder', 'rescheduled'].some(prefix => item.id.startsWith(`${prefix}:${id}:`)));
            for (const key of this._unreadIds || []) {
                if (key === `intrapy:${id}` || ['seat', 'reminder', 'rescheduled'].some(prefix => key.startsWith(`${prefix}:${id}:`)))
                    this._unreadIds.delete(key);
            }
            delete this._feedback[id];
            this._renderCards();
            return;
        }
        if (message.type === 'agenda' && Array.isArray(message.rows) && message.rows.length <= 100) {
            this._agenda = message.rows;
            this._renderAgenda();
            return;
        }
        if (message.type === 'evaluations' && Array.isArray(message.rows) && message.rows.length <= 10000) {
            this._evaluations = [...message.rows, ...this._evaluations.filter(row => row.devTest)];
            this._renderEvaluations();
            return;
        }
        if (message.type === 'study-time') {
            if (message.login !== GLib.get_user_name()) return;
            const format = minutes => Number.isInteger(minutes) && minutes >= 0 && minutes <= 44640
                ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : '—';
            this._indicator.refreshLogtimeTitle();
            this._indicator.monthTime.text = format(message.monthMinutes);
            this._indicator.todayTime.text = `Today: ${format(message.todayMinutes)}`;
            this._indicator.studyReady = Number.isInteger(message.monthMinutes) && Number.isInteger(message.todayMinutes);
            this._indicator.checkProfileReady();
            return;
        }
        if (message.type === 'signed-out') { this._clearProfile(); return; }
        if (['profile', 'profile-avatar'].includes(message.type)) {
            if (message.login !== GLib.get_user_name()) return;
            if (message.type === 'profile') this._indicator.updateProfile(message);
            else {
                const image = Gio.File.new_for_path(GLib.build_filenamev([
                    GLib.get_user_state_dir(), 'pingoose', 'profile-avatar']));
                this._indicator.avatarReady = true;
                this._indicator.checkProfileReady();
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
                const wasLoginOnly = this._indicator.loginOnly;
                this._indicator.setLoginOnly(false);
                if (wasLoginOnly) this._renderCards();
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
        this._unreadIds ||= new Set();
        if (!this._indicator.menu.isOpen || this._settingsVisible) this._unreadIds.add(message.id);
        this._notifications.unshift({id: message.id, body: message.body,
            test: message.test === true, category: message.category,
            unread: !this._indicator.menu.isOpen || this._settingsVisible, time: GLib.DateTime.new_now_local().format('%H:%M')});
        this._notifications.length = Math.min(this._notifications.length, 5);
        this._renderCards();
        this._showBanner(message);
        this._flashScreen();
    }

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
                        this._evaluations = this._evaluations.filter(item => item !== row);
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

        if (this._slotsBusy) { textRow('Updating slots…'); return; }
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
        footer.remove_all_children(); footer.set_style('padding: 6px 24px 6px 0;');
        const refresh = new St.Button({label: 'Refresh', can_focus: true, style_class: 'pingoose-clear-button'});
        refresh.connect('clicked', () => this._requestSlots('slots:list'));
        footer.add_child(refresh);
        if (this._slots?.length) {
            const all = new St.Button({label: 'Close All Slots', can_focus: true, x_expand: true, x_align: Clutter.ActorAlign.END, style_class: 'pingoose-clear-button'});
            all.connect('clicked', () => this._requestSlots('slots:all'));
            footer.add_child(all);
        }
        section.addMenuItem(footer);
    }

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

    _updatePanelLabel() {
        const indicator = this._indicator;
        if (!indicator) return;
        if (indicator.loginOnly) { indicator.count.text = 'Login Required'; return; }
        const feedback = (this._evaluations || []).filter(row => Date.parse(row.begin) <= Date.now()).length +
            (this._agenda || []).filter(row => row.feedback).length;
        const unread = this._unreadIds?.size ?? (this._notifications || []).filter(row => row.unread).length;
        const badge = count => count > 5 ? '5+' : String(count);
        if (feedback) indicator.count.text = `Feedback ${badge(feedback)}`;
        else if (unread) indicator.count.text = `New ${badge(unread)}`;
        else if (indicator.profileReady) indicator.count.text = '42';
    }

    _syncOptionalSections() {
        this._chatPanel?.sync();
        this._updatePanelLabel();
        const indicator = this._indicator;
        if (indicator.slotsItem) indicator.slotsItem.visible = !!this._slotsExpanded && !indicator.loginOnly;
        const enabled = key => this._settings ? this._settings.get_boolean(`show-${key}`) : true;
        if (indicator.slotsButtonItem) indicator.slotsButtonItem.visible = !indicator.loginOnly && enabled('slots');
        if (indicator.slotsItem) indicator.slotsItem.visible = !!this._slotsExpanded && !indicator.loginOnly && enabled('slots');
        if (indicator.profileSeparator) indicator.profileSeparator.visible = !indicator.loginOnly && enabled('profile');
        if (indicator.profileItem) indicator.profileItem.visible = !indicator.loginOnly && enabled('profile');
        if (indicator.overviewItem) {
            indicator.projectsColumn.visible = enabled('projects');
            indicator.studyColumn.visible = enabled('logtime');
            indicator.overviewItem.visible = !indicator.loginOnly && (enabled('projects') || enabled('logtime'));
        }
        const evaluationsVisible = !indicator.loginOnly && !this._settingsVisible && !!this._evaluations?.length && enabled('evaluations');
        const notificationsVisible = !indicator.loginOnly && !this._settingsVisible && !!this._notifications?.length && enabled('notifications');
        const agendaVisible = !indicator.loginOnly && !this._settingsVisible && !!this._agenda?.length && enabled('agenda');
        indicator.agendaItem.actor.visible = agendaVisible;
        indicator.agendaSeparator.actor.visible = agendaVisible && notificationsVisible;
        indicator.evaluationItem.actor.visible = evaluationsVisible;
        indicator.evaluationSeparator.actor.visible = evaluationsVisible && (agendaVisible || notificationsVisible);
        indicator.notificationItem.actor.visible = notificationsVisible;
        // Caps, not fixed heights: short lists occupy only their natural height.
        // Preserve more room for notifications when the slot list is expanded.
        const slotsVisible = !!this._slotsExpanded && !indicator.loginOnly && enabled('slots');
        const evaluationMax = notificationsVisible ? (slotsVisible ? 190 : 300) : (slotsVisible ? 280 : 360);
        indicator.evaluationScroll?.set_style(`min-height: 0; max-height: ${evaluationMax}px;`);
        indicator.notificationSeparator.actor.visible = false;
        if (indicator.overviewSeparator) indicator.overviewSeparator.actor.visible = evaluationsVisible || agendaVisible || notificationsVisible;
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

    disable() {
        this._chatPanel?.destroy();
        this._chatPanel = null;
        this._logoutDialog?.destroy();
        this._logoutDialog = null;
        if (this._evaluationScrollRestore) Meta.later_remove(this._evaluationScrollRestore);
        this._evaluationScrollRestore = 0;
        this._evaluationScrollPosition = null;
        this._sessionHook?.disable();
        this._sessionHook = null;
        if (this._sessionSlotsTimer) GLib.source_remove(this._sessionSlotsTimer);
        this._sessionSlotsTimer = 0;
        this._sessionSlotsCallback = null;
        this._optionsMenu?.destroy();
        this._optionsMenu = null;
        this._optionsManager = null;
        this._bannerSource?.destroy();
        this._bannerSource = null;
        if (this._evaluationClock) GLib.source_remove(this._evaluationClock);
        this._evaluationClock = 0;
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
        this._unreadIds = new Set();
    }
}

function init() {
    return new Pingoose();
}
