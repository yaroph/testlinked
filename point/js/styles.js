export function injectStyles() {
    const style = document.createElement('style');
    style.innerHTML = `
        /* --- BASICS --- */
        .editor { width: 100% !important; }
        #editorBody { max-height: calc(100vh - 180px); overflow-y: auto; padding-right: 5px; min-width: 0; box-sizing: border-box; }
        #editorBody::-webkit-scrollbar { width: 5px; }
        #editorBody::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }

        .editor-sheet {
            font-family: var(--font-main);
            color: #d2ecff;
        }
        .editor-sheet-head {
            display: grid;
            grid-template-columns: 1fr auto auto;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
        }
        .editor-sheet-name {
            font-family: var(--font-tactical, var(--font-main));
            font-size: 3.5rem;
            line-height: 0.85;
            color: var(--accent-cyan);
            letter-spacing: 1px;
            white-space: normal;
            overflow-wrap: anywhere;
            text-overflow: clip;
        }
        .editor-sheet-type {
            padding: 4px 10px 3px;
            background: rgba(115, 251, 247, 0.82);
            color: #041621;
            font-family: var(--font-tactical, var(--font-main));
            font-size: 2rem;
            line-height: 0.82;
            text-transform: lowercase;
            border-radius: 1px;
            min-width: 88px;
            text-align: center;
        }
        .editor-sheet-id {
            font-family: var(--font-tactical, var(--font-main));
            font-size: 3.2rem;
            line-height: 0.82;
            color: var(--accent-cyan);
            letter-spacing: 1.2px;
        }
        .editor-sheet-values {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            font-family: var(--font-tactical, var(--font-main));
            font-size: 2rem;
            line-height: 0.85;
            color: #5fd9de;
            padding: 4px 2px 9px;
            border-bottom: 2px solid rgba(115, 251, 247, 0.65);
            margin-bottom: 10px;
        }
        .editor-sheet-note {
            border-bottom: 2px solid rgba(115, 251, 247, 0.45);
            margin-bottom: 10px;
        }
        .editor-sheet-note textarea {
            min-height: 54px;
            resize: vertical;
            border: none;
            border-radius: 0;
            padding: 4px 0 8px;
            background: transparent;
            color: #69d9df;
            font-family: var(--font-tactical, var(--font-main));
            font-size: 2rem;
            line-height: 0.9;
            box-shadow: none;
        }
        .editor-sheet-note textarea::placeholder {
            color: rgba(108, 199, 203, 0.62);
            font-family: var(--font-tactical, var(--font-main));
        }
        .editor-links-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 1rem;
            color: #58d4dc;
            letter-spacing: 1px;
            text-transform: uppercase;
            font-weight: 700;
        }
        #chipsLinks {
            min-height: 92px;
            border-bottom: 1px solid rgba(115, 251, 247, 0.2);
            padding-bottom: 10px;
            margin-bottom: 10px;
        }
        .sheet-links-columns {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px;
        }
        .sheet-links-col {
            min-width: 0;
        }
        .sheet-links-col + .sheet-links-col {
            border-left: 1px solid rgba(115, 251, 247, 0.2);
            padding-left: 12px;
        }
        .link-category {
            margin-top: 6px;
            margin-bottom: 4px;
            font-size: 0.7rem;
            color: #4f6f8f;
            text-transform: uppercase;
            letter-spacing: 1.2px;
            font-weight: 700;
        }
        .chip {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(13, 19, 37, 0.65);
            border-left: 3px solid #888;
            border-radius: 0 2px 2px 0;
            padding: 2px 6px;
            margin-bottom: 3px;
            transition: all 0.2s;
            min-height: 28px;
        }
        .chip:hover { background: rgba(255,255,255,0.08); }
        .chip-content { display: flex; align-items: center; flex: 1; min-width: 0; gap: 8px; }
        .chip-name {
            font-weight: 500;
            font-size: 1.9rem;
            line-height: 0.84;
            font-family: var(--font-tactical, var(--font-main));
            cursor: pointer;
            color: #cfd9eb;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .chip-name:hover { text-decoration: underline; color: #fff; }
        .chip-meta { margin-left: auto; }
        .chip-badge {
            font-size: 1.55rem;
            line-height: 0.8;
            font-family: var(--font-tactical, var(--font-main));
            text-transform: uppercase;
            opacity: 0.9;
            white-space: nowrap;
        }
        .x { padding: 0 0 0 8px; cursor: pointer; color: #666; font-size: 1rem; font-weight: bold; }
        .x:hover { color: #ff5555; }

        .editor-sheet-actions {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 8px;
            margin-top: 2px;
        }
        .editor-sheet-actions .mini-btn {
            font-family: var(--font-tactical, var(--font-main));
            font-size: 2rem;
            line-height: 0.86;
            text-transform: lowercase;
            min-height: 40px;
            background: rgba(99, 214, 216, 0.9);
            color: #041621;
            border-color: rgba(115, 251, 247, 0.95);
        }
        .editor-advanced {
            margin-top: 10px;
            border: 1px solid rgba(115, 251, 247, 0.25);
            background: rgba(5, 10, 23, 0.85);
            padding: 10px;
            display: none;
        }
        .editor-advanced.open { display: block; }
        .editor-adv-grid {
            display: grid;
            grid-template-columns: 1.4fr 1fr 0.65fr;
            gap: 8px;
            margin-bottom: 8px;
        }
        .editor-adv-grid label {
            display: block;
            margin-bottom: 3px;
            font-size: 0.7rem;
            color: #88a6c1;
            letter-spacing: 0.8px;
            text-transform: uppercase;
        }
        .editor-adv-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }
        .editor-adv-links {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 8px;
        }

        details {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.05);
            border-radius: 6px;
            margin-bottom: 8px;
            padding: 8px;
        }
        summary {
            cursor: pointer; font-weight: bold; font-size: 0.8rem;
            color: var(--accent-cyan);
            list-style: none; display: flex; align-items: center; justify-content: space-between;
        }
        summary::after { content: '+'; font-size: 1rem; font-weight: bold; opacity:0.5; }
        details[open] summary::after { content: '-'; }

        .flex-row-force { display: flex !important; flex-direction: row !important; flex-wrap: nowrap !important; align-items: center !important; width: 100% !important; gap: 5px !important; }
        .flex-grow-input { flex: 1 1 auto !important; min-width: 0 !important; width: 100% !important; }
        .compact-select { flex: 0 0 auto !important; font-size: 0.75rem !important; padding: 2px !important; }

        /* MINI BOUTONS REFAITS */
        .mini-btn {
            flex: 0 0 auto;
            padding: 6px 10px;
            text-align: center;
            justify-content: center;
            font-size: 0.88rem;
            border-radius: 3px;
            min-height: 30px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.12);
            color: #c9d7f0;
            font-family: var(--font-main);
            letter-spacing: 0.8px;
            text-transform: uppercase;
            clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
        }
        .mini-btn:hover { background: rgba(115, 251, 247, 0.16); color:#fff; border-color: rgba(115, 251, 247, 0.45); }
        .mini-btn:disabled { opacity: 0.45; cursor: not-allowed; background: rgba(6, 14, 28, 0.74); color:#6d819a; border-color: rgba(115, 251, 247, 0.12); }
        .mini-btn.active { background: var(--accent-cyan); color:#000; border-color:var(--accent-cyan); }
        .mini-btn.primary { background: rgba(115, 251, 247, 0.2); border-color: var(--accent-cyan); color: var(--accent-cyan); }

        /* HUD & DOCK */
        #hud {
            position: fixed;
            top: max(14px, env(safe-area-inset-top));
            right: max(14px, env(safe-area-inset-right));
            left: auto;
            bottom: auto;
            transform: none;
            width: min(148px, calc(100vw - 22px));
            max-width: 148px;
            margin-top: 0;
            padding: 6px;
            border-radius: 16px;
            background:
                linear-gradient(180deg, rgba(5, 11, 28, 0.96), rgba(3, 8, 20, 0.94)),
                radial-gradient(circle at top right, rgba(115, 251, 247, 0.12), transparent 55%);
            border: 1px solid rgba(115, 251, 247, 0.22);
            display: flex;
            flex-direction: column;
            gap: 5px;
            z-index: 70;
            backdrop-filter: blur(14px);
            box-shadow:
                inset 0 0 0 1px rgba(115, 251, 247, 0.05),
                0 18px 36px rgba(0, 0, 0, 0.34);
        }
        .hud-panel-title {
            display: none;
        }
        .hud-panel-kicker {
            color: #d7efff;
            font-size: 0.68rem;
            letter-spacing: 2.2px;
            text-transform: uppercase;
            font-weight: 700;
        }
        .hud-panel-sub {
            color: #6d86a2;
            font-size: 0.56rem;
            letter-spacing: 1.3px;
            text-transform: uppercase;
        }

        .icon-svg { width: 16px; height: 16px; fill: currentColor; display: block; }

        #hud .hud-btn {
            background: transparent; border: none; color: #8b9bb4; cursor: pointer;
            display: flex; align-items: center; gap: 8px; font-family: var(--font-main);
            font-size: 0.88rem; text-transform: uppercase; font-weight: 700;
            width: 100%;
            padding: 0; transition: all 0.2s; border-radius: 4px;
            letter-spacing: 0.8px;
            min-width: 0;
        }
        #hud .hud-btn:hover { color: var(--accent-cyan); }
        #hud .hud-btn.active { color: var(--accent-cyan); text-shadow: none; }
        #hud .hud-stack-btn,
        #hud .hud-mode-btn {
            min-height: 48px;
            padding: 7px 8px;
            border: 1px solid rgba(115, 251, 247, 0.14);
            border-radius: 11px;
            background: linear-gradient(180deg, rgba(8, 16, 34, 0.9), rgba(4, 10, 22, 0.96));
            clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px));
            justify-content: flex-start;
            text-align: left;
            transition:
                transform 0.16s ease,
                border-color 0.2s ease,
                background 0.2s ease,
                box-shadow 0.2s ease,
                color 0.2s ease;
        }
        #hud .hud-stack-btn:hover,
        #hud .hud-mode-btn:hover {
            transform: translateY(-1px);
            background: linear-gradient(180deg, rgba(10, 20, 40, 0.94), rgba(5, 13, 28, 0.98));
            border-color: rgba(115, 251, 247, 0.24);
        }
        #hud .hud-stack-btn.active,
        #hud .hud-mode-btn.active {
            background: linear-gradient(180deg, rgba(16, 35, 58, 0.96), rgba(8, 18, 32, 0.96));
            border-color: rgba(115, 251, 247, 0.42);
            box-shadow: 0 0 14px rgba(115, 251, 247, 0.12);
        }
        #hud .hud-stack-btn.is-off,
        #hud .hud-mode-btn.is-off {
            color: #7b90ab;
            border-color: rgba(123, 144, 171, 0.14);
        }
        #hud .hud-btn-icon {
            flex: 0 0 25px;
            width: 25px;
            height: 25px;
            border-radius: 7px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: rgba(115, 251, 247, 0.08);
            border: 1px solid rgba(115, 251, 247, 0.14);
            color: currentColor;
        }
        #hud .hud-btn-copy {
            display: flex;
            flex: 1 1 auto;
            flex-direction: column;
            align-items: flex-start;
            justify-content: center;
            gap: 2px;
            min-width: 0;
        }
        #hud .hud-btn-label {
            color: #7f96b0;
            font-size: 0.48rem;
            line-height: 1.05;
            letter-spacing: 1.3px;
            text-transform: uppercase;
            font-weight: 700;
            white-space: normal;
        }
        #hud .hud-btn-value {
            flex: 0 0 auto;
            color: #d8eeff;
            font-size: 0.75rem;
            line-height: 1;
            letter-spacing: 1px;
            text-transform: uppercase;
            font-weight: 800;
            white-space: normal;
            padding: 0;
            border-radius: 0;
            border: none;
            background: transparent;
        }
        #hud .hud-stack-btn.no-meta .hud-btn-label,
        #hud .hud-mode-btn.no-meta .hud-btn-label {
            color: #d8eeff;
            font-size: 0.7rem;
            line-height: 1;
            letter-spacing: 1.1px;
        }
        #hud .hud-stack-btn.no-meta .hud-btn-copy,
        #hud .hud-mode-btn.no-meta .hud-btn-copy {
            gap: 0;
        }
        #hud .hud-stack-btn.active .hud-btn-icon,
        #hud .hud-mode-btn.active .hud-btn-icon {
            background: rgba(115, 251, 247, 0.16);
            border-color: rgba(115, 251, 247, 0.38);
            box-shadow: 0 0 12px rgba(115, 251, 247, 0.12);
        }
        #hud .hud-stack-btn.active .hud-btn-value,
        #hud .hud-mode-btn.active .hud-btn-value {
            color: #bdf6ff;
        }
        #hud .hud-stack-btn.is-off .hud-btn-label,
        #hud .hud-mode-btn.is-off .hud-btn-label {
            color: #9ab0c9;
        }
        #hud .hud-stack-btn.is-off .hud-btn-value,
        #hud .hud-mode-btn.is-off .hud-btn-value {
            color: #8ba1bb;
        }
        #hud .hud-action-btn {
            border-color: rgba(115, 251, 247, 0.28);
            background: linear-gradient(90deg, rgba(10, 20, 40, 0.94), rgba(8, 18, 32, 0.92));
        }
        #hud .hud-action-btn .hud-btn-icon {
            background: rgba(115, 251, 247, 0.12);
            border-color: rgba(115, 251, 247, 0.24);
        }
        #hud .hud-action-btn .hud-btn-label {
            letter-spacing: 1.6px;
        }
        #hud .hud-action-btn .hud-btn-value {
            font-size: 0.82rem;
        }
        #hud .hud-filter-card {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 6px;
            border: 1px solid rgba(115, 251, 247, 0.16);
            border-radius: 16px;
            background: linear-gradient(180deg, rgba(8, 16, 34, 0.9), rgba(4, 10, 22, 0.96));
            clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px));
            box-shadow: inset 0 0 0 1px rgba(115, 251, 247, 0.03);
        }
        #hud .hud-filter-drawer {
            overflow: hidden;
        }
        #hud .hud-filter-trigger {
            width: 100%;
            position: relative;
        }
        #hud .hud-filter-trigger::after {
            content: '▾';
            color: #7f96b0;
            font-size: 0.62rem;
            line-height: 1;
            margin-left: auto;
            transition: transform 0.18s ease, color 0.18s ease;
        }
        #hud .hud-filter-card.expanded .hud-filter-trigger::after {
            transform: rotate(180deg);
            color: #d8eeff;
        }
        #hud .hud-filter-options {
            display: none;
            flex-direction: column;
            gap: 4px;
            padding-top: 5px;
            border-top: 1px solid rgba(115, 251, 247, 0.1);
        }
        #hud .hud-filter-card.expanded .hud-filter-options {
            display: flex;
        }
        #hud .hud-filter-title {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 1px 1px 5px;
            color: #7d93ad;
            font-size: 0.52rem;
            font-weight: 700;
            letter-spacing: 2px;
            text-transform: uppercase;
        }
        #hud .hud-filter-title-icon,
        #hud .hud-filter-option-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: currentColor;
        }
        #hud .hud-filter-title-icon {
            width: 16px;
            height: 16px;
        }
        #hud .hud-filter-title-icon .icon-svg {
            width: 14px;
            height: 14px;
        }
        #hud .hud-filter-option {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 7px;
            border: 1px solid transparent;
            border-radius: 10px;
            background: transparent;
            color: #93a6bf;
            cursor: pointer;
            font-family: var(--font-main);
            font-size: 0.6rem;
            font-weight: 700;
            letter-spacing: 1px;
            text-transform: uppercase;
            transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
        }
        #hud .hud-filter-option:hover {
            color: #dff9ff;
            background: rgba(115, 251, 247, 0.05);
        }
        #hud .hud-filter-option.active {
            color: var(--accent-cyan);
            background: rgba(115, 251, 247, 0.14);
            border-color: rgba(115, 251, 247, 0.42);
            box-shadow: inset 0 0 0 1px rgba(115, 251, 247, 0.12);
        }
        #hud .hud-filter-option-icon {
            flex: 0 0 15px;
            width: 15px;
            height: 15px;
        }
        #hud .hud-filter-option-label {
            flex: 1 1 auto;
            min-width: 0;
            text-align: left;
        }
        #hud .hud-settings-btn .hud-btn-icon {
            flex-basis: 26px;
            width: 26px;
            height: 26px;
            border-radius: 7px;
            background: rgba(115, 251, 247, 0.1);
            border-color: rgba(115, 251, 247, 0.22);
        }

        .hud-toggle {
            display: flex; align-items: center; gap: 8px; cursor: pointer;
            color: #8b9bb4; font-size: 0.85rem; text-transform: uppercase; font-weight: 700;
            transition: color 0.2s;
            letter-spacing: 0.8px;
        }
        .hud-toggle:hover { color: #fff; }
        .hud-toggle input { display: none; }

        .toggle-track {
            width: 24px; height: 12px; background: #333; border-radius: 10px;
            position: relative; transition: background 0.3s;
            box-shadow: inset 0 1px 3px rgba(0,0,0,0.5);
        }
        .toggle-thumb {
            width: 10px; height: 10px; background: #888; border-radius: 50%;
            position: absolute; top: 1px; left: 1px; transition: transform 0.3s, background 0.3s;
        }
        .hud-toggle input:checked + .toggle-track { background: rgba(115, 251, 247, 0.2); border: 1px solid var(--accent-cyan); }
        .hud-toggle input:checked + .toggle-track .toggle-thumb { transform: translateX(12px); background: var(--accent-cyan); box-shadow: 0 0 8px var(--accent-cyan); }

        #btnHVT { border: 1px solid #ff5555; color: #ff5555; background: rgba(255, 85, 85, 0.1); }
        #btnHVT:hover { background: rgba(255, 85, 85, 0.2); box-shadow: 0 0 10px rgba(255, 85, 85, 0.3); }
        #btnHVT.active { background: #ff5555; color: #000; box-shadow: 0 0 15px #ff5555; }

        #btnIntel { border: 1px solid var(--accent-cyan); color: var(--accent-cyan); background: rgba(115, 251, 247, 0.1); }
        #btnIntel:hover { background: rgba(115, 251, 247, 0.2); box-shadow: 0 0 10px rgba(115, 251, 247, 0.35); }
        #btnIntel.active { background: var(--accent-cyan); color: #000; box-shadow: 0 0 15px rgba(115, 251, 247, 0.6); }
        #btnIntel.locked { opacity: 0.7; }

        .hud-sep { width: 1px; height: 20px; background: rgba(255,255,255,0.1); }
        .hud-zoom {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 132px;
            padding: 6px 10px;
            border: 1px solid rgba(115, 251, 247, 0.18);
            border-radius: 10px;
            background: rgba(10, 18, 38, 0.82);
        }
        .hud-zoom-label {
            color: #7f92ad;
            font-size: 0.72rem;
            font-weight: 700;
            letter-spacing: 1.1px;
            text-transform: uppercase;
        }
        .hud-zoom-value {
            min-width: 44px;
            color: var(--accent-cyan);
            font-family: var(--font-tactical);
            font-size: 1.55rem;
            line-height: 0.8;
        }
        .hud-zoom-bar {
            position: relative;
            flex: 1 1 auto;
            height: 4px;
            border-radius: 999px;
            overflow: hidden;
            background: rgba(115, 251, 247, 0.12);
        }
        .hud-zoom-bar span {
            display: block;
            width: 0%;
            height: 100%;
            border-radius: inherit;
            background: linear-gradient(90deg, rgba(115, 251, 247, 0.42), rgba(115, 251, 247, 0.92));
            box-shadow: 0 0 10px rgba(115, 251, 247, 0.32);
        }

        /* --- HVT PANEL --- */
        #hvt-panel {
            position: fixed;
            right: 20px;
            top: 90px;
            width: 340px;
            max-height: 75vh;
            display: none;
            flex-direction: column;
            background: rgba(5, 7, 20, 0.98);
            border: 1px solid rgba(255, 85, 85, 0.5);
            border-radius: 10px;
            padding: 12px;
            z-index: 10002;
            box-shadow: 0 0 40px rgba(0,0,0,0.8);
            backdrop-filter: blur(12px);
        }
        .hvt-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; cursor: move; user-select: none; }
        #hvt-panel.dragging { cursor: grabbing; }
        .hvt-title { color: #ff5555; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; font-size: 0.8rem; }
        .hvt-close { cursor: pointer; color: #999; font-weight: bold; padding: 2px 6px; border-radius: 4px; }
        .hvt-close:hover { color: #fff; background: rgba(255,255,255,0.08); }
        .hvt-sub { display: flex; align-items: center; justify-content: space-between; color: #888; font-size: 0.7rem; text-transform: uppercase; margin-bottom: 8px; }
        #hvt-list { max-height: 260px; overflow-y: auto; border-top: 1px solid rgba(255,255,255,0.08); border-bottom: 1px solid rgba(255,255,255,0.08); padding: 6px 0; }
        .hvt-row { display: flex; align-items: center; gap: 8px; padding: 6px 6px; border-radius: 6px; cursor: pointer; transition: background 0.2s; }
        .hvt-row:hover { background: rgba(255,255,255,0.06); }
        .hvt-row.active { background: rgba(255, 85, 85, 0.2); border: 1px solid rgba(255, 85, 85, 0.5); }
        .hvt-rank { width: 22px; font-size: 0.7rem; color: var(--accent-cyan); font-weight: bold; text-align: right; }
        .hvt-name { font-size: 0.85rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
        .hvt-type { font-size: 0.7rem; color: #888; }
        .hvt-score { font-size: 0.7rem; color: #ffb3b3; font-weight: bold; }
        #hvt-details { padding-top: 8px; font-size: 0.8rem; color: #cfcfcf; }
        .hvt-detail-title { color: var(--accent-cyan); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
        .hvt-detail-name { font-size: 1rem; font-weight: bold; margin-bottom: 6px; color: #fff; }
        .hvt-detail-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .hvt-detail-sub { margin-top: 8px; margin-bottom: 4px; font-size: 0.7rem; text-transform: uppercase; color: #888; letter-spacing: 1px; }
        .hvt-tags { display: flex; flex-wrap: wrap; gap: 6px; }
        .hvt-tag { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 2px 6px; font-size: 0.7rem; color: #ddd; }

        /* --- INTEL PANEL --- */
        #intel-panel {
            position: fixed;
            right: 380px;
            top: 90px;
            width: 420px;
            max-height: 80vh;
            display: none;
            flex-direction: column;
            background: rgba(5, 7, 20, 0.98);
            border: 1px solid rgba(115, 251, 247, 0.5);
            border-radius: 10px;
            padding: 12px;
            z-index: 10003;
            box-shadow: 0 0 40px rgba(0,0,0,0.8);
            backdrop-filter: blur(12px);
        }
        .intel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; cursor: move; user-select: none; }
        #intel-panel.dragging { cursor: grabbing; }
        .intel-title { color: var(--accent-cyan); text-transform: uppercase; letter-spacing: 2px; font-weight: 700; font-size: 0.8rem; }
        .intel-close { cursor: pointer; color: #999; font-weight: bold; padding: 2px 6px; border-radius: 4px; }
        .intel-close:hover { color: #fff; background: rgba(255,255,255,0.08); }
        .intel-sub { font-size: 0.7rem; text-transform: uppercase; color: #88a; letter-spacing: 1px; margin-bottom: 8px; }
        .intel-controls { display: flex; flex-direction: column; gap: 8px; }
        .intel-row { display: flex; align-items: center; gap: 8px; }
        .intel-row label { font-size: 0.7rem; color: #888; text-transform: uppercase; letter-spacing: 1px; }
        .intel-row .intel-grow { flex: 1; }
        .intel-select, .intel-input {
            background: rgba(0,0,0,0.4);
            border: 1px solid rgba(255,255,255,0.1);
            color: #ddd;
            font-size: 0.75rem;
            padding: 6px 8px;
            border-radius: 4px;
        }
        .intel-toggle { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .intel-toggle label { font-size: 0.7rem; color: #aaa; text-transform: uppercase; display: flex; align-items: center; gap: 4px; }
        .intel-toggle input { accent-color: var(--accent-cyan); }
        .intel-actions { display: flex; align-items: center; gap: 6px; }
        .intel-actions button { font-size: 0.7rem; padding: 6px 8px; }
        .intel-divider { height: 1px; background: rgba(255,255,255,0.08); margin: 6px 0; }
        #intel-list { margin-top: 8px; overflow-y: auto; padding-right: 4px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px; }
        .intel-item { background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 8px; margin-bottom: 8px; }
        .intel-item.highlight { border-color: rgba(115, 251, 247, 0.4); box-shadow: 0 0 12px rgba(115, 251, 247, 0.12); }
        .intel-meta { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 0.7rem; color: #999; }
        .intel-score { color: var(--accent-cyan); font-weight: bold; }
        .intel-confidence { color: #9fd4d2; font-weight: 600; }
        .intel-names { font-size: 0.85rem; color: #fff; margin: 4px 0; display: flex; align-items: center; gap: 6px; }
        .intel-badge { font-size: 0.65rem; text-transform: uppercase; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 2px 6px; color: #aaa; }
        .intel-reasons { font-size: 0.7rem; color: #888; margin-top: 6px; line-height: 1.2; }
        .intel-cta { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
        .intel-cta button { font-size: 0.65rem; padding: 5px 8px; border-radius: 4px; }
        .intel-kind { font-size: 0.7rem; }
        .intel-feedback { margin-left: auto; display: flex; gap: 4px; }
        .intel-feedback button { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); color: #aaa; padding: 3px 6px; border-radius: 4px; font-size: 0.65rem; }
        .intel-feedback button.active { border-color: var(--accent-cyan); color: var(--accent-cyan); }

        @media (max-width: 1100px) {
            #intel-panel { right: 20px; top: 90px; width: 320px; }
        }

        /* --- CONTEXT MENU --- */
        #context-menu {
            position: fixed; z-index: 10000;
            background: rgba(5, 7, 20, 0.98); border: 1px solid var(--accent-cyan);
            border-radius: 8px; padding: 5px 0; min-width: 180px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.8); backdrop-filter: blur(10px);
            display: none; flex-direction: column;
        }
        .ctx-item {
            padding: 8px 15px; cursor: pointer; font-size: 0.9rem; color: #eee;
            display: flex; align-items: center; gap: 10px; transition: background 0.1s;
        }
        .ctx-item:hover { background: rgba(115, 251, 247, 0.15); color: #fff; }
        .ctx-item.danger { color: #ff5555; }
        .ctx-item.danger:hover { background: rgba(255, 80, 80, 0.2); }
        .ctx-divider { height: 1px; background: rgba(255,255,255,0.1); margin: 4px 0; }

        /* --- PANNEAU REGLAGES (HAUT GAUCHE) --- */
        #settings-panel {
            position: fixed; top: 20px; left: 20px;
            width: min(430px, calc(100vw - 28px));
            max-height: min(82vh, 820px);
            background: rgba(5, 7, 20, 0.98);
            border: 1px solid var(--accent-cyan); border-radius: 12px;
            padding: 16px; z-index: 10001;
            display: none;
            box-shadow: 0 0 50px rgba(0,0,0,0.9);
            backdrop-filter: blur(15px);
            overflow: auto;
        }
        .ui-close-x {
            appearance: none;
            width: 34px;
            height: 34px;
            min-width: 34px;
            min-height: 34px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            border: 1px solid rgba(102, 243, 255, 0.24);
            border-radius: 999px;
            background: linear-gradient(180deg, rgba(8, 18, 42, 0.96), rgba(4, 10, 22, 0.92));
            color: #e6f8ff;
            font-family: var(--font-main);
            font-size: 1rem;
            font-weight: 700;
            line-height: 1;
            cursor: pointer;
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
            transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
        }
        .ui-close-x:hover {
            transform: translateY(-1px);
            border-color: rgba(102, 243, 255, 0.5);
            background: linear-gradient(180deg, rgba(15, 33, 62, 0.98), rgba(6, 16, 30, 0.96));
            color: #ffffff;
            box-shadow: 0 0 16px rgba(102, 243, 255, 0.12);
        }
        #settings-panel.dragging { cursor: grabbing; user-select: none; }
        .settings-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 16px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            padding-bottom: 10px;
            cursor: grab;
        }
        .settings-header h3 { margin: 0; color: var(--accent-cyan); text-transform: uppercase; font-size: 1rem; letter-spacing: 1px; }
        .settings-header-copy {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .settings-header-sub {
            color: #88a2bc;
            font-size: 0.68rem;
            line-height: 1.4;
            letter-spacing: 1.1px;
            text-transform: uppercase;
        }
        .settings-close {
            flex: 0 0 auto;
        }

        .setting-row { margin-bottom: 15px; }
        .setting-row label { display: block; font-size: 0.72rem; color: #aaa; margin-bottom: 7px; text-transform: uppercase; font-weight: 600; letter-spacing: 1.2px; }
        .setting-row input[type="range"] { width: 100%; cursor: pointer; accent-color: var(--accent-cyan); margin-top: 5px; }
        .setting-val { float: right; color: var(--accent-cyan); font-family: monospace; font-size: 0.9rem; }

        .settings-actions { margin-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 15px; }

        /* --- THEME OVERRIDES --- */
        #custom-modal {
            background: rgba(1, 4, 12, 0.78) !important;
            backdrop-filter: blur(8px) !important;
        }
        #custom-modal .modal-card {
            background:
                linear-gradient(180deg, rgba(8, 18, 42, 0.98), rgba(4, 11, 26, 0.96)) !important;
            border: 1px solid rgba(102, 243, 255, 0.44) !important;
            border-radius: 18px;
            clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 18px 100%, 0 calc(100% - 18px));
            box-shadow:
                0 0 0 1px rgba(102, 243, 255, 0.08),
                0 28px 70px rgba(0, 0, 0, 0.66) !important;
        }
        #custom-modal #modal-msg {
            color: var(--text-main);
            font-family: var(--font-main);
        }
        #custom-modal #modal-actions {
            gap: 12px;
            justify-content: flex-end;
        }
        #custom-modal #modal-actions button {
            min-width: 140px;
        }
        .modal-tool {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .modal-tool-title {
            margin: 0;
            color: var(--accent-cyan);
            font-size: 0.78rem;
            line-height: 1.3;
            letter-spacing: 3px;
            text-transform: uppercase;
        }
        .modal-input-standalone,
        .modal-raw-input {
            width: 100%;
            border: 1px solid rgba(102, 243, 255, 0.18);
            border-radius: 10px;
            background: rgba(2, 8, 20, 0.92);
            color: var(--text-light);
            box-shadow: inset 0 0 0 1px rgba(102, 243, 255, 0.04);
        }
        .modal-input-standalone {
            min-height: 42px;
            padding: 9px 11px;
        }
        .modal-input-standalone::placeholder,
        .modal-raw-input::placeholder {
            color: #637996;
        }
        .modal-input-center {
            text-align: center;
            font-family: var(--font-main);
            font-size: 1.08rem;
            letter-spacing: 0.06em;
        }
        .modal-search-results {
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 240px;
            overflow: auto;
            padding: 7px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 10px;
            background: rgba(3, 10, 24, 0.72);
        }
        .quick-search-hit {
            width: 100%;
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
        }
        .quick-search-name {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .quick-search-meta {
            color: var(--text-muted);
            font-family: var(--font-code);
            font-size: 0.72rem;
            letter-spacing: 0.04em;
        }
        .modal-empty-state {
            padding: 12px;
            text-align: center;
            color: var(--text-faded);
            font-size: 0.82rem;
        }
        .modal-segment {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
        }
        .modal-segment-btn {
            width: 100%;
        }
        .modal-note {
            color: #9bb0c7;
            font-size: 0.8rem;
            line-height: 1.5;
        }
        .modal-note-warning {
            color: #ffcc8a;
        }
        .modal-raw-input {
            min-height: 180px;
            padding: 12px 14px;
            resize: vertical;
            font-family: var(--font-code);
            font-size: 0.82rem;
            line-height: 1.45;
        }
        .intel-unlock-error {
            min-height: 16px;
            margin-top: 2px;
            color: #ff6b81;
            font-size: 0.8rem;
        }
        .is-disabled-visual {
            opacity: 0.6;
        }

        .ai-hub {
            display: flex;
            flex-direction: column;
            min-height: 520px;
            position: relative;
            overflow: hidden;
            background:
                linear-gradient(180deg, rgba(1, 9, 28, 0.98), rgba(1, 6, 18, 0.98)),
                radial-gradient(circle at 85% 10%, rgba(102, 243, 255, 0.08), transparent 24%);
        }
        .ai-hub::before {
            content: "";
            position: absolute;
            inset: 0;
            pointer-events: none;
            background-image:
                linear-gradient(rgba(102, 243, 255, 0.06) 1px, transparent 1px),
                linear-gradient(90deg, rgba(102, 243, 255, 0.05) 1px, transparent 1px);
            background-size: 48px 48px;
            opacity: 0.24;
        }
        .ai-hub-head {
            position: relative;
            z-index: 1;
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 14px;
            padding: 18px 42px 14px 18px;
            border-bottom: 1px solid rgba(102, 243, 255, 0.12);
        }
        .ai-hub-copy {
            display: flex;
            flex-direction: column;
            gap: 10px;
            min-width: 0;
        }
        .ai-hub-kicker {
            color: #90aac6;
            font-size: 0.74rem;
            letter-spacing: 4px;
            text-transform: uppercase;
        }
        .ai-hub-title {
            color: var(--text-light);
            font-family: var(--font-main);
            font-size: clamp(2.1rem, 4.1vw, 3.2rem);
            line-height: 0.86;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }
        .ai-hub-grid {
            position: relative;
            z-index: 1;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
            padding: 16px;
            flex: 1;
        }
        .ai-hub-card {
            position: relative;
            min-height: 252px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 18px;
            padding: 24px 18px 20px;
            border: 1px solid rgba(132, 169, 212, 0.22);
            border-radius: 0;
            background:
                linear-gradient(180deg, rgba(3, 14, 42, 0.96), rgba(2, 9, 28, 0.96)),
                radial-gradient(circle at 50% 0%, rgba(102, 243, 255, 0.07), transparent 52%);
            text-align: left;
            text-transform: none;
            letter-spacing: normal;
            font-family: var(--font-main);
            box-shadow:
                inset 0 0 0 1px rgba(102, 243, 255, 0.05),
                0 16px 40px rgba(0, 0, 0, 0.32);
            clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
        }
        .ai-hub-card:hover {
            border-color: rgba(102, 243, 255, 0.48);
            transform: translateY(-2px);
            box-shadow:
                inset 0 0 0 1px rgba(102, 243, 255, 0.08),
                0 22px 44px rgba(0, 0, 0, 0.42);
        }
        .ai-hub-card::before {
            content: "";
            position: absolute;
            inset: 0;
            pointer-events: none;
            background:
                linear-gradient(180deg, rgba(102, 243, 255, 0.05), transparent 14%, transparent 86%, rgba(102, 243, 255, 0.04));
        }
        .ai-hub-card-pill {
            position: absolute;
            top: 14px;
            right: 16px;
            min-height: 24px;
            padding: 4px 10px;
            border-radius: 999px;
            border: 1px solid rgba(102, 243, 255, 0.26);
            background: rgba(102, 243, 255, 0.12);
            color: #dff7ff;
            font-size: 0.62rem;
            font-weight: 700;
            letter-spacing: 1.6px;
            text-transform: uppercase;
        }
        .ai-hub-card-pill.is-locked {
            border-color: rgba(255, 204, 138, 0.32);
            background: rgba(255, 204, 138, 0.12);
            color: #ffd79c;
        }
        .ai-hub-card-corner {
            position: absolute;
            width: 32px;
            height: 32px;
            opacity: 0.9;
        }
        .ai-hub-card-corner::before,
        .ai-hub-card-corner::after {
            content: "";
            position: absolute;
            background: rgba(214, 233, 255, 0.9);
        }
        .ai-hub-card-corner::before {
            width: 18px;
            height: 2px;
        }
        .ai-hub-card-corner::after {
            width: 2px;
            height: 18px;
        }
        .ai-hub-card-corner-tl {
            top: 12px;
            left: 12px;
        }
        .ai-hub-card-corner-tl::before,
        .ai-hub-card-corner-tl::after {
            top: 0;
            left: 0;
        }
        .ai-hub-card-corner-br {
            right: 12px;
            bottom: 12px;
        }
        .ai-hub-card-corner-br::before,
        .ai-hub-card-corner-br::after {
            right: 0;
            bottom: 0;
        }
        .ai-hub-card-icon {
            width: 84px;
            height: 84px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: rgba(255, 255, 255, 0.96);
        }
        .ai-hub-card-icon svg {
            width: 100%;
            height: 100%;
            display: block;
        }
        .ai-hub-card-title {
            color: var(--text-light);
            font-size: clamp(1.55rem, 2.7vw, 2.2rem);
            line-height: 1.04;
            font-weight: 700;
            text-align: center;
        }
        .ai-hub-card-desc {
            max-width: 360px;
            color: #95aac8;
            font-size: 0.82rem;
            line-height: 1.45;
            letter-spacing: 1.6px;
            text-align: center;
            text-transform: uppercase;
        }

        .quick-create-shell {
            display: flex;
            flex-direction: column;
            gap: 10px;
            max-width: 720px;
            margin: 0 auto;
            padding: 12px;
            border: 1px solid rgba(102, 243, 255, 0.34);
            border-radius: 16px;
            background:
                linear-gradient(180deg, rgba(8, 18, 42, 0.94), rgba(4, 11, 26, 0.92)),
                radial-gradient(circle at top right, rgba(102, 243, 255, 0.08), transparent 52%);
            box-shadow: inset 0 0 0 1px rgba(102, 243, 255, 0.04);
        }
        .quick-create-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
            padding-right: 42px;
        }
        .quick-create-tabs {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 6px;
        }
        .quick-create-tab {
            appearance: none;
            padding: 9px 12px;
            border: 1px solid rgba(102, 243, 255, 0.16);
            border-radius: 12px;
            background: rgba(3, 10, 24, 0.82);
            color: #6d88aa;
            font-family: var(--font-main);
            font-size: clamp(0.96rem, 1.6vw, 1.22rem);
            line-height: 0.92;
            letter-spacing: 0.08em;
            text-align: left;
            text-transform: uppercase;
            transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease, transform 0.18s ease;
            box-shadow: none;
        }
        .quick-create-tab:hover {
            border-color: rgba(102, 243, 255, 0.28);
            color: #d5fcff;
        }
        .quick-create-tab.active {
            border-color: rgba(102, 243, 255, 0.42);
            background:
                linear-gradient(180deg, rgba(8, 23, 48, 0.96), rgba(4, 12, 28, 0.92)),
                radial-gradient(circle at top right, rgba(102, 243, 255, 0.12), transparent 60%);
            color: var(--accent-cyan);
            transform: translateY(-1px);
        }
        .quick-create-panels {
            display: flex;
            flex-direction: column;
        }
        .quick-create-panel {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .quick-create-panel.is-hidden {
            display: none;
        }
        .quick-create-title {
            margin: 0;
            color: var(--accent-cyan);
            font-family: var(--font-main);
            font-size: clamp(1.55rem, 2.5vw, 2.1rem);
            line-height: 0.82;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }
        .quick-create-block {
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-height: 100%;
            padding: 10px;
            border: 1px solid rgba(102, 243, 255, 0.14);
            border-radius: 12px;
            background: rgba(2, 8, 20, 0.58);
        }
        .quick-create-block-head {
            color: #9eb8d4;
            font-size: 0.7rem;
            letter-spacing: 1.6px;
            text-transform: uppercase;
        }
        .quick-create-link-flow {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
            gap: 10px;
            align-items: start;
        }
        .quick-create-link-arrow {
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 42px;
            min-height: 40px;
            color: var(--accent-cyan);
            font-size: clamp(1.3rem, 2.2vw, 1.8rem);
            line-height: 1;
            text-shadow: 0 0 16px rgba(102, 243, 255, 0.2);
        }
        .quick-create-node-row {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 6px;
        }
        .quick-create-target-input {
            min-height: 42px;
            padding: 8px 10px;
            border: 1px solid rgba(102, 243, 255, 0.26);
            border-radius: 10px;
            background: rgba(2, 8, 20, 0.92);
            color: var(--text-light);
            font-family: var(--font-main);
            font-size: clamp(0.9rem, 1.4vw, 1.02rem);
            line-height: 1.1;
            letter-spacing: 0.04em;
        }
        .quick-create-target-input::placeholder {
            color: #5b7291;
        }
        .quick-create-field-stack {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .quick-create-field-label {
            color: #9bb0c7;
            font-size: 0.68rem;
            letter-spacing: 1.5px;
            text-transform: uppercase;
        }
        .quick-create-search-result {
            display: block;
            min-height: 18px;
            line-height: 1.35;
        }
        .quick-create-search-list {
            display: block;
        }
        .quick-create-search-hit {
            margin: 0;
            display: inline;
            width: auto;
            padding: 0;
            border: 0;
            background: transparent;
            color: #95efff;
            font-family: var(--font-main);
            font-size: 0.84rem;
            line-height: 1.35;
            text-transform: none;
            box-shadow: none;
            text-decoration: underline;
            text-decoration-thickness: 1px;
            text-underline-offset: 2px;
            text-align: left;
        }
        .quick-create-search-hit:not(:first-child)::before {
            content: '·';
            display: inline-block;
            margin: 0 8px 0 6px;
            color: rgba(145, 188, 216, 0.78);
            text-decoration: none;
        }
        .quick-create-search-hit:hover {
            color: #ffffff;
            box-shadow: none;
        }
        .quick-create-search-name {
            max-width: 180px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .quick-create-search-meta {
            color: #89a6c5;
            font-size: 0.64rem;
            letter-spacing: 1.2px;
            text-transform: uppercase;
            white-space: nowrap;
        }
        .quick-create-search-empty {
            color: var(--text-faded);
            font-size: 0.76rem;
        }
        .quick-create-search-create-wrap {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
            margin-top: 2px;
            padding: 8px 0 4px;
            border-top: 1px solid rgba(102, 243, 255, 0.08);
        }
        .quick-create-search-create-wrap.is-active {
            padding: 10px 12px;
            border: 1px solid rgba(102, 243, 255, 0.18);
            border-radius: 10px;
            background: rgba(7, 18, 39, 0.72);
        }
        .quick-create-search-hit-create {
            color: #9ff6ff;
            font-weight: 700;
        }
        .quick-create-search-hit-create::before {
            display: none;
        }
        .quick-create-search-create-label {
            color: #6f8ea6;
            font-size: 0.68rem;
            letter-spacing: 0.12em;
            text-transform: uppercase;
        }
        .quick-create-type-switch {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            flex-wrap: wrap;
            width: 100%;
        }
        .quick-create-type-chip {
            margin: 0;
            padding: 0;
            border: 0;
            background: transparent;
            color: #89a6c5;
            font-family: var(--font-main);
            font-size: 0.72rem;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            box-shadow: none;
            text-decoration: underline;
            text-decoration-thickness: 1px;
            text-underline-offset: 2px;
        }
        .quick-create-type-chip:not(:first-child)::before {
            content: '·';
            display: inline-block;
            margin: 0 6px 0 4px;
            color: rgba(145, 188, 216, 0.6);
            text-decoration: none;
        }
        .quick-create-type-chip:hover {
            color: #d9f9ff;
            background: transparent;
        }
        .quick-create-type-chip.active {
            color: #f2fdff;
            font-weight: 700;
        }
        .quick-create-search-meta {
            display: none;
        }
        .quick-create-search-empty {
            color: var(--text-faded);
            font-size: 0.76rem;
        }
        .quick-create-context {
            color: #7aa6b9;
            font-size: 0.76rem;
            line-height: 1.45;
            letter-spacing: 1.2px;
            text-transform: uppercase;
        }
        .quick-create-source-pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            width: fit-content;
            padding: 8px 12px;
            border: 1px solid rgba(102, 243, 255, 0.22);
            border-radius: 999px;
            background: rgba(102, 243, 255, 0.08);
            color: var(--accent-cyan);
            font-size: 0.8rem;
            letter-spacing: 1.2px;
            text-transform: uppercase;
        }
        .quick-create-empty-state {
            padding: 14px;
            border: 1px dashed rgba(102, 243, 255, 0.2);
            border-radius: 10px;
            background: rgba(3, 10, 24, 0.72);
            color: var(--text-faded);
            font-size: 0.84rem;
            line-height: 1.45;
            text-align: center;
        }
        .quick-create-suggestions {
            display: grid;
            grid-template-columns: 1fr;
            gap: 8px;
            max-height: 176px;
            overflow: auto;
            padding: 10px;
            border: 1px dashed rgba(102, 243, 255, 0.22);
            border-radius: 10px;
            background: rgba(3, 10, 24, 0.7);
        }
        .quick-create-type-row,
        .quick-create-source-row,
        .quick-create-kind-row {
            display: flex;
            gap: 8px;
        }
        .quick-create-kind-label {
            align-self: center;
            min-width: 74px;
            margin: 0;
            color: #9bb0c7;
            font-size: 0.7rem;
            letter-spacing: 1px;
            text-transform: uppercase;
            white-space: nowrap;
        }
        .quick-create-suggestion {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 10px 12px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 10px;
            background: rgba(5, 12, 26, 0.82);
            color: var(--text-light);
            font-family: var(--font-main);
            font-size: 0.92rem;
            line-height: 1.2;
            text-transform: none;
            text-decoration: none;
            box-shadow: none;
        }
        .quick-create-suggestion:hover {
            background: rgba(10, 23, 42, 0.92);
            border-color: rgba(102, 243, 255, 0.34);
            color: #d5fcff;
            box-shadow: none;
        }
        .quick-create-suggestion-type {
            color: #89a6c5;
            font-size: 0.68rem;
            letter-spacing: 1.4px;
            text-transform: uppercase;
            white-space: nowrap;
        }
        .quick-create-panel-action {
            width: 100%;
            margin-top: auto;
            min-height: 42px;
        }
        .quick-create-sep {
            color: #3a6f7e;
        }
        .quick-create-empty {
            color: var(--text-faded);
            font-size: 0.76rem;
        }

        .cloud-auth-shell {
            max-width: 460px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 2px 0;
        }
        .cloud-auth-shell-inline {
            max-width: none;
            padding: 18px;
            border: 1px solid rgba(102, 243, 255, 0.1);
            border-radius: 14px;
            background: linear-gradient(180deg, rgba(5, 12, 28, 0.76), rgba(4, 10, 22, 0.82));
        }
        .cloud-auth-shell-guest {
            justify-content: center;
            min-height: 100%;
        }
        .cloud-auth-badge {
            align-self: flex-start;
            padding: 5px 9px;
            border: 1px solid rgba(102, 243, 255, 0.14);
            border-radius: 999px;
            background: rgba(8, 20, 44, 0.56);
            color: #9befff;
            font-size: 0.62rem;
            font-weight: 700;
            letter-spacing: 0.7px;
            text-transform: none;
        }
        .cloud-auth-title {
            margin: 0;
            color: #effbff;
            font-size: 1.02rem;
            font-weight: 700;
            letter-spacing: 0.02em;
            text-transform: none;
        }
        .cloud-auth-copy {
            color: #a6c2dd;
            font-size: 0.8rem;
            line-height: 1.5;
        }
        .cloud-auth-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 8px;
        }
        .cloud-auth-shell-guest .cloud-auth-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
        }
        .cloud-auth-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 0;
            border: none;
            border-radius: 0;
            background: transparent;
            box-shadow: none;
        }
        .cloud-auth-label {
            color: #d5ecfa;
            font-size: 0.62rem;
            font-weight: 700;
            letter-spacing: 0.6px;
            text-transform: none;
        }
        .cloud-auth-input {
            min-height: 44px;
            padding: 10px 12px;
            border-color: rgba(102, 243, 255, 0.14);
            border-radius: 10px;
            background: rgba(3, 9, 22, 0.92);
        }
        .cloud-auth-input:focus {
            outline: none;
            border-color: rgba(102, 243, 255, 0.52);
            box-shadow: 0 0 0 3px rgba(102, 243, 255, 0.1), 0 0 18px rgba(102, 243, 255, 0.12);
        }
        .cloud-auth-hint {
            color: #86a4c0;
            font-size: 0.74rem;
            line-height: 1.45;
            padding: 10px 12px;
            border: 1px solid rgba(102, 243, 255, 0.1);
            border-radius: 10px;
            background: rgba(4, 11, 26, 0.46);
        }
        .cloud-auth-primary,
        .cloud-auth-secondary,
        .cloud-auth-tertiary {
            min-width: 132px;
            border-radius: 10px;
            text-transform: none !important;
            letter-spacing: 0.01em !important;
            font-size: 0.84rem;
            font-weight: 700;
        }
        .cloud-auth-secondary {
            border-color: rgba(102, 243, 255, 0.2);
            background: rgba(8, 20, 44, 0.78);
            color: #dcfaff;
        }
        .cloud-auth-tertiary {
            background: rgba(4, 10, 22, 0.68);
            color: #9ab6cf;
        }
        .cloud-inline-form {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 120px auto;
            gap: 8px;
            align-items: center;
        }
        .cloud-inline-select {
            min-width: 110px;
        }
        .cloud-shell {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .cloud-manage-shell {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .cloud-manage-loading {
            min-height: 280px;
        }
        .cloud-loading-card {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 14px;
            border: 1px solid rgba(102, 243, 255, 0.1);
            border-radius: 14px;
            background: linear-gradient(180deg, rgba(7, 16, 35, 0.86), rgba(4, 10, 22, 0.82));
        }
        .cloud-loading-bar {
            height: 11px;
            border-radius: 999px;
            background: linear-gradient(90deg, rgba(102, 243, 255, 0.08), rgba(102, 243, 255, 0.22), rgba(102, 243, 255, 0.08));
            background-size: 220% 100%;
            animation: cloud-loading-shimmer 1.2s linear infinite;
        }
        .cloud-loading-bar-lg {
            width: 72%;
        }
        .cloud-loading-bar-sm {
            width: 38%;
        }
        @keyframes cloud-loading-shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -20% 0; }
        }
        .cloud-board-manage-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 2px;
            padding-right: 52px;
            padding-bottom: 12px;
            border-bottom: 1px solid rgba(102, 243, 255, 0.14);
        }
        .cloud-share-line {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px;
            color: #8faac8;
            font-size: 0.74rem;
            line-height: 1.5;
        }
        .cloud-share-link {
            color: var(--accent-cyan);
            word-break: break-all;
        }
        .cloud-scroll,
        .cloud-column {
            max-height: 360px;
            overflow: auto;
            padding-right: 4px;
        }
        .cloud-panel-shell {
            min-height: 320px;
            padding: 14px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 16px;
            background:
                linear-gradient(180deg, rgba(6, 14, 30, 0.9), rgba(4, 10, 22, 0.92)),
                radial-gradient(circle at top right, rgba(102, 243, 255, 0.05), transparent 30%);
            box-shadow: inset 0 0 0 1px rgba(102, 243, 255, 0.03);
        }
        .cloud-panel-shell-guest {
            min-height: 0;
            max-height: none;
            overflow: visible;
            padding: 0;
            border: none;
            background: transparent;
            box-shadow: none;
        }
        .cloud-scroll {
            max-height: 270px;
            padding-right: 6px;
        }
        .cloud-member-row,
        .cloud-board-row {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 14px;
            margin: 0 0 10px;
            padding: 14px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 14px;
            background: linear-gradient(180deg, rgba(7, 16, 35, 0.94), rgba(4, 10, 22, 0.9));
            transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.18s ease, background 0.18s ease;
        }
        .cloud-member-row:hover,
        .cloud-board-row:hover {
            transform: translateY(-1px);
            border-color: rgba(102, 243, 255, 0.28);
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.24);
        }
        .cloud-board-row.is-active {
            border-color: rgba(102, 243, 255, 0.34);
            background: linear-gradient(180deg, rgba(12, 26, 50, 0.96), rgba(5, 13, 28, 0.94));
        }
        .cloud-board-row-local {
            background: linear-gradient(180deg, rgba(8, 18, 38, 0.92), rgba(4, 10, 22, 0.9));
        }
        .cloud-local-badge {
            align-self: center;
            padding: 7px 11px;
            border: 1px solid rgba(102, 243, 255, 0.18);
            border-radius: 999px;
            background: rgba(102, 243, 255, 0.08);
            color: var(--accent-cyan);
            font-size: 0.66rem;
            letter-spacing: 1.2px;
            text-transform: uppercase;
            white-space: nowrap;
        }
        .cloud-row-main {
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 6px;
            flex: 1 1 auto;
        }
        .cloud-row-title {
            color: var(--text-light);
            font-size: 1.02rem;
            font-weight: 700;
            white-space: normal;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .cloud-row-title-wrap {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        .cloud-connected-pill {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 28px;
            padding: 5px 10px;
            border: 1px solid rgba(102, 243, 255, 0.26);
            border-radius: 999px;
            background: rgba(102, 243, 255, 0.08);
            color: var(--accent-cyan);
            font-size: 0.62rem;
            letter-spacing: 1.1px;
            text-transform: uppercase;
            transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
        }
        .cloud-connected-pill-hover {
            display: none;
        }
        .cloud-connected-pill:hover {
            border-color: rgba(255, 154, 167, 0.34);
            background: rgba(255, 154, 167, 0.1);
            color: #ffb4bf;
        }
        .cloud-connected-pill:hover .cloud-connected-pill-label {
            display: none;
        }
        .cloud-connected-pill:hover .cloud-connected-pill-hover {
            display: inline;
        }
        .cloud-local-connected-note {
            margin-bottom: 12px;
            color: var(--text-muted);
            font-size: 0.8rem;
            line-height: 1.5;
        }
        .cloud-local-session-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
        }
        .cloud-manage-footer {
            display: flex;
            justify-content: flex-start;
            gap: 10px;
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid rgba(102, 243, 255, 0.12);
        }
        .cloud-row-sub {
            color: #8b9bb4;
            font-size: 0.68rem;
            letter-spacing: 1.4px;
            text-transform: uppercase;
        }
        .cloud-member-status {
            margin-top: 2px;
            color: #7e95b0;
            font-size: 0.72rem;
            line-height: 1.35;
        }
        .cloud-member-status.is-online {
            color: #9df5b8;
        }
        .cloud-member-status.is-offline {
            color: #ff9aa7;
        }
        .cloud-row-actions {
            display: flex;
            flex-wrap: wrap;
            justify-content: flex-end;
            gap: 6px;
            flex-shrink: 0;
            align-items: center;
        }
        .cloud-home-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding-right: 42px;
            padding-bottom: 6px;
        }
        .cloud-home-heading {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
        }
        .cloud-home-kicker {
            color: #7ec8d5;
            font-size: 0.68rem;
            letter-spacing: 1.8px;
            text-transform: uppercase;
        }
        .cloud-home-title {
            color: #effbff;
            font-size: 1.34rem;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }
        .cloud-home-tab-group {
            display: flex;
            align-items: center;
            gap: 6px;
            min-width: 0;
            padding: 5px;
            border: 1px solid rgba(102, 243, 255, 0.16);
            border-radius: 999px;
            background: rgba(4, 11, 26, 0.8);
            box-shadow: inset 0 0 0 1px rgba(102, 243, 255, 0.04);
        }
        .cloud-home-tab {
            min-width: 96px;
            min-height: 38px;
            padding: 0 14px;
            cursor: pointer;
            opacity: 0.72;
            transition: opacity 0.2s ease, transform 0.2s ease, color 0.2s ease, background 0.2s ease, border-color 0.2s ease;
            clip-path: none;
            border-radius: 999px;
            border: 1px solid transparent;
            background: transparent;
            color: #8fb6c7;
            font-size: 0.82rem;
            letter-spacing: 1.6px;
            text-transform: uppercase;
        }
        .cloud-home-tab:hover {
            opacity: 0.96;
            transform: translateY(-1px);
        }
        .cloud-home-tab.is-active {
            opacity: 1;
            color: #031018;
            background: linear-gradient(90deg, rgba(97, 247, 255, 0.94), rgba(72, 207, 226, 0.92));
            border-color: rgba(102, 243, 255, 0.4);
            box-shadow: 0 0 18px rgba(102, 243, 255, 0.12);
        }
        .cloud-home-tab.cloud-home-tab-alt.is-active {
            background: linear-gradient(90deg, rgba(120, 226, 231, 0.92), rgba(86, 187, 194, 0.9));
        }
        .cloud-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px;
        }
        .cloud-status-bar {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            margin-top: 0;
            color: #9bb0c7;
            font-size: 0.72rem;
            flex-wrap: wrap;
        }
        .cloud-status-pill {
            display: inline-flex;
            align-items: center;
            min-height: 32px;
            padding: 7px 11px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 999px;
            background: rgba(4, 11, 26, 0.78);
        }
        .cloud-status-active {
            color: var(--accent-cyan);
            border-color: rgba(102, 243, 255, 0.24);
        }
        .cloud-local-hint,
        .cloud-local-note {
            margin-top: 8px;
            padding: 10px 12px;
            border-radius: 10px;
            border: 1px dashed rgba(102, 243, 255, 0.14);
            background: rgba(3, 10, 24, 0.6);
            color: #8faac8;
            font-size: 0.74rem;
            line-height: 1.45;
        }
        .cloud-local-note {
            border-color: rgba(255, 204, 138, 0.18);
            color: #ffd8a4;
            margin-top: 0;
            margin-bottom: 8px;
        }
        .cloud-local-panel {
            margin-top: 10px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .cloud-local-action-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
        }
        .cloud-local-action-shell {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .cloud-local-action-card {
            width: 100%;
            min-height: 92px;
            align-items: flex-start;
            text-align: left;
            padding: 16px 18px;
        }
        .cloud-local-action-card .data-hub-card-meta {
            max-width: 32ch;
            text-align: left;
            line-height: 1.45;
        }
        .cloud-local-action-shell.is-open .cloud-local-action-card {
            border-color: rgba(102, 243, 255, 0.48);
            box-shadow: 0 0 20px rgba(102, 243, 255, 0.08);
        }
        .cloud-local-choice-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
        }
        .cloud-local-choice-grid[hidden] {
            display: none !important;
        }
        .cloud-local-choice {
            min-height: 58px;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            justify-content: center;
            gap: 4px;
            padding: 10px 12px;
            border: 1px solid rgba(102, 243, 255, 0.16);
            border-radius: 12px;
            background: rgba(5, 12, 28, 0.86);
            text-align: left;
            clip-path: none;
            transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
        }
        .cloud-local-choice:hover {
            border-color: rgba(102, 243, 255, 0.38);
            background: rgba(10, 22, 44, 0.9);
            transform: translateY(-1px);
        }
        .cloud-local-choice-title {
            color: #bdf7ff;
            font-size: 0.72rem;
            letter-spacing: 1.4px;
            text-transform: uppercase;
        }
        .cloud-local-choice-meta {
            color: #88a3be;
            font-size: 0.64rem;
            letter-spacing: 1.1px;
            text-transform: uppercase;
        }
        .cloud-local-action-grid > .data-hub-card-danger {
            min-height: 92px;
        }
        .cloud-guest-panel {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .cloud-guest-layout {
            display: grid;
            grid-template-columns: minmax(250px, 0.9fr) minmax(320px, 1.1fr);
            gap: 12px;
            align-items: stretch;
        }
        .cloud-guest-hero {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 18px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 16px;
            background:
                linear-gradient(180deg, rgba(7, 16, 35, 0.94), rgba(4, 10, 22, 0.9)),
                radial-gradient(circle at top left, rgba(102, 243, 255, 0.08), transparent 54%);
        }
        .cloud-guest-kicker {
            color: #7ec8d5;
            font-size: 0.66rem;
            letter-spacing: 1.8px;
            text-transform: uppercase;
        }
        .cloud-guest-title {
            color: #effbff;
            font-size: 1.18rem;
            font-weight: 700;
            letter-spacing: 0.03em;
            text-transform: uppercase;
        }
        .cloud-guest-copy {
            color: #9fb8d2;
            font-size: 0.8rem;
            line-height: 1.5;
        }
        .cloud-guest-pills {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: auto;
        }
        .cloud-guest-pill {
            display: inline-flex;
            align-items: center;
            min-height: 30px;
            padding: 6px 10px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 999px;
            background: rgba(4, 11, 26, 0.72);
            color: #9fd8e1;
            font-size: 0.7rem;
            letter-spacing: 1px;
            text-transform: uppercase;
        }
        .cloud-board-row .mini-btn,
        .cloud-member-row .mini-btn,
        .cloud-manage-shell .mini-btn {
            min-height: 34px;
            padding: 7px 11px;
            border-radius: 10px;
            clip-path: none;
            font-size: 0.74rem;
            letter-spacing: 1.1px;
        }
        .cloud-open-board {
            border-color: rgba(102, 243, 255, 0.28);
            background: rgba(102, 243, 255, 0.12);
            color: #bdf7ff;
        }
        .cloud-manage-board {
            border-color: rgba(255, 204, 138, 0.22);
            background: rgba(255, 204, 138, 0.1);
            color: #ffd8a4;
        }
        .cloud-leave-board,
        #cloud-delete-board {
            border-color: rgba(255, 120, 150, 0.22);
            background: rgba(255, 120, 150, 0.1);
            color: #ffb0c3;
        }
        #cloudModalSyncInfo[data-state="saving"],
        #cloudModalSyncInfo[data-state="pending"] {
            color: #ffcc8a;
        }
        #cloudModalSyncInfo[data-state="merged"] {
            color: #9df5b8;
        }
        #cloudModalSyncInfo[data-state="error"] {
            color: #ff9aa7;
        }
        .cloud-modal-presence {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 10px;
        }
        .cloud-modal-presence .cloud-presence-pill {
            min-width: 180px;
            flex: 1 1 180px;
        }
        .cloud-board-log {
            margin-top: 12px;
            padding: 12px;
            border: 1px solid rgba(102, 243, 255, 0.14);
            border-radius: 12px;
            background: rgba(3, 10, 24, 0.78);
        }
        .cloud-board-log-home {
            margin-top: 14px;
        }
        .cloud-board-log-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid rgba(102, 243, 255, 0.12);
            color: #9db3cd;
            font-size: 0.74rem;
            letter-spacing: 1.6px;
            text-transform: uppercase;
        }
        .cloud-board-log-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 220px;
            overflow: auto;
            padding-right: 4px;
        }
        .cloud-board-log-row {
            width: 100%;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 8px 10px;
            border: 1px solid rgba(102, 243, 255, 0.08);
            border-radius: 8px;
            background: rgba(2, 8, 18, 0.82);
            text-align: left;
            font-family: var(--font-main);
            box-shadow: none;
        }
        .cloud-board-log-row.is-clickable {
            appearance: none;
            cursor: pointer;
            transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
        }
        .cloud-board-log-row.is-clickable:hover {
            border-color: rgba(102, 243, 255, 0.28);
            background: rgba(7, 18, 36, 0.92);
            transform: translateY(-1px);
        }
        .cloud-board-log-row.is-clickable:focus-visible {
            outline: 1px solid rgba(102, 243, 255, 0.42);
            outline-offset: 1px;
        }
        .cloud-board-log-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        .cloud-board-log-actor {
            color: var(--text-light);
            font-size: 0.76rem;
            letter-spacing: 1.1px;
            text-transform: uppercase;
        }
        .cloud-board-log-time {
            color: #7d95b0;
            font-size: 0.7rem;
            letter-spacing: 1px;
            text-transform: uppercase;
        }
        .cloud-board-log-text {
            color: #a9bdd4;
            font-size: 0.8rem;
            line-height: 1.45;
        }
        .cloud-board-log-summary {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 10px;
        }
        .cloud-board-log-summary span {
            padding: 6px 10px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 999px;
            background: rgba(8, 17, 34, 0.72);
            color: #8ca9c9;
            font-size: 0.7rem;
            letter-spacing: 1.1px;
            text-transform: uppercase;
        }
        .cloud-board-log-list-detail {
            max-height: 280px;
        }
        .cloud-board-log-empty {
            color: #7388a4;
            font-size: 0.76rem;
            line-height: 1.45;
            padding: 2px 0;
        }

        .data-hub {
            display: flex;
            flex-direction: column;
            gap: 14px;
        }
        .data-hub-head {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .data-hub-section {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 12px;
            border-radius: 14px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            background: rgba(4, 10, 24, 0.64);
        }
        .data-hub-section-local {
            border-color: rgba(102, 243, 255, 0.22);
            background:
                linear-gradient(180deg, rgba(8, 20, 40, 0.9), rgba(3, 10, 22, 0.82)),
                radial-gradient(circle at top left, rgba(102, 243, 255, 0.1), transparent 56%);
            clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%);
        }
        .data-hub-section-cloud {
            border-color: rgba(255, 199, 122, 0.24);
            background:
                linear-gradient(180deg, rgba(36, 26, 10, 0.9), rgba(17, 12, 6, 0.86)),
                radial-gradient(circle at top right, rgba(255, 199, 122, 0.1), transparent 52%);
            clip-path: polygon(14px 0, 100% 0, 100% 100%, calc(100% - 14px) 100%, 0 calc(100% - 14px), 0 0);
        }
        .data-hub-section-danger {
            border-color: rgba(255, 107, 129, 0.22);
            background:
                linear-gradient(180deg, rgba(42, 12, 20, 0.88), rgba(22, 7, 12, 0.88)),
                radial-gradient(circle at center, rgba(255, 107, 129, 0.08), transparent 58%);
        }
        .data-hub-kicker {
            color: #8ea9c6;
            font-size: 0.72rem;
            letter-spacing: 2.4px;
            text-transform: uppercase;
        }
        .data-hub-section-local .data-hub-kicker {
            color: var(--accent-cyan);
        }
        .data-hub-section-cloud .data-hub-kicker {
            color: #ffcc8a;
        }
        .data-hub-section-danger .data-hub-kicker {
            color: #ff9aa7;
        }
        .data-hub-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
        }
        .data-hub-card {
            width: 100%;
            min-height: 72px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 4px;
            padding: 12px 14px;
            text-align: center;
            border-radius: 12px;
            border: 1px solid rgba(102, 243, 255, 0.16);
            background: linear-gradient(180deg, rgba(7, 18, 38, 0.94), rgba(4, 10, 22, 0.9));
            box-shadow: inset 0 0 0 1px rgba(102, 243, 255, 0.04);
        }
        .data-hub-card:hover {
            border-color: rgba(102, 243, 255, 0.42);
            background: linear-gradient(180deg, rgba(14, 31, 56, 0.96), rgba(6, 14, 28, 0.92));
        }
        .data-hub-card-local {
            border-color: rgba(102, 243, 255, 0.22);
            background: linear-gradient(180deg, rgba(10, 24, 48, 0.96), rgba(4, 10, 22, 0.92));
            clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%);
        }
        .data-hub-card-local:hover {
            border-color: rgba(102, 243, 255, 0.5);
            background: linear-gradient(180deg, rgba(18, 40, 66, 0.98), rgba(6, 14, 28, 0.94));
        }
        .data-hub-card-cloud {
            border-color: rgba(255, 199, 122, 0.3);
            background: linear-gradient(180deg, rgba(50, 36, 12, 0.96), rgba(20, 14, 6, 0.92));
            clip-path: polygon(12px 0, 100% 0, 100% 100%, 0 100%, 0 12px);
        }
        .data-hub-card-cloud:hover {
            border-color: rgba(255, 199, 122, 0.56);
            background: linear-gradient(180deg, rgba(74, 52, 16, 0.98), rgba(28, 20, 8, 0.94));
        }
        .data-hub-card-danger {
            border-color: rgba(255, 107, 129, 0.28);
            background: linear-gradient(180deg, rgba(54, 14, 26, 0.9), rgba(28, 8, 14, 0.92));
            clip-path: polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%);
        }
        .data-hub-card-danger:hover {
            border-color: rgba(255, 107, 129, 0.54);
            background: linear-gradient(180deg, rgba(78, 20, 34, 0.94), rgba(38, 10, 18, 0.94));
        }
        .data-hub-card-title {
            color: var(--text-light);
            font-size: 0.82rem;
            letter-spacing: 1.8px;
            text-transform: uppercase;
        }
        .data-hub-card-local .data-hub-card-title {
            color: #8cf4ff;
        }
        .data-hub-card-cloud .data-hub-card-title {
            color: #ffd7a1;
        }
        .data-hub-card-danger .data-hub-card-title {
            color: #ffb1bb;
        }
        .data-hub-card-meta {
            color: #89a0bb;
            font-size: 0.68rem;
            letter-spacing: 1.4px;
            text-transform: uppercase;
        }
        .data-hub-status {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 12px 14px;
            border: 1px dashed rgba(102, 243, 255, 0.18);
            border-radius: 10px;
            background: rgba(3, 10, 24, 0.66);
            color: #90a7c3;
            font-size: 0.74rem;
            letter-spacing: 1px;
            text-transform: uppercase;
            flex-wrap: wrap;
        }
        .data-hub-status strong {
            color: var(--text-light);
            font-weight: 600;
            letter-spacing: 1px;
            text-transform: uppercase;
        }
        .intel-toolbar {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 10px;
        }
        .intel-toolbar-row {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .intel-toolbar-row-actions {
            flex-wrap: wrap;
        }
        .intel-toolbar-label {
            min-width: 58px;
            color: #8ea9c6;
            font-size: 0.72rem;
            letter-spacing: 1.5px;
            text-transform: uppercase;
        }
        .intel-preset-group {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }
        .intel-preset-btn {
            min-width: 94px;
        }
        .intel-simple-toggle {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            color: var(--text-muted);
            font-size: 0.74rem;
            letter-spacing: 1px;
            text-transform: uppercase;
        }
        .intel-simple-toggle input {
            accent-color: var(--accent-cyan);
        }
        .intel-advanced {
            margin: 4px 0 10px;
            border: 1px solid rgba(102, 243, 255, 0.1);
            border-radius: 10px;
            background: rgba(3, 10, 24, 0.52);
        }
        .intel-advanced summary {
            cursor: pointer;
            padding: 10px 12px;
            color: #9bb0c7;
            font-size: 0.74rem;
            letter-spacing: 1.6px;
            text-transform: uppercase;
            user-select: none;
        }
        .intel-advanced[open] summary {
            border-bottom: 1px solid rgba(102, 243, 255, 0.1);
        }
        .intel-advanced .intel-controls {
            padding: 10px 12px 12px;
        }
        .intel-limit-input {
            width: 76px;
        }
        .intel-results {
            margin-top: 0;
            overflow-y: auto;
            padding-right: 4px;
            border-top: 1px solid rgba(102, 243, 255, 0.08);
            padding-top: 10px;
        }
        .intel-empty-state {
            padding: 12px;
            text-align: center;
            color: var(--text-faded);
            font-size: 0.82rem;
        }
        .intel-item {
            padding: 10px;
            margin-bottom: 10px;
            cursor: pointer;
            transition: border-color 0.2s, background 0.2s, transform 0.2s;
        }
        .intel-item:hover {
            border-color: rgba(102, 243, 255, 0.3);
            background: rgba(8, 19, 39, 0.84);
            transform: translateY(-1px);
        }
        .intel-card-top {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 8px;
        }
        .intel-badges {
            display: flex;
            flex-wrap: wrap;
            justify-content: flex-end;
            gap: 4px;
        }
        .intel-name-pair {
            display: block;
            line-height: 1.35;
        }
        .intel-cta {
            flex-wrap: wrap;
            margin-top: 8px;
        }
        .intel-kind {
            min-width: 180px;
            flex: 1 1 190px;
        }
        .intel-connect-btn {
            min-width: 132px;
        }

        .settings-hero {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 12px;
        }
        .settings-hero-title {
            color: var(--text-light);
            font-size: 0.78rem;
            font-weight: 700;
            letter-spacing: 1.7px;
            text-transform: uppercase;
        }
        .settings-hero-sub {
            color: #8aa4bc;
            font-size: 0.7rem;
            line-height: 1.45;
        }
        .settings-quick-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
            margin-bottom: 16px;
        }
        .settings-mode-card,
        .settings-quick-card {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            justify-content: flex-start;
            gap: 10px;
            padding: 12px;
            border: 1px solid rgba(102, 243, 255, 0.18);
            border-radius: 12px;
            background: rgba(3, 10, 24, 0.72);
        }
        .settings-mode-label {
            display: flex;
            align-items: center;
            gap: 10px;
            color: var(--text-light);
            font-weight: 700;
        }
        .settings-quick-card {
            gap: 8px;
        }
        .settings-quick-label {
            color: #9eb8d4;
            font-size: 0.68rem;
            letter-spacing: 1.4px;
            text-transform: uppercase;
        }
        .settings-quick-value {
            color: var(--accent-cyan);
            font-size: 1.12rem;
            line-height: 1;
            font-weight: 800;
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }
        .settings-quick-help {
            color: #6f8ea6;
            font-size: 0.64rem;
            letter-spacing: 1.1px;
            text-transform: uppercase;
        }
        .settings-mode-icon {
            width: 22px;
            height: 22px;
            fill: currentColor;
            color: var(--accent-cyan);
            flex: 0 0 auto;
        }
        .settings-preset-shell {
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-bottom: 18px;
            padding: 14px;
            border: 1px solid rgba(102, 243, 255, 0.16);
            border-radius: 14px;
            background: linear-gradient(180deg, rgba(3, 10, 24, 0.82), rgba(4, 11, 26, 0.68));
            box-shadow: inset 0 0 0 1px rgba(102, 243, 255, 0.04);
        }
        .settings-preset-head {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .settings-preset-title {
            color: var(--text-light);
            font-size: 0.72rem;
            font-weight: 700;
            letter-spacing: 1.8px;
            text-transform: uppercase;
        }
        .settings-preset-sub {
            color: #88a2bc;
            font-size: 0.68rem;
            line-height: 1.45;
        }
        .settings-preset-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 8px;
        }
        .settings-preset-btn {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 6px;
            padding: 10px 11px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 10px;
            background: rgba(6, 14, 30, 0.88);
            color: var(--text-main);
            cursor: pointer;
            text-align: left;
            font-family: var(--font-main);
            min-height: 80px;
            clip-path: none;
            transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, transform 0.16s ease;
        }
        .settings-preset-btn::after {
            display: none;
        }
        .settings-preset-btn:hover {
            transform: translateY(-1px);
            border-color: rgba(102, 243, 255, 0.24);
            background: rgba(8, 18, 38, 0.96);
        }
        .settings-preset-btn.active {
            border-color: rgba(102, 243, 255, 0.42);
            background: rgba(102, 243, 255, 0.12);
            box-shadow: 0 0 14px rgba(102, 243, 255, 0.12);
        }
        .settings-preset-name {
            color: var(--text-light);
            font-size: 0.7rem;
            font-weight: 700;
            letter-spacing: 1.3px;
            text-transform: uppercase;
        }
        .settings-preset-hint-inline {
            color: #8aa4bc;
            font-size: 0.64rem;
            line-height: 1.45;
        }
        .settings-preset-hint {
            min-height: 20px;
            padding: 10px 12px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 10px;
            background: rgba(3, 10, 24, 0.72);
            color: #b4d9ea;
            font-size: 0.72rem;
            line-height: 1.45;
        }
        .settings-section-break {
            margin-top: 20px;
            padding-top: 12px;
            border-top: 1px solid rgba(102, 243, 255, 0.12);
        }
        .settings-advanced-shell {
            margin: 0;
            border: 1px solid rgba(102, 243, 255, 0.14);
            border-radius: 14px;
            background: rgba(3, 10, 24, 0.6);
            overflow: hidden;
        }
        .settings-advanced-toggle {
            list-style: none;
            cursor: pointer;
            padding: 12px 14px;
            color: var(--text-light);
            font-size: 0.74rem;
            font-weight: 700;
            letter-spacing: 1.7px;
            text-transform: uppercase;
            user-select: none;
        }
        .settings-advanced-toggle::-webkit-details-marker {
            display: none;
        }
        .settings-advanced-toggle::after {
            content: '▾';
            float: right;
            color: #8aa4bc;
            transition: transform 0.18s ease;
        }
        .settings-advanced-shell[open] .settings-advanced-toggle::after {
            transform: rotate(180deg);
        }
        .settings-advanced-body {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px 12px;
            padding: 0 14px 14px;
            border-top: 1px solid rgba(102, 243, 255, 0.1);
        }
        .settings-advanced-body .setting-row {
            margin-bottom: 0;
            padding-top: 10px;
        }
        .settings-reset-btn {
            width: 100%;
        }

        .pf-card {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 12px;
            border: 1px dashed rgba(102, 243, 255, 0.28);
            border-radius: 8px;
            background: linear-gradient(180deg, rgba(4, 11, 26, 0.88), rgba(3, 8, 20, 0.76));
            box-shadow: inset 0 0 0 1px rgba(102, 243, 255, 0.04);
        }
        .pf-card-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid rgba(102, 243, 255, 0.14);
        }
        .pf-card-kicker {
            color: #a9bfd8;
            font-size: 0.74rem;
            letter-spacing: 2px;
            text-transform: uppercase;
            font-weight: 700;
        }
        .pf-card-led {
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: rgba(255, 136, 136, 0.95);
            box-shadow: 0 0 12px rgba(255, 107, 129, 0.42);
            flex: 0 0 auto;
        }
        .pf-card-led.is-active {
            background: rgba(102, 243, 255, 0.96);
            box-shadow: 0 0 12px rgba(102, 243, 255, 0.5);
        }
        .pf-node-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 8px;
        }
        .pf-node-box {
            display: flex;
            flex-direction: column;
            gap: 3px;
            min-height: 44px;
            padding: 8px 10px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 8px;
            background: rgba(2, 8, 20, 0.72);
        }
        .pf-node-box-active {
            border-color: rgba(102, 243, 255, 0.34);
            background: rgba(102, 243, 255, 0.08);
        }
        .pf-node-box-target {
            border-color: rgba(255, 107, 129, 0.34);
            background: rgba(255, 107, 129, 0.06);
        }
        .pf-node-label {
            font-size: 0.68rem;
            letter-spacing: 1.6px;
            text-transform: uppercase;
            color: #86a7c8;
        }
        .pf-node-value {
            font-size: 0.92rem;
            line-height: 1.2;
            font-weight: 600;
            color: var(--text-light);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .pf-status-wrap {
            min-height: 46px;
            display: flex;
            align-items: center;
        }
        .pf-status {
            width: 100%;
            padding: 10px 12px;
            border-radius: 8px;
            text-align: center;
            font-size: 0.78rem;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            border: 1px solid rgba(102, 243, 255, 0.14);
            background: rgba(3, 9, 22, 0.82);
        }
        .pf-status-active {
            color: var(--accent-cyan);
            border-color: rgba(102, 243, 255, 0.34);
            background: rgba(102, 243, 255, 0.08);
        }
        .pf-status-idle {
            color: var(--text-faded);
        }
        .pf-action-btn {
            width: 100%;
        }
        .pf-action-btn-alt {
            border-color: rgba(255, 107, 129, 0.74);
            color: #ff9aa7;
            background: linear-gradient(90deg, rgba(66, 16, 30, 0.78), rgba(35, 10, 18, 0.88));
        }
        .pf-cancel-btn {
            width: 100%;
            min-height: 38px;
            background: rgba(4, 10, 22, 0.92);
            border-color: rgba(102, 243, 255, 0.2);
            color: var(--text-muted);
            font-size: 0.74rem;
        }
        .pf-empty-card {
            min-height: 84px;
            border: 1px dashed rgba(102, 243, 255, 0.22);
            border-radius: 8px;
            background: rgba(3, 9, 22, 0.76);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            color: var(--text-faded);
            font-style: italic;
        }
        .pf-empty-icon {
            font-family: var(--font-code);
            font-size: 1.3rem;
            color: #7e93ae;
            opacity: 0.7;
        }
        .pf-empty-text {
            font-size: 0.86rem;
        }

        .mini-btn {
            min-height: 36px;
            font-size: 0.74rem;
            line-height: 1.15;
            letter-spacing: 1.5px;
            background: rgba(8, 18, 36, 0.92);
            border: 1px solid rgba(102, 243, 255, 0.16);
            color: var(--text-main);
            box-shadow: none;
        }
        .mini-btn:hover {
            background: rgba(102, 243, 255, 0.1);
            border-color: rgba(102, 243, 255, 0.38);
            color: var(--accent-cyan);
        }
        .mini-btn.primary {
            background: linear-gradient(90deg, rgba(20, 47, 63, 0.72), rgba(12, 23, 40, 0.88));
            border-color: rgba(102, 243, 255, 0.58);
            color: var(--accent-cyan);
        }

        .editor-panel-layout {
            position: relative;
            min-width: 0;
            min-height: var(--editor-rail-height, min(calc(100vh - 28px), 88vh));
            padding-left: calc(var(--editor-action-rail-width, 74px) + var(--editor-action-rail-gap, 12px));
            pointer-events: none;
        }
        .editor-side-rail {
            position: absolute;
            top: 0;
            left: 0;
            width: var(--editor-action-rail-width, 74px);
            height: var(--editor-rail-height, min(calc(100vh - 28px), 88vh));
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            gap: 12px;
            align-self: stretch;
            background: transparent;
            pointer-events: none;
        }
        .editor-side-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
            pointer-events: none;
        }
        .editor-side-group-bottom {
            margin-top: auto;
            position: relative;
            padding-top: 10px;
        }
        .editor-side-group .mini-btn {
            width: 100%;
            pointer-events: auto;
            min-height: 44px;
            padding: 10px 7px;
            font-size: 0.66rem;
            line-height: 1.15;
            font-family: var(--font-main);
            letter-spacing: 1.15px;
            text-transform: uppercase;
            background: linear-gradient(90deg, rgba(16, 34, 52, 0.9), rgba(8, 17, 30, 0.92));
            color: var(--accent-cyan);
            border: 1px solid rgba(102, 243, 255, 0.18);
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.26);
        }
        .editor-side-group .mini-btn.danger {
            color: #ff9aa7;
            border-color: rgba(255, 154, 167, 0.26);
            background: linear-gradient(90deg, rgba(49, 12, 24, 0.92), rgba(28, 7, 16, 0.94));
        }
        .editor-main-card {
            min-width: 0;
            width: 100%;
            height: var(--editor-rail-height, min(calc(100vh - 28px), 88vh));
            pointer-events: auto;
            max-height: var(--editor-rail-height, min(calc(100vh - 28px), 88vh));
            padding: 12px 12px 14px;
            border: 1px solid rgba(102, 243, 255, 0.14);
            border-radius: 14px;
            background: linear-gradient(180deg, rgba(5, 12, 28, 0.92), rgba(3, 9, 22, 0.84));
            box-shadow: inset 0 0 0 1px rgba(102, 243, 255, 0.04);
            overflow-x: hidden;
            overflow-y: auto;
            scrollbar-width: thin;
            scrollbar-color: rgba(102, 243, 255, 0.3) transparent;
        }
        .editor-main-card::-webkit-scrollbar {
            width: 5px;
        }
        .editor-main-card::-webkit-scrollbar-track {
            background: transparent;
        }
        .editor-main-card::-webkit-scrollbar-thumb {
            background: rgba(102, 243, 255, 0.22);
            border-radius: 999px;
        }
        #editorBody {
            pointer-events: none;
        }
        .editor-main-card *,
        .editor-side-group .mini-btn,
        .editor-side-popover,
        .editor-side-popover *,
        .editor-autocomplete-results,
        .editor-autocomplete-results * {
            pointer-events: auto;
        }
        .editor-sheet {
            display: flex;
            flex-direction: column;
            gap: 10px;
            color: var(--text-main);
        }
        .editor-sheet-head {
            cursor: grab;
            user-select: none;
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 6px;
            margin: -12px -12px 0;
            padding: 10px 14px 9px;
            border-bottom: 1px solid rgba(102, 243, 255, 0.18);
            background: linear-gradient(90deg, rgba(102, 243, 255, 0.16), rgba(7, 18, 39, 0.96) 28%, rgba(3, 9, 24, 0.98));
            box-shadow: inset 0 1px 0 rgba(140, 250, 255, 0.08);
        }
        #editor.dragging .editor-sheet-head {
            cursor: grabbing;
        }
        .editor-sheet-head input,
        .editor-sheet-head textarea {
            cursor: text;
            user-select: text;
        }
        .editor-sheet-head button,
        .editor-sheet-head select,
        .editor-sheet-head label,
        .editor-sheet-head a {
            cursor: pointer;
        }
        .editor-sheet-head-main {
            display: flex;
            align-items: center;
            min-width: 0;
            width: 100%;
        }
        .editor-sheet-identity-row {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            gap: 10px;
            width: 100%;
            min-width: 0;
            flex-wrap: nowrap;
        }
        .editor-sheet-title-block {
            min-width: 0;
            flex: 1 1 auto;
            display: flex;
            flex-direction: column;
            justify-content: center;
            min-height: 38px;
        }
        .editor-head-pills {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            flex: 0 0 auto;
        }
        .editor-sheet-name {
            font-family: var(--font-main);
            font-size: clamp(1.16rem, 1.55vw, 1.42rem);
            line-height: 1;
            color: var(--text-light);
            letter-spacing: 0.04em;
            text-transform: uppercase;
            white-space: normal;
            overflow-wrap: anywhere;
        }
        .editor-sheet-name-input {
            width: 100%;
            min-height: 38px;
            padding: 2px 0 1px;
            border: none;
            background: transparent;
            box-shadow: none;
            outline: none;
        }
        .editor-sheet-name-textarea {
            resize: none;
            overflow: hidden;
            text-overflow: clip;
        }
        .editor-sheet-name-input::placeholder {
            color: #6c84a0;
        }
        .editor-toolbar {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 10px;
            flex-wrap: wrap;
        }
        .editor-toolbar-group {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
            min-width: 0;
        }
        .editor-toolbar-group-danger {
            justify-content: flex-end;
            margin-left: auto;
        }
        .editor-toolbar .mini-btn {
            min-height: 38px;
            padding: 8px 12px;
            font-size: 0.64rem;
            letter-spacing: 1.35px;
        }
        .editor-action-merge {
            min-width: 118px;
        }
        .editor-side-group .editor-action-merge {
            min-width: 0;
            font-size: 0.6rem;
            letter-spacing: 1px;
        }
        .editor-sheet-topbar {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: start;
            gap: 8px;
            padding-top: 0;
        }
        .editor-sheet-topbar-meta-only {
            grid-template-columns: 1fr;
        }
        .editor-type-select,
        .editor-inline-phone,
        .editor-color-pill {
            min-height: 26px;
            border: 1px solid rgba(102, 243, 255, 0.2);
            border-radius: 999px;
            background: rgba(4, 11, 27, 0.88);
            box-shadow: inset 0 0 0 1px rgba(102, 243, 255, 0.04);
        }
        .editor-type-select {
            flex: 0 0 auto;
            width: auto;
            min-width: 92px;
            min-height: 32px;
            padding: 5px 22px 5px 10px;
            color: var(--accent-cyan);
            font-family: var(--font-main);
            font-size: 0.54rem;
            letter-spacing: 1px;
            text-transform: uppercase;
            cursor: pointer;
        }
        .editor-type-select:focus {
            outline: none;
            border-color: rgba(102, 243, 255, 0.38);
            box-shadow: 0 0 0 3px rgba(102, 243, 255, 0.08);
        }
        .editor-inline-phone,
        .editor-color-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 3px 7px;
        }
        .editor-inline-phone {
            flex: 0 0 auto;
            min-width: 0;
        }
        .editor-inline-phone-head {
            flex: 0 1 176px;
            min-width: 112px;
            max-width: 208px;
            margin-left: 0;
            min-height: 38px;
            padding: 0;
            border: none;
            background: transparent;
            box-shadow: none;
            align-self: center;
        }
        .editor-inline-label {
            color: #7f9ab7;
            font-size: 0.56rem;
            letter-spacing: 1.2px;
            text-transform: uppercase;
            white-space: nowrap;
        }
        .editor-inline-phone-head .editor-inline-label,
        .editor-color-pill-head .editor-inline-label {
            display: none;
        }
        .editor-inline-phone input {
            min-width: 0;
            width: 100%;
            min-height: 38px;
            height: 38px;
            border: none;
            background: transparent;
            color: var(--text-light);
            font-family: var(--font-main);
            font-size: clamp(1.12rem, 1.5vw, 1.34rem);
            line-height: 38px;
            padding: 0 0 1px;
            box-shadow: none;
            outline: none;
            text-align: right;
            letter-spacing: 0.04em;
        }
        .editor-inline-phone input::placeholder {
            color: #637996;
        }
        .editor-status-inline {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            flex-wrap: wrap;
            min-width: 0;
        }
        .editor-status-inline-meta {
            margin-left: 0;
            justify-content: flex-end;
            gap: 6px;
        }
        .editor-color-pill {
            margin-left: 0;
            flex: 0 0 auto;
        }
        .editor-color-pill-head {
            margin-left: 0;
            width: 28px;
            min-width: 28px;
            min-height: 28px;
            padding: 2px;
            justify-content: center;
            border-radius: 6px;
        }
        .editor-color-input-inline {
            width: 22px;
            min-width: 22px;
            height: 22px;
            padding: 0;
            border: none;
            background: transparent;
            cursor: pointer;
            border-radius: 4px;
            appearance: none;
            -webkit-appearance: none;
        }
        .editor-color-input-inline::-webkit-color-swatch-wrapper {
            padding: 0;
        }
        .editor-color-input-inline::-webkit-color-swatch {
            border: 1px solid rgba(255, 255, 255, 0.16);
            border-radius: 4px;
        }
        .editor-color-input-inline::-moz-color-swatch {
            border: 1px solid rgba(255, 255, 255, 0.16);
            border-radius: 4px;
        }
        .editor-color-input.editor-color-input-inline {
            width: 22px;
            min-width: 22px;
            max-width: 22px;
            height: 22px;
            min-height: 22px;
            max-height: 22px;
            line-height: 0;
            font-size: 0;
        }
        .editor-sheet-type {
            min-width: auto;
            padding: 5px 8px;
            border: 1px solid rgba(102, 243, 255, 0.32);
            background: rgba(102, 243, 255, 0.12);
            color: var(--accent-cyan);
            font-family: var(--font-main);
            font-size: 0.64rem;
            line-height: 1;
            letter-spacing: 1.4px;
            text-transform: uppercase;
            border-radius: 8px;
        }
        .editor-sheet-id {
            font-family: var(--font-code);
            font-size: 0.82rem;
            line-height: 1;
            color: #9fd8e1;
            letter-spacing: 0.12em;
        }
        .editor-sheet-status {
            padding: 5px 8px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 8px;
            font-size: 0.62rem;
            line-height: 1;
            letter-spacing: 1.2px;
            text-transform: uppercase;
            white-space: nowrap;
        }
        .editor-sheet-status.is-missing {
            border-color: rgba(244, 195, 90, 0.34);
            background: rgba(244, 195, 90, 0.12);
            color: #ffd777;
        }
        .editor-sheet-status.is-deceased {
            border-color: rgba(255, 120, 150, 0.34);
            background: rgba(255, 120, 150, 0.12);
            color: #ff9ab2;
        }
        .editor-priority-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
        }
        .editor-status-strip {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 8px 10px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 10px;
            background: rgba(4, 11, 27, 0.68);
        }
        .editor-status-label {
            color: #8ba4c0;
            letter-spacing: 1.3px;
            font-size: 0.62rem;
            text-transform: uppercase;
            white-space: nowrap;
        }
        .editor-status-actions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            flex-wrap: wrap;
        }
        .editor-status-btn {
            min-height: 26px;
            padding: 4px 9px;
            border: 1px solid rgba(102, 243, 255, 0.14);
            border-radius: 999px;
            background: rgba(2, 8, 20, 0.92);
            color: #9bb0c7;
            font-family: var(--font-main);
            font-size: 0.5rem;
            letter-spacing: 0.8px;
            text-transform: uppercase;
            clip-path: none;
            box-shadow: none;
        }
        .editor-side-popover {
            position: static;
            left: auto;
            top: auto;
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 10px;
            border: 1px solid rgba(102, 243, 255, 0.16);
            border-radius: 12px;
            background: linear-gradient(180deg, rgba(8, 18, 36, 0.96), rgba(4, 10, 22, 0.98));
            box-shadow: 0 16px 32px rgba(0, 0, 0, 0.34);
            z-index: 8;
        }
        .editor-side-popover[hidden] {
            display: none;
        }
        .editor-side-popover-title {
            color: #a8bed8;
            font-size: 0.64rem;
            letter-spacing: 1.4px;
            text-transform: uppercase;
        }
        .editor-side-popover .mini-btn {
            width: 100%;
        }
        .editor-merge-head {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .editor-merge-copy {
            color: #7f99b7;
            font-size: 0.72rem;
            line-height: 1.45;
        }
        .editor-merge-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 8px;
            align-items: center;
        }
        .editor-merge-row .mini-btn {
            min-width: 146px;
            width: auto;
        }
        .editor-status-btn:hover {
            border-color: rgba(102, 243, 255, 0.3);
            color: #e7f8ff;
            background: rgba(10, 22, 42, 0.92);
        }
        .editor-status-btn.active.is-active {
            border-color: rgba(102, 243, 255, 0.4);
            background: rgba(102, 243, 255, 0.12);
            color: var(--accent-cyan);
        }
        .editor-status-btn.active.is-missing {
            border-color: rgba(244, 195, 90, 0.36);
            background: rgba(244, 195, 90, 0.14);
            color: #ffd777;
        }
        .editor-status-btn.active.is-deceased {
            border-color: rgba(255, 120, 150, 0.36);
            background: rgba(255, 120, 150, 0.14);
            color: #ff9ab2;
        }
        .editor-quick-field {
            display: flex;
            flex-direction: column;
            gap: 5px;
            padding: 8px 10px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 10px;
            background: rgba(4, 11, 27, 0.72);
        }
        .editor-quick-field label {
            color: #8ba4c0;
            letter-spacing: 1.3px;
            font-size: 0.62rem;
            text-transform: uppercase;
        }
        .editor-quick-field input {
            min-height: 36px;
            border: 1px solid rgba(102, 243, 255, 0.16);
            border-radius: 8px;
            padding: 8px 10px;
            background: rgba(2, 8, 20, 0.92);
            color: var(--text-main);
            font-family: var(--font-main);
            font-size: 0.88rem;
            line-height: 1.2;
        }
        .editor-quick-field input:focus {
            outline: none;
            border-color: rgba(102, 243, 255, 0.38);
            box-shadow: 0 0 0 3px rgba(102, 243, 255, 0.08);
        }
        .editor-priority-field input {
            font-size: 0.9rem;
        }
        .editor-sheet-note {
            display: flex;
            flex-direction: column;
            gap: 6px;
            border-bottom: none;
            margin: 0;
        }
        .editor-section-label {
            color: #8ba4c0;
            letter-spacing: 1.3px;
            font-size: 0.62rem;
            text-transform: uppercase;
        }
        .editor-sheet-note textarea {
            min-height: 78px;
            border: 1px solid rgba(102, 243, 255, 0.16);
            border-radius: 8px;
            padding: 10px 11px;
            background: rgba(2, 8, 20, 0.92);
            color: var(--text-main);
            font-family: var(--font-main);
            font-size: 0.88rem;
            line-height: 1.4;
        }
        .editor-sheet-note textarea::placeholder {
            color: #637996;
            font-family: var(--font-main);
        }
        .editor-meta-strip {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
        }
        .editor-meta-pill {
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 10px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 9px;
            background: rgba(4, 11, 27, 0.68);
        }
        .editor-meta-pill span {
            color: #7f9ab7;
            font-size: 0.62rem;
            letter-spacing: 1.2px;
            text-transform: uppercase;
        }
        .editor-meta-pill input {
            min-height: 38px;
            border: 1px solid rgba(102, 243, 255, 0.14);
            border-radius: 8px;
            padding: 8px 10px;
            background: rgba(2, 8, 20, 0.92);
            color: var(--text-light);
            font-family: var(--font-main);
            font-size: 0.86rem;
            line-height: 1.2;
        }
        .editor-meta-pill input::placeholder {
            color: #637996;
        }
        .editor-meta-pill input:focus {
            outline: none;
            border-color: rgba(102, 243, 255, 0.34);
            box-shadow: 0 0 0 3px rgba(102, 243, 255, 0.08);
        }
        .editor-links-head {
            margin: 0;
            padding-top: 4px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            color: #a8bed8;
            font-size: 0.72rem;
            letter-spacing: 1.5px;
        }
        .editor-links-count {
            color: #89a6c5;
            font-size: 0.66rem;
            letter-spacing: 1.2px;
        }
        #chipsLinks {
            min-height: 96px;
            max-height: 248px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 10px;
            border: 1px dashed rgba(102, 243, 255, 0.22);
            border-radius: 10px;
            background: rgba(3, 10, 24, 0.74);
            padding: 10px;
            margin-bottom: 0;
        }
        .editor-link-strip {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 10px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 10px;
            background: rgba(4, 11, 27, 0.66);
        }
        .editor-inline-title {
            color: #a8bed8;
            font-size: 0.66rem;
            letter-spacing: 1.5px;
            text-transform: uppercase;
        }
        .editor-link-grid {
            display: grid;
            grid-template-columns: minmax(96px, 0.62fr) minmax(160px, 1.15fr) auto;
            gap: 8px;
            align-items: stretch;
        }
        .editor-link-target {
            grid-column: 1 / -1;
            min-width: 0;
        }
        .editor-link-kind-select {
            width: 100%;
            min-width: 0;
        }
        #btnAddLinkQuick {
            min-width: 112px;
        }
        .editor-link-hint {
            color: #7f99b7;
            font-size: 0.72rem;
            line-height: 1.45;
        }
        .link-group-section {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .link-group-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        .link-category {
            margin: 0;
            font-size: 0.64rem;
            color: #86a7c8;
            letter-spacing: 1.5px;
        }
        .link-group-count {
            color: #7f99b7;
            font-size: 0.6rem;
            letter-spacing: 1.1px;
        }
        .link-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
        }
        .chip {
            background: linear-gradient(90deg, rgba(8, 18, 36, 0.94), rgba(4, 10, 22, 0.86));
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-left-width: 1px;
            border-radius: 8px;
            padding: 10px 11px;
            margin-bottom: 0;
            min-height: 52px;
            clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
        }
        .chip:hover {
            background: linear-gradient(90deg, rgba(12, 24, 48, 0.96), rgba(6, 13, 27, 0.9));
        }
        .chip-content {
            flex-direction: column;
            align-items: flex-start;
            gap: 3px;
        }
        .chip-name {
            font-family: var(--font-main);
            font-size: 0.9rem;
            line-height: 1.18;
            color: var(--text-light);
            letter-spacing: 0.04em;
            white-space: normal;
            overflow-wrap: anywhere;
        }
        .chip-meta {
            width: 100%;
            margin-left: 0;
            display: flex;
            justify-content: flex-start;
        }
        .chip-badge {
            display: inline-flex;
            align-items: center;
            max-width: 100%;
            padding: 2px 6px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.04);
            font-size: 0.56rem;
            line-height: 1;
            font-family: var(--font-main);
            letter-spacing: 0.55px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .x {
            color: #7b90ab;
            padding: 0 0 0 10px;
        }
        .x:hover {
            color: #ff9aa7;
        }
        .editor-advanced {
            margin-top: 2px;
            border: 1px solid rgba(102, 243, 255, 0.14);
            border-radius: 12px;
            background: linear-gradient(180deg, rgba(5, 12, 28, 0.94), rgba(3, 9, 22, 0.86));
            padding: 6px;
        }
        .editor-advanced-open {
            display: block;
        }
        .editor-adv-section {
            display: flex;
            flex-direction: column;
            gap: 5px;
            margin-bottom: 0;
            padding: 7px;
            border: 1px solid rgba(102, 243, 255, 0.12);
            border-radius: 10px;
            background: rgba(3, 10, 24, 0.54);
        }
        .editor-adv-title {
            color: #a8bed8;
            font-size: 0.64rem;
            letter-spacing: 1.6px;
            text-transform: uppercase;
        }
        .editor-adv-grid {
            gap: 8px;
            margin-bottom: 8px;
        }
        .editor-adv-primary-row {
            display: flex;
            align-items: end;
            gap: 8px;
            margin-bottom: 8px;
        }
        .editor-adv-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
        }
        .editor-adv-field-name {
            flex: 0 1 220px;
        }
        .editor-adv-field-color {
            flex: 0 0 74px;
        }
        .editor-adv-grid label {
            color: #8ba4c0;
            letter-spacing: 1.3px;
            font-size: 0.62rem;
        }
        .editor-adv-grid-identity {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .editor-adv-row {
            gap: 8px;
            margin-bottom: 0;
        }
        .editor-merge-row {
            display: flex;
            align-items: center;
            flex-wrap: nowrap;
        }
        .editor-merge-row .flex-grow-input {
            min-width: 0;
        }
        .editor-adv-links {
            gap: 6px;
            margin-bottom: 8px;
        }
        .editor-link-composer {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .editor-link-composer-primary {
            align-items: stretch;
        }
        .editor-link-composer-primary .editor-autocomplete-field {
            width: 100%;
        }
        .editor-link-composer-secondary {
            display: grid;
            grid-template-columns: 118px minmax(0, 1fr) auto;
            align-items: center;
        }
        .editor-autocomplete-field {
            position: relative;
            min-width: 0;
            flex: 1 1 auto;
        }
        .editor-autocomplete-field > input {
            width: 100%;
        }
        .editor-autocomplete-results {
            position: absolute;
            top: calc(100% + 6px);
            left: 0;
            right: 0;
            z-index: 12;
            display: flex;
            flex-direction: column;
            gap: 4px;
            max-height: 188px;
            overflow-y: auto;
            padding: 8px;
            border: 1px solid rgba(102, 243, 255, 0.18);
            border-radius: 10px;
            background: rgba(4, 11, 27, 0.96);
            box-shadow: 0 18px 28px rgba(0, 0, 0, 0.34);
        }
        .editor-autocomplete-results[hidden],
        .editor-autocomplete-results:empty,
        .quick-create-search-result[hidden],
        .quick-create-search-result:empty {
            display: none !important;
        }
        .editor-autocomplete-hit {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            min-height: 34px;
            padding: 8px 10px;
            border: 1px solid rgba(102, 243, 255, 0.1);
            border-radius: 8px;
            background: rgba(8, 18, 36, 0.92);
            color: var(--text-light);
            font-family: var(--font-main);
            font-size: 0.82rem;
            line-height: 1.2;
            text-transform: none;
            text-align: left;
            box-shadow: none;
        }
        .editor-autocomplete-hit:hover,
        .editor-autocomplete-hit.active {
            background: rgba(13, 28, 50, 0.96);
            border-color: rgba(102, 243, 255, 0.34);
            color: #e3fdff;
        }
        .editor-autocomplete-name {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .editor-autocomplete-type {
            color: #89a6c5;
            font-size: 0.66rem;
            letter-spacing: 1.3px;
            text-transform: uppercase;
            white-space: nowrap;
        }
        .editor-link-hint {
            color: var(--text-muted);
            font-size: 0.68rem;
            line-height: 1.35;
        }
        .flex-row-force {
            gap: 8px !important;
        }
        .compact-select {
            min-height: 36px !important;
            font-size: 0.72rem !important;
            padding: 6px 9px !important;
        }
        .editor-compact-select {
            width: 100%;
            min-width: 96px;
        }
        .editor-name-input {
            max-width: 220px;
        }
        .editor-inline-action {
            min-height: 30px;
            padding: 5px 9px;
            font-size: 0.6rem;
            white-space: nowrap;
        }
        .editor-color-input {
            width: 38px;
            min-width: 38px;
            height: 38px;
            padding: 0;
            cursor: pointer;
            border-radius: 6px;
            border: 1px solid rgba(102, 243, 255, 0.18);
            background: rgba(2, 8, 20, 0.92);
            appearance: none;
            -webkit-appearance: none;
        }
        .editor-color-input::-webkit-color-swatch-wrapper {
            padding: 0;
        }
        .editor-color-input::-webkit-color-swatch {
            border: none;
            border-radius: 5px;
        }
        .editor-color-input::-moz-color-swatch {
            border: none;
            border-radius: 5px;
        }

        #hud {
            position: fixed;
            top: max(12px, env(safe-area-inset-top));
            right: max(12px, env(safe-area-inset-right));
            left: auto;
            bottom: auto;
            transform: none;
            width: min(156px, calc(100vw - 20px));
            max-width: 156px;
            margin-top: 0;
            padding: 8px 7px;
            background: rgba(5, 12, 28, 0.82);
            border: 1px solid rgba(102, 243, 255, 0.18);
            border-radius: 16px;
            display: flex;
            flex-direction: column;
            align-items: stretch;
            justify-content: flex-start;
            gap: 6px;
            box-shadow: inset 0 0 0 1px rgba(102, 243, 255, 0.04);
        }
        .hud-panel-title {
            display: none;
        }
        #hud .hud-btn {
            color: var(--text-muted);
            font-size: 0.7rem;
            letter-spacing: 1.4px;
        }
        #hud .hud-stack-btn,
        #hud .hud-mode-btn {
            width: 100%;
            min-height: 50px;
            justify-content: flex-start;
            border-radius: 11px;
            padding: 8px 9px;
            gap: 9px;
        }
        #hud .hud-primary-btn {
            border-color: rgba(102, 243, 255, 0.24);
            background: linear-gradient(180deg, rgba(10, 22, 42, 0.94), rgba(4, 10, 22, 0.98));
        }
        #hud .hud-btn-icon {
            flex-basis: 26px;
            width: 26px;
            height: 26px;
            border-radius: 7px;
        }
        #hud .hud-btn-label {
            color: #7f96b0;
            font-size: 0.48rem;
            line-height: 1.05;
            letter-spacing: 1.3px;
        }
        #hud .hud-btn-value {
            flex: 0 0 auto;
            color: var(--text-light);
            font-size: 0.75rem;
            line-height: 1;
            letter-spacing: 1px;
            font-weight: 800;
            padding: 0;
            border-radius: 0;
            border: none;
            background: transparent;
        }
        #hud .hud-btn-copy {
            flex: 1 1 auto;
            flex-direction: column;
            align-items: flex-start;
            justify-content: center;
            gap: 3px;
        }
        #hud .hud-filter-card {
            padding: 6px;
            gap: 5px;
        }
        #hud .hud-filter-title {
            padding: 1px 1px 4px;
            font-size: 0.5rem;
        }
        #hud .hud-filter-option {
            padding: 7px;
            font-size: 0.6rem;
            letter-spacing: 1px;
        }
        #hud .hud-settings-btn .hud-btn-icon {
            flex-basis: 26px;
            width: 26px;
            height: 26px;
            border-radius: 7px;
            background: rgba(102, 243, 255, 0.12);
            border-color: rgba(102, 243, 255, 0.22);
        }
        #hud .hud-toolbar {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 6px;
            padding: 6px;
            border: 1px solid rgba(102, 243, 255, 0.16);
            border-radius: 14px;
            background: linear-gradient(180deg, rgba(8, 16, 34, 0.9), rgba(4, 10, 22, 0.96));
            box-shadow: inset 0 0 0 1px rgba(102, 243, 255, 0.03);
            clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px));
        }
        #hud .hud-tool-btn {
            min-height: 36px;
            padding: 0;
            justify-content: center;
            border: 1px solid rgba(102, 243, 255, 0.18);
            border-radius: 10px;
            background: linear-gradient(180deg, rgba(10, 22, 42, 0.94), rgba(5, 12, 26, 0.98));
            clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));
            transition: transform 0.16s ease, border-color 0.2s ease, background 0.2s ease;
        }
        #hud .hud-tool-btn:hover {
            transform: translateY(-1px);
            border-color: rgba(102, 243, 255, 0.32);
            background: linear-gradient(180deg, rgba(14, 28, 52, 0.98), rgba(6, 14, 30, 1));
        }
        #hud .hud-tool-btn .hud-btn-icon {
            flex-basis: 28px;
            width: 28px;
            height: 28px;
            margin: 0;
            background: rgba(102, 243, 255, 0.1);
            border: 1px solid rgba(102, 243, 255, 0.18);
        }
        #hud .hud-tool-btn .hud-btn-copy {
            display: none;
        }
        .hud-toggle {
            color: var(--text-muted);
            font-size: 0.74rem;
            letter-spacing: 1.2px;
        }
        .hud-toggle:hover {
            color: var(--text-light);
        }

        #settings-panel,
        #hvt-panel,
        #intel-panel {
            border: 1px solid rgba(102, 243, 255, 0.28);
            border-radius: 18px;
            background:
                linear-gradient(180deg, rgba(8, 18, 42, 0.98), rgba(4, 11, 26, 0.96));
            box-shadow:
                0 0 0 1px rgba(102, 243, 255, 0.06),
                0 26px 70px rgba(0, 0, 0, 0.66);
            clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 18px 100%, 0 calc(100% - 18px));
        }
        .settings-header,
        .hvt-header,
        .intel-header {
            border-bottom: 1px solid rgba(102, 243, 255, 0.14);
            padding-bottom: 10px;
            margin-bottom: 10px;
        }
        .settings-header h3,
        .hvt-title,
        .intel-title {
            font-size: 0.8rem;
            letter-spacing: 3px;
            color: var(--accent-cyan);
        }
        .hvt-sub,
        .intel-sub {
            color: var(--text-muted);
        }
        .hvt-row,
        .intel-item {
            background: rgba(3, 10, 24, 0.72);
            border: 1px solid rgba(102, 243, 255, 0.1);
            border-radius: 10px;
        }
        .hvt-row.active {
            background: rgba(102, 243, 255, 0.12);
            border-color: rgba(102, 243, 255, 0.32);
        }
        .hvt-rank,
        .intel-score {
            color: var(--accent-cyan);
        }
        .hvt-name,
        .intel-names {
            color: var(--text-light);
        }
        .hvt-type,
        .hvt-score,
        .intel-meta,
        .intel-reasons {
            color: var(--text-muted);
        }
        #right #editor {
            max-width: 100%;
            box-sizing: border-box;
        }
        #cloudStatus {
            min-height: 36px;
            padding: 5px 7px;
            transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
        }
        #cloudStatus.is-clickable {
            cursor: pointer;
        }
        #cloudStatus.is-clickable:hover {
            border-color: rgba(255, 154, 167, 0.32);
            background: rgba(39, 8, 16, 0.9);
            box-shadow: 0 0 0 1px rgba(255, 154, 167, 0.08);
        }
        #cloudStatus.is-clickable:hover .cloud-status-value {
            color: #ffb4bf;
        }
        .cloud-status-label,
        .cloud-status-solo {
            letter-spacing: 0.9px;
            font-size: 0.48rem;
        }
        #cloudStatus[data-state="local"] .cloud-status-solo {
            font-size: 0.68rem;
            font-weight: 800;
            letter-spacing: 1.4px;
            color: var(--accent-cyan);
        }
        #cloudStatus[data-state="session"] .cloud-status-label {
            font-size: 0.9rem;
            font-weight: 900;
            letter-spacing: 1.9px;
            color: #89f5ff;
            text-shadow: 0 0 14px rgba(102, 243, 255, 0.18);
        }
        #cloudStatus[data-state="session"] .cloud-status-value {
            margin-top: 3px;
            font-size: 0.72rem;
            letter-spacing: 0.6px;
            color: var(--text-light);
        }
        .cloud-status-value {
            margin-top: 1px;
            font-size: 0.66rem;
            letter-spacing: 0.5px;
            text-transform: none;
        }
        .cloud-local-disconnect-btn {
            cursor: pointer;
            border: 1px solid rgba(255, 154, 167, 0.22);
            background: rgba(40, 10, 18, 0.88);
            color: #ffc0c8;
        }
        .cloud-local-disconnect-btn:hover {
            border-color: rgba(255, 154, 167, 0.44);
            color: #ffe2e7;
        }
        #modal-actions button.is-busy-dimmed {
            opacity: 0.58;
        }
        #modal-actions button.is-busy {
            opacity: 1;
            position: relative;
            padding-right: 34px;
        }
        #modal-actions button.is-busy::after {
            content: '';
            position: absolute;
            right: 12px;
            top: 50%;
            width: 12px;
            height: 12px;
            margin-top: -6px;
            border-radius: 50%;
            border: 2px solid rgba(255, 255, 255, 0.24);
            border-top-color: currentColor;
            animation: cloudSpin 0.8s linear infinite;
        }
        body.cloud-workspace-busy-active {
            cursor: progress;
        }
        #cloudWorkspaceBusy {
            position: fixed;
            inset: 0;
            z-index: 1800;
            display: none;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            background: rgba(3, 8, 18, 0.52);
            backdrop-filter: blur(2px);
            -webkit-backdrop-filter: blur(2px);
        }
        #cloudWorkspaceBusy[hidden] {
            display: none !important;
        }
        .cloud-workspace-busy-card {
            min-width: min(360px, calc(100vw - 32px));
            padding: 22px 24px;
            border-radius: 18px;
            border: 1px solid rgba(102, 243, 255, 0.2);
            background: rgba(4, 10, 22, 0.94);
            box-shadow: 0 22px 46px rgba(0, 0, 0, 0.36);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            pointer-events: none;
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
        }
        .cloud-workspace-spinner {
            width: 18px;
            height: 18px;
            border-radius: 50%;
            border: 2px solid rgba(102, 243, 255, 0.24);
            border-top-color: rgba(102, 243, 255, 0.96);
            animation: cloudSpin 0.8s linear infinite;
            flex: 0 0 auto;
        }
        .cloud-workspace-busy-label {
            font-size: 0.92rem;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--text-light);
        }
        @keyframes cloudSpin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .cloud-live-info {
            gap: 4px;
            padding: 6px;
        }
        .cloud-sync-info {
            min-height: 24px;
            padding: 4px 6px;
            font-size: 0.56rem;
            letter-spacing: 0.9px;
        }
        .cloud-presence-empty {
            font-size: 0.62rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .cloud-presence-pill {
            min-height: 32px;
            padding: 4px 6px;
            gap: 5px;
        }
        .cloud-presence-name {
            font-size: 0.72rem;
        }
        .cloud-presence-detail {
            font-size: 0.62rem;
        }
        .hvt-tag,
        .intel-badge {
            background: rgba(102, 243, 255, 0.08);
            border-color: rgba(102, 243, 255, 0.14);
            color: #a7bfd6;
        }

        #context-menu {
            background: linear-gradient(180deg, rgba(8, 18, 42, 0.98), rgba(4, 11, 26, 0.96));
            border: 1px solid rgba(102, 243, 255, 0.28);
            border-radius: 14px;
            clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px));
        }
        .ctx-item {
            font-size: 0.78rem;
            letter-spacing: 1.2px;
            text-transform: uppercase;
            color: var(--text-main);
        }
        .ctx-item:hover {
            background: rgba(102, 243, 255, 0.12);
            color: var(--accent-cyan);
        }
        .ctx-item.danger:hover {
            background: rgba(255, 107, 129, 0.12);
            color: #ff9aa7;
        }

        /* --- RESPONSIVE DESKTOP --- */
        @media (min-width: 1024px) and (max-height: 820px) {
            #hud {
                top: max(10px, env(safe-area-inset-top));
                right: max(10px, env(safe-area-inset-right));
                width: min(140px, calc(100vw - 14px));
                max-width: 140px;
                padding: 5px;
                gap: 4px;
            }
            #hud .hud-stack-btn,
            #hud .hud-mode-btn {
                min-height: 42px;
                padding: 6px;
            }
            #hud .hud-btn-label {
                font-size: 0.42rem;
            }
            #hud .hud-btn-value {
                font-size: 0.66rem;
            }
            #hud .hud-filter-option {
                padding: 4px;
                font-size: 0.54rem;
            }
            #hud .hud-filter-title {
                font-size: 0.46rem;
            }
            .editor-sheet-name {
                font-size: 0.98rem;
            }
            .editor-sheet-type,
            .editor-sheet-values,
            .editor-sheet-note textarea,
            .editor-sheet-actions .mini-btn {
                font-size: 0.8rem;
            }
            .chip-name {
                font-size: 0.76rem;
            }
        }

        @media (min-width: 1024px) and (min-height: 821px) and (max-width: 1439px) {
            #hud {
                width: min(144px, calc(100vw - 16px));
                max-width: 144px;
            }
        }

        @media (min-width: 1920px) {
            #hud {
                width: min(160px, calc(100vw - 28px));
                max-width: 160px;
                padding: 9px;
            }
            #hud .hud-stack-btn,
            #hud .hud-mode-btn {
                min-height: 50px;
            }
            #hud .hud-filter-option {
                padding: 7px;
            }
            .editor-sheet-name {
                font-size: 1.22rem;
            }
            .editor-sheet-type,
            .editor-sheet-values,
            .editor-sheet-note textarea,
            .editor-sheet-actions .mini-btn {
                font-size: 0.88rem;
            }
        }

        @media (min-width: 2560px), (min-width: 1920px) and (min-aspect-ratio: 21/9) {
            #hud {
                width: min(165px, calc(100vw - 32px));
                max-width: 165px;
            }
            .editor-sheet-name {
                font-size: 1.3rem;
            }
        }

        @media (max-width: 900px) {
            .modal-segment {
                grid-template-columns: 1fr;
            }
            .data-hub-grid,
            .cloud-auth-grid {
                grid-template-columns: 1fr;
            }
            .ai-hub {
                min-height: auto;
            }
            .ai-hub-head {
                padding: 18px 16px 14px;
                flex-direction: column;
                align-items: stretch;
                padding-right: 16px;
            }
            .ai-hub-grid {
                grid-template-columns: 1fr;
                gap: 14px;
                padding: 16px;
            }
            .ai-hub-card {
                min-height: 240px;
                gap: 18px;
                padding: 26px 18px 22px;
            }
            .ai-hub-card-icon {
                width: 86px;
                height: 86px;
            }
            .ai-hub-card-title {
                font-size: clamp(1.7rem, 7vw, 2.3rem);
            }
            .ai-hub-card-desc {
                font-size: 0.82rem;
                letter-spacing: 1.7px;
            }
            .quick-create-tabs,
            .quick-create-link-flow,
            .quick-create-node-row {
                grid-template-columns: 1fr;
            }
            .quick-create-shell {
                gap: 8px;
                padding: 10px;
            }
            .quick-create-title {
                font-size: clamp(1.55rem, 6vw, 2rem);
            }
            .quick-create-tab {
                padding: 10px 12px;
                font-size: 1rem;
            }
            .quick-create-block {
                padding: 10px;
            }
            .quick-create-head {
                align-items: stretch;
                flex-direction: column;
                padding-right: 0;
            }
            .quick-create-target-input {
                min-height: 42px;
                font-size: 0.96rem;
            }
            .quick-create-search-result {
                max-height: none;
                overflow: visible;
            }
            #settings-panel {
                width: min(100vw - 18px, 430px);
                max-height: 86vh;
                padding: 14px;
            }
            .settings-quick-grid,
            .settings-advanced-body {
                grid-template-columns: 1fr;
            }
            .settings-close {
                min-width: 0;
                width: auto;
            }
            #hud {
                margin-top: 8px;
                padding: 8px;
            }
            .quick-create-type-row,
            .quick-create-source-row,
            .quick-create-kind-row {
                flex-direction: column;
            }
            .editor-priority-grid,
            .editor-status-strip,
            .editor-meta-strip,
            .editor-adv-grid-identity,
            .link-grid,
            .editor-link-grid,
            .editor-merge-row {
                grid-template-columns: 1fr;
            }
            .editor-panel-layout {
                display: flex;
                flex-direction: column;
                gap: 10px;
                padding-left: 0;
            }
            .editor-sheet-head {
                align-items: start;
            }
            .editor-sheet-head-main,
            .editor-sheet-identity-row,
            .editor-sheet-topbar {
                flex-direction: column;
                align-items: stretch;
            }
            .editor-sheet-head-main {
                gap: 6px;
            }
            .editor-head-pills {
                justify-content: flex-start;
            }
            .editor-type-select,
            .editor-inline-phone {
                width: 100%;
                min-width: 0;
            }
            .editor-inline-phone-head {
                margin-left: 0;
                max-width: none;
            }
            .editor-color-pill {
                margin-left: 0;
                justify-content: space-between;
            }
            .editor-status-inline {
                width: 100%;
            }
            .editor-side-rail {
                position: static;
                width: 100%;
                min-height: 0;
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px;
            }
            .editor-side-group {
                display: contents;
            }
            .editor-side-group-bottom {
                margin-top: 0;
                padding-top: 0;
            }
            .editor-side-group .mini-btn {
                min-height: 40px;
                padding: 8px 8px;
            }
            .editor-side-group .editor-action-merge {
                font-size: 0.58rem;
            }
            .editor-side-popover {
                position: static;
                width: 100%;
                margin-top: 6px;
            }
            .editor-status-strip {
                align-items: flex-start;
            }
            .editor-status-actions {
                justify-content: flex-start;
            }
            #right #editor {
                width: 100% !important;
                max-width: 100%;
                border-radius: 0;
                clip-path: none;
            }
            #editorBody {
                max-height: none;
            }
            .editor-adv-primary-row,
            .editor-merge-row,
            .editor-link-composer-secondary,
            .editor-link-composer {
                display: flex;
                flex-direction: column;
                align-items: stretch;
            }
            .cloud-inline-form,
            .cloud-grid,
            .cloud-local-action-grid,
            .cloud-local-choice-grid,
            .cloud-guest-layout,
            .cloud-auth-shell-guest .cloud-auth-grid {
                grid-template-columns: 1fr;
            }
            .cloud-home-head,
            .cloud-board-manage-head,
            .cloud-status-bar,
            .cloud-member-row,
            .cloud-board-row {
                flex-direction: column;
            }
            .intel-toolbar-row {
                flex-direction: column;
                align-items: stretch;
            }
            .cloud-row-actions {
                width: 100%;
                justify-content: flex-start;
            }
            .quick-create-kind-label {
                min-width: 0;
            }
            .quick-create-link-arrow {
                min-height: 28px;
                transform: rotate(90deg);
            }
            #hud {
                position: fixed;
                top: max(12px, env(safe-area-inset-top));
                right: max(12px, env(safe-area-inset-right));
                left: auto;
                bottom: auto;
                width: min(158px, calc(100vw - 18px));
                margin-top: 0;
                justify-content: flex-start;
                flex-wrap: nowrap;
            }
            #settings-panel,
            #hvt-panel,
            #intel-panel {
                clip-path: none;
                border-radius: 16px;
            }
        }
    `;
    document.head.appendChild(style);
}
