# TracknField Mobile Backend

## Switch rapide dev / prod (via fichiers .env)

Le serveur lit les variables d'environnement via `dotenv` au démarrage dans [server.js](server.js).
Tu peux forcer un fichier avec `ENV_FILE`.

### 1) Créer tes fichiers locaux

Depuis `tracknfield-mobile-back`:

- copier `.env.development.example` → `.env.development`
- copier `.env.production.example` → `.env.production`

Ces fichiers sont ignorés par git (`.env.*`).

### 2) Démarrer

- Dev (avec nodemon): `npm run dev:dev`
- Dev (node, sans reload): `npm run start:dev`
- Prod (node): `npm run start:prod`
- Prod (avec nodemon, utile pour tester la config): `npm run dev:prod`

## E2E

Voir [e2e/README.md](e2e/README.md) (utilise `ENV_FILE=.env.e2e`).
