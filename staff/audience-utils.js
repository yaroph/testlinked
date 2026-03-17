export function normalizeAudienceUsername(value) {
    const raw = String(value || '').trim().toLowerCase();
    const clean = raw.replace(/[^a-z0-9._-]/g, '');
    return clean.length >= 3 ? clean : '';
}

export function normalizeAudienceQuery(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '');
}

export function sanitizeAllowedUsers(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const clean = [];
    list.forEach((value) => {
        const username = normalizeAudienceUsername(value);
        if (!username || seen.has(username)) return;
        seen.add(username);
        clean.push(username);
    });
    return clean;
}
