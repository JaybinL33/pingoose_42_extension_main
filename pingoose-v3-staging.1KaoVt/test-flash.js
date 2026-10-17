// Exercise the real extension with tiny Shell stubs; no desktop changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let now = 10_000_000;
let banners = true;
let animations = true;
let instant = false;
let notificationCount = 0;
let lastBanner;
const launches = [];
let flashCount = 1;
let nextSource = 1;
const timers = new Map();
const listeners = new Map();
const created = [];
const settings = {
    get_int: () => flashCount,
    set_int(_key, value) {
        assert.ok(Number.isInteger(value) && value >= 0 && value <= 5);
        if (flashCount === value) return;
        flashCount = value;
        for (const callback of listeners.values()) callback();
    },
    connect(_signal, callback) { const id = nextSource++; listeners.set(id, callback); return id; },
    disconnect(id) { assert.ok(listeners.delete(id)); },
};
class Menu {
    constructor() { this.items = []; }
    addAction(title, callback) {
        const item = {title, callback, setOrnament(value) { this.ornament = value; }};
        this.items.push(item);
        return item;
    }
    addMenuItem(item) { this.items.push(item); }
}
class SubMenu {
    constructor() { this.label = {}; this.menu = new Menu(); }
}
class Indicator {
    constructor() { this.menu = new Menu(); this.status = {label: {}}; }
    destroy() {}
}
class Actor {
    constructor(properties) { Object.assign(this, properties); this.started = now; created.push(this); }
    ease(options) { this.animation = options; if (instant) options.onComplete(); }
    remove_all_transitions() { this.animation = null; this.cancelled = true; }
    destroy() { assert.ok(!this.destroyed); this.destroyed = true; this.animation = null; }
}
const monitors = [{x: 0, y: 0, width: 1920, height: 1080},
    {x: -1280, y: 120, width: 1280, height: 1024}];
const main = {
    panel: {addToStatusArea() {}}, layoutManager: {monitors}, sessionMode: {isLocked: false},
    uiGroup: {add_child() {}}, notify(title, body) { notificationCount++; lastBanner = {title, body}; },
};
const extension = vm.runInNewContext(
    fs.readFileSync(`${__dirname}/extension.js`, 'utf8') + '\ninit();', {
        imports: {
            gi: {
                Clutter: {AnimationMode: {EASE_OUT_QUAD: 1}},
                GObject: {registerClass: () => Indicator},
                Gio: {
                    Settings: class { get_boolean() { return banners; } },
                    Cancellable: class { cancel() {} },
                    SubprocessFlags: {STDIN_PIPE: 1, STDOUT_PIPE: 2},
                    Subprocess: {new(argv, flags) {
                        launches.push({argv: [...argv], flags});
                        throw new Error('No real WebKit helper in this logic check');
                    }},
                },
                GLib: {
                    PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false, get_monotonic_time: () => now,
                    DateTime: {new_now_local: () => ({format: () => '12:00'})},
                    timeout_add(_priority, delay, callback) {
                        assert.ok(delay >= 1);
                        const id = nextSource++;
                        timers.set(id, {at: now + delay * 1000, callback});
                        return id;
                    },
                    source_remove(id) { assert.ok(timers.delete(id)); },
                },
                St: {Widget: Actor, Settings: {get: () => ({enable_animations: animations})}},
            },
            ui: {main, panelMenu: {Button: class {}}, popupMenu: {
                PopupSubMenuMenuItem: SubMenu, Ornament: {NONE: 0, DOT: 1},
            }},
            misc: {extensionUtils: {
                getCurrentExtension: () => ({path: '/fixture/pingoose', uuid: 'pingoose@local'}),
                getSettings: () => settings,
            }},
        },
    }, {filename: 'extension.js'});
extension._renderCards = () => {};
extension.enable();
assert.deepEqual(launches, [{argv: ['/usr/bin/gjs', '/fixture/pingoose/webview.js'], flags: 3}]);
const countMenu = () => extension._indicator.menu.items.find(item => item instanceof SubMenu);
const choose = count => countMenu().menu.items[count].callback();
const notify = id => extension._message({type: 'notification', id, body: '평가 예약', test: true});
function finishPulse() {
    const actors = [...extension._flashActors];
    assert.equal(actors.length, monitors.length);
    now += 180_000;
    actors.forEach((actor, index) => {
        assert.equal(actor.reactive, false);
        assert.equal(actor.can_focus, false);
        for (const key of ['x', 'y', 'width', 'height']) assert.equal(actor[key], monitors[index][key]);
        assert.equal(actor.animation.opacity, 200);
        assert.equal(actor.animation.duration, 180);
        actor.animation.onComplete();
        assert.equal(actor.animation.opacity, 0);
        assert.equal(actor.animation.duration, 720);
    });
    now += 720_000;
    actors.forEach(actor => { actor.animation.onComplete(); assert.ok(actor.destroyed); });
    assert.equal(extension._flashActors.length, 0);
}
function tick() {
    assert.equal(timers.size, 1);
    const [id, timer] = timers.entries().next().value;
    assert.ok(timer.at - extension._lastFlash >= 3_000_000);
    now = timer.at;
    timers.delete(id);
    assert.equal(timer.callback(), false);
}

