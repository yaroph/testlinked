import { LINK_KIND_EMOJI, KINDS, KIND_LABELS, PERSON_STATUS, TYPES } from './constants.js';

let cssColorParser = null;

function channelToHex(value) {
    const channel = Math.max(0, Math.min(255, Number(value) || 0));
    return Math.round(channel).toString(16).padStart(2, '0');
}

function colorChannelsToHex(r, g, b) {
    return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

function hslToHex(h, s, l) {
    const hue = ((((Number(h) || 0) % 360) + 360) % 360) / 360;
    const sat = Math.max(0, Math.min(1, Number(s) || 0));
    const light = Math.max(0, Math.min(1, Number(l) || 0));

    if (sat === 0) {
        const gray = light * 255;
        return colorChannelsToHex(gray, gray, gray);
    }

    const q = light < 0.5 ? light * (1 + sat) : light + sat - (light * sat);
    const p = 2 * light - q;
    const hueToChannel = (t) => {
        let channelHue = t;
        if (channelHue < 0) channelHue += 1;
        if (channelHue > 1) channelHue -= 1;
        if (channelHue < 1 / 6) return p + (q - p) * 6 * channelHue;
        if (channelHue < 1 / 2) return q;
        if (channelHue < 2 / 3) return p + (q - p) * (2 / 3 - channelHue) * 6;
        return p;
    };

    return colorChannelsToHex(
        hueToChannel(hue + 1 / 3) * 255,
        hueToChannel(hue) * 255,
        hueToChannel(hue - 1 / 3) * 255
    );
}

function parseCssColorToHex(color) {
    if (typeof document === 'undefined') return '';
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && !CSS.supports('color', color)) {
        return '';
    }
    if (!cssColorParser) {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        cssColorParser = canvas.getContext('2d');
    }
    if (!cssColorParser) return '';

    try {
        cssColorParser.fillStyle = '#000000';
        cssColorParser.fillStyle = color;
    } catch (e) {
        return '';
    }

    const normalized = String(cssColorParser.fillStyle || '').trim();
    if (/^#[0-9A-F]{6}$/i.test(normalized)) return normalized;

    const rgbMatch = normalized.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*[0-9.]+\s*)?\)$/i);
    if (!rgbMatch) return '';
    return colorChannelsToHex(rgbMatch[1], rgbMatch[2], rgbMatch[3]);
}

// Normalise un ID (objet D3 ou valeur primitive) en string
export function getId(value) {
    if (value && typeof value === 'object') return String(value.id);
    return String(value ?? '');
}

// Génère un ID unique
export function uid() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Sécurise l'affichage HTML
export function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function safeHex(color) {
    const raw = String(color || '').trim();
    if (!raw) return '#ffffff';
    if (/^#[0-9A-F]{6}$/i.test(raw)) return raw;
    const shortHex = raw.match(/^#([0-9A-F]{3})$/i);
    if (shortHex) {
        const [r, g, b] = shortHex[1].split('');
        return `#${r}${r}${g}${g}${b}${b}`;
    }
    const cssHex = parseCssColorToHex(raw);
    if (cssHex) return cssHex;
    return '#ffffff';
}

export function sanitizeNodeColor(color) {
    const hex = safeHex(color);
    if (hex.toLowerCase() === '#000000') return '#4c617a';
    return hex;
}

export function normalizePersonStatus(value, type = TYPES.PERSON) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === PERSON_STATUS.MISSING) return PERSON_STATUS.MISSING;
    if (raw === PERSON_STATUS.DECEASED) return PERSON_STATUS.DECEASED;
    return PERSON_STATUS.ACTIVE;
}

export function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
}

export function rgbToHex(r, g, b) {
    return colorChannelsToHex(r, g, b);
}

export function randomPastel() {
    const hue = Math.floor(Math.random() * 360);
    return hslToHex(hue, 0.7, 0.8);
}

// Math helpers
export function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
}

// Convertit les coordonnées écran (Souris) en coordonnées Monde (Simulation)
export function screenToWorld(screenX, screenY, canvas, view) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    
    return {
        x: (screenX - w / 2 - view.x) / view.scale,
        y: (screenY - h / 2 - view.y) / view.scale
    };
}

export function kindToLabel(kind) {
    if (!kind) return 'Lien';
    if (KIND_LABELS[kind]) return KIND_LABELS[kind];
    return String(kind)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

// CORRECTION : Utilise maintenant la source de vérité dans constants.js
export function linkKindEmoji(kind) {
    return LINK_KIND_EMOJI[kind] || '🔗';
}

// CORRECTION : Liste complète des couleurs pour tous les types (KINDS)
export function computeLinkColor(link) {
    const map = {
        [KINDS.PATRON]: '#9b59b6',      // Violet
        [KINDS.HAUT_GRADE]: '#f39c12',  // Or
        [KINDS.EMPLOYE]: '#f1c40f',     // Jaune
        [KINDS.COLLEGUE]: '#e67e22',    // Orange
        [KINDS.PARTENAIRE]: '#1abc9c',  // Turquoise
        
        [KINDS.FAMILLE]: '#8e44ad',     // Violet Foncé
        [KINDS.COUPLE]: '#e84393',      // Rose Foncé
        [KINDS.AMOUR]: '#fd79a8',       // Rose Clair
        [KINDS.AMI]: '#2ecc71',         // Vert
        [KINDS.CONNAISSANCE]: '#bdc3c7', // Gris Clair
        
        [KINDS.ENNEMI]: '#e74c3c',      // Rouge
        [KINDS.RIVAL]: '#d35400',       // Orange Foncé
        
        [KINDS.AFFILIATION]: '#3498db', // Bleu
        [KINDS.MEMBRE]: '#2980b9',      // Bleu Foncé
        [KINDS.RELATION]: '#95a5a6'     // Gris
    };
    return map[link.kind] || '#999';
}
