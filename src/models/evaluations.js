// Shared validation and ID tracking; no credentials, networking or desktop access.
const ISSUER = 'https://auth.42.fr/auth/realms/students-42';
const MAX_SEEN = 2000;

function identifier(value) {
    if (Number.isSafeInteger(value) && value > 0) return String(value);
    if (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) && !/^0+$/.test(value)) return value;
    throw new Error('response-error');
}

function claimsInfo(claims, login) {
    if (!claims || claims.iss !== ISSUER || typeof claims.sub !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(claims.sub) || !Number.isFinite(claims.exp) || claims.exp <= 0)
        throw new Error('auth-error');
    if (claims.preferred_username !== login) throw new Error('account-error');
    // This checks account selection, not a JWT signature; the HTTPS API validates authentication.
    return {subject: claims.sub, login};
}

function parseRows(data) {
    if (!Array.isArray(data) || data.length > 1000) throw new Error('response-error');
    const ids = new Set();
    const result = [];
    for (const row of data) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('response-error');
        const id = identifier(row.id);
        const rawBegin = row.begin_at ?? row.beginAt;
        // Match slim: the service also returns UTC timestamps without a suffix.
        const begin = typeof rawBegin === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/.test(rawBegin) ? `${rawBegin}Z` : rawBegin;
        const project = row.project_name ?? row.projectName;
        const match = typeof begin === 'string' && begin.match(
            /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/);
        if (!match || !Number.isFinite(Date.parse(begin)) || ids.has(id) ||
            typeof row.kind !== 'string' || !row.kind || row.kind.length > 40 ||
            (project != null && (typeof project !== 'string' || project.length > 500)))
            throw new Error('response-error');
        const calendar = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
        if (calendar.getUTCFullYear() !== Number(match[1]) || calendar.getUTCMonth() + 1 !== Number(match[2]) ||
            calendar.getUTCDate() !== Number(match[3])) throw new Error('response-error');
        ids.add(id);
        if (['evaluator', 'evaluated', 'corrector', 'corrected', 'evaluatee'].includes(row.kind)) {
            // The deployed Intra widget consumes `user` for either role.
            const candidates = row.user ?? (row.kind === 'evaluator' || row.kind === 'corrector'
                ? (row.correcteds || row.evaluated || []) : (row.corrector || row.evaluator || []));
            const users = (Array.isArray(candidates) ? candidates : [candidates])
                .map(user => typeof user === 'string' ? user : user?.login)
                .filter(login => typeof login === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(login));
            result.push({id, begin, project: project || '', kind: row.kind,
                users: [...new Set(users)].slice(0, 10), slug: typeof row.project_slug === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(row.project_slug) ? row.project_slug : null});
        }
    }
    return result;
}

function storedState(text) {
    const state = JSON.parse(text);
    if (!state || state.version !== 1 || typeof state.subject !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(state.subject) || !Array.isArray(state.ids) ||
        state.ids.length > MAX_SEEN || state.ids.some(id => typeof id !== 'string' || identifier(id) !== id) ||
        new Set(state.ids).size !== state.ids.length) throw new Error('storage-error');
    for (const field of ['dismissed', 'reminders', 'agendaIds']) {
        if (state[field] === undefined) state[field] = [];
        if (!Array.isArray(state[field]) || state[field].length > MAX_SEEN ||
            state[field].some(value => typeof value !== 'string' || value.length > 512)) throw new Error('storage-error');
    }
    if (state.evaluations === undefined) state.evaluations = [];
    if (!Array.isArray(state.evaluations) || state.evaluations.length > 10000) throw new Error('storage-error');
    state.evaluations = state.evaluations.map(row => {
        const parsed = parseRows([{...row, begin_at: row.begin, project_name: row.project,
            user: row.users, project_slug: row.slug}])[0];
        if (!parsed) throw new Error('storage-error');
        parsed.missing=row.missing===true;
        parsed.missingAt=Number.isFinite(row.missingAt)?row.missingAt:null;
        parsed.avatars = Array.isArray(row.avatars) ? row.avatars.filter(login => parsed.users.includes(login)) : [];
        parsed.seats = {};
        parsed.chatConfirmedAt = {};
        for (const login of parsed.users) {
            const seat = row.seats?.[login];
            if(Number.isFinite(row.chatConfirmedAt?.[login]))parsed.chatConfirmedAt[login]=row.chatConfirmedAt[login];
            if (typeof seat === 'string' && (seat === 'Unavailable' || /^c[0-9]+r[0-9]+s[0-9]+$/i.test(seat))) parsed.seats[login] = seat;
        }
        return parsed;
    });
    return state;
}

