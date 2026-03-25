# BNI Linked V3

BNI Linked V3 est une suite web tactique en HTML, CSS et JavaScript. Le projet rassemble un graphe relationnel, une carte tactique, une console staff, une vue base de donnees, un backend Node de collaboration temps reel et un stockage Firebase.

## Production

- frontend public : `https://bni-linked.web.app`
- hebergement statique : Firebase Hosting
- backend API + websocket : Cloud Run
- stockage runtime : Firebase Realtime Database

## Vue d'ensemble

- `point/` : graphe relationnel, edition de fiches, liaisons, recherche, HVT et prediction IA.
- `map/` : carte tactique, points, zones, liaisons terrain, import, fusion et cloud.
- `staff/` : console d'administration et de publication des alertes.
- `database/` : lecture et controle des donnees sauvegardees.
- `netlify/functions/` : logique backend legacy, reusee par le serveur Cloud Run.
- `realtime/server/` : serveur Node unique pour les sessions collaboratives, les endpoints API et le websocket.
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
- `map/carte.jpg` a ete recompressee pour reduire fortement le poids au chargement

## Stack

- frontend statique HTML / CSS / JavaScript
- Firebase Hosting
- Firebase Realtime Database via Admin SDK
- Node.js
- Cloud Run
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

Backend local Cloud Run style :

```bash
npm run realtime:server
```

Serveur statique simple pour la navigation locale ou les smoke tests.
Il proxifie `/.netlify/functions/**`, `/api/**` et `/health` vers `http://127.0.0.1:8787` par defaut :

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
npm run realtime:verify -- --site https://your-project.web.app --realtime https://bni-linked-backend-xxxxx-ew.a.run.app
```

## Variables d'environnement utiles

Backend Cloud Run :

- `BNI_LINKED_KEY`
- `BNI_LINKED_REQUIRE_AUTH`
- `FIREBASE_DATABASE_URL`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON` optionnelle en local
- `BNI_REALTIME_SECRET`
- `BNI_REALTIME_HTTP_URL`
- `BNI_REALTIME_WS_URL`
- `PORT`
- `PLAYWRIGHT_PORT`

Un exemple complet est fourni dans [.env.example](./.env.example).

## Deploiement cible

Architecture recommandee :

1. Deployer le frontend statique sur Firebase Hosting avec [firebase.json](./firebase.json).
2. Deployer [realtime/server/index.mjs](./realtime/server/index.mjs) sur Cloud Run.
3. Configurer Cloud Run avec `--max-instances=1` au debut pour garder une coherence simple.
4. Configurer Firebase Realtime Database pour stocker :
   - boards collaboratifs
   - sessions auth
   - presence
   - alertes
   - archives `db-*`
5. Faire pointer Firebase Hosting vers Cloud Run via les rewrites `/.netlify/functions/**` et `/api/**`.

Fichiers ajoutes pour accelerer ce setup :

- [Dockerfile](./Dockerfile) pour un deploiement container standard
- [firebase.json](./firebase.json) pour Firebase Hosting
- [scripts/deploy-cloudrun.ps1](./scripts/deploy-cloudrun.ps1) pour `gcloud builds submit` puis `gcloud run deploy`
- [scripts/migrate-netlify-to-firebase.mjs](./scripts/migrate-netlify-to-firebase.mjs) pour copier les stores Netlify existants vers Firebase
- [scripts/verify-realtime-prod.mjs](./scripts/verify-realtime-prod.mjs) pour verifier la chaine prod

### Cloud Run

Exemple de deploiement :

```powershell
./scripts/deploy-cloudrun.ps1 `
  -ProjectId your-project-id `
  -Region europe-west1 `
  -ServiceName bni-linked-backend `
  -DatabaseUrl https://your-project-id-default-rtdb.europe-west1.firebasedatabase.app `
  -RealtimeSecret <long-random-secret>
```

### Firebase Hosting

Le fichier [firebase.json](./firebase.json) :

- publie le front statique
- recrit `/.netlify/functions/**` vers le service Cloud Run `bni-linked-backend`
- recrit `/api/**` vers le meme service
- garde `/health` accessible

Deploiement :

```bash
firebase deploy --only hosting
```

### Migration des donnees

Pour copier les stores Netlify Blobs existants vers Firebase avant la coupure :

```bash
npm run migrate:netlify
```

Par defaut, le script migre :

- `bni-linked-collab`
- `bni-linked-alerts`
- `bni-linked-db`

Options utiles :

- `npm run migrate:netlify -- --wipe` pour vider d abord la cible Firebase
- `npm run migrate:netlify -- --stores bni-linked-collab,bni-linked-alerts` pour limiter la copie

### Verification

Verification healthcheck seule :

```bash
npm run realtime:verify -- --site https://your-project.web.app --realtime https://bni-linked-backend-xxxxx-ew.a.run.app
```

Verification complete avec session cloud et handshake websocket :

```bash
npm run realtime:verify -- --site https://your-project.web.app --realtime https://bni-linked-backend-xxxxx-ew.a.run.app --collabToken <session_token> --boardId <board_id> --page point
```

Le healthcheck du serveur websocket repond sur `/health` et valide maintenant :

- presence d'un secret non-par-defaut
- accessibilite du store Firebase
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

Verification deploiement Firebase validee :

- `https://bni-linked.web.app/`
- `https://bni-linked.web.app/point/`
- `https://bni-linked.web.app/map/`
- `https://bni-linked.web.app/health`
- creation d'un compte, creation d'un board, token realtime et handshake websocket

## Version

Ce depot correspond a la version `3.0.0` de BNI Linked V3.
