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
        const begin = row.begin_at ?? row.beginAt;
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
        if (row.kind === 'evaluator') result.push({id, begin, project: project || ''});
    }
    return result;
}

function storedState(text) {
    const state = JSON.parse(text);
    if (!state || state.version !== 1 || typeof state.subject !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(state.subject) || !Array.isArray(state.ids) ||
        state.ids.length > MAX_SEEN || state.ids.some(id => typeof id !== 'string' || identifier(id) !== id) ||
        new Set(state.ids).size !== state.ids.length) throw new Error('storage-error');
    return state;
}

function advanceSeen(previous, subject, rows) {
    const baseline = previous !== null && previous.subject === subject;
    const old = baseline ? previous.ids : [];
    const seen = new Set(old);
    const ids = [...new Set([...rows.map(row => row.id), ...old])].slice(0, MAX_SEEN);
    return {state: {version: 1, subject, ids}, added: baseline ? rows.filter(row => !seen.has(row.id)) : []};
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
        body: `시작 ${when}${project ? ` · ${project}` : ''}\n평가 ${row.id}`};
}

if (typeof module !== 'undefined')
    module.exports = {identifier, claimsInfo, parseRows, storedState, advanceSeen, retryAfter, notification};
