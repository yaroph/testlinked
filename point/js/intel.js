import { state, nodeById } from './state.js';
import { KINDS, TYPES, PERSON_STATUS } from './constants.js';
import { clamp, getId, normalizePersonStatus } from './utils.js';
import { loadMapPointIndex, resolveMapPointForNode as resolveLinkedMapPoint } from '../../shared/js/map-link-contract.mjs';

const LINK_STRENGTH = {
    [KINDS.PATRON]: 1.25,
    [KINDS.HAUT_GRADE]: 1.15,
    [KINDS.EMPLOYE]: 1.0,
    [KINDS.COLLEGUE]: 0.9,
    [KINDS.PARTENAIRE]: 1.1,
    [KINDS.FAMILLE]: 1.0,
    [KINDS.COUPLE]: 1.1,
    [KINDS.AMOUR]: 1.1,
    [KINDS.AMI]: 0.9,
    [KINDS.CONNAISSANCE]: 0.6,
    [KINDS.AFFILIATION]: 0.85,
    [KINDS.MEMBRE]: 0.8,
    [KINDS.RELATION]: 0.6,
    [KINDS.RIVAL]: 0.5,
    [KINDS.ENNEMI]: 0.2
};

const KIND_CATEGORY = {
    [KINDS.PATRON]: 'business',
    [KINDS.HAUT_GRADE]: 'business',
    [KINDS.EMPLOYE]: 'business',
    [KINDS.COLLEGUE]: 'business',
    [KINDS.PARTENAIRE]: 'business',
    [KINDS.FAMILLE]: 'social',
    [KINDS.COUPLE]: 'social',
    [KINDS.AMOUR]: 'social',
    [KINDS.AMI]: 'social',
    [KINDS.CONNAISSANCE]: 'social',
    [KINDS.AFFILIATION]: 'org',
    [KINDS.MEMBRE]: 'org',
    [KINDS.RELATION]: 'org',
    [KINDS.RIVAL]: 'conflict',
    [KINDS.ENNEMI]: 'conflict'
};

const STOPWORDS = new Set([
    'le','la','les','un','une','des','du','de','d','et','ou','mais','avec','sans','pour','par','sur','sous',
    'au','aux','ce','cet','cette','ces','son','sa','ses','mon','ma','mes','ton','ta','tes','notre','nos',
    'votre','vos','leur','leurs','est','sont','etre','etre','a','ont','avait','avais','dans','chez','plus',
    'moins','tres','trop','ou','si','se','ses','sa','son','sur','sous','comme','qui','que','quoi','dont',
    'ou','ne','pas','ni','je','tu','il','elle','nous','vous','ils','elles','on','the','and','or','of','to',
    'in','on','for','with','by','as','at','from','is','are','was','were','be','been','this','that','these',
    'those','it','its'
]);

const FAMILY_KEYWORDS = new Set([
    'famille','frere','soeur','cousin','cousine','pere','mere','mari','epouse',
    'enfant','fils','fille','oncle','tante','neveu','niece','beau','belle','parents','fiance',
    'fiancee','conjoint','conjointe','brother','sister','cousin','father','mother','wife','husband',
    'son','daughter','uncle','aunt','nephew','niece','family'
]);

const COMMON_LASTNAMES = new Set([
    'martin','dupont','durand','moreau','lambert','petit','robert','richard','bernard','david',
    'smith','johnson','williams','brown','jones','garcia','miller','davis','lopez','wilson'
]);

const ROLE_LEXICON = {
    boss: {
        tokens: ['ceo','pdg','president','fondateur','fondatrice','directeur','directrice','boss','patron','owner','cofondateur','cofondatrice','chairman','chief'],
        phrases: ['chief executive','vice president','vp','head of','general manager','managing director']
    },
    exec: {
        tokens: ['cto','cfo','coo','cmo','vp','senior','executif','executive','dir','manager'],
        phrases: ['chief technology','chief financial','chief operations','chief marketing']
    },
    employee: {
        tokens: ['employe','employee','salarie','staff','interne','stagiaire','agent','assistant','consultant','freelance'],
        phrases: ['team member','works at','travaille','travaille chez','emploi']
    },
    partner: {
        tokens: ['partenaire','partner','associe','allie','alliance','joint','coentreprise','co-entreprise'],
        phrases: ['joint venture','strategic partner','partenariat']
    },
    affiliation: {
        tokens: ['filiale','subsidiary','holding','groupe','division','branche','franchise','affiliate','maison-mere','maison mere'],
        phrases: ['owned by','appartient a','appartient']
    },
    colleague: {
        tokens: ['collegue','colleague','equipe','team','staff'],
        phrases: ['meme equipe','same team']
    },
    member: {
        tokens: ['membre','member','adherent','adhesion','inscrit'],
        phrases: ['membre de','member of']
    }
};

const ALIAS_KEYWORDS = ['alias','aka','a.k.a','dit','surnomme','surnom','nickname'];

const TYPE_COMPAT = {
    'person|person': 0.9,
    'person|company': 1.0,
    'person|group': 1.0,
    'company|company': 0.8,
    'group|group': 0.8,
    'company|group': 0.9
};

const DEFAULT_WEIGHTS = {
    serieux: { graph: 0.45, text: 0.18, tags: 0.08, profile: 0.1, bridge: 0.05, lex: 0.08, geo: 0.06 },
    decouverte: { graph: 0.4, text: 0.22, tags: 0.12, profile: 0.09, bridge: 0.07, lex: 0.06, geo: 0.04 },
    creatif: { graph: 0.28, text: 0.28, tags: 0.18, profile: 0.06, bridge: 0.1, lex: 0.05, geo: 0.05 }
};
function pairKey(aId, bId) {
    const a = String(aId);
    const b = String(bId);
    return (a < b) ? `${a}|${b}` : `${b}|${a}`;
}

