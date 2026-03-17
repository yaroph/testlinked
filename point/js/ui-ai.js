export function openPointAiHub(options = {}) {
    const {
        ensureModal = () => {},
        setModalMode = () => {},
        getModalOverlay = () => null,
        onOpenIntel = () => {},
        onOpenHvt = () => {},
        intelUnlocked = false,
    } = options;

    ensureModal();
    setModalMode('aihub');

    const modalOverlay = getModalOverlay();
    const msgEl = document.getElementById('modal-msg');
    const actEl = document.getElementById('modal-actions');
    if (!modalOverlay || !msgEl || !actEl) return;

    const intelPill = '<span class="ai-hub-card-pill">Pret</span>';

    msgEl.innerHTML = `
            <div class="ai-hub">
                <div class="ai-hub-head">
                    <div class="ai-hub-copy">
                        <div class="ai-hub-kicker">Operateur IA</div>
                        <div class="ai-hub-title">Choisis un assistant</div>
                        <div class="modal-note">Prediction IA propose de nouvelles liaisons. Cible importante classe les fiches deja centrales.</div>
                    </div>
                </div>
                <div class="ai-hub-grid">
                <button type="button" class="ai-hub-card" data-ai-open="intel-global">
                    <span class="ai-hub-card-corner ai-hub-card-corner-tl" aria-hidden="true"></span>
                    <span class="ai-hub-card-corner ai-hub-card-corner-br" aria-hidden="true"></span>
                    ${intelPill}
                    <span class="ai-hub-card-icon" aria-hidden="true">
                        <svg viewBox="0 0 120 120" role="presentation">
                            <g fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round" transform="translate(25 26) scale(2.85)">
                                <g transform="rotate(38 12 12)">
                                    <path d="M9 17H7A5 5 0 0 1 7 7h2"/>
                                    <path d="M15 7h2a5 5 0 1 1 0 10h-2"/>
                                    <path d="M8.5 12h7"/>
                                </g>
                            </g>
                            <path d="m81 20 3.4 9.3L94 32.7l-9.3 3.4L81 45.4l-3.4-9.3-9.3-3.4 9.3-3.4L81 20Z" fill="currentColor"/>
                            <path d="m44 60 5.4 2-3 2.9 6.3 2.3" fill="none" stroke="currentColor" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </span>
                    <span class="ai-hub-card-title">Prediction IA</span>
                    <span class="ai-hub-card-desc">Cherche des liaisons probables ou surprenantes a confirmer.</span>
                </button>
                <button type="button" class="ai-hub-card" data-ai-open="hvt">
                    <span class="ai-hub-card-corner ai-hub-card-corner-tl" aria-hidden="true"></span>
                    <span class="ai-hub-card-corner ai-hub-card-corner-br" aria-hidden="true"></span>
                    <span class="ai-hub-card-pill">Direct</span>
                    <span class="ai-hub-card-icon" aria-hidden="true">
                        <svg viewBox="0 0 120 120" role="presentation">
                            <circle cx="60" cy="50" r="10" fill="currentColor"/>
                            <circle cx="35" cy="28" r="5.8" fill="currentColor"/>
                            <circle cx="92" cy="24" r="5.8" fill="currentColor"/>
                            <circle cx="100" cy="76" r="5.8" fill="currentColor"/>
                            <circle cx="40" cy="82" r="5.8" fill="currentColor"/>
                            <circle cx="30" cy="60" r="5.8" fill="currentColor"/>
                            <path d="M60 50 35 28M60 50 92 24M60 50 100 76M60 50 40 82M60 50 30 60" fill="none" stroke="currentColor" stroke-width="4.8" stroke-linecap="round"/>
                        </svg>
                    </span>
                    <span class="ai-hub-card-title">Cible importante</span>
                    <span class="ai-hub-card-desc">Affiche le classement HVT des fiches deja les plus centrales.</span>
                </button>
            </div>
        </div>
    `;

    actEl.innerHTML = '';

    Array.from(document.querySelectorAll('[data-ai-open]')).forEach((btn) => {
        btn.onclick = () => {
            const action = btn.getAttribute('data-ai-open') || '';
            modalOverlay.style.display = 'none';
            if (action === 'hvt') {
                onOpenHvt();
                return;
            }
            if (action === 'intel-global') {
                onOpenIntel();
            }
        };
    });

    modalOverlay.style.display = 'flex';
}

export function bindPointQuickActions(options = {}) {
    const {
        onSearch = () => {},
        onCreate = () => {},
        onAi = () => {},
    } = options;

    const btnQuickSearch = document.getElementById('btnQuickSearch');
    if (btnQuickSearch) btnQuickSearch.onclick = () => onSearch();

    const btnQuickCreate = document.getElementById('btnQuickCreate');
    if (btnQuickCreate) btnQuickCreate.onclick = () => onCreate();

    const btnQuickIntel = document.getElementById('btnQuickIntel');
    if (btnQuickIntel) btnQuickIntel.onclick = () => onAi();
}
