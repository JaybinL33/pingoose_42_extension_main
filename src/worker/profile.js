function readProfileDOM(login) {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
    const heading = Array.from(document.querySelectorAll('h1')).find(h => /^\d{1,3}$/.test(h.textContent.trim()));
    const progress = text.match(/(?:^|\s)(\d{1,3})\s*%/);
    const points = text.match(/Ev\.\s*P\s*(\d+)/i);
    const pace = text.match(/Pace\s*(\d+)/i);
    const deadlineLabel = text.match(/\b(Milestone\s+Deadline|Ultimate\s+Deadline|Black\s*holed\s+at|Alumni[sz]ation(?:\s+(?:at|date|on))?)\s*:?\s*(.{0,70})/i);
    let deadline = null;
    if (deadlineLabel) {
        const raw = deadlineLabel[2];
        let match = raw.match(/^(\d{4})[.\/年-]\s*(\d{1,2})[.\/月-]\s*(\d{1,2})/);
        let parts = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
        if (!parts) {
            match = raw.match(/^(\d{1,2})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{4})/);
            if (match) {
                const order = new Intl.DateTimeFormat(navigator.language).formatToParts(new Date(2026, 10, 23))
                    .filter(part => ['day', 'month', 'year'].includes(part.type)).map(part => part.type);
                const first = Number(match[1]), second = Number(match[2]);
                const dayFirst = first > 12 || (second <= 12 && order[0] === 'day');
                parts = [Number(match[3]), dayFirst ? second : first, dayFirst ? first : second];
            }
        }
        if (parts) {
            const [year, month, day] = parts;
            const date = new Date(Date.UTC(year, month - 1, day));
            if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day)
                deadline = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }
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
        deadline,
        deadlineKind: !deadlineLabel ? null : /^milestone/i.test(deadlineLabel[1]) ? 'milestone' :
            /^ultimate/i.test(deadlineLabel[1]) ? 'ultimate' : /^black/i.test(deadlineLabel[1]) ? 'blackhole' : 'alumnization',
        avatar: avatar?.src || null,
    });
}

function summarizeLogtime(data, date = new Date()) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid-logtime');
    const year = date.getFullYear(), month = String(date.getMonth() + 1).padStart(2, '0');
    const prefix = `${year}-${month}-`;
    const today = prefix + String(date.getDate()).padStart(2, '0');
    let total = 0, todaySeconds = null;
    for (let day = 1; day <= date.getDate(); day++) {
        const key = prefix + String(day).padStart(2, '0');
        const value = data[key];
        if (typeof value !== 'string' || !/^\d{2}:[0-5]\d:[0-5]\d$/.test(value)) throw new Error('incomplete-logtime');
        const [h, m, s] = value.split(':').map(Number);
        if (h > 24) throw new Error('invalid-duration');
        const seconds = h * 3600 + m * 60 + s;
        total += seconds;
        if (key === today) todaySeconds = seconds;
    }
    return {date: today, monthMinutes: Math.floor(total / 60), todayMinutes: Math.floor(todaySeconds / 60)};
}

