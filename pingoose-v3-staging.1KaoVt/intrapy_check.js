#!/usr/bin/gjs
// One-shot, ephemeral web-login check; never reads the app keys or existing browser profiles.
imports.gi.versions.Gtk = '3.0';
imports.gi.versions.WebKit2 = '4.0';
const {Gtk, WebKit2, GLib} = imports.gi;
const ByteArray = imports.byteArray;
const System = imports.system;

const selfTest = ARGV.length === 1 && ARGV[0] === '--self-test';
if (ARGV.length && !selfTest) {
    printerr('Usage: gjs intrapy_check.js [--self-test]');
    System.exit(2);
}
Gtk.init(null);
const home = 'https://profile.intra.42.fr/';
const profiles = ['profile.intra.42.fr', 'profile-v3.intra.42.fr'];
const allowList = profiles.map(host => `https://${host}/*`);
const sourcePath = GLib.build_filenamev([GLib.path_get_dirname(System.programPath), 'intrapy_probe.js']);
const [, sourceBytes] = GLib.file_get_contents(sourcePath);
const manager = new WebKit2.UserContentManager();
const store = WebKit2.WebsiteDataManager.new_ephemeral();
const context = WebKit2.WebContext.new_with_website_data_manager(store);
const view = new WebKit2.WebView({web_context: context, user_content_manager: manager});
view.get_settings().set_enable_write_console_messages_to_stdout(false);
context.connect('download-started', (_context, download) => download.cancel());
view.connect('permission-request', (_view, request) => { request.deny(); return true; });

const window = new Gtk.Window({title: 'Pingoose — 인트라 웹 로그인 API 확인', default_width: 1050, default_height: 760});
const layout = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
const address = new Gtk.Label({label: '인트라에 로그인하면 평가 API를 한 번 조회하고 창을 닫습니다. 토큰은 저장하지 않습니다.', margin: 10});
layout.pack_start(address, false, false, 0);
layout.pack_start(view, true, true, 0);
window.add(layout);
let finished = false;
let exitCode = 1;

function hostname(uri) {
    try {
        const parsed = GLib.Uri.parse(uri, GLib.UriFlags.NONE);
        if (parsed.get_scheme() !== 'https' || parsed.get_userinfo() || ![-1, 443].includes(parsed.get_port()))
            return null;
        return parsed.get_host();
    } catch (_) { return null; }
}
function finish(code) {
    if (finished) return;
    finished = true;
    exitCode = code;
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        view.stop_loading();
        window.destroy();
        Gtk.main_quit();
        return GLib.SOURCE_REMOVE;
    });
}
window.connect('delete-event', () => { print('CANCELLED: no token saved.'); finish(1); return true; });
view.connect('notify::uri', () => {
    const host = hostname(view.get_uri());
    address.set_text(host ? `${host} — 평소처럼 로그인하세요. 결과 확인 후 자동으로 닫힙니다.` : '페이지 로딩 중');
});
view.connect('decide-policy', (_view, decision, type) => {
    if (type !== WebKit2.PolicyDecisionType.NAVIGATION_ACTION && type !== WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION)
        return false;
    const host = hostname(decision.get_navigation_action().get_request().get_uri());
    if (!host || !(host === 'auth.42.fr' || host.endsWith('.intra.42.fr')) ||
        type === WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION) {
        decision.ignore();
        print('NAVIGATION_BLOCKED: only HTTPS Intra and auth.42.fr navigation is allowed.');
        return true;
    }
    return false;
});
view.connect('load-failed', () => { print('PAGE_LOAD_FAILED: request details withheld.'); return false; });

if (!manager.register_script_message_handler_in_world('pingooseIntrapy', 'pingoose-check'))
    throw new Error('Cannot register diagnostic bridge');
manager.connect('script-message-received::pingooseIntrapy', (_manager, result) => {
    if (finished || !profiles.includes(hostname(view.get_uri()))) return;
    let message;
    try {
        const raw = result.get_js_value().to_string();
        if (raw.length > 65536) return;
        message = JSON.parse(raw);
        if (!message || typeof message !== 'object') return;
    } catch (_) { return; }
    if (message.type === 'status' && ['waiting-for-web-login', 'web-token-observed'].includes(message.state)) {
        print(`STATUS: ${message.state}`);
        return;
    }
    if (message.type !== 'result') return;
    if (selfTest) {
        const serialized = JSON.stringify(message);
        const ok = store.is_ephemeral && !window.get_visible() && message.httpStatus === 200 &&
            message.counts.as_corrector === 1 && message.data.as_corrector[0].id === 42 &&
            message.data.as_corrector[0].correcteds[0].login === 'fixture-peer' &&
            !serialized.includes('fixture-secret-token') && !serialized.includes('private-comment') &&
            !serialized.includes('private-email');
        print(ok ? 'PASS: native ephemeral WebKit, isolated bridge, GET constraints and credential/privacy filtering' :
            'FAIL: native diagnostic self-test');
        finish(ok ? 0 : 1);
    } else {
        print(JSON.stringify(message, null, 2));
        finish(message.httpStatus === 200 ? 0 : 1);
    }
});

function mainScript(source) {
    manager.add_script(WebKit2.UserScript.new(source, WebKit2.UserContentInjectedFrames.TOP_FRAME,
        WebKit2.UserScriptInjectionTime.START, allowList, null));
}
if (selfTest) {
    mainScript(`window.fetch = function (url, options) {
        if (url.endsWith('/scale_teams')) {
            if (options.headers.Authorization !== 'Bearer fixture-secret-token' ||
                options.credentials !== 'omit' || options.redirect !== 'error')
                return Promise.resolve(new Response('{}', {status: 400}));
            return Promise.resolve(new Response(JSON.stringify({as_corrector: [{id: 42,
                correcteds: [{login: 'fixture-peer', email: 'private-email'}],
                name: 'fixture-secret-token', access_token: 'fixture-secret-token', comment: 'private-comment'}]})));
        }
        return Promise.resolve(new Response('{}'));
    };`);
}
manager.add_script(WebKit2.UserScript.new_for_world(`document.addEventListener('PingooseIntrapyResult', event => {
    if (typeof event.detail === 'string' && event.detail.length <= 65536)
        window.webkit.messageHandlers.pingooseIntrapy.postMessage(event.detail);
});`, WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START,
'pingoose-check', allowList, null));
mainScript(ByteArray.toString(sourceBytes));

GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, selfTest ? 15 : 300, () => {
    print('TIMEOUT: no completed authenticated API check. No token saved.');
    finish(1);
    return GLib.SOURCE_REMOVE;
});
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 15, () => { finish(1); return GLib.SOURCE_REMOVE; });
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 2, () => { finish(1); return GLib.SOURCE_REMOVE; });
if (selfTest) {
    view.load_html(`<html><body><script>fetch('https://intrapy.intra.42.fr/api/v1/users/me/summary', {
        headers: {Authorization: 'Bearer fixture-secret-token'}});</script></body></html>`, home);
} else {
    window.show_all();
    print('LOGIN_WINDOW_OPEN: ephemeral session; app keys and existing browser profiles untouched.');
    view.load_uri(home);
}
Gtk.main();
System.exit(exitCode);
