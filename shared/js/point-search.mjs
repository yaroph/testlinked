export function normalizeSearchText(value) {
    return String(value ?? '').trim().toLowerCase();
}

export function normalizeSearchPhone(value) {
    return String(value ?? '').replace(/\D+/g, '');
}

export function tokenizeSearchQuery(value) {
    const normalized = normalizeSearchText(value);
    return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

function scoreTextField(fieldValue, token, weight, prefixBonus = 0) {
    if (!fieldValue || !token) return 0;
    if (fieldValue === token) return weight + prefixBonus + 18;
    if (fieldValue.startsWith(token)) return weight + prefixBonus;
    if (fieldValue.includes(token)) return weight;
    return 0;
}

function scoreDigitField(fieldValue, token, weight, prefixBonus = 0) {
    if (!fieldValue || !token) return 0;
    if (fieldValue === token) return weight + prefixBonus + 14;
    if (fieldValue.startsWith(token)) return weight + prefixBonus;
    if (fieldValue.includes(token)) return Math.max(6, weight - 6);
    return 0;
}

export function buildNodeSearchFields(node, options = {}) {
    const mode = options.mode === 'name' ? 'name' : 'smart';
    const typeLabel = typeof options.typeLabel === 'function' ? options.typeLabel : () => '';
    const statusLabel = typeof options.statusLabel === 'function' ? options.statusLabel : () => '';
    const nameField = {
        text: normalizeSearchText(node?.name || ''),
        digits: '',
        weight: 84,
        prefixBonus: 30
    };
    if (mode === 'name') return [nameField];

    return [
        nameField,
        {
            text: normalizeSearchText(typeLabel(node)),
            digits: '',
            weight: 24,
            prefixBonus: 8
        },
        {
            text: normalizeSearchText(node?.description || ''),
            digits: '',
            weight: 24,
            prefixBonus: 8
        },
        {
            text: normalizeSearchText(node?.notes || ''),
            digits: '',
            weight: 20,
            prefixBonus: 6
        },
        {
            text: normalizeSearchText(node?.num || ''),
            digits: normalizeSearchPhone(node?.num || ''),
            weight: 42,
            prefixBonus: 16
        },
        {
            text: normalizeSearchText(node?.accountNumber || ''),
            digits: normalizeSearchPhone(node?.accountNumber || ''),
            weight: 30,
            prefixBonus: 10
        },
        {
            text: normalizeSearchText(node?.citizenNumber || ''),
            digits: normalizeSearchPhone(node?.citizenNumber || ''),
            weight: 30,
            prefixBonus: 10
        },
        {
            text: normalizeSearchText(node?.linkedMapPointId || ''),
            digits: normalizeSearchPhone(node?.linkedMapPointId || ''),
            weight: 18,
            prefixBonus: 6
        },
        {
            text: normalizeSearchText(statusLabel(node)),
            digits: '',
            weight: 12,
            prefixBonus: 4
        }
    ];
}

export function findPointSearchMatches(nodes, query, options = {}) {
    const normalizedQuery = normalizeSearchText(query);
    const mode = options.mode === 'name' ? 'name' : 'smart';
    const limit = Math.max(1, Number(options.limit) || 10);
    const locale = String(options.locale || 'fr');
    const tokens = tokenizeSearchQuery(query);
    const sourceNodes = Array.isArray(nodes) ? nodes : [];

    if (!normalizedQuery || !tokens.length) return [];

    return sourceNodes
        .map((node) => {
            const fields = buildNodeSearchFields(node, {
                mode,
                typeLabel: options.typeLabel,
                statusLabel: options.statusLabel
            });
            const combinedText = fields.map((field) => field.text).filter(Boolean).join(' ');
            let score = 0;

            for (const token of tokens) {
                const isDigitToken = /^\d+$/.test(token);
                let bestFieldScore = 0;

                fields.forEach((field) => {
                    bestFieldScore = Math.max(bestFieldScore, scoreTextField(field.text, token, field.weight, field.prefixBonus));
                    if (isDigitToken) {
                        bestFieldScore = Math.max(bestFieldScore, scoreDigitField(field.digits, token, field.weight, field.prefixBonus));
                    }
                });

                if (!bestFieldScore) return null;
                score += bestFieldScore;
            }

            const name = normalizeSearchText(node?.name || '');
            if (name === normalizedQuery) score += 50;
            else if (name.startsWith(normalizedQuery)) score += 30;
            else if (name.includes(normalizedQuery)) score += 16;

            if (mode === 'smart' && combinedText.includes(normalizedQuery)) {
                score += 12;
            }

            if (tokens.length > 1) {
                score += tokens.length * 6;
            }

            return { node, score };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return String(a.node?.name || '').localeCompare(String(b.node?.name || ''), locale, { sensitivity: 'base' });
        })
        .slice(0, limit)
        .map((entry) => entry.node);
}
