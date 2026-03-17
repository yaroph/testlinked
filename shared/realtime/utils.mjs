export function cloneJson(value, fallback = null) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return fallback;
    }
}

export function valuesEqual(leftValue, rightValue) {
    if (leftValue === rightValue) return true;

    const leftIsObject = leftValue !== null && typeof leftValue === 'object';
    const rightIsObject = rightValue !== null && typeof rightValue === 'object';
    if (!leftIsObject && !rightIsObject) return false;

    try {
        return JSON.stringify(leftValue) === JSON.stringify(rightValue);
    } catch (error) {
        return false;
    }
}

export function sortById(list = []) {
    return [...list].sort((left, right) => String(left?.id || '').localeCompare(String(right?.id || '')));
}
