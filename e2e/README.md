# Backend E2E

Objectif: fournir un environnement backend **isolé** (DB dédiée) pour exécuter des tests E2E Maestro côté mobile.

## 1) Créer le fichier d'env

- Copier `.env.e2e.example` vers `.env.e2e`
- Adapter `MONGO_URI` si besoin.

## 2) Préparer la DB E2E (reset + seed)

Depuis `tracknfield-mobile-back`:

- `npm run e2e:prepare`

Par défaut, cela crée un utilisateur:
- email: `e2e.user@example.com`
- password: `P@ssw0rd!`

Tu peux override via:
- `E2E_USER_EMAIL`
- `E2E_USER_PASSWORD`

## 3) Démarrer le serveur backend E2E

- `npm run e2e:start`

Le serveur écoute par défaut sur `PORT=4001`.

## Safety

Les scripts E2E refusent de toucher une base dont le `MONGO_URI` ne contient pas `e2e` ou `test`.
