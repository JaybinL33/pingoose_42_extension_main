const {Clutter, Gio, GLib, GObject, Pango, St} = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const ByteArray = imports.byteArray;

const STATUS = {
    loading: '인트라 v3 연결 · 로그인/평가 기준 목록 확인 중…',
    watching: '인트라 v3 · 10초마다 평가 조회 중',
    'login-needed': '인트라 로그인 필요 · 인트라 창 열기를 눌러 주세요',
    'auth-error': '인트라 인증 갱신 대기 · 숨긴 창에서 자동 재시도',
    'permission-error': 'API 평가 조회 권한이 없어요',
    'account-error': '현재 OS 사용자와 42 계정을 확인해 주세요',
    'rate-limit': 'API 호출 한도 도달 · 자동 재시도 대기',
    'retry-wait': '서비스의 Retry-After 요청에 따라 대기 중',
    'network-error': 'API 연결 실패 · 자동 재시도 대기',
    'api-error': 'API 요청 실패 · 자동 재시도 대기',
    'response-error': 'API 응답을 읽지 못했어요 · 기준 목록은 유지',
    'storage-error': '평가 ID 저장 파일·권한을 확인해 주세요',
    'worker-error': '보조 프로세스 오류 · GJS/GTK/WebKit 설치·폴더 권한을 확인해 주세요',
    'worker-busy': 'Pingoose 보조 프로세스가 이미 실행 중이에요',
};

const Indicator = GObject.registerClass(class PingooseIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Pingoose');
        this.accessible_name = 'Pingoose 평가 알림';
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        box.add_child(new St.Icon({icon_name: 'preferences-system-notifications-symbolic', style_class: 'system-status-icon'}));
        this.count = new St.Label({text: '42', y_align: Clutter.ActorAlign.CENTER, style_class: 'pingoose-count'});
        box.add_child(this.count);
        this.add_child(box);
        const title = new PopupMenu.PopupMenuItem('Pingoose · 평가 알림', {reactive: false});
        title.label.add_style_class_name('pingoose-heading');
        this.menu.addMenuItem(title);
        this.status = new PopupMenu.PopupMenuItem('인트라 v3 감지 시작 중…', {reactive: false});
        this.status.label.add_style_class_name('pingoose-status');
        this.status.label.clutter_text.line_wrap = true;
        this.menu.addMenuItem(this.status);
        this.cards = new PopupMenu.PopupMenuSection();
        const list = new St.ScrollView({style_class: 'pingoose-list', overlay_scrollbars: true});
        list.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        list.add_actor(this.cards.actor);
        const listItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        listItem.add_child(list);
        this.menu.addMenuItem(listItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
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
        Main.panel.addToStatusArea(Me.uuid, this._indicator);
        this._cancel = new Gio.Cancellable();
        this._commands = [];
        this._writing = false;
        this._notifications = [];
        this._workerStatus = null;
        this._indicator.menu.addAction('인트라 창 열기', () => this._send('show'));
        this._indicator.menu.addAction('인트라 창 숨기기', () => this._send('hide'));
        this._indicator.menu.addAction('테스트 알림 보내기', () => this._send('test'));
        const flashMenu = new PopupMenu.PopupSubMenuMenuItem('');
        const choices = [];
        for (let count = 0; count <= 5; count++) {
            choices.push(flashMenu.menu.addAction(count ? `${count}회` : '끄기',
                () => this._settings.set_int('flash-count', count)));
        }
        const syncFlashCount = () => {
            this._clearFlash();
            const count = this._settings.get_int('flash-count');
            flashMenu.label.text = `화면 점멸: ${count ? `${count}회` : '끄기'}`;
            choices.forEach((item, value) => item.setOrnament(
                value === count ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE));
        };
        this._settingsChanged = this._settings.connect('changed::flash-count', syncFlashCount);
        syncFlashCount();
        this._indicator.menu.addMenuItem(flashMenu);
        this._indicator.menu.addAction('알림 카드 지우기', () => {
            this._notifications = [];
            this._renderCards();
        });
        this._renderCards();
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
                        this._indicator.status.label.text = '인트라 감지 종료 · 확장을 다시 켜 주세요';
                }
            });
        } catch (_) {
            this._indicator.status.label.text = '인트라 감지 시작 실패 · GJS 설치 확인 필요';
        }
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
                            this._indicator.status.label.text = '알림 메시지/UI 처리 오류 · 다시 켜서 확인해 주세요';
                    }
                }
                this._read(proc, stream, cancel);
            } catch (_) {
                if (!cancel.is_cancelled() && this._indicator)
                    this._indicator.status.label.text = 'API 보조 프로세스 연결을 읽지 못했어요';
            }
        });
    }

    _send(command) {
        if (!this._process) {
            this._indicator.status.label.text = 'API 감지가 꺼져 있어요 · 확장을 다시 켜 주세요';
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
                    this._indicator.status.label.text = 'API 보조 프로세스에 명령을 전달하지 못했어요';
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
        if (message.type === 'status' && Object.prototype.hasOwnProperty.call(STATUS, message.state)) {
            this._workerStatus = message.state;
            let status = STATUS[message.state];
            if (message.state === 'watching' && Number.isInteger(message.count) &&
                message.count >= 0 && message.count <= 2000 && typeof message.login === 'string' &&
                /^[a-zA-Z0-9_-]{1,64}$/.test(message.login)) {
                const checked = GLib.DateTime.new_now_local().format('%H:%M:%S');
                status += ` · ${message.login} · 대기 ${message.count}건 · 최근 ${checked}`;
            } else if (Number.isFinite(message.retryAfter) && message.retryAfter > 0) {
                status += ` · ${Math.ceil(message.retryAfter)}초 후 재시도`;
            }
            this._indicator.status.label.text = status;
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
        Main.notify(message.test ? 'Pingoose · 테스트' : 'Pingoose · 새 평가 예약',
            '상단 패널의 Pingoose에서 내용을 확인하세요.');
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
        indicator.count.text = this._notifications.length ? String(this._notifications.length) : '42';
        if (!this._notifications.length) {
            indicator.cards.addMenuItem(new PopupMenu.PopupMenuItem('아직 새 알림이 없어요', {reactive: false}));
            return;
        }
        for (const notification of this._notifications) {
            const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            const card = new St.BoxLayout({vertical: true, style_class: 'pingoose-card'});
            card.add_child(new St.Label({text: notification.test ? '테스트 알림' : '42 · 새 평가 예약',
                style_class: 'pingoose-card-title'}));
            const body = new St.Label({text: notification.body, style_class: 'pingoose-card-body'});
            body.clutter_text.line_wrap = true;
            body.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            body.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            card.add_child(body);
            card.add_child(new St.Label({text: `${notification.time} 수신`, style_class: 'pingoose-card-time'}));
            item.add_child(card);
            indicator.cards.addMenuItem(item);
        }
    }

    disable() {
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
