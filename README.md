# BNI Linked V3

BNI Linked V3 est une suite web tactique en HTML, CSS et JavaScript. Le projet rassemble un graphe relationnel, une carte tactique, une console staff, une vue base de donnees, des fonctions Netlify et une couche collaborative temps reel.

## Vue d'ensemble

- `point/` : graphe relationnel, edition de fiches, liaisons, recherche, HVT et prediction IA.
- `map/` : carte tactique, points, zones, liaisons terrain, import, fusion et cloud.
- `staff/` : console d'administration et de publication des alertes.
- `database/` : lecture et controle des donnees sauvegardees.
- `netlify/functions/` : endpoints cloud, alertes, auth et persistence.
- `realtime/server/` : serveur Node pour les sessions collaboratives locales et prod.
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
npm run realtime:verify -- --site https://bni-linked.netlify.app --realtime https://realtime.example.com
```

## Variables d'environnement utiles

Netlify :

- `BNI_LINKED_KEY`
- `BNI_LINKED_REQUIRE_AUTH`
- `BNI_REALTIME_SECRET`
- `BNI_REALTIME_HTTP_URL`
- `BNI_REALTIME_WS_URL`

Serveur realtime externe :

- `BNI_REALTIME_SECRET`
- `REALTIME_SECRET`
- `NETLIFY_SITE_ID`
- `NETLIFY_AUTH_TOKEN`
- `BNI_NETLIFY_SITE_ID`
- `BNI_NETLIFY_AUTH_TOKEN`
- `PORT`
- `PLAYWRIGHT_PORT`

Un exemple complet est fourni dans [.env.example](./.env.example).

## Mise en prod du websocket

Le websocket realtime ne doit pas tourner sur le domaine Netlify principal. Le flux recommande :

1. Deployer le serveur Node `realtime/server/index.mjs` sur un host long-running.
2. Lui donner le meme `BNI_REALTIME_SECRET` que les Functions Netlify.
3. Configurer Netlify pour renvoyer `BNI_REALTIME_HTTP_URL` et `BNI_REALTIME_WS_URL`.
4. Donner au serveur externe l'acces Netlify Blobs avec `NETLIFY_SITE_ID` et `NETLIFY_AUTH_TOKEN`.
5. Redepoyer Netlify apres ajout des variables.
6. Verifier le healthcheck, le token endpoint et le handshake websocket.

Fichiers ajoutes pour accelerer ce setup :

- [Dockerfile](./Dockerfile) pour un deploiement container standard
- [render.yaml](./render.yaml) pour Render
- [railway.json](./railway.json) pour Railway
- [scripts/verify-realtime-prod.mjs](./scripts/verify-realtime-prod.mjs) pour verifier la chaine prod

### Variables Netlify

Configurer ces variables dans le dashboard Netlify du site statique :

```text
BNI_REALTIME_SECRET=<meme secret que le serveur websocket>
BNI_REALTIME_HTTP_URL=https://realtime.bni-linked.app
BNI_REALTIME_WS_URL=wss://realtime.bni-linked.app
```

### Variables du serveur realtime

Configurer ces variables sur Render, Railway, Fly.io ou autre host Node :

```text
BNI_REALTIME_SECRET=<meme secret que Netlify>
NETLIFY_SITE_ID=<site id Netlify>
NETLIFY_AUTH_TOKEN=<personal access token Netlify>
PORT=8787
```

Le serveur realtime sait aussi lire `BNI_NETLIFY_SITE_ID` et `BNI_NETLIFY_AUTH_TOKEN` si vous preferez des noms dedies.

### Verification

Verification healthcheck seule :

```bash
npm run realtime:verify -- --site https://bni-linked.netlify.app --realtime https://realtime.bni-linked.app
```

Verification complete avec session cloud et handshake websocket :

```bash
npm run realtime:verify -- --site https://bni-linked.netlify.app --realtime https://realtime.bni-linked.app --collabToken <session_token> --boardId <board_id> --page point
```

Le healthcheck du serveur websocket repond sur `/health` et valide maintenant :

- presence d'un secret non-par-defaut
- accessibilite du store Netlify Blobs
- chemin websocket `/ws`

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
