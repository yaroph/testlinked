# BNI Linked V3

BNI Linked V3 est une suite web tactique en HTML, CSS et JavaScript. Le projet rassemble un graphe relationnel, une carte tactique, une console staff, une vue base de donnees, des fonctions Netlify et une couche collaborative temps reel.

## Vue d'ensemble

- `point/` : graphe relationnel, edition de fiches, liaisons, recherche, HVT et prediction IA.
- `map/` : carte tactique, points, zones, liaisons terrain, import, fusion et cloud.
- `staff/` : console d'administration et de publication des alertes.
- `database/` : lecture et controle des donnees sauvegardees.
- `netlify/functions/` : endpoints cloud, alertes, auth et persistence.
- `realtime/server/` : serveur local pour les sessions collaboratives.
- `shared/` : contrats, logique commune et outils de collaboration.
- `tests/` : tests Node et smoke tests Playwright.

## Points forts V3

- navigation multi-modules entre home, graphe, carte, staff et base
- collaboration cloud avec roles, boards et presence
- recherche differenciee entre recherche rapide et recherche mot-cle
- mode HVT avec propagation visuelle sur le reseau
- prediction IA sans code d'acces
- systeme d'import, fusion et sauvegarde locale ou cloud
- UI tactique unifiee, notamment sur les fermetures et les etats de chargement

## Changements recents inclus

- `map` affiche maintenant un empty state central avec demarrage direct
- le menu `Fichier` de `point` conserve son flux cloud d'origine
- les vues lentes du cloud affichent un vrai retour visuel de chargement
- `Gerer` et `Retour` dans le cloud evitent les doubles clics et montrent l'etat en cours
- la recherche mot-cle analyse nom, numero, description, notes et champs associes
- `Recherche rapide` reste volontairement limitee au nom
- la couleur HVT continue visuellement vers les noeuds relies

## Stack

- frontend statique HTML / CSS / JavaScript
- Netlify Functions
- Node.js
- WebSocket `ws`
- Yjs
- Playwright

## Prerequis

- Node.js 18+
- npm

## Installation

```bash
npm install
```

## Lancement local

Serveur temps reel :

```bash
npm run realtime:server
```

Serveur statique simple pour la navigation locale ou les smoke tests :

```bash
node tests/smoke/static-server.cjs --port 4173
```

Ensuite :

- home : `http://localhost:4173/`
- graphe : `http://localhost:4173/point/`
- carte : `http://localhost:4173/map/`

## Scripts utiles

```bash
npm test
npm run test:smoke
npm run test:verify
npm run realtime:server
```

## Variables d'environnement utiles

- `BNI_LINKED_KEY`
- `BNI_LINKED_REQUIRE_AUTH`
- `BNI_REALTIME_SECRET`
- `REALTIME_SECRET`
- `BNI_REALTIME_HTTP_URL`
- `BNI_REALTIME_WS_URL`
- `PORT`
- `PLAYWRIGHT_PORT`

## Structure rapide

```text
.
|-- database/
|-- map/
|-- netlify/
|   `-- functions/
|-- point/
|-- realtime/
|   `-- server/
|-- shared/
|-- staff/
`-- tests/
```

## Verification actuelle

Derniere verification locale validee :

- `npm test`
- `npm run test:smoke`

## Version

Ce depot correspond a la version `3.0.0` de BNI Linked V3.
