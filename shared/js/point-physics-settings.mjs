export const DEFAULT_POINT_PHYSICS_SETTINGS = Object.freeze({
    repulsion: 1200,
    gravity: 0.005,
    linkLength: 220,
    friction: 0.3,
    collision: 50,
    enemyForce: 300,
    structureRepulsion: 0.1,
    curveStrength: 1.0,
    socialLinkStrength: 0.34,
    socialLinkDistanceMult: 0.78,
    businessLinkStrength: 0.26,
    businessLinkDistanceMult: 1.08,
    companyChargeMultiplier: 5,
    groupChargeMultiplier: 3,
    companyTerritoryRadius: 450,
    groupTerritoryRadius: 350,
    enemyDistanceMultiplier: 1.0,
    presetId: 'standard'
});

export function cloneDefaultPointPhysicsSettings() {
    return { ...DEFAULT_POINT_PHYSICS_SETTINGS };
}

export function normalizePointPhysicsSettings(value = null) {
    return {
        ...cloneDefaultPointPhysicsSettings(),
        ...(value && typeof value === 'object' ? { ...value } : {})
    };
}
