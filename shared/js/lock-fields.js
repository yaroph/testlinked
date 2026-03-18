(() => {
    const selector = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="hidden"]), textarea';

    const lockField = (field) => {
        if (!field || typeof field.setAttribute !== 'function') return;
        field.setAttribute('autocomplete', 'off');
        field.setAttribute('autocorrect', 'off');
        field.setAttribute('autocapitalize', 'off');
        field.setAttribute('spellcheck', 'false');
    };

    const applyLocks = () => {
        document.querySelectorAll(selector).forEach(lockField);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyLocks, { once: true });
    } else {
        applyLocks();
    }

    document.addEventListener('focusin', (event) => {
        const field = event.target;
        if (field && typeof field.matches === 'function' && field.matches(selector)) {
            lockField(field);
        }
    });
})();