extension._message({type: 'status', state: 'watching', count: 0, login: 'fixture-user'});
assert.equal(extension._indicator.status.label.text,
    '인트라 v3 · 10초마다 평가 조회 중 · fixture-user · 대기 0건 · 최근 12:00');
extension._message({type: 'status', state: 'rate-limit', retryAfter: 75});
assert.ok(extension._indicator.status.label.text.endsWith('75초 후 재시도'));
const previousStatus = extension._indicator.status.label.text;
extension._message({type: 'status', state: '__proto__'});
assert.equal(extension._indicator.status.label.text, previousStatus);
const send = extension._send;
const commands = [];
extension._send = command => commands.push(command);
extension._indicator.menu.items.find(item => item.title === '인트라 창 열기').callback();
extension._indicator.menu.items.find(item => item.title === '인트라 창 숨기기').callback();
assert.deepEqual(commands, ['show', 'hide']);
extension._send = send;
extension._message({type: 'status', state: 'login-needed'});
assert.ok(extension._indicator.status.label.text.includes('인트라 로그인 필요'));
assert.equal(countMenu().label.text, '화면 점멸: 1회');
assert.equal(countMenu().menu.items[1].ornament, 1);
notify('one');
notify('one'); // Duplicate is ignored.
extension._message({type: 'notification', id: 'burst', body: 'private fixture details'});
// A real-format booking still creates a card/banner, but cannot restart the sequence.
assert.equal(lastBanner.title, 'Pingoose · 새 평가 예약');
assert.ok(!lastBanner.body.includes('private fixture details'));
assert.equal(extension._notifications[0].body, 'private fixture details');
assert.equal(notificationCount, 2);
assert.equal(created.length, 2);
finishPulse();
assert.equal(timers.size, 0);
notify('cooldown');
assert.equal(created.length, 2);

for (const count of [2, 3, 4, 5]) {
    choose(count);
    assert.equal(countMenu().label.text, `화면 점멸: ${count}회`);
    assert.equal(countMenu().menu.items[count].ornament, 1);
    now += 3_000_000;
    const start = created.length;
    notify(`count-${count}`);
    for (let pulse = 0; pulse < count; pulse++) {
        assert.equal(created.length - start, (pulse + 1) * monitors.length);
        finishPulse();
        if (pulse < count - 1) {
            notify(`between-${count}-${pulse}`); // Waiting timers also coalesce bursts.
            assert.equal(created.length - start, (pulse + 1) * monitors.length);
            tick();
        }
    }
    assert.equal(timers.size, 0);
}
const end = created.length;
choose(0);
assert.equal(countMenu().label.text, '화면 점멸: 끄기');
now += 3_000_000;
notify('off');
choose(3);
banners = false; notify('dnd'); banners = true;
animations = false; notify('reduced-motion'); animations = true;
main.sessionMode.isLocked = true; notify('locked'); main.sessionMode.isLocked = false;
assert.equal(created.length, end);

notify('dnd-during-sequence');
finishPulse();
banners = false;
tick();
banners = true;
assert.equal(timers.size, 0);
assert.equal(extension._flashActors.length, 0);
notify('cancel-active');
const active = [...extension._flashActors];
choose(0); // Live setting changes cancel active animations immediately.
assert.ok(active.every(actor => actor.cancelled && actor.destroyed));
choose(3);
now += 3_000_000;
notify('cancel-wait');
finishPulse();
assert.equal(timers.size, 1);
choose(5); // Also cancels a pending repeat; changes apply on the next notification.
assert.equal(timers.size, 0);

// Synchronous completion (e.g. native animations skipped) must not create one timer per monitor.
instant = true;
now += 3_000_000;
notify('instant');
assert.equal(timers.size, 1);
assert.equal(extension._flashActors.length, 0);
choose(3);
instant = false;
now += 3_000_000;
notify('disable-pending');
finishPulse();
extension.disable();
assert.equal(timers.size, 0);
assert.equal(listeners.size, 0);
extension.enable();
assert.equal(countMenu().label.text, '화면 점멸: 3회');
notify('disable-active');
const last = [...extension._flashActors];
extension.disable();
assert.ok(last.every(actor => actor.cancelled && actor.destroyed));
assert.equal(listeners.size, 0);
assert.equal(timers.size, 0);
extension._flashScreen(); // Late calls after disable are harmless.
assert.equal(extension._flashActors.length, 0);
console.log('PASS: API worker launch/status/privacy, count menu, 0–5 pulses, spacing/bursts, DND/motion/lock and lifecycle cleanup');
