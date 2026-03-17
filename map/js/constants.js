// --- BIBLIOTHÈQUE D'ICÔNES (VERSION SVG LOCALE / EMBARQUÉE) ---
const icon = (markup) => markup.trim();

export const ICONS = Object.freeze({
    DEFAULT: icon(`
        <circle cx="12" cy="12" r="5.2"></circle>
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.7"></circle>
    `),
    HQ: icon(`
        <path d="M6 20V4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        <path d="M7 5H17L14.3 9L17 13H7Z"></path>
    `),
    TECH: icon(`
        <rect x="7" y="7" width="10" height="10" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.6"></rect>
        <rect x="10" y="10" width="4" height="4"></rect>
        <path d="M9 2V5M12 2V5M15 2V5M9 19V22M12 19V22M15 19V22M2 9H5M2 12H5M2 15H5M19 9H22M19 12H22M19 15H22" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path>
    `),
    SKULL: icon(`
        <path d="M12 3C8.1 3 5 6.1 5 10C5 12.6 6.4 14.8 8.5 16V19H11V21H13V19H15.5V16C17.6 14.8 19 12.6 19 10C19 6.1 15.9 3 12 3Z" fill="none" stroke="currentColor" stroke-width="1.5"></path>
        <circle cx="9.4" cy="10" r="1.2"></circle>
        <circle cx="14.6" cy="10" r="1.2"></circle>
        <path d="M10 13.3H14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
    `),
    POLICE: icon(`
        <path d="M12 3L18 5.4V10.2C18 14 15.7 17.1 12 19C8.3 17.1 6 14 6 10.2V5.4L12 3Z" fill="none" stroke="currentColor" stroke-width="1.5"></path>
        <path d="M12 7V13M9 10H15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
    `),
    MEDIC: icon(`
        <rect x="5" y="5" width="14" height="14" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.5"></rect>
        <path d="M12 8V16M8 12H16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
    `),
    GANG: icon(`
        <path d="M6 9C7.8 5.7 10 4 12 4C14 4 16.2 5.7 18 9V16C16.2 18 14.2 19 12 19C9.8 19 7.8 18 6 16Z" fill="none" stroke="currentColor" stroke-width="1.5"></path>
        <path d="M8.4 10.2H15.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path>
        <circle cx="9.5" cy="12.1" r="1.1"></circle>
        <circle cx="14.5" cy="12.1" r="1.1"></circle>
    `),
    SHOP: icon(`
        <path d="M4 6H6L8.1 14H17.4L19.4 8.4H7.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
        <circle cx="10" cy="18.2" r="1.5"></circle>
        <circle cx="16" cy="18.2" r="1.5"></circle>
    `),
    WEAPON: icon(`
        <path d="M5 12H14.3L17.8 10.2L19 11.5L17 13.1L15.6 13.4V15H12.6V13.4H5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>
        <path d="M9.5 13.3V16.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
    `),
    GARAGE: icon(`
        <path d="M6 14L8.2 9.2H15.8L18 14V18H16.4V16.8H7.6V18H6Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>
        <circle cx="8.8" cy="14.8" r="1.2"></circle>
        <circle cx="15.2" cy="14.8" r="1.2"></circle>
        <path d="M9 11.4H15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path>
    `),
    INFO: icon(`
        <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.5"></circle>
        <circle cx="12" cy="8" r="1.2"></circle>
        <path d="M12 11V16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
    `),
});

// --- ECHELLE RÉELLE ---
export const MAP_SCALE_UNIT = 82.5; 

export const GTA_BOUNDS = {
    MIN_X: -5647, MAX_X: 6672,
    MIN_Y: -4060, MAX_Y: 8426
};

export const GPS_CORRECTION = { x: 0, y: 0 };
