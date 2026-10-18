// Slot API adapted from origin/deeev-seunkang-slot. Runs only in our WebKit session.
async function slotRequest(action, expected, payload) {
    const date = new Date();
    const end = new Date(date.getTime() + 7 * 86400000);
    const query = new URLSearchParams({start: date.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10)});
    const read = async () => {
        const response = await fetch(`/slots.json?${query}`, {credentials: 'same-origin', redirect: 'error',
            headers: {'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}});
        if (!response.ok) throw new Error('Unable to load slots. Open Intra and check your session.');
        const data = await response.json();
        if (!Array.isArray(data) || data.length > 1000) throw new Error('Invalid slot response.');
        return data.filter(row => row?.title === 'Available').map(row => {
            const id = String(row.id), ids = String(row.ids || row.id);
            if (!/^\d+$/.test(id) || !/^\d+(,\d+)*$/.test(ids) || !Number.isFinite(Date.parse(row.start)) || !Number.isFinite(Date.parse(row.end)))
                throw new Error('Invalid slot response.');
            return {id, ids, start: row.start, end: row.end};
        });
    };
    let rows = await read();

    if (action === 'create' || action === 'create-5') {
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
        if (!csrf) throw new Error('Slot session expired. Open Intra and try again.');
        const slotsToCreate = Array.isArray(payload) ? payload : [payload];
        if(!slotsToCreate.length || slotsToCreate.length>5 || slotsToCreate.some(item=>!item || !Number.isFinite(Date.parse(item.begin)) || Date.parse(item.end)-Date.parse(item.begin)!==1800000))throw new Error('Invalid slot schedule.');
        let createdCount = 0, skipped=0, failed=0;
        for (const item of slotsToCreate) {
            if(rows.some(row=>Date.parse(row.start)===Date.parse(item.begin) && Date.parse(row.end)===Date.parse(item.end))){skipped++;continue;}
            try {
                const params = new URLSearchParams({
                    'slot[begin_at]': item.begin,
                    'slot[end_at]': item.end,
                });
                const response = await fetch('/slots.json', {
                    method: 'POST',
                    credentials: 'same-origin',
                    redirect: 'error',
                    headers: {
                        'X-CSRF-Token': csrf,
                        'X-Requested-With': 'XMLHttpRequest',
                        'Accept': 'application/json, text/javascript, */*; q=0.01',
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                    },
                    body: params.toString()
                });
                if (response.ok) createdCount++; else failed++;
            } catch (_) {failed++;}
        }
        rows = await read();
        return {rows, created: createdCount, skipped, error:failed?`${failed} slot(s) could not be opened. Refresh and try again.`:null};
    }

    let failed = 0, closed = 0;
    if (action !== 'list') {
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
        if (!csrf) throw new Error('Slot session expired. Open Intra and try again.');
        // Close only unchanged, still-available slots that were shown when clicked.
        for (const target of expected) {
            const current = rows.find(row => row.id === target.id);
            if (!current) continue;
            if (current.ids !== target.ids || current.start !== target.start || current.end !== target.end) { failed++; continue; }
            try {
                const response = await fetch(`/slots/${current.id}.json`, {method: 'POST', credentials: 'same-origin', redirect: 'error',
                    headers: {'X-CSRF-Token': csrf, 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json',
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'},
                    body: new URLSearchParams({_method: 'delete', ids: current.ids}).toString()});
                if ([200, 204].includes(response.status)) closed++; else failed++;
            } catch (_) { failed++; }
        }
        rows = await read();
    }
    return {rows, closed, error: failed ? `${failed} slot(s) could not be closed. Refresh and try again.` : null};
}

var SlotsService = class SlotsService {
    constructor(context, allowedURI) {
        this.context = context;
        this.allowedURI = allowedURI;
        this.rows = [];
        this.busy = false;
    }
    run(action, id, callback, payload = null) {
        if (this.busy) return;
        const expected = action === 'all' ? this.rows.slice() : action === 'future' ? this.rows.filter(row => Date.parse(row.start) > Date.now()) : this.rows.filter(row => row.id === id);
        if (action !== 'list' && action !== 'create' && action !== 'create-5' && !expected.length) { callback({rows: this.rows, error: 'Refresh slots before closing them.'}); return; }
        const {WebKit2, GLib} = imports.gi;
        this.busy = true;
        const view = this.view = new WebKit2.WebView({web_context: this.context});
        view.get_settings().set_enable_write_console_messages_to_stdout(false);
        let started = false, reading = false, attempts = 0;
        const finish = result => {
            this.close();
            if (result.rows) this.rows = result.rows;
            callback(result);
        };
        view.connect('permission-request', (_view, request) => {request.deny(); return true;});
        view.connect('decide-policy', (_view, decision, type) => {
            if (type === WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION ||
                (type === WebKit2.PolicyDecisionType.NAVIGATION_ACTION && !this.allowedURI(decision.get_navigation_action().get_request().get_uri()))) {
                decision.ignore(); return true;
            }
            return false;
        });
        view.connect('load-changed', (_view, event) => {
            if (started || event !== WebKit2.LoadEvent.FINISHED || !/^https:\/\/profile\.intra\.42\.fr\/slots\/?(?:[?#]|$)/.test(view.get_uri() || '')) return;
            started = true;
            const script = `window.__pingooseSlots = null; (${slotRequest.toString()})(${JSON.stringify(action)}, ${JSON.stringify(expected)}, ${JSON.stringify(payload)}).then(value => window.__pingooseSlots = value).catch(error => window.__pingooseSlots = {error: error.message}); void 0;`;
            view.run_javascript_in_world(script, 'pingoose-slots', null, (page, result) => {
                try { page.run_javascript_in_world_finish(result); } catch (_) { if (this.view === view) finish({error: 'Unable to read slots.'}); }
            });
        });
        this.timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            if (++attempts > 60) { finish({error: 'Slot request timed out. Open Intra and try again.'}); return GLib.SOURCE_REMOVE; }
            if (!started || reading) return GLib.SOURCE_CONTINUE;
            reading = true;
            view.run_javascript_in_world('JSON.stringify(window.__pingooseSlots)', 'pingoose-slots', null, (page, result) => {
                reading = false;
                if (this.view !== view) return;
                try {
                    const value = JSON.parse(page.run_javascript_in_world_finish(result).get_js_value().to_string());
                    if (value) finish(value);
                } catch (_) { finish({error: 'Unable to read slots.'}); }
            });
            return GLib.SOURCE_CONTINUE;
        });
        view.load_uri('https://profile.intra.42.fr/slots');
    }
    close() {
        if (this.timer) imports.gi.GLib.source_remove(this.timer);
        this.timer = 0;
        this.view?.stop_loading(); this.view?.destroy(); this.view = null;
        this.busy = false;
    }
};
if (typeof module !== 'undefined') module.exports = {slotRequest};
