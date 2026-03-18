export function normalizeSearchText(value) {
    return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isSearchWordChar(char) {
    return /[0-9a-z\u00c0-\u024f]/i.test(String(char || ''));
}

export function getSearchTextMatch(fieldValue, query) {
    const field = normalizeSearchText(fieldValue);
    const needle = normalizeSearchText(query);
    if (!field || !needle) {
        return { kind: 'none', index: -1 };
    }
    if (field === needle) {
        return { kind: 'exact', index: 0 };
    }
    if (field.startsWith(needle)) {
        return { kind: 'prefix', index: 0 };
    }

    let index = field.indexOf(needle);
    while (index >= 0) {
        const prevChar = index > 0 ? field.charAt(index - 1) : '';
        if (!prevChar || !isSearchWordChar(prevChar)) {
            return { kind: 'word', index };
        }
        index = field.indexOf(needle, index + 1);
    }

    return { kind: 'none', index: -1 };
}

export function hasSearchTextMatch(fieldValue, query) {
    return getSearchTextMatch(fieldValue, query).kind !== 'none';
}
