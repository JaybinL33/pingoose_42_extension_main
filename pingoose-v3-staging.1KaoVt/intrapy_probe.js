// Runs only in the temporary Intra page. The web token never crosses the native bridge.
(function () {
    if (location.protocol !== 'https:' || location.port && location.port !== '443' ||
        !['profile.intra.42.fr', 'profile-v3.intra.42.fr'].includes(location.hostname))
        return;
    const endpoint = 'https://intrapy.intra.42.fr/api/v1/users/me/scale_teams';
    const originalFetch = window.fetch;
    let requested = false;
    let truncated = false;
    const fields = new Set(['id', 'login', 'name', 'slug', 'begin_at', 'created_at', 'updated_at',
        'filled_at', 'project_id', 'scale_id', 'team_id', 'corrector_id', 'corrected_id',
        'corrector', 'correcteds', 'corrected', 'role', 'status', 'state', 'is_corrector', 'is_corrected']);

    function selectFields(value, token, depth = 0) {
        if (depth > 6) { truncated = true; return null; }
        if (Array.isArray(value)) {
            if (value.length > 20) truncated = true;
            return value.slice(0, 20).map(item => selectFields(item, token, depth + 1));
        }
        if (!value || typeof value !== 'object')
            return null;
        const result = {};
        const entries = Object.entries(value);
        if (entries.length > 40) truncated = true;
        for (const [key, item] of entries.slice(0, 40)) {
            if (/token|secret|password|authorization|email|comment|feedback|answer/i.test(key) || key === '__proto__')
                continue;
            if (item && typeof item === 'object') {
                result[key] = selectFields(item, token, depth + 1);
            } else if (fields.has(key)) {
                if (typeof item === 'string') {
                    if (item.length > 160) truncated = true;
                    result[key] = item.split(token).join('[REDACTED]').slice(0, 160);
                } else if (item === null || typeof item === 'number' || typeof item === 'boolean') {
                    result[key] = item;
                }
            }
        }
        return result;
    }

    function send(message, authorization = null) {
        let raw = JSON.stringify(message);
        if (authorization) {
            const token = authorization.replace(/^Bearer\s+/i, '');
            raw = raw.split(token).join('[REDACTED]');
        }
        if (raw.length > 48000)
            raw = JSON.stringify({type: 'result', httpStatus: message.httpStatus, dataOmitted: true});
        document.dispatchEvent(new CustomEvent('PingooseIntrapyResult', {detail: raw}));
    }

    async function probe(authorization, source) {
        if (requested || typeof authorization !== 'string' || authorization.length > 32768 ||
            !/^Bearer\s+\S+$/i.test(authorization))
            return;
        requested = true;
        if (window.fetch === wrappedFetch) window.fetch = originalFetch;
        send({type: 'status', state: 'web-token-observed', source});
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await originalFetch.call(window, endpoint, {
                headers: {Authorization: authorization}, credentials: 'omit', redirect: 'error',
                signal: controller.signal,
            });
            if (!response.ok) {
                send({type: 'result', httpStatus: response.status});
                return;
            }
            const raw = await response.text();
            if (raw.length > 1000000) {
                send({type: 'result', httpStatus: response.status, dataOmitted: true});
                return;
            }
            const data = JSON.parse(raw);
            const counts = {};
            if (Array.isArray(data)) counts.items = data.length;
            else if (data && typeof data === 'object') {
                for (const [key, value] of Object.entries(data)) {
                    if (Array.isArray(value) && !/token|secret|password|authorization/i.test(key))
                        counts[key] = value.length;
                }
            }
            const selected = selectFields(data, authorization.replace(/^Bearer\s+/i, ''));
            send({type: 'result', httpStatus: response.status, counts, data: selected, truncated}, authorization);
        } catch (_) {
            send({type: 'result', state: 'request-error'});
        } finally {
            clearTimeout(timer);
        }
    }

    function wrappedFetch(input, init) {
        const pending = originalFetch.apply(this, arguments);
        try {
            const url = new URL(input instanceof Request ? input.url : String(input), location.href);
            const method = init?.method || (input instanceof Request ? input.method : 'GET');
            if (url.origin === 'https://intrapy.intra.42.fr' && url.pathname.startsWith('/api/v1/') &&
                method.toUpperCase() === 'GET') {
                const headers = new Headers(init?.headers !== undefined ? init.headers :
                    input instanceof Request ? input.headers : undefined);
                const authorization = headers.get('authorization');
                pending.then(response => {
                    if (response.ok) return probe(authorization, 'successful-intrapy-request');
                }).catch(() => {});
            }
        } catch (_) { /* Inspection must not change the site's own request behavior. */ }
        return pending;
    }
    window.fetch = wrappedFetch;
    send({type: 'status', state: 'waiting-for-web-login'});
    // Some Intra builds expose the Keycloak adapter rather than using window.fetch.
    setTimeout(() => {
        const keycloak = window.keycloak || window._keycloak;
        if (!requested && typeof keycloak?.token === 'string')
            probe(`Bearer ${keycloak.token}`, 'keycloak-adapter');
    }, 10000);
})();
