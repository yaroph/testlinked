function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function attachAsyncAutocomplete(options = {}) {
    const input = options.input instanceof HTMLElement ? options.input : null;
    const resultsEl = options.resultsEl instanceof HTMLElement ? options.resultsEl : null;
    const fetchSuggestions = typeof options.fetchSuggestions === 'function' ? options.fetchSuggestions : async () => [];
    const onPick = typeof options.onPick === 'function' ? options.onPick : () => {};
    const onSubmit = typeof options.onSubmit === 'function' ? options.onSubmit : null;
    const onInputChange = typeof options.onInputChange === 'function' ? options.onInputChange : null;
    const renderSuggestion = typeof options.renderSuggestion === 'function'
        ? options.renderSuggestion
        : (item) => `
            <span class="editor-autocomplete-name">${escapeHtml(item?.label || item?.username || '')}</span>
            <span class="editor-autocomplete-type">${escapeHtml(item?.meta || '')}</span>
        `;
    const getSuggestionKey = typeof options.getSuggestionKey === 'function'
        ? options.getSuggestionKey
        : (item, index) => String(item?.id || item?.username || index);
    const minChars = Math.max(0, Number(options.minChars) || 1);

    if (!input || !resultsEl) {
        return {
            hide() {},
            refresh() {
                return Promise.resolve([]);
            }
        };
    }

    let suggestions = [];
    let activeIndex = -1;
    let hideTimer = null;
    let requestSeq = 0;

    const clearHideTimer = () => {
        if (!hideTimer) return;
        clearTimeout(hideTimer);
        hideTimer = null;
    };

    const hide = () => {
        clearHideTimer();
        suggestions = [];
        activeIndex = -1;
        resultsEl.hidden = true;
        resultsEl.innerHTML = '';
    };

    const setActiveIndex = (nextIndex) => {
        activeIndex = nextIndex;
        Array.from(resultsEl.querySelectorAll('[data-autocomplete-index]')).forEach((button) => {
            button.classList.toggle('active', Number(button.getAttribute('data-autocomplete-index')) === activeIndex);
        });
    };

    const pickSuggestion = (item, { focusInput = true } = {}) => {
        if (!item) return;
        const nextValue = String(item?.username || item?.label || item?.value || '').trim();
        if (nextValue) input.value = nextValue;
        hide();
        onPick(item);
        if (focusInput) input.focus();
    };

    const bindSuggestionRows = () => {
        Array.from(resultsEl.querySelectorAll('[data-autocomplete-key]')).forEach((button) => {
            button.onmousedown = (event) => {
                event.preventDefault();
                clearHideTimer();
            };
            button.onmouseenter = () => {
                setActiveIndex(Number(button.getAttribute('data-autocomplete-index')));
            };
            button.onclick = () => {
                const targetKey = String(button.getAttribute('data-autocomplete-key') || '');
                const item = suggestions.find((entry, index) => getSuggestionKey(entry, index) === targetKey) || null;
                pickSuggestion(item);
            };
        });
    };

    const refresh = async () => {
        clearHideTimer();
        const query = String(input.value || '').trim();
        if (typeof onInputChange === 'function') onInputChange(query);
        if (query.length < minChars) {
            hide();
            return [];
        }

        const seq = ++requestSeq;
        let nextSuggestions = [];
        try {
            nextSuggestions = await fetchSuggestions(query);
        } catch (error) {
            if (seq === requestSeq) hide();
            return [];
        }
        if (seq !== requestSeq) return [];

        suggestions = Array.isArray(nextSuggestions) ? nextSuggestions : [];
        activeIndex = -1;

        if (!suggestions.length) {
            hide();
            return [];
        }

        resultsEl.hidden = false;
        resultsEl.innerHTML = suggestions.map((item, index) => `
            <button
                type="button"
                class="editor-autocomplete-hit"
                data-autocomplete-key="${escapeHtml(getSuggestionKey(item, index))}"
                data-autocomplete-index="${index}"
            >
                ${renderSuggestion(item, index)}
            </button>
        `).join('');
        bindSuggestionRows();
        return suggestions;
    };

    input.addEventListener('input', () => {
        refresh().catch(() => {});
    });
    input.addEventListener('focus', () => {
        if (String(input.value || '').trim().length >= minChars) {
            refresh().catch(() => {});
        }
    });
    input.addEventListener('blur', () => {
        clearHideTimer();
        hideTimer = setTimeout(hide, 120);
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
            if (!suggestions.length) return;
            event.preventDefault();
            setActiveIndex(Math.min(activeIndex + 1, suggestions.length - 1));
            return;
        }
        if (event.key === 'ArrowUp') {
            if (!suggestions.length) return;
            event.preventDefault();
            setActiveIndex(activeIndex <= 0 ? 0 : activeIndex - 1);
            return;
        }
        if (event.key === 'Escape') {
            hide();
            return;
        }
        if (event.key === 'Tab' && activeIndex >= 0 && suggestions[activeIndex]) {
            event.preventDefault();
            pickSuggestion(suggestions[activeIndex], { focusInput: false });
            return;
        }
        if (event.key === 'Enter') {
            if (activeIndex >= 0 && suggestions[activeIndex]) {
                event.preventDefault();
                pickSuggestion(suggestions[activeIndex]);
                return;
            }
            if (typeof onSubmit === 'function') {
                event.preventDefault();
                onSubmit();
            }
        }
    });

    hide();

    return {
        hide,
        refresh
    };
}
