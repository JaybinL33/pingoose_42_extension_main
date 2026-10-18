const {Clutter, Gio, GLib, GObject, Meta, Pango, St} = imports.gi;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const ModalDialog = imports.ui.modalDialog;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const ByteArray = imports.byteArray;
const Indicator = Me.imports.ui.indicator.Indicator;

const STATUS = Object.fromEntries([
    'authenticated', 'loading', 'watching', 'login-needed', 'auth-error',
    'permission-error', 'account-error', 'rate-limit', 'retry-wait', 'network-error',
    'api-error', 'response-error', 'storage-error', 'worker-error', 'worker-busy',
].map(state => [state, state]));

class Pingoose {
    enable() {
        this._evaluationTimes = new Map();
        this._evaluationActors = new Map();
        this._evaluationKey = null;
        this._resetting=false;this._resetReady=false;this._resetWorkerExited=false;
        this._flashActors = [];
        this._flashTimer = 0;
        this._lastFlash = -Infinity;
        this._settings = imports.misc.extensionUtils.getSettings();
        this._notificationSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._indicator = new Indicator();
        this._indicator.onLogin = () => this._send('login');
        this._indicator.onProjectOpen = project => {
            if (this._settings.get_boolean('project-open-direct')) this._visitProject(project);
            else this._projectPanel.open(project);
        };

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

        this._indicator.autoSlotsButton.connect('clicked',()=>{
            if(!Me.imports.models.featureFlags.enabled(this._settings,'hidden-auto-slots'))return;
            this._slotsExpanded=true;this._requestSlots('slots:open-5');
        });

        this._settingsChanged = this._settings.connect('changed::flash-count', () => this._clearFlash());
        this._renderCards();
        this._chatPanel = new Me.imports.ui.chatPanel.ChatPanel(this._indicator);
        this._servicePanel = new Me.imports.ui.servicePanel.ServicePanel(this._indicator, command => this._send(command));
        this._projectPanel = new Me.imports.ui.projectPanel.ProjectPanel(this._indicator, project => this._visitProject(project));
        this._buildSettings();
        this._sessionHook = new Me.imports.services.systemSessionHook.SystemSessionHook(
            (command, callback) => this._sessionSlotRequest(command, callback),
            () => !!this._process && !this._indicator.loginOnly);
        this._sessionHook.enable();
        this._startWorker();
        this._requestFullReset();
    }

    _startWorker() {
        try {
            this._process = Gio.Subprocess.new(['/usr/bin/gjs', `${Me.path}/worker/webview.js`],
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
            const proc = this._process;
            const input = new Gio.DataInputStream({base_stream: proc.get_stdout_pipe()});
            this._read(proc, input, this._cancel);
            proc.wait_async(null, (child, result) => {
                try { child.wait_finish(result); } catch (_) { /* Already stopping. */ }
                if (this._process === child && this._indicator) {
                    if (this._resetting) {
                        this._resetWorkerExited=true;
                        if(this._resetReady){this._process=null;this._finishFullReset();}
                        return;
                    }
                    this._process = null;
                    if (!['worker-busy', 'worker-error'].includes(this._workerStatus))
                        this._indicator.status.label.text = 'Intra monitoring stopped. Restart the extension.';
                }
            });
        } catch (_) {
            this._indicator.status.label.text = 'Unable to start Intra monitoring. Check your GJS installation.';
        }
    }

    _visitProject(project) {
        this._send('project:open:' + JSON.stringify(project));
        this._indicator.menu.close();
    }

    _clearProfile() {
        this._projectPanel?.reset();
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
                if (this._process !== proc || cancel.is_cancelled()) return;
                if(line===null){
                    if(this._resetting && !this._resetReady){
                        this._resetting=false;this._settings.set_string('reset-status','error');
                    }
                    return;
                }
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
        if (message.type === 'reset-ready') {
            this._resetReady=true;
            if(this._resetWorkerExited){this._process=null;this._finishFullReset();}
            return;
        }
        if (message.type === 'reset-error') {
            this._resetting=false;this._settings.set_string('reset-status','error');return;
        }
        if (this._resetting) return;
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

    disable() {
        this._projectPanel?.destroy();
        this._projectPanel = null;
        this._servicePanel?.destroy();
        this._servicePanel = null;
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

// Feature controllers share this extension's lifecycle and state.
for (const name of ['settings', 'evaluations', 'slots', 'agenda', 'notifications', 'visibility', 'reset', 'layout']) {
    const descriptors = Object.getOwnPropertyDescriptors(Me.imports.ui[name].Controller.prototype);
    delete descriptors.constructor;
    Object.defineProperties(Pingoose.prototype, descriptors);
}

function init() {
    return new Pingoose();
}
