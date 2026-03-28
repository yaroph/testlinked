# BNI Linked

Application web tactique en HTML, CSS et JavaScript avec :

- `point/` pour le graphe relationnel
- `map/` pour la carte tactique
- `staff/` pour la gestion des alertes
- `database/` pour la consultation des archives
- `netlify/functions/` pour le backend cloud

## Architecture actuelle

- frontend statique
- backend Netlify Functions
- stockage cloud via Firebase Realtime Database ou Netlify Blobs
- edition cloud en HTTP simple
- un seul editeur par board
- lecture seule pour les autres utilisateurs tant que le lock est pris
- autosave debounce + bouton `Sauvegarder`
- bouton `Arreter de modifier`
- bouton `Rafraichir` pour reprendre la main quand le board redevient libre

Le vieux runtime websocket/realtime a ete retire du repo.

## Installation

```bash
npm install
```

## Developpement local

Le serveur statique de smoke suffit pour naviguer localement :

```bash
node tests/smoke/static-server.cjs --port 4173
```

Pages utiles :

- `http://localhost:4173/`
- `http://localhost:4173/point/`
- `http://localhost:4173/map/`
- `http://localhost:4173/staff/`

## Tests

```bash
npm test
npm run test:smoke
npm run test:verify
```

## Deploiement

Le projet est deploye sur Netlify.

- production : `https://bni-linked.netlify.app`

Deploiement CLI :

```bash
npx netlify deploy --prod --dir . --functions netlify/functions
```

## Variables utiles

- `BNI_LINKED_KEY`
- `BNI_LINKED_REQUIRE_AUTH`
- `FIREBASE_DATABASE_URL`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `BNI_FIREBASE_STORE_NAMESPACE`

## Notes

- le lock d'edition cloud expire au bout de 60 secondes sans refresh
- les viewers ne recoivent plus de sync live automatique
- les changements cloud distants se recuperent via `Rafraichir`