function advanceSeen(previous, subject, rows) {
    const baseline = previous !== null && previous.subject === subject;
    const old = baseline ? previous.ids : [];
    const seen = new Set(old);
    const ids = [...new Set([...rows.map(row => row.id), ...old])].slice(0, MAX_SEEN);
    return {state: {version: 1, subject, ids, evaluations: baseline ? (previous.evaluations || []) : [], dismissed: baseline ? (previous.dismissed || []) : [], reminders: baseline ? (previous.reminders || []) : [], agendaIds: baseline ? (previous.agendaIds || []) : []}, added: rows.filter(row => !seen.has(row.id) && !(baseline && previous.dismissed?.includes(row.id)))};
}

function parseAgenda(data, feedback = false) {
    if (!Array.isArray(data) || data.length > 1000) throw new Error('response-error');
    return data.map(row => {
        const id = identifier(row?.id);
        const name = row.name;
        const begin = row.begin_at ?? row.beginAt;
        const end = row.end_at ?? row.endAt;
        if (typeof name !== 'string' || !name.trim() || name.length > 500 ||
            typeof begin !== 'string' || !Number.isFinite(Date.parse(begin)) ||
            typeof end !== 'string' || !Number.isFinite(Date.parse(end))) throw new Error('response-error');
        const utc = value => /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
        const field = (snake, camel) => row[snake] ?? row[camel];
        const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
        const subscription = field('events_user_id', 'eventsUserId');
        const delay = field('unsubscription_delay', 'unsubscriptionDelay');
        return {id, name, begin: utc(begin), end: utc(end), feedback,
            kind: typeof row.kind === 'string' ? row.kind.slice(0, 60) : '',
            description: typeof row.description === 'string' ? row.description.slice(0, 30000) : '',
            subscribers: count(field('nbr_subscribers', 'nbrSubscribers')),
            capacity: count(field('max_subscribers', 'maxSubscribers')),
            subscribed: typeof field('is_subscribed', 'isSubscribed') === 'boolean' ? field('is_subscribed', 'isSubscribed') : null,
            subscriptionId: /^\d+$/.test(String(subscription ?? '')) ? String(subscription) : null,
            unsubscriptionDelay: typeof delay === 'number' && Number.isFinite(delay) && delay >= 0 ? delay : 0,
            waitlisted: field('is_waitlisted', 'isWaitlisted') === true,
            location: typeof row.location === 'string' ? row.location.slice(0, 200) : ''};
    });
}

function retryAfter(value, now = Date.now()) {
    if (typeof value !== 'string' || value.length > 100) return 0;
    if (/^\d+$/.test(value)) {
        const seconds = Number(value);
        return Number.isSafeInteger(seconds) ? seconds : 0;
    }
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : 0;
}

function notification(row) {
    const date = new Date(row.begin);
    const pad = value => String(value).padStart(2, '0');
    const when = `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    const project = row.project.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
    return {type: 'notification', id: `intrapy:${row.id}`,
        body: `You have been matched with someone.\n${row.kind === 'evaluator' || row.kind === 'corrector' ? 'Evaluator' : 'Evaluatee'} · ${when}${project ? ` · ${project}` : ''}`};
}

if (typeof module !== 'undefined')
    module.exports = {identifier, claimsInfo, parseRows, storedState, advanceSeen, retryAfter, notification, parseAgenda};

// The same constraints used by the Intra agenda UI; the server remains authoritative.
function agendaAction(row, action, now = Date.now()) {
    if (!row || row.devTest || !/^\d+$/.test(String(row.id)) || !row.kind ||
        !['subscribe', 'unsubscribe'].includes(action) || !(Date.parse(row.begin) > now)) return null;
    const group = row.kind === 'exam' ? 'exams' : 'events';
    let path = `/${group}/${row.id}/${group}_users`;
    if (action === 'subscribe') {
        if (row.subscribed !== false || row.waitlisted || (row.capacity > 0 && (row.subscribers === null || row.subscribers >= row.capacity))) return null;
    } else {
        if (row.subscribed !== true || !/^\d+$/.test(String(row.subscriptionId ?? '')) ||
            Date.parse(row.begin) - (row.unsubscriptionDelay || 0) * 3600000 <= now) return null;
        path += `/${row.subscriptionId}`;
    }
    return {method: action === 'subscribe' ? 'POST' : 'DELETE', url: `https://profile.intra.42.fr${path}.json`};
}
function agendaSummary(row, now = Date.now()) {
    const start = new Date(row.begin), end = Date.parse(row.end);
    const date = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
    const minutes = Math.max(0, Math.ceil((start.getTime()-now)/60000));
    const state = now >= start.getTime() ? (now < end ? 'In progress' : 'Ended') :
        [[Math.floor(minutes/1440), 'd'], [Math.floor(minutes%1440/60), 'h'], [minutes%60, 'm']]
            .filter(([value]) => value > 0).map(([value, unit]) => `${value} ${unit}`).join(' ') + ' remain';
    return `${date} (${state})`;
}
if (typeof module !== 'undefined') Object.assign(module.exports, {agendaAction, agendaSummary});