function normalizeText(text) {
    return (text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function stripPunctuation(text) {
    return (text || '').replace(/[^a-zA-Z0-9\s'-]/g, ' ');
}

function hasAnyKeyword(text, spec) {
    if (!text) return false;
    const safe = normalizeText(text);
    const tokenSet = tokenize(text);
    let hit = false;
    (spec.tokens || []).forEach(tok => {
        if (hit) return;
        if (tokenSet.has(tok)) hit = true;
    });
    (spec.phrases || []).forEach(phrase => {
        if (hit) return;
        if (safe.includes(phrase)) hit = true;
    });
    return hit;
}

function detectLexHints(text) {
    return {
        boss: hasAnyKeyword(text, ROLE_LEXICON.boss),
        exec: hasAnyKeyword(text, ROLE_LEXICON.exec),
        employee: hasAnyKeyword(text, ROLE_LEXICON.employee),
        partner: hasAnyKeyword(text, ROLE_LEXICON.partner),
        affiliation: hasAnyKeyword(text, ROLE_LEXICON.affiliation),
        colleague: hasAnyKeyword(text, ROLE_LEXICON.colleague),
        member: hasAnyKeyword(text, ROLE_LEXICON.member)
    };
}

function getSurname(name) {
    const raw = normalizeText(stripPunctuation(name || ''));
    if (!raw) return null;
    const parts = raw.split(/\s+/).filter(Boolean);
    if (!parts.length) return null;
    const commaIdx = raw.indexOf(',');
    if (commaIdx > -1) {
        const before = raw.slice(0, commaIdx).trim();
        const first = before.split(/\s+/).filter(Boolean)[0];
        if (first && first.length >= 4 && !COMMON_LASTNAMES.has(first)) return first;
    }
    for (let i = parts.length - 1; i >= 0; i--) {
        let p = parts[i];
        if (p.length < 3) continue;
        if (STOPWORDS.has(p)) continue;
        if (p.includes('-')) {
            const segs = p.split('-').filter(Boolean);
            if (segs.length) p = segs[segs.length - 1];
        }
        if (COMMON_LASTNAMES.has(p)) return null;
        return p;
    }
    return null;
}

function nameTokens(name, keepInitials = true) {
    const raw = normalizeText(stripPunctuation(name || ''));
    if (!raw) return [];
    const parts = raw.split(/\s+/).filter(Boolean);
    return parts.filter(p => {
        if (!keepInitials && p.length === 1) return false;
        return true;
    });
}

function nameInitials(tokens) {
    return tokens.map(t => t[0]).join('');
}

function isInitialsOnly(tokens) {
    return tokens.length > 0 && tokens.every(t => t.length === 1);
}

function compactName(tokens) {
    return tokens.join('');
}

function aliasScoreForNames(nameA, nameB) {
    const tokensA = nameTokens(nameA, true);
    const tokensB = nameTokens(nameB, true);
    if (!tokensA.length || !tokensB.length) return 0;

    const compactA = compactName(tokensA);
    const compactB = compactName(tokensB);
    if (compactA && compactA === compactB) return 0.95;

    const initialsA = nameInitials(tokensA);
    const initialsB = nameInitials(tokensB);
    const initialsOnlyA = isInitialsOnly(tokensA);
    const initialsOnlyB = isInitialsOnly(tokensB);
    if ((initialsOnlyA && initialsA && initialsA === initialsB) || (initialsOnlyB && initialsB === initialsA)) return 0.75;

    const surnameA = getSurname(nameA);
    const surnameB = getSurname(nameB);
    if (surnameA && surnameB && surnameA === surnameB) {
        const firstA = tokensA[0];
        const firstB = tokensB[0];
        if (firstA && firstB && firstA[0] === firstB[0]) return 0.7;
        return 0.55;
    }

    const setA = new Set(tokensA.filter(t => t.length > 1));
    const setB = new Set(tokensB.filter(t => t.length > 1));
    const subset = [...setA].every(t => setB.has(t)) || [...setB].every(t => setA.has(t));
    if (subset) return 0.5;

    return 0;
}

function normalizeDigits(value) {
    return String(value || '').replace(/\D+/g, '').trim();
}

function normalizedNameKey(name) {
    return normalizeText(stripPunctuation(name || '')).replace(/\s+/g, ' ').trim();
}

function hasReliablePhone(value) {
    const digits = normalizeDigits(value);
    return digits.length >= 7 && !/^(\d)\1+$/.test(digits);
}

function hasMergeFieldConflict(a, b, field, normalizer = normalizeText) {
    const left = normalizer(String(a?.[field] || '').trim());
    const right = normalizer(String(b?.[field] || '').trim());
    return Boolean(left && right && left !== right);
}

function isPersonInitialAliasPair(a, b) {
    if (a?.type !== TYPES.PERSON || b?.type !== TYPES.PERSON) return false;
    const tokensA = nameTokens(a.name || '', true);
    const tokensB = nameTokens(b.name || '', true);
    if (tokensA.length < 2 || tokensB.length < 2) return false;
    const surnameA = getSurname(a.name || '');
    const surnameB = getSurname(b.name || '');
    if (!surnameA || !surnameB || surnameA !== surnameB) return false;
    const firstA = tokensA[0] || '';
    const firstB = tokensB[0] || '';
    if (!firstA || !firstB || firstA[0] !== firstB[0]) return false;
    return tokensA.some((token) => token.length === 1) || tokensB.some((token) => token.length === 1);
}

function mergeNameQualityScore(node) {
    const normalized = normalizedNameKey(node?.name || '');
    if (!normalized) return -1;
    const tokens = nameTokens(node?.name || '', true);
    let score = normalized.length + (tokens.length * 6);
    if (node?.type === TYPES.PERSON) {
        if (tokens.length >= 2) score += 10;
        if (tokens.some((token) => token.length === 1)) score -= 16;
    }
    return score;
}

function nodeDataRichness(node) {
    if (!node || typeof node !== 'object') return 0;
    let score = mergeNameQualityScore(node);
    score += String(node.description || '').trim().length * 0.18;
    score += String(node.notes || '').trim().length * 0.12;
    if (String(node.num || '').trim()) score += 14;
    if (String(node.accountNumber || '').trim()) score += 18;
    if (String(node.citizenNumber || '').trim()) score += 20;
    if (String(node.linkedMapPointId || '').trim()) score += 10;
    if (node.manualColor) score += 4;
    return score;
}

function chooseMergeDirection(a, b) {
    const scoreA = nodeDataRichness(a);
    const scoreB = nodeDataRichness(b);
    if (scoreA > scoreB) return { source: b, target: a };
    if (scoreB > scoreA) return { source: a, target: b };
    if (mergeNameQualityScore(a) >= mergeNameQualityScore(b)) return { source: b, target: a };
    return { source: a, target: b };
}

function hasAliasKeyword(text) {
    const safe = normalizeText(text || '');
    return ALIAS_KEYWORDS.some(k => safe.includes(k));
}

function extractTags(text) {
    const tags = new Set();
    const safe = normalizeText(text);
    const re = /#([a-z0-9_-]{2,})/g;
    let match = null;
    while ((match = re.exec(safe)) !== null) {
        tags.add(match[1]);
    }
    return tags;
}

function tokenize(text) {
    const tokens = new Set();
    const safe = normalizeText(text);
    const raw = safe.split(/[^a-z0-9#_-]+/).filter(Boolean);
    raw.forEach(tok => {
        const t = tok.startsWith('#') ? tok.slice(1) : tok;
        if (t.length < 2) return;
        if (STOPWORDS.has(t)) return;
        tokens.add(t);
    });
    return tokens;
}

function loadMapPoints() {
    return loadMapPointIndex();
}

function resolveMapPointForNode(node, mapPoints) {
    return resolveLinkedMapPoint(node, mapPoints);
}

function geoScoreForNodes(a, b, mapPoints) {
    if (!mapPoints) return { score: 0, distance: null };
    const pA = resolveMapPointForNode(a, mapPoints);
    const pB = resolveMapPointForNode(b, mapPoints);
    if (!pA || !pB) return { score: 0, distance: null };
    const dx = pA.x - pB.x;
    const dy = pA.y - pB.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const score = clamp(Math.exp(-d / 25), 0, 1);
    return { score, distance: d };
}

function hasFamilyKeyword(text) {
    const safe = normalizeText(text || '');
    if (!safe) return false;
    return Array.from(FAMILY_KEYWORDS).some(k => safe.includes(k));
}

function jaccard(setA, setB) {
    if (!setA || !setB) return 0;
    if (setA.size === 0 && setB.size === 0) return 0;
    let small = setA;
    let big = setB;
    if (setB.size < setA.size) { small = setB; big = setA; }
    let inter = 0;
    small.forEach(v => { if (big.has(v)) inter++; });
    const union = setA.size + setB.size - inter;
    return union === 0 ? 0 : inter / union;
}

function cosine(vecA, vecB) {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        magA += vecA[i] * vecA[i];
        magB += vecB[i] * vecB[i];
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function buildGraphData(blockedTransitIds = new Set()) {
    const adjacency = new Map();
    const neighborSet = new Map();
    const fullNeighborSet = new Map();
    const degree = new Map();
    const linkSet = new Set();

    const ensureMap = (id) => {
        const key = String(id);
        if (!adjacency.has(key)) adjacency.set(key, new Map());
        if (!neighborSet.has(key)) neighborSet.set(key, new Set());
        if (!fullNeighborSet.has(key)) fullNeighborSet.set(key, new Set());
        if (!degree.has(key)) degree.set(key, 0);
        return key;
    };

    state.nodes.forEach(n => ensureMap(n.id));

    state.links.forEach(l => {
        const s = ensureMap(getId(l.source));
        const t = ensureMap(getId(l.target));
        if (s === t) return;
        linkSet.add(pairKey(s, t));

        const w = LINK_STRENGTH[l.kind] ?? 0.6;
        const addEdge = (from, to) => {
            if (blockedTransitIds.has(String(to)) && !blockedTransitIds.has(String(from))) return;
            const map = adjacency.get(from);
            let entry = map.get(to);
            if (!entry) {
                entry = { weight: 0, kinds: new Map() };
                map.set(to, entry);
            }
            entry.weight += w;
            entry.kinds.set(l.kind, (entry.kinds.get(l.kind) || 0) + 1);
        };

        addEdge(s, t);
        addEdge(t, s);

        if (l.kind !== KINDS.ENNEMI) {
            fullNeighborSet.get(s).add(t);
            fullNeighborSet.get(t).add(s);

            if (!blockedTransitIds.has(t) || blockedTransitIds.has(s)) {
                neighborSet.get(s).add(t);
                degree.set(s, (degree.get(s) || 0) + 1);
            }
            if (!blockedTransitIds.has(s) || blockedTransitIds.has(t)) {
                neighborSet.get(t).add(s);
                degree.set(t, (degree.get(t) || 0) + 1);
            }
        }
    });

    return { adjacency, neighborSet, fullNeighborSet, degree, linkSet };
}

function buildComponents(neighborSet) {
    const comp = new Map();
    let compId = 0;
    const nodes = Array.from(neighborSet.keys());
    const visited = new Set();

    for (const id of nodes) {
        if (visited.has(id)) continue;
        compId += 1;
        const queue = [id];
        visited.add(id);
        comp.set(id, compId);
        while (queue.length) {
            const cur = queue.shift();
            const neighbors = neighborSet.get(cur) || new Set();
            neighbors.forEach(n => {
                if (visited.has(n)) return;
                visited.add(n);
                comp.set(n, compId);
                queue.push(n);
            });
        }
    }
    return comp;
}

function buildProfiles(adjacency) {
    const profiles = new Map();
    adjacency.forEach((neighbors, id) => {
        const acc = { business: 0, social: 0, org: 0, conflict: 0 };
        neighbors.forEach(entry => {
            entry.kinds.forEach((count, kind) => {
                const cat = KIND_CATEGORY[kind] || 'org';
                acc[cat] += count;
            });
        });
        profiles.set(id, [acc.business, acc.social, acc.org, acc.conflict]);
    });
    return profiles;
}

function getTypeCompat(a, b) {
    const key = (a.type < b.type) ? `${a.type}|${b.type}` : `${b.type}|${a.type}`;
    return TYPE_COMPAT[key] ?? 0.85;
}

function getNodePersonStatus(node) {
    return normalizePersonStatus(node?.personStatus, node?.type);
}

function computeStatusModifiers(a, b, context = {}) {
    const aStatus = getNodePersonStatus(a);
    const bStatus = getNodePersonStatus(b);
    const hasMissing = aStatus === PERSON_STATUS.MISSING || bStatus === PERSON_STATUS.MISSING;
    const hasDeceased = aStatus === PERSON_STATUS.DECEASED || bStatus === PERSON_STATUS.DECEASED;
    const investigativeLead = Boolean(
        context.orgMention ||
        context.bridgeScore ||
        context.mentionScore >= 0.25 ||
        context.geoScore >= 0.45
    );
    const archivalLead = Boolean(
        context.familyHint ||
        context.aliasHint ||
        context.commonCount >= 2
    );

    let scoreFactor = 1;
    let confidenceFactor = 1;
    const reasons = [];

    if (hasMissing) {
        scoreFactor *= investigativeLead ? 0.96 : 0.88;
        confidenceFactor *= 0.94;
        reasons.push('Statut disparu pris en compte');
    }

    if (hasDeceased) {
        scoreFactor *= archivalLead ? 0.68 : 0.52;
        confidenceFactor *= archivalLead ? 0.8 : 0.68;
        reasons.push('Statut mort pris en compte');
    }

    if (aStatus === PERSON_STATUS.DECEASED && bStatus === PERSON_STATUS.DECEASED) {
        scoreFactor *= 0.85;
        confidenceFactor *= 0.92;
    }

    return {
        aStatus,
        bStatus,
        scoreFactor,
        confidenceFactor,
        reasons
    };
}

function shouldAllowPairWithStatuses(aId, bId, focusId, deceasedNodeIds) {
    const leftId = String(aId || '');
    const rightId = String(bId || '');
    const leftDead = deceasedNodeIds.has(leftId);
    const rightDead = deceasedNodeIds.has(rightId);
    if (!leftDead && !rightDead) return true;
    if (!focusId) return false;
    const focusedId = String(focusId);
    return deceasedNodeIds.has(focusedId) && (leftId === focusedId || rightId === focusedId);
}

export function getAllowedKinds(sourceType, targetType) {
    if (sourceType === TYPES.PERSON && targetType === TYPES.PERSON) {
        return new Set([KINDS.FAMILLE, KINDS.COUPLE, KINDS.AMOUR, KINDS.AMI, KINDS.ENNEMI, KINDS.RIVAL, KINDS.CONNAISSANCE, KINDS.COLLEGUE, KINDS.RELATION]);
    }
    if (sourceType === TYPES.PERSON || targetType === TYPES.PERSON) {
        return new Set([KINDS.PATRON, KINDS.HAUT_GRADE, KINDS.EMPLOYE, KINDS.AFFILIATION, KINDS.MEMBRE, KINDS.PARTENAIRE, KINDS.ENNEMI, KINDS.RELATION]);
    }
    return new Set([KINDS.PARTENAIRE, KINDS.RIVAL, KINDS.ENNEMI, KINDS.AFFILIATION, KINDS.RELATION]);
}

export function suggestKind(a, b, score = 0.5, mode = 'decouverte', hint = {}) {
    const aStatus = hint.aStatus || getNodePersonStatus(a);
    const bStatus = hint.bStatus || getNodePersonStatus(b);
    const hasDeceased = aStatus === PERSON_STATUS.DECEASED || bStatus === PERSON_STATUS.DECEASED;

    if (mode === 'creatif') return KINDS.RELATION;
    if (hasDeceased) {
        if (a.type === TYPES.PERSON && b.type === TYPES.PERSON) {
            if (hint.family || hint.surname) return KINDS.FAMILLE;
            if (hint.alias) return KINDS.RELATION;
            return KINDS.RELATION;
        }
        if (a.type === TYPES.PERSON || b.type === TYPES.PERSON) {
            if (hint.family || hint.surname) return KINDS.FAMILLE;
            return KINDS.RELATION;
        }
    }
    if (a.type === TYPES.PERSON && b.type === TYPES.PERSON) {
        if (hint.alias) return KINDS.RELATION;
        if (hint.family || hint.surname) return KINDS.FAMILLE;
        return score > 0.7 ? KINDS.AMI : KINDS.CONNAISSANCE;
    }
    if (a.type === TYPES.PERSON || b.type === TYPES.PERSON) {
        if (hint.role === 'boss') return KINDS.PATRON;
        if (hint.role === 'exec') return KINDS.HAUT_GRADE;
        if (hint.role === 'employee') return KINDS.EMPLOYE;
        if (hint.role === 'partner') return KINDS.PARTENAIRE;
        if (hint.role === 'member') return KINDS.MEMBRE;
        if (hint.orgMention) {
            const org = (a.type === TYPES.PERSON) ? b : a;
            return org.type === TYPES.GROUP ? KINDS.MEMBRE : KINDS.EMPLOYE;
        }
        return score > 0.65 ? KINDS.EMPLOYE : KINDS.AFFILIATION;
    }
    if (a.type === TYPES.COMPANY && b.type === TYPES.COMPANY) {
        if (hint.role === 'affiliation') return KINDS.AFFILIATION;
        if (hint.role === 'partner') return KINDS.PARTENAIRE;
        return score > 0.6 ? KINDS.PARTENAIRE : KINDS.RELATION;
    }
    if (a.type === TYPES.GROUP && b.type === TYPES.GROUP) {
        if (hint.role === 'affiliation') return KINDS.AFFILIATION;
        return score > 0.6 ? KINDS.AFFILIATION : KINDS.RELATION;
    }
    if (hint.role === 'affiliation') return KINDS.AFFILIATION;
    if (hint.role === 'partner') return KINDS.PARTENAIRE;
    return score > 0.6 ? KINDS.AFFILIATION : KINDS.PARTENAIRE;
}

export function feedbackForPair(aId, bId) {
    const key = pairKey(aId, bId);
    const fb = state.aiFeedback?.[key];
    if (!fb) return { up: 0, down: 0, score: 0 };
    const delta = (fb.up || 0) - (fb.down || 0);
    return { up: fb.up || 0, down: fb.down || 0, score: clamp(delta * 0.06, -0.25, 0.25) };
}

export function recordFeedback(aId, bId, delta) {
    const key = pairKey(aId, bId);
    if (!state.aiFeedback) state.aiFeedback = {};
    if (!state.aiFeedback[key]) state.aiFeedback[key] = { up: 0, down: 0 };
    if (delta > 0) state.aiFeedback[key].up += delta;
    if (delta < 0) state.aiFeedback[key].down += Math.abs(delta);
}

function selectSuggestionsWithNovelty(suggestions, limit, noveltyRatio) {
    const safeLimit = Math.max(0, Number(limit) || 0);
    if (safeLimit <= 0) return [];
    if (suggestions.length <= safeLimit) return suggestions.slice(0, safeLimit);

    const surpriseList = suggestions.filter((suggestion) => suggestion.surprise >= 0.55);
    const normalList = suggestions.filter((suggestion) => suggestion.surprise < 0.55);
    const surpriseCount = Math.min(Math.round(safeLimit * noveltyRatio), surpriseList.length);
    return surpriseList.slice(0, surpriseCount).concat(normalList.slice(0, safeLimit - surpriseCount));
}

export function computeLinkSuggestions(options = {}) {
    const nodes = state.nodes || [];
    if (nodes.length < 2) return [];

    const focusId = options.focusId ? String(options.focusId) : null;
    const mode = options.mode || 'decouverte';
    const weights = DEFAULT_WEIGHTS[mode] || DEFAULT_WEIGHTS.decouverte;
    const minScore = typeof options.minScore === 'number' ? options.minScore : (mode === 'serieux' ? 0.45 : (mode === 'creatif' ? 0.25 : 0.35));
    const limit = Math.max(1, Math.min(options.limit || 20, 80));
    const noveltyRatio = clamp(typeof options.noveltyRatio === 'number' ? options.noveltyRatio : 0.25, 0, 0.6);
    const sources = options.sources || { graph: true, text: true, tags: true, profile: true, bridge: true, lex: true, geo: true };

    const blockedTransitIds = new Set(
        nodes
            .filter((node) => getNodePersonStatus(node) === PERSON_STATUS.DECEASED)
            .map((node) => String(node.id))
    );
    const nodeMap = new Map(nodes.map(n => [String(n.id), n]));
    const { adjacency, neighborSet, fullNeighborSet, degree, linkSet } = buildGraphData(blockedTransitIds);
    const components = buildComponents(fullNeighborSet);
    const profiles = buildProfiles(adjacency);
    const mapPoints = loadMapPoints();

    const tokensById = new Map();
    const nameTokensById = new Map();
    const noteTokensById = new Map();
    const tagsById = new Map();
    const surnameById = new Map();
    const familyHintById = new Map();
    const lexById = new Map();
    const aliasKeywordById = new Map();
    const orgTokensById = new Map();
    const orgMentionByPerson = new Map();
    const tokenIndex = new Map();

    nodes.forEach(n => {
        const text = `${n.name || ''} ${n.notes || ''}`;
        const tags = extractTags(text);
        const tokens = tokenize(text);
        const nameTokens = tokenize(n.name || '');
        const noteTokens = tokenize(n.notes || '');
        const surname = (n.type === TYPES.PERSON) ? getSurname(n.name || '') : null;
        const familyHint = (n.type === TYPES.PERSON) ? hasFamilyKeyword(n.notes || '') : false;
        const lexHints = detectLexHints(text);
        const aliasHint = hasAliasKeyword(text);
        tags.forEach(t => tokens.add(t));
        tokensById.set(String(n.id), tokens);
        nameTokensById.set(String(n.id), nameTokens);
        noteTokensById.set(String(n.id), noteTokens);
        tagsById.set(String(n.id), tags);
        surnameById.set(String(n.id), surname);
        familyHintById.set(String(n.id), familyHint);
        lexById.set(String(n.id), lexHints);
        aliasKeywordById.set(String(n.id), aliasHint);
        if (n.type === TYPES.COMPANY || n.type === TYPES.GROUP) {
            const orgTokens = tokenize(n.name || '');
            if (orgTokens.size) orgTokensById.set(String(n.id), orgTokens);
        }
        tokens.forEach(t => {
            if (!tokenIndex.has(t)) tokenIndex.set(t, new Set());
            tokenIndex.get(t).add(String(n.id));
        });
    });

    nodes.filter(n => n.type === TYPES.PERSON).forEach(p => {
        const pId = String(p.id);
        const noteTokens = noteTokensById.get(pId) || new Set();
        const mentioned = new Set();
        if (noteTokens.size) {
            orgTokensById.forEach((orgTokens, orgId) => {
                const overlap = jaccard(noteTokens, orgTokens);
                const threshold = orgTokens.size >= 3 ? 0.45 : 0.3;
                if (overlap >= threshold) mentioned.add(orgId);
            });
        }
        orgMentionByPerson.set(pId, mentioned);
    });

    const candidates = new Set();

    if (focusId) {
        nodes.forEach(n => {
            const id = String(n.id);
            if (id === focusId) return;
            if (linkSet.has(pairKey(id, focusId))) return;
            if (!shouldAllowPairWithStatuses(id, focusId, focusId, blockedTransitIds)) return;
            candidates.add(pairKey(id, focusId));
        });
    } else if (nodes.length <= 240) {
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = String(nodes[i].id);
                const b = String(nodes[j].id);
                if (linkSet.has(pairKey(a, b))) continue;
                if (!shouldAllowPairWithStatuses(a, b, focusId, blockedTransitIds)) continue;
                candidates.add(pairKey(a, b));
            }
        }
    } else {
        nodes.forEach(n => {
            const aId = String(n.id);
            const neigh = neighborSet.get(aId) || new Set();
            neigh.forEach(mid => {
                if (blockedTransitIds.has(String(mid))) return;
                const second = neighborSet.get(mid) || new Set();
                second.forEach(bId => {
                    if (bId === aId) return;
                    if (linkSet.has(pairKey(aId, bId))) return;
                    if (!shouldAllowPairWithStatuses(aId, bId, focusId, blockedTransitIds)) return;
                    candidates.add(pairKey(aId, bId));
                });
            });
        });

        tokenIndex.forEach(ids => {
            const arr = Array.from(ids);
            if (arr.length > 40) return;
            for (let i = 0; i < arr.length; i++) {
                for (let j = i + 1; j < arr.length; j++) {
                    if (linkSet.has(pairKey(arr[i], arr[j]))) continue;
                    if (!shouldAllowPairWithStatuses(arr[i], arr[j], focusId, blockedTransitIds)) continue;
                    candidates.add(pairKey(arr[i], arr[j]));
                }
            }
        });

        const byDegree = [...nodes].sort((a, b) => (degree.get(String(b.id)) || 0) - (degree.get(String(a.id)) || 0));
        const top = byDegree.slice(0, 30).map(n => String(n.id));
        for (let i = 0; i < top.length; i++) {
            for (let j = i + 1; j < top.length; j++) {
                const aId = top[i];
                const bId = top[j];
                if (linkSet.has(pairKey(aId, bId))) continue;
                if ((components.get(aId) || 0) === (components.get(bId) || 0)) continue;
                if (!shouldAllowPairWithStatuses(aId, bId, focusId, blockedTransitIds)) continue;
                candidates.add(pairKey(aId, bId));
            }
        }
    }

    const mergeCandidates = new Set();
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const aId = String(nodes[i].id);
            const bId = String(nodes[j].id);
            if (nodes[i].type !== nodes[j].type) continue;
            if (focusId && aId !== focusId && bId !== focusId) continue;
            mergeCandidates.add(pairKey(aId, bId));
        }
    }

    const suggestions = [];
    const useGraph = sources.graph !== false;
    const useText = sources.text !== false;
    const useTags = sources.tags !== false;
    const useProfile = sources.profile !== false;
    const useBridge = sources.bridge !== false;
    const useLex = sources.lex !== false;
    const useGeo = sources.geo !== false;

    const buildMergeSuggestion = (aId, bId) => {
        const a = nodeMap.get(String(aId));
        const b = nodeMap.get(String(bId));
        if (!a || !b) return null;
        if (String(a.type || '') !== String(b.type || '')) return null;
        if (hasMergeFieldConflict(a, b, 'citizenNumber')) return null;
        if (hasMergeFieldConflict(a, b, 'accountNumber')) return null;

        const sameCitizen = Boolean(
            String(a.citizenNumber || '').trim()
            && normalizeText(String(a.citizenNumber || '').trim()) === normalizeText(String(b.citizenNumber || '').trim())
        );
        const sameAccount = Boolean(
            String(a.accountNumber || '').trim()
            && normalizeText(String(a.accountNumber || '').trim()) === normalizeText(String(b.accountNumber || '').trim())
        );
        const sameName = Boolean(
            normalizedNameKey(a.name || '')
            && normalizedNameKey(a.name || '') === normalizedNameKey(b.name || '')
        );
        const aliasInitial = isPersonInitialAliasPair(a, b);
        const aliasScore = a.type === TYPES.PERSON ? aliasScoreForNames(a.name || '', b.name || '') : 0;
        const sameReliablePhone = (() => {
            const left = normalizeDigits(a.num);
            const right = normalizeDigits(b.num);
            return Boolean(left && right && left === right && hasReliablePhone(left));
        })();
        const notesA = noteTokensById.get(String(a.id)) || new Set();
        const notesB = noteTokensById.get(String(b.id)) || new Set();
        const descOverlap = jaccard(notesA, notesB);
        const tagsA = tagsById.get(String(a.id)) || new Set();
        const tagsB = tagsById.get(String(b.id)) || new Set();
        const tagOverlap = jaccard(tagsA, tagsB);
        const geoInfo = geoScoreForNodes(a, b, mapPoints);
        const geoScore = geoInfo.score || 0;
        const strongAlias = aliasInitial || aliasScore >= 0.82;
        const strongIdentity = sameCitizen || sameAccount || sameName || strongAlias;

        if (!strongIdentity && !(sameReliablePhone && descOverlap >= 0.22)) return null;
        if (a.type === TYPES.PERSON && !strongIdentity && !sameReliablePhone) return null;
        if (a.type === TYPES.PERSON && !sameCitizen && !sameAccount && !sameName && !aliasInitial && aliasScore < 0.82) return null;

        let score = 0;
        const reasons = [];

        if (sameCitizen) {
            score += 0.76;
            reasons.push('Numero social identique');
        }
        if (sameAccount) {
            score += 0.68;
            reasons.push('Numero de compte identique');
        }
        if (sameName) {
            score += 0.54;
            reasons.push('Nom strictement identique');
        }
        if (aliasInitial) {
            score += 0.48;
            reasons.push('Nom abrege compatible');
        } else if (aliasScore >= 0.9) {
            score += 0.38;
            reasons.push('Alias tres probable');
        } else if (aliasScore >= 0.82) {
            score += 0.28;
            reasons.push('Alias probable');
        }
        if (sameReliablePhone) {
            score += strongIdentity ? 0.18 : 0.1;
            reasons.push('Telephone identique');
        }
        if (descOverlap >= 0.22) {
            score += Math.min(0.16, descOverlap * 0.38);
            reasons.push('Notes proches');
        }
        if (tagOverlap >= 0.25) {
            score += Math.min(0.1, tagOverlap * 0.22);
            reasons.push('Tags communs');
        }
        if (geoScore > 0.58) {
            score += 0.08;
            reasons.push('Position proche');
        }

        score = clamp(score, 0, 0.99);
        if (score < 0.56) return null;

        const evidence = (sameCitizen ? 0.22 : 0)
            + (sameAccount ? 0.18 : 0)
            + (sameName ? 0.16 : 0)
            + (strongAlias ? 0.18 : 0)
            + (sameReliablePhone ? 0.08 : 0)
            + (descOverlap >= 0.22 ? 0.06 : 0)
            + (tagOverlap >= 0.25 ? 0.04 : 0)
            + (geoScore > 0.58 ? 0.04 : 0);
        const confidence = clamp((score * 0.76) + evidence, 0, 0.99);
        const surprise = clamp((strongAlias ? 0.34 : 0.12) + (sameName ? 0.06 : 0.18), 0, 1);
        const direction = chooseMergeDirection(a, b);
        const aStatus = getNodePersonStatus(a);
        const bStatus = getNodePersonStatus(b);

        return {
            id: pairKey(aId, bId),
            actionType: 'merge',
            aId: String(aId),
            bId: String(bId),
            a,
            b,
            score,
            confidence,
            surprise,
            reasons,
            graphScore: 0,
            textScore: Math.max(descOverlap, aliasScore),
            tagScore: tagOverlap,
            profileScore: 0,
            lexScore: 0,
            geoScore,
            aStatus,
            bStatus,
            alias: strongAlias,
            bridge: 0,
            kind: null,
            mergeSourceId: String(direction.source.id),
            mergeTargetId: String(direction.target.id),
            mergeSource: direction.source,
            mergeTarget: direction.target
        };
    };

    candidates.forEach(key => {
        const parts = key.split('|');
        const aId = parts[0];
        const bId = parts[1];
        const a = nodeMap.get(aId);
        const b = nodeMap.get(bId);
        if (!a || !b) return;
        if (!shouldAllowPairWithStatuses(aId, bId, focusId, blockedTransitIds)) return;

        const neighborsA = neighborSet.get(aId) || new Set();
        const neighborsB = neighborSet.get(bId) || new Set();

        let commonCount = 0;
        let weightedCommon = 0;
        let commonIds = [];
        let small = neighborsA;
        let big = neighborsB;
        if (neighborsB.size < neighborsA.size) { small = neighborsB; big = neighborsA; }
        small.forEach(nid => {
            if (!big.has(nid)) return;
            commonCount += 1;
            const wA = adjacency.get(aId)?.get(nid)?.weight || 0.6;
            const wB = adjacency.get(bId)?.get(nid)?.weight || 0.6;
            weightedCommon += Math.sqrt(wA * wB);
            if (commonIds.length < 3) commonIds.push(nid);
        });

        const union = neighborsA.size + neighborsB.size - commonCount;
        const jacc = union > 0 ? commonCount / union : 0;
        const cnScore = 1 - Math.exp(-weightedCommon / 2);
        const graphScore = clamp(0.7 * cnScore + 0.3 * jacc, 0, 1);

        const tokensA = tokensById.get(aId) || new Set();
        const tokensB = tokensById.get(bId) || new Set();
        const nameTokensA = nameTokensById.get(aId) || new Set();
        const nameTokensB = nameTokensById.get(bId) || new Set();
        const noteTokensA = noteTokensById.get(aId) || new Set();
        const noteTokensB = noteTokensById.get(bId) || new Set();
        const tagsA = tagsById.get(aId) || new Set();
        const tagsB = tagsById.get(bId) || new Set();
        const baseTextScore = jaccard(tokensA, tokensB);
        const nameOverlapScore = jaccard(nameTokensA, nameTokensB);
        const mentionScore = Math.max(jaccard(nameTokensA, noteTokensB), jaccard(nameTokensB, noteTokensA));
        const tagScore = jaccard(tagsA, tagsB);
        const profileScore = cosine(profiles.get(aId) || [0,0,0,0], profiles.get(bId) || [0,0,0,0]);

        const compA = components.get(aId) || 0;
        const compB = components.get(bId) || 0;
        const bridgeScore = (compA !== compB) ? 1 : 0;

        const surnameA = surnameById.get(aId);
        const surnameB = surnameById.get(bId);
        let surnameScore = 0;
        let familyHint = false;
        if (a.type === TYPES.PERSON && b.type === TYPES.PERSON && surnameA && surnameB && surnameA === surnameB) {
            surnameScore = 0.6;
            if (familyHintById.get(aId) || familyHintById.get(bId)) {
                surnameScore = clamp(surnameScore + 0.2, 0, 1);
                familyHint = true;
            }
        }

        let aliasScore = 0;
        let aliasHint = false;
        if (a.type === TYPES.PERSON && b.type === TYPES.PERSON) {
            aliasScore = aliasScoreForNames(a.name || '', b.name || '');
            if (aliasScore > 0.6 || (aliasScore > 0.45 && (aliasKeywordById.get(aId) || aliasKeywordById.get(bId)))) {
                aliasHint = true;
                aliasScore = clamp(aliasScore + 0.1, 0, 1);
            }
        }

        const textScore = clamp(
            (baseTextScore * 0.55) +
            (mentionScore * 0.45) +
            (nameOverlapScore * 0.2) +
            (surnameScore * 0.35) +
            (aliasScore * 0.4),
            0,
            1
        );

        const geoInfo = geoScoreForNodes(a, b, mapPoints);
        const geoScore = geoInfo.score || 0;

        let lexScore = 0;
        const lexReasons = [];
        const lexA = lexById.get(aId) || {};
        const lexB = lexById.get(bId) || {};
        let orgMentionFlag = false;
        let roleHint = null;

        if (a.type === TYPES.PERSON && b.type === TYPES.PERSON) {
            const orgsA = orgMentionByPerson.get(aId) || new Set();
            const orgsB = orgMentionByPerson.get(bId) || new Set();
            const sharedOrgs = [...orgsA].filter(id => orgsB.has(id));
            if (sharedOrgs.length) {
                lexScore += 0.35;
                const names = sharedOrgs.slice(0, 2).map(id => nodeMap.get(id)?.name).filter(Boolean);
                if (names.length) lexReasons.push(`Organisation commune: ${names.join(', ')}`);
                else lexReasons.push('Organisation commune mentionnee');
            }
            if (lexA.colleague || lexB.colleague) {
                lexScore += 0.15;
                lexReasons.push('Indice collegue/equipe');
            }
        } else if ((a.type === TYPES.PERSON) !== (b.type === TYPES.PERSON)) {
            const person = (a.type === TYPES.PERSON) ? a : b;
            const org = (a.type === TYPES.PERSON) ? b : a;
            const personId = String(person.id);
            const orgId = String(org.id);
            const orgTokens = orgTokensById.get(orgId) || nameTokensById.get(orgId) || new Set();
            const orgMention = jaccard(noteTokensById.get(personId) || new Set(), orgTokens) >= 0.3 || mentionScore >= 0.25;
            orgMentionFlag = orgMention;
            const personLex = lexById.get(personId) || {};
            if (orgMention) {
                lexScore += 0.35;
                lexReasons.push('Mention d organisation');
            }
            if (personLex.boss || personLex.exec) {
                lexScore += 0.35;
                lexReasons.push('Role direction');
                roleHint = personLex.boss ? 'boss' : 'exec';
            }
            if (personLex.employee) {
                lexScore += 0.25;
                lexReasons.push('Role employe');
                if (!roleHint) roleHint = 'employee';
            }
            if (personLex.partner) {
                lexScore += 0.15;
                lexReasons.push('Role partenaire');
                if (!roleHint) roleHint = 'partner';
            }
            if (personLex.member) {
                lexScore += 0.2;
                lexReasons.push('Role membre');
                if (!roleHint) roleHint = 'member';
            }
        } else {
            const orgTokensA = orgTokensById.get(aId) || nameTokensById.get(aId) || new Set();
            const orgTokensB = orgTokensById.get(bId) || nameTokensById.get(bId) || new Set();
            const mentionAB = jaccard(noteTokensA, orgTokensB) >= 0.3 || mentionScore >= 0.25;
            const mentionBA = jaccard(noteTokensB, orgTokensA) >= 0.3 || mentionScore >= 0.25;
            const mention = mentionAB || mentionBA;
            if ((lexA.partner || lexB.partner) && mention) {
                lexScore += 0.4;
                lexReasons.push('Partenariat mentionne');
                roleHint = 'partner';
            }
            if ((lexA.affiliation || lexB.affiliation) && mention) {
                lexScore += 0.4;
                lexReasons.push('Lien filiale/holding');
                if (!roleHint) roleHint = 'affiliation';
            }
            if (mention && lexScore < 0.2) {
                lexScore += 0.2;
                lexReasons.push('Lien org mentionne');
            }
        }
        lexScore = clamp(lexScore, 0, 1);
        const familyKindHint = familyHint || surnameScore > 0.5;
        const statusMeta = computeStatusModifiers(a, b, {
            commonCount,
            mentionScore,
            bridgeScore,
            geoScore,
            familyHint: familyKindHint,
            aliasHint,
            orgMention: orgMentionFlag
        });

        const degA = degree.get(aId) || 0;
        const degB = degree.get(bId) || 0;
        const degPenalty = 1 / (1 + 0.04 * (degA + degB));
        const typeCompat = getTypeCompat(a, b);

        let score = 0;
        if (useGraph) score += weights.graph * graphScore;
        if (useText) score += weights.text * textScore;
        if (useTags) score += weights.tags * tagScore;
        if (useProfile) score += weights.profile * profileScore;
        if (useBridge) score += weights.bridge * bridgeScore;
        if (useLex) score += weights.lex * lexScore;
        if (useGeo) score += weights.geo * geoScore;

        score *= degPenalty;
        score *= (0.9 + 0.1 * typeCompat);
        score *= statusMeta.scoreFactor;

        const surprise = clamp((bridgeScore * 0.6) + (textScore * 0.4) + (tagScore * 0.3) - (graphScore * 0.4), 0, 1);
        if (mode === 'creatif') score = clamp(score + surprise * 0.08, 0, 1);
        if (mode === 'serieux') score = clamp(score - surprise * 0.05, 0, 1);

        const fb = feedbackForPair(aId, bId);
        score = clamp(score + fb.score, 0, 1);

        const evidence = (graphScore > 0.15 ? 0.25 : 0) +
            (textScore > 0.18 ? 0.2 : 0) +
            (tagScore > 0.1 ? 0.15 : 0) +
            (profileScore > 0.25 ? 0.2 : 0) +
            (bridgeScore ? 0.2 : 0) +
            (surnameScore > 0.4 ? 0.18 : 0) +
            (mentionScore > 0.25 ? 0.15 : 0) +
            (nameOverlapScore > 0.35 ? 0.1 : 0) +
            (aliasScore > 0.55 ? 0.18 : 0) +
            (useLex && lexScore > 0.25 ? 0.18 : 0) +
            (useGeo && geoScore > 0.45 ? 0.12 : 0);
        const confidence = clamp((score * 0.7 + evidence) * statusMeta.confidenceFactor, 0, 1);

        const reasons = [];
        if (commonCount >= 2) {
            const names = commonIds.map(id => nodeById(id)?.name).filter(Boolean);
            reasons.push(`${commonCount} voisins communs${names.length ? ` (${names.join(', ')})` : ''}`);
        } else if (commonCount === 1) {
            const name = nodeById(commonIds[0])?.name;
            reasons.push(`1 voisin commun${name ? ` (${name})` : ''}`);
        }
        if (aliasHint) reasons.push('Alias probable');
        if (surnameScore > 0.4) reasons.push('Nom de famille commun');
        if (familyHint) reasons.push('Indice familial (notes)');
        if (mentionScore >= 0.25) reasons.push('Mention explicite');
        if (nameOverlapScore >= 0.35) reasons.push('Nom proche');
        if (textScore >= 0.2) reasons.push(`Similarite texte ${Math.round(textScore * 100)}%`);
        if (tagScore >= 0.2) {
            const list = Array.from(tagsA).filter(t => tagsB.has(t)).slice(0, 3);
            if (list.length) reasons.push(`Tags communs: ${list.map(t => `#${t}`).join(' ')}`);
        }
        if (profileScore >= 0.35) reasons.push('Profil relationnel proche');
        if (bridgeScore) reasons.push('Pont entre clusters');
        if (useLex && lexScore >= 0.25) reasons.push(...lexReasons.slice(0, 2));
        if (useGeo && geoScore > 0.45 && geoInfo.distance !== null) reasons.push(`Proximite geo ~${Math.round(geoInfo.distance)}%`);
        if (fb.up > fb.down) reasons.push(`Appris: +${fb.up - fb.down}`);
        if (fb.down > fb.up) reasons.push('Historique negatif');
        if (statusMeta.reasons.length) reasons.push(...statusMeta.reasons);

        if (score < minScore) {
            if (!(mode === 'creatif' && surprise > 0.6 && score > minScore * 0.7)) return;
        }

        const personOrg = (a.type === TYPES.PERSON || b.type === TYPES.PERSON) && a.type !== b.type;
        const orgMention = personOrg && (orgMentionFlag || mentionScore >= 0.25 || nameOverlapScore >= 0.3);
        const kindHint = {
            family: familyKindHint,
            surname: surnameScore > 0.4,
            orgMention,
            alias: aliasHint,
            role: roleHint,
            aStatus: statusMeta.aStatus,
            bStatus: statusMeta.bStatus
        };

        suggestions.push({
            id: key,
            actionType: 'link',
            aId,
            bId,
            a,
            b,
            score,
            confidence,
            surprise,
            reasons,
            graphScore,
            textScore,
            tagScore,
            profileScore,
            lexScore,
            geoScore,
            aStatus: statusMeta.aStatus,
            bStatus: statusMeta.bStatus,
            alias: aliasHint,
            bridge: bridgeScore,
            kind: suggestKind(a, b, score, mode, kindHint)
        });
    });

    const mergeSuggestions = [];
    mergeCandidates.forEach((key) => {
        const [aId, bId] = key.split('|');
        const suggestion = buildMergeSuggestion(aId, bId);
        if (suggestion) mergeSuggestions.push(suggestion);
    });

    mergeSuggestions.sort((x, y) => (y.score - x.score) || (y.confidence - x.confidence));
    const mergePairs = new Set(mergeSuggestions.map((suggestion) => suggestion.id));

    const linkSuggestions = suggestions
        .filter((suggestion) => !mergePairs.has(suggestion.id))
        .sort((x, y) => (y.score - x.score) || (y.confidence - x.confidence));

    if (!mergeSuggestions.length) {
        return selectSuggestionsWithNovelty(linkSuggestions, limit, noveltyRatio);
    }

    const mergeSlots = Math.min(
        mergeSuggestions.length,
        Math.max(1, Math.min(4, Math.round(limit * 0.35)))
    );
    const linkSlots = Math.max(0, limit - mergeSlots);
    const result = mergeSuggestions
        .slice(0, mergeSlots)
        .concat(selectSuggestionsWithNovelty(linkSuggestions, linkSlots, noveltyRatio));

    return result
        .sort((x, y) => (y.score - x.score) || (y.confidence - x.confidence))
        .slice(0, limit);
}
