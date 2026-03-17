import { GTA_BOUNDS, GPS_CORRECTION } from './constants.js';

// Convertit les coordonnées GPS (Mètres) en Pourcentage CSS (0-100%)
export function gpsToPercentage(gameX, gameY) {
    const mapWidth = GTA_BOUNDS.MAX_X - GTA_BOUNDS.MIN_X;
    const mapHeight = GTA_BOUNDS.MAX_Y - GTA_BOUNDS.MIN_Y;

    let xPercent = ((gameX - GTA_BOUNDS.MIN_X) / mapWidth) * 100;
    let yPercent = ((GTA_BOUNDS.MAX_Y - gameY) / mapHeight) * 100;

    xPercent += GPS_CORRECTION.x;
    yPercent += GPS_CORRECTION.y;

    return { x: xPercent, y: yPercent };
}

// --- NOUVELLE FONCTION (INVERSE) ---
// Convertit le Pourcentage CSS (du clic) en Coordonnées GPS pour le formulaire
export function percentageToGps(xPercent, yPercent) {
    const mapWidth = GTA_BOUNDS.MAX_X - GTA_BOUNDS.MIN_X;
    const mapHeight = GTA_BOUNDS.MAX_Y - GTA_BOUNDS.MIN_Y;

    // 1. Enlever la correction manuelle
    const rawX = xPercent - GPS_CORRECTION.x;
    const rawY = yPercent - GPS_CORRECTION.y;

    // 2. Formule inverse
    // gameX = (percent / 100) * width + minX
    const gameX = (rawX / 100) * mapWidth + GTA_BOUNDS.MIN_X;
    
    // gameY = maxY - (percent / 100) * height
    const gameY = GTA_BOUNDS.MAX_Y - (rawY / 100) * mapHeight;

    return { x: gameX, y: gameY };
}

// Échappe les chaînes injectées dans le HTML
export function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
