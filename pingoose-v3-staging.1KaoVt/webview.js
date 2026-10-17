#!/usr/bin/gjs
imports.gi.versions.Gtk = '3.0';
imports.gi.versions.WebKit2 = '4.0';
imports.gi.versions.Soup = '2.4';
const {Gio, GLib, Gtk, Soup, WebKit2} = imports.gi;
const ByteArray = imports.byteArray;
const System = imports.system;
imports.searchPath.unshift(GLib.path_get_dirname(System.programPath));
const Model = imports.evaluations;
const HOME = 'https://profile-v3.intra.42.fr/';
const ENDPOINT = 'https://intrapy.intra.42.fr/api/v1/users/me/scale_teams';
// Summary is also requested when the user hides the evaluations widget.
const AUTH_REQUESTS = [ENDPOINT, 'https://intrapy.intra.42.fr/api/v1/users/me/summary'];
const TEST = ARGV.includes('--self-test');
const UID = new Gio.Credentials().get_unix_user();
const now = () => GLib.get_monotonic_time() / 1000000;
let worker = null;
let owner = 0;
let stopped = false;
let exitCode = 0;
const testMessages = [];
let lastStatus = '';
function emit(message) {
    if (stopped) return;
    if (TEST) testMessages.push(message);
    else print(JSON.stringify(message));
}
function status(state, extra = {}) {
    const message = {type: 'status', state, ...extra};
    const key = JSON.stringify(message);
    if (state !== 'watching' && key === lastStatus) return;
    lastStatus = key;
    emit(message);
}
function stop(code = 0) {
    if (stopped) return;
    stopped = true;
    exitCode = code;
    worker?.close();
    if (owner) Gio.bus_unown_name(owner);
    Gtk.main_quit();
}
function privateDirectory(path) {
    if (GLib.mkdir_with_parents(path, 0o700) !== 0) throw new Error('storage-error');
    const file = Gio.File.new_for_path(path);
    const info = file.query_info('standard::type,unix::uid', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    if (info.get_file_type() !== Gio.FileType.DIRECTORY || info.get_attribute_uint32('unix::uid') !== UID)
        throw new Error('storage-error');
    file.set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
}
function profileURI(uri) {
    try {
        const parsed = GLib.Uri.parse(uri || '', GLib.UriFlags.NONE);
        return parsed.get_scheme() === 'https' && parsed.get_host() === 'profile-v3.intra.42.fr' &&
            !parsed.get_userinfo() && [-1, 443].includes(parsed.get_port());
    } catch (_) { return false; }
}
function allowedURI(uri) {
    if (uri === 'about:blank') return true;
    try {
        const parsed = GLib.Uri.parse(uri, GLib.UriFlags.NONE);
        const host = parsed.get_host() || '';
        return parsed.get_scheme() === 'https' && !parsed.get_userinfo() && [-1, 443].includes(parsed.get_port()) &&
            (host === 'auth.42.fr' || host === 'intra.42.fr' || host.endsWith('.intra.42.fr'));
    } catch (_) { return false; }
}

// Read only the visible profile DOM; no page storage or authentication data.
function readProfileDOM(login) {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
    const heading = Array.from(document.querySelectorAll('h1')).find(h => /^\d{1,3}$/.test(h.textContent.trim()));
    const progress = text.match(/(?:^|\s)(\d{1,3})\s*%/);
    const points = text.match(/Ev\.\s*P\s*(\d+)/i);
    const pace = text.match(/Pace\s*(\d+)/i);
    const deadline = text.match(/Milestone Deadline\s*:\s*(\d{4})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})/i);
    const avatar = Array.from(document.images).find(img => /^https:\/\/cdn\.intra\.42\.fr\/users\//.test(img.src));
    const projects = [];
    const seen = new Set();
    for (const link of document.querySelectorAll('a[href]')) {
        try {
            const url = new URL(link.href);
            const match = url.pathname.match(/^\/([a-zA-Z0-9_-]{1,100})\/([a-zA-Z0-9_-]{1,64})\/?$/);
            if (url.origin !== 'https://projects.intra.42.fr' || !match || match[2] !== login ||
                !link.textContent.trim() || seen.has(match[1])) continue;
            seen.add(match[1]);
            projects.push({name: link.textContent.trim().slice(0, 80), slug: match[1]});
            if (projects.length === 20) break;
        } catch (_) { /* Ignore unrelated links. */ }
    }
    return JSON.stringify({
        profileLogin: avatar?.src.match(/\/([a-zA-Z0-9_-]+)\.(?:jpg|jpeg|png|webp)(?:[?#]|$)/i)?.[1] || null,
        projects: projects.length || /\bprojects\b/i.test(text) ? projects : null,
        name: document.querySelector('h2')?.textContent.trim().slice(0, 100) || '',
        level: heading ? Number(heading.textContent.trim()) : null,
        progress: progress ? Number(progress[1]) : null,
        points: points ? Number(points[1]) : null,
        pace: pace ? Number(pace[1]) : null,
        deadline: deadline ? `${deadline[1]}-${deadline[2].padStart(2, '0')}-${deadline[3].padStart(2, '0')}` : null,
        avatar: avatar?.src || null,
    });
}

class Worker {
    constructor() {
        this.login = GLib.get_user_name();
        this.auth = null;
        this.loginWindow = false;
        this.nextProfileRead = 0;
        this.profileReading = false;
        this.avatarURL = null;
        this.avatarResources = new Map();
        this.profileDiagnostics = {};
        this.diagnosticUntil = TEST ? 0 : now() + 90;
        this.pending = null;
        this.nextPoll = Infinity;
        this.notBefore = 0;
        this.reloadAt = Infinity;
        this.backoff = 20;
        this.lastPageLoad = now();
        this.cancel = new Gio.Cancellable();
        this.session = new Soup.Session({timeout: 15, ssl_strict: true, user_agent: 'Pingoose/3'});
        this.stateDirectory = TEST ? GLib.dir_make_tmp('pingoose-view-check-XXXXXX') :
            GLib.build_filenamev([GLib.get_user_state_dir(), 'pingoose']);
        privateDirectory(this.stateDirectory);
        this.signedOutFile = Gio.File.new_for_path(`${this.stateDirectory}/signed-out`);
        this.webLoginOnlyFile = Gio.File.new_for_path(`${this.stateDirectory}/web-login-only`);
        this.signedOut = !TEST && this.signedOutFile.query_exists(null);
        this.clearingLogin = false;
        this.stateFile = Gio.File.new_for_path(`${this.stateDirectory}/intrapy-evaluations.json`);
        const directory = GLib.build_filenamev([GLib.get_user_data_dir(), 'pingoose']);
        if (!TEST) privateDirectory(directory);
        const manager = TEST ? WebKit2.WebsiteDataManager.new_ephemeral() : new WebKit2.WebsiteDataManager({
            base_data_directory: `${directory}/profile`, base_cache_directory: `${directory}/cache`,
        });
        this.dataManager = manager;
        this.context = WebKit2.WebContext.new_with_website_data_manager(manager);
        this.context.connect('download-started', (_context, download) => download.cancel());
        if (!TEST) this.context.get_cookie_manager().set_persistent_storage(
            `${directory}/cookies.sqlite`, WebKit2.CookiePersistentStorage.SQLITE);
        this.view = new WebKit2.WebView({web_context: this.context});
        this.view.get_settings().set_enable_write_console_messages_to_stdout(false);
        this.window = new Gtk.Window({title: 'Pingoose · Intra Login', default_width: 1000, default_height: 750});
        const header = new Gtk.HeaderBar({title: 'Pingoose · Intra',
            subtitle: 'This window closes automatically after login', show_close_button: true});
        const home = new Gtk.Button({label: 'Intra Home'});
        home.connect('clicked', () => this.view.load_uri(HOME));
        header.pack_start(home);
        this.window.set_titlebar(header);
        this.window.add(this.view);
        this.window.connect('delete-event', () => { this.window.hide(); return true; });
        this.view.connect('permission-request', (_view, request) => { request.deny(); return true; });
        this.view.connect('decide-policy', (_view, decision, type) => {
            if (type !== WebKit2.PolicyDecisionType.NAVIGATION_ACTION && type !== WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION)
                return false;
            if (type === WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION ||
                !allowedURI(decision.get_navigation_action().get_request().get_uri())) {
                decision.ignore(); return true;
            }
            return false;
        });
        this.view.connect('load-failed', () => {
            if (!this.auth) { status('network-error'); this.reloadAt = now() + 30; }
            return false;
        });
        this.view.connect('load-changed', (_view, event) => {
            if (event === WebKit2.LoadEvent.STARTED) this.lastPageLoad = now();
            if (event === WebKit2.LoadEvent.FINISHED && !TEST && !this.auth) {
                status(profileURI(this.view.get_uri()) ? 'loading' : 'login-needed');
            }
        });
        this.view.connect('resource-load-started', (_view, resource, request) => {
            const uri = request.get_uri() || '';
            if (/^https:\/\/cdn\.intra\.42\.fr\/users\//.test(uri)) {
                if (this.avatarResources.size >= 8) this.avatarResources.clear();
                this.avatarResources.set(uri, resource);
                resource.connect('finished', () => { this.nextProfileRead = 0; });
            }
            if (/logtime|locations/i.test(uri)) {
                resource.connect('finished', () => this.inspectLogtime(resource, uri, resource.get_response()));
            }
            if (!uri.startsWith('https://intrapy.intra.42.fr/') || request.get_http_method() !== 'GET') return;
            try {
                this.observedPaths = this.observedPaths || new Set();
                this.observedPaths.add(uri.split('?')[0]);
                Gio.File.new_for_path(`${this.stateDirectory}/api-paths.json`).replace_contents(
                    ByteArray.fromString(JSON.stringify([...this.observedPaths])), null, false,
                    Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                const header = request.get_http_headers()?.get_one('Authorization');
                if (header) {
                    this.acceptAuthorization(header);
                }
                resource.connect('finished', () => {
                    if (stopped) return;
                    const response = resource.get_response();
                    this.inspectLogtime(resource, uri, response);
                    this.inspectProfileResource(resource, uri, response);
                    if (response?.get_status_code() === 429)
                        this.fail('rate-limit', Model.retryAfter(response.get_http_headers()?.get_one('Retry-After')));
                });
            } catch (error) {
                if (error.message === 'account-error') this.logout('account-error');
                else { this.auth = null; status('auth-error'); }
            }
        });
        this.view.show();
        if (!TEST) {
            this.input = new Gio.DataInputStream({base_stream: new Gio.UnixInputStream({fd: 0, close_fd: false})});
            this.readCommand();
            this.timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this.tick(); return GLib.SOURCE_CONTINUE;
            });
            // Try automatic background refresh first
            if (this.signedOut) status('login-needed');
            else {
                if (!this.tryPythonRefresh()) status('loading');
                this.view.load_uri(HOME);
            }
        }
    }

    readProfile() {
        if (this.profileReading || !profileURI(this.view.get_uri())) return;
        this.nextProfileRead = now() + 30;
        this.profileReading = true;
        const identity = this.auth;
        this.view.run_javascript_in_world(`(${readProfileDOM.toString()})(${JSON.stringify(identity.login)})`, 'pingoose-profile', this.cancel, (view, result) => {
            this.profileReading = false;
            if (stopped || this.auth !== identity) return;
            try {
                const profile = JSON.parse(view.run_javascript_in_world_finish(result).get_js_value().to_string());
                if (profile.profileLogin && profile.profileLogin !== identity.login) { this.logout('account-error'); return; }
                if (!profile.name && profile.level === null) { this.nextProfileRead = now() + 3; return; }
                emit({type: 'profile', login: identity.login, ...profile, avatar: undefined});
                if (profile.avatar && profile.avatar !== this.avatarURL) this.loadAvatar(profile.avatar, identity);
                const resource = this.avatarResources.get(profile.avatar);
                const report = JSON.stringify({projects: profile.projects?.length ?? null, hasImage: !!profile.avatar, resources: this.avatarResources.size,
                    matched: !!resource, httpStatus: resource?.get_response()?.get_status_code() ?? null});
                if (report !== this.avatarReport) {
                    this.avatarReport = report;
                    Gio.File.new_for_path(`${this.stateDirectory}/profile-image-status.json`).replace_contents(
                        ByteArray.fromString(report), null, false,
                        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                }
            } catch (_) { this.nextProfileRead = now() + 10; }
        });
    }

    loadAvatar(url, identity) {
        // Reuse the image loaded by the authenticated WebKit page. A separate
        // HTTP client can be refused by the CDN even for the same image URL.
        const resource = this.avatarResources.get(url);
        if (!resource || !/^https:\/\/cdn\.intra\.42\.fr\/users\//.test(url)) return;
        const response = resource.get_response();
        if (!response || response.get_status_code() !== 200 ||
            !/^image\//.test(response.get_mime_type() || '') || response.get_content_length() > 2000000) return;
        this.avatarURL = url;
        resource.get_data(this.cancel, (item, result) => {
            try {
                const image = item.get_data_finish(result);
                if (stopped || this.auth !== identity) { this.avatarURL = null; return; }
                if (!image || !image.length || image.length > 2000000) throw new Error('invalid-image');
                Gio.File.new_for_path(`${this.stateDirectory}/profile-avatar`).replace_contents(image, null, false,
                    Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                emit({type: 'profile-avatar', login: identity.login});
            } catch (_) { this.avatarURL = null; }
        });
    }

    inspectLogtime(resource, uri, response) {
        if (!this.auth || this.signedOut || !/logtime|locations/i.test(uri) || response?.get_status_code() !== 200) return;
        resource.get_data(this.cancel, (item, result) => {
            try {
                if (!this.auth || this.signedOut || stopped) return;
                const bytes = item.get_data_finish(result);
                if (bytes.length > 1000000) return;
                const body = JSON.parse(ByteArray.toString(bytes));
                Gio.File.new_for_path(`${this.stateDirectory}/logtime-probe.json`).replace_contents(
                    ByteArray.fromString(JSON.stringify({path: uri.split('?')[0], body})), null, false,
                    Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            } catch (_) {}
        });
    }

    inspectProfileResource(resource, uri, response) {
        if (!this.auth || this.signedOut || TEST || now() > this.diagnosticUntil || response?.get_status_code() !== 200) return;
        const path = uri.split('?')[0].replace('https://intrapy.intra.42.fr', '');
        // Only the signed-in user's profile requests, never other users or evaluations.
        if (!/^\/api\/v1\/users\/me(?:\/|$)/.test(path) ||
            /scale_teams|events|logtime|projects|feedback/.test(path) ||
            Object.keys(this.profileDiagnostics).length >= 20 || this.profileDiagnostics[path]) return;
        if (!/json/i.test(response.get_mime_type() || '') || response.get_content_length() > 1000000) return;
        this.profileDiagnostics[path] = {pending: true};
        resource.get_data(this.cancel, (item, result) => {
            if (stopped || this.signedOut || !this.auth) return;
            try {
                const data = item.get_data_finish(result);
                if (data.length > 1000000) return;
                const body = JSON.parse(ByteArray.toString(data));
                const fields = [];
                const allowed = /^(login|preferred_username|display_name|first_name|last_name|level|correction_point|correction_points|evaluation_points|pace|deadline|milestone_deadline|begin_at|end_at|image_url|avatar_url|picture_url)$/;
                const walk = (value, prefix, depth) => {
                    if (depth > 7 || fields.length >= 300) return;
                    if (Array.isArray(value)) { value.slice(0, 3).forEach((v, i) => walk(v, `${prefix}[${i}]`, depth + 1)); return; }
                    if (!value || typeof value !== 'object') return;
                    for (const [key, v] of Object.entries(value)) {
                        if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(key) ||
                            /token|secret|password|email|phone|address/i.test(key)) continue;
                        const field = {path: `${prefix}.${key}`, type: v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v};
                        if (allowed.test(key) && (typeof v === 'number' || typeof v === 'string'))
                            field.value = typeof v === 'string' ? v.slice(0, 300) : v;
                        fields.push(field);
                        walk(v, field.path, depth + 1);
                        if (fields.length >= 300) break;
                    }
                };
                walk(body, '$', 0);
                this.profileDiagnostics[path] = {fields};
                Gio.File.new_for_path(`${this.stateDirectory}/profile-diagnostics.json`).replace_contents(
                    ByteArray.fromString(JSON.stringify({checkedAt: new Date().toISOString(), endpoints: this.profileDiagnostics}, null, 2)),
                    null, false, Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            } catch (_) { this.profileDiagnostics[path] = {error: 'response-unavailable'}; }
        });
    }

    tryPythonRefresh() {
        if (this.signedOut || this.webLoginOnlyFile.query_exists(null)) return false;
        try {
            const extDir = GLib.path_get_dirname(System.programPath);
            const candidates = [
                GLib.build_filenamev([extDir, 'token_refresher.py']),
                GLib.build_filenamev([GLib.get_home_dir(), 'hack42', 'token_refresher.py']),
                GLib.build_filenamev([GLib.get_home_dir(), 'hack42', 'intra_pure.py']),
            ];
            let pyScript = null;
            for (const path of candidates) {
                if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
                    pyScript = path;
                    break;
                }
            }
            if (!pyScript) return false;

            const pyBin = GLib.find_program_in_path('python3') || '/usr/bin/python3';
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            });
            const proc = launcher.spawnv([pyBin, pyScript]);
            const [ok, stdout, stderr] = proc.communicate_utf8(null, null);
            proc.wait(null);
            const token = (stdout || '').trim();
            if (token && token.startsWith('eyJ')) {
                this.acceptAuthorization(`Bearer ${token}`);
                return true;
            }
        } catch (_) {}
        return false;
    }

    acceptAuthorization(header) {
        if (this.signedOut || this.clearingLogin) return;
        if (typeof header !== 'string' || header.length > 20000 ||
            !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(header)) throw new Error('auth-error');
        const payload = header.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const claims = JSON.parse(ByteArray.toString(GLib.base64_decode(payload + '='.repeat((4 - payload.length % 4) % 4))));
        let info;
        try { info = Model.claimsInfo(claims, this.login); }
        catch (error) {
            if (error.message === 'account-error' && !TEST) this.logout('account-error');
            throw error;
        }
        if (this.auth?.header === header) { this.finishLogin(); return; }
        this.auth = {...info, header}; // Only this helper's memory; never emit or persist headers/claims.
        if (this.nextPoll === Infinity) this.nextPoll = now() + 1;
        this.reloadAt = Infinity;
        status('authenticated');
        this.finishLogin();
    }

    finishLogin() {
        // A validated login token is sufficient; do not wait for navigation.
        if (!this.loginWindow || !this.auth) return;
        this.loginWindow = false;
        this.window.hide();
    }

    readState() {
        let info;
        try {
            info = this.stateFile.query_info('standard::type,standard::size,unix::uid,unix::mode',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        } catch (error) {
            if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) return null;
            throw error;
        }
        if (info.get_file_type() !== Gio.FileType.REGULAR || info.get_size() > 400000 ||
            info.get_attribute_uint32('unix::uid') !== UID || (info.get_attribute_uint32('unix::mode') & 0o077))
            throw new Error('storage-error');
        const stream = this.stateFile.read(null);
        try {
            const bytes = stream.read_bytes(400001, null).get_data();
            if (bytes.length > 400000) throw new Error('storage-error');
            return Model.storedState(ByteArray.toString(bytes));
        } finally { stream.close(null); }
    }

    writeState(state) {
        this.stateFile.replace_contents(ByteArray.fromString(JSON.stringify(state)), null, false,
            Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    }

    receive(text, identity) {
        let rows;
        try { rows = Model.parseRows(JSON.parse(text)); }
        catch (_) { this.fail('response-error'); return false; }
        let plan;
        try {
            const previous = this.readState();
            plan = Model.advanceSeen(previous, identity.subject, rows);
            if (JSON.stringify(previous) !== JSON.stringify(plan.state)) this.writeState(plan.state);
        } catch (_) { this.fail('storage-error'); return false; }
        // shortcut: a crash after saving can lose delivery; add acknowledgements if durable delivery is needed.
        for (const row of plan.added) emit(Model.notification(row));
        this.backoff = 20;
        this.nextPoll = Math.max(now() + 10, this.notBefore);
        if (this.notBefore > now() + 10)
            status('retry-wait', {retryAfter: Math.ceil(this.notBefore - now())});
        else
            status('watching', {login: identity.login, count: rows.length});
        return true;
    }

    fail(state, wait = 0) {
        const delay = Math.max(this.backoff, wait);
        if (wait > 0 || state === 'rate-limit') this.notBefore = Math.max(this.notBefore, now() + delay);
        this.nextPoll = Math.max(now() + delay, this.notBefore);
        if (Number.isFinite(this.reloadAt)) this.reloadAt = Math.max(this.reloadAt, this.notBefore);
        this.backoff = Math.min(300, this.backoff * 2);
        status(state, {retryAfter: Math.ceil(this.nextPoll - now())});
    }

    tick() {
        if (stopped || this.signedOut || this.clearingLogin) return;
        if (!TEST && this.auth && now() >= this.nextProfileRead) this.readProfile();
        if (!this.auth && now() >= this.reloadAt) {
            this.reloadAt = Infinity;
            if (this.tryPythonRefresh()) {
                this.poll();
                return;
            }
            this.view.load_uri(HOME);
        }
        if (this.auth && !this.pending && now() >= this.nextPoll) this.poll();
        if (!this.auth && !this.view.is_loading && now() - this.lastPageLoad > 30 && this.reloadAt === Infinity) {
            if (!this.tryPythonRefresh()) {
                status('login-needed');
            }
        }
    }

    poll() {
        const identity = this.auth;
        const message = Soup.Message.new('GET', ENDPOINT);
        message.set_flags(Soup.MessageFlags.NO_REDIRECT);
        message.request_headers.append('Authorization', identity.header);
        message.request_headers.append('Content-Type', 'application/json');
        const cancel = new Gio.Cancellable();
        this.pending = cancel;
        let stream = null;
        let done = false;
        let deadline = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
            deadline = 0; cancel.cancel(); return GLib.SOURCE_REMOVE;
        });
        const finish = (text = null, state = null, wait = 0) => {
            if (done) return;
            done = true;
            if (deadline) GLib.source_remove(deadline);
            if (stream) { try { stream.close(null); } catch (_) {} }
            this.pending = null;
            if (stopped || this.auth !== identity) return;
            if (state === 'auth-error') {
                this.auth = null;
                // Immediate background token refresh
                if (this.tryPythonRefresh()) {
                    this.poll();
                    return;
                }
                this.reloadAt = now() + this.backoff;
            }
            if (state) this.fail(state, wait);
            else this.receive(text, identity);
        };
        this.session.send_async(message, cancel, (session, result) => {
            try {
                stream = session.send_finish(result);
                const code = message.status_code;
                if (code !== 200) {
                    finish(null, code === 401 ? 'auth-error' : code === 403 ? 'permission-error' :
                        code === 429 ? 'rate-limit' : 'api-error',
                    Model.retryAfter(message.response_headers.get_one('Retry-After')));
                    return;
                }
                const chunks = [];
                let size = 0;
                const read = () => stream.read_bytes_async(32768, GLib.PRIORITY_DEFAULT, cancel, (input, next) => {
                    try {
                        const bytes = input.read_bytes_finish(next).get_data() || new Uint8Array(0);
                        size += bytes.length;
                        if (size > 1000000) { finish(null, 'response-error'); return; }
                        if (bytes.length) { chunks.push(bytes); read(); return; }
                        const all = new Uint8Array(size);
                        let offset = 0;
                        for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
                        finish(ByteArray.toString(all));
                    } catch (_) { finish(null, 'network-error'); }
                });
                read();
            } catch (_) { finish(null, 'network-error'); }
        });
    }

    logout(state = 'login-needed') {
        if (this.clearingLogin) return;
        this.signedOut = true;
        this.clearingLogin = true;
        this.auth = null;
        this.pending?.cancel();
        this.session.abort();
        this.nextPoll = this.reloadAt = Infinity;
        this.avatarURL = null;
        this.avatarResources.clear();
        this.view.stop_loading();
        this.window.hide();
        this.loginWindow = false;
        for (const marker of [this.signedOutFile, this.webLoginOnlyFile])
            marker.replace_contents(ByteArray.fromString('1'), null, false,
                Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        for (const name of ['profile-avatar', 'profile-diagnostics.json', 'profile-image-status.json']) {
            try { Gio.File.new_for_path(`${this.stateDirectory}/${name}`).delete(null); } catch (_) {}
        }
        emit({type: 'signed-out'});
        status(state);
        this.view.load_uri('about:blank');
        this.dataManager.clear(WebKit2.WebsiteDataTypes.ALL, 0, null, (manager, result) => {
            try { manager.clear_finish(result); }
            catch (_) { status('storage-error'); return; }
            this.clearingLogin = false;
        });
    }

    command(command) {
        if (command === 'quit') stop();
        else if (command === 'diagnose') {
            this.profileDiagnostics = {};
            this.diagnosticUntil = now() + 90;
            this.view.load_uri(HOME);
        }
        else if (command === 'logout') this.logout();
        else if (command === 'login') {
            if (this.clearingLogin) return;
            this.signedOut = false;
            try { this.signedOutFile.delete(null); } catch (_) {}
            this.loginWindow = true;
            this.window.show_all();
            this.window.present();
            if (!this.view.is_loading) this.view.load_uri(HOME);
        }
        else if (command === 'show') { this.window.show_all(); this.window.present(); }
        else if (command === 'hide') this.window.hide();
        else if (command === 'test') emit({type: 'notification', id: `test:${GLib.get_monotonic_time()}`,
            test: true, body: 'This is a test notification for banners, cards and screen flash. Your evaluations are unchanged.'});
    }

    readCommand() {
        this.input.read_line_async(GLib.PRIORITY_DEFAULT, this.cancel, (input, result) => {
            try {
                const [line] = input.read_line_finish_utf8(result);
                if (line === null) { stop(); return; }
                if (line.length <= 32) this.command(line.trim());
                if (!stopped) this.readCommand();
            } catch (_) { if (!stopped) stop(1); }
        });
    }

    close() {
        this.cancel.cancel();
        this.pending?.cancel();
        this.session.abort();
        if (this.timer) GLib.source_remove(this.timer);
        this.view.stop_loading();
        this.window.destroy();
        this.auth = null;
        if (TEST) {
            try { this.stateFile.delete(null); } catch (_) {}
            try { Gio.File.new_for_path(this.stateDirectory).delete(null); } catch (_) {}
        }
    }
}

function selfTest() {
    const assert = (condition, name) => { if (!condition) throw new Error(name); };
    assert(!profileURI('https://profile-v3.intra.42.fr.evil.example/') &&
        !profileURI('https://user@profile-v3.intra.42.fr/') && !allowedURI('http://auth.42.fr/') &&
        !allowedURI('https://auth.42.fr:444/'), 'origin boundary');
    worker = new Worker();
    const claims = {iss: 'https://auth.42.fr/auth/realms/students-42', sub: 'fixture-subject',
        preferred_username: GLib.get_user_name(), exp: Date.now() / 1000 + 600};
    const encoded = GLib.base64_encode(ByteArray.fromString(JSON.stringify(claims)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    worker.acceptAuthorization(`Bearer e30.${encoded}.fixture-signature`);
    const identity = worker.auth;
    worker.acceptAuthorization(`Bearer e30.${encoded}.fixture-signature`);
    assert(worker.auth === identity, 'duplicate token does not invalidate an in-flight request');
    const row = {id: 123, kind: 'evaluator', begin_at: '2026-10-20T18:45:00+09:00', project_name: 'Fixture project'};
    assert(worker.receive('[]', identity), 'empty baseline');
    assert(worker.receive(JSON.stringify([row]), identity), 'new booking');
    assert(worker.receive(JSON.stringify([row]), identity), 'duplicate');
    assert(testMessages.filter(message => message.type === 'notification').length === 1, 'single notification');
    assert(worker.readState().ids[0] === '123', 'native state reload');
    worker.fail('rate-limit', 75);
    const notBefore = worker.notBefore;
    assert(worker.receive(JSON.stringify([row]), identity) && worker.nextPoll >= notBefore,
        'a parallel successful request cannot bypass Retry-After');
    worker.notBefore = 0;
    assert((worker.stateFile.query_info('unix::mode', 0, null).get_attribute_uint32('unix::mode') & 0o777) === 0o600,
        'private state mode');
    assert(!worker.receive('{}', identity) && worker.readState().ids[0] === '123', 'bad response preserves state');
    worker.stateFile.replace_contents(ByteArray.fromString('broken fixture'), null, false,
        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    assert(!worker.receive('[]', identity), 'corrupt state refused');
    assert(ByteArray.toString(worker.stateFile.load_contents(null)[1]) === 'broken fixture', 'corrupt state preserved');
    worker.command('test');
    assert(testMessages.at(-1).test === true, 'test command');
    worker.view.connect('load-changed', (_view, event) => {
        if (event !== WebKit2.LoadEvent.FINISHED) return;
        worker.view.run_javascript_in_world('2 + 2', 'pingoose-test', null, (view, result) => {
            try {
                assert(view.run_javascript_in_world_finish(result).get_js_value().to_int32() === 4, 'native WebKit');
                assert(!worker.window.get_visible(), 'hidden window');
                print('PASS: private native storage, restart/dedup, failed snapshots, JWT account selection, hidden ephemeral WebKit and cleanup');
                stop();
            } catch (_) { print('FAIL: native WebKit self-check'); stop(1); }
        });
    });
    worker.view.load_html('<!doctype html><title>Pingoose fixture</title>', 'about:blank');
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 12, () => {
        print('FAIL: native WebKit self-check timed out'); stop(1); return GLib.SOURCE_REMOVE;
    });
}

Gtk.init(null);
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 15, () => { stop(); return GLib.SOURCE_REMOVE; });
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 2, () => { stop(); return GLib.SOURCE_REMOVE; });
if (TEST) {
    try { selfTest(); }
    catch (error) { print(`FAIL: ${error.message}`); worker?.close(); System.exit(1); }
} else {
    // The session bus releases ownership on crashes; no stale PID file or shared profile writers.
    owner = Gio.bus_own_name(Gio.BusType.SESSION, 'org.gnome.Shell.Extensions.Pingoose.Worker',
        Gio.BusNameOwnerFlags.DO_NOT_QUEUE, null,
        () => { try { worker = new Worker(); } catch (_) { status('worker-error'); stop(1); } },
        () => { if (!stopped) { status('worker-busy'); stop(1); } });
}
Gtk.main();
System.exit(exitCode);
