export const TYPES = {
    PERSON: 'person',
    GROUP: 'group',
    COMPANY: 'company'
};

export const PERSON_STATUS = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    MISSING: 'missing',
    DECEASED: 'deceased'
};

export const PERSON_STATUS_LABELS = {
    [PERSON_STATUS.ACTIVE]: 'Actif',
    [PERSON_STATUS.INACTIVE]: 'Inactif',
    [PERSON_STATUS.MISSING]: 'Disparu',
    [PERSON_STATUS.DECEASED]: 'Mort'
};

export const KINDS = {
    PATRON: 'patron',
    HAUT_GRADE: 'haut_grade',
    EMPLOYE: 'employe',
    COLLEGUE: 'collegue',
    PARTENAIRE: 'partenaire',
    FAMILLE: 'famille',
    COUPLE: 'couple',
    AMOUR: 'amour',
    AMI: 'ami',
    ENNEMI: 'ennemi', // Invisible sur la carte, grosse répulsion
    RIVAL: 'rival',
    CONNAISSANCE: 'connaissance',
    AFFILIATION: 'affiliation',
    MEMBRE: 'membre',
    RELATION: 'relation'
};

// AJOUT DE L'EXPORT MANQUANT
export const KIND_LABELS = {
    [KINDS.PATRON]: 'Patron',
    [KINDS.HAUT_GRADE]: 'Haut grade',
    [KINDS.EMPLOYE]: 'Employé',
    [KINDS.COLLEGUE]: 'Collègue',
    [KINDS.PARTENAIRE]: 'Partenaire',
    [KINDS.FAMILLE]: 'Famille',
    [KINDS.COUPLE]: 'Couple',
    [KINDS.AMOUR]: 'Amour',
    [KINDS.AMI]: 'Ami',
    [KINDS.ENNEMI]: 'Ennemi',
    [KINDS.RIVAL]: 'Rival',
    [KINDS.CONNAISSANCE]: 'Connaissance',
    [KINDS.AFFILIATION]: 'Affiliation',
    [KINDS.MEMBRE]: 'Membre',
    [KINDS.RELATION]: 'Relation'
};

export const PERSON_PERSON_KINDS = new Set([
    KINDS.FAMILLE, KINDS.COUPLE, KINDS.AMOUR, KINDS.AMI, 
    KINDS.ENNEMI, KINDS.RIVAL, KINDS.CONNAISSANCE, KINDS.COLLEGUE
]);

export const PERSON_ORG_KINDS = new Set([
    KINDS.PATRON, KINDS.HAUT_GRADE, KINDS.EMPLOYE, KINDS.AFFILIATION, KINDS.MEMBRE,
    KINDS.PARTENAIRE, KINDS.ENNEMI 
]);

export const ORG_ORG_KINDS = new Set([
    KINDS.PARTENAIRE, KINDS.RIVAL, KINDS.ENNEMI, KINDS.AFFILIATION
]);

export const FILTERS = {
    ALL: 'ALL',
    BUSINESS: 'BUSINESS',
    ILLEGAL: 'ILLEGAL',
    SOCIAL: 'SOCIAL'
};

// Règles de visibilité des liens selon le filtre actif
export const FILTER_RULES = {
    [FILTERS.ALL]: null,
    [FILTERS.BUSINESS]: new Set([KINDS.PATRON, KINDS.EMPLOYE, KINDS.COLLEGUE, KINDS.PARTENAIRE, KINDS.RELATION]),
    [FILTERS.ILLEGAL]: new Set([KINDS.ENNEMI, KINDS.RIVAL, KINDS.MEMBRE, KINDS.AFFILIATION, KINDS.PARTENAIRE]),
    [FILTERS.SOCIAL]: new Set([KINDS.FAMILLE, KINDS.COUPLE, KINDS.AMOUR, KINDS.AMI, KINDS.CONNAISSANCE, KINDS.ENNEMI])
};

export const NODE_BASE_SIZE = { [TYPES.PERSON]: 12, [TYPES.COMPANY]: 25, [TYPES.GROUP]: 18 };
export const DEG_SCALE = { [TYPES.PERSON]: 3, [TYPES.COMPANY]: 1.5, [TYPES.GROUP]: 2 };
export const R_MIN = { [TYPES.PERSON]: 12, [TYPES.COMPANY]: 25, [TYPES.GROUP]: 18 };
export const R_MAX = { [TYPES.PERSON]: 50, [TYPES.COMPANY]: 100, [TYPES.GROUP]: 80 };

export const LINK_KIND_EMOJI = {
    [KINDS.PATRON]: '👑', [KINDS.HAUT_GRADE]: '⭐', [KINDS.EMPLOYE]: '💼', [KINDS.COLLEGUE]: '🤝',
    [KINDS.PARTENAIRE]: '🤝', [KINDS.FAMILLE]: '🏠', [KINDS.COUPLE]: '❤️',
    [KINDS.AMOUR]: '💘', [KINDS.AMI]: '🍻', [KINDS.ENNEMI]: '⚔️',
    [KINDS.RIVAL]: '⚡', [KINDS.CONNAISSANCE]: '👋', [KINDS.AFFILIATION]: '🏴',
    [KINDS.MEMBRE]: '👤', [KINDS.RELATION]: '🔗'
};
