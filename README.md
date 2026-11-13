# TONDE Desktop — Poste Guichetier

Application desktop du guichetier TONDE (banques, hôpitaux, administrations).
Construite avec **Tauri 2** (Rust) + **React 19** + **TypeScript** + **TailwindCSS**.

L'agent au guichet travaille **100 % au clavier** : appeler le suivant, marquer un
absent, transférer un ticket, mettre le guichet en pause — sans jamais lâcher le clavier.
L'application reste utilisable **hors ligne** et resynchronise automatiquement.

---

## Prérequis

| Outil | Version | Notes |
|-------|---------|-------|
| Node.js | 20+ | Avec npm |
| Rust | stable | `rustup update stable` |
| MSVC Build Tools | 2019+ | Windows : « Desktop development with C++ » |
| WebView2 | — | Préinstallé sur Windows 10/11 |

Linux/macOS : voir les [prérequis Tauri](https://v2.tauri.app/start/prerequisites/).

---

## Démarrage rapide

```bash
git clone https://github.com/tonde-sys/tonde-desktop.git
cd tonde-desktop
npm install

# Configurer l'environnement (aucun secret dans ce fichier)
cp .env.example .env.local
# Adapter VITE_API_URL / VITE_WS_URL si le backend n'est pas en local

# Développement dans le navigateur, avec l'API mock (aucun backend requis)
npm run dev

# Développement dans la fenêtre Tauri (backend réel nécessaire)
npm run tauri dev
```

> L'API mock n'est active **qu'en mode DEV** (`npm run dev`) et seulement si
> `VITE_USE_MOCK=true`. Un build de production ne peut jamais utiliser le mock.

En mode mock, le login accepte **n'importe quel e-mail et mot de passe non vides** ;
le jeu de données de démonstration (guichets, files, tickets) est défini dans
[src/services/api/apiService.ts](src/services/api/apiService.ts).

---

## Variables d'environnement

Copier [.env.example](.env.example) vers `.env.local`. Les variables `VITE_*` sont
exposées au frontend : **ne jamais y mettre de secret**.

| Variable | Défaut | Rôle |
|----------|--------|------|
| `VITE_ENV` | `development` | `development` \| `staging` \| `production` |
| `VITE_API_URL` | localhost en dev, Render en staging/prod | Base du backend FastAPI |
| `VITE_WS_URL` | dérivé de `VITE_API_URL` (`http`→`ws`) | Base WebSocket temps réel |
| `VITE_API_PREFIX` | `/api/v1` | Préfixe REST (vide si le backend sert la racine) |
| `VITE_TONDE_ORG_ID` | — | Organisation du poste (multi-tenant) |
| `VITE_TONDE_BRANCH_ID` | — | Agence du poste (multi-tenant) |
| `VITE_USE_MOCK` | `false` | Active l'API mock locale en DEV uniquement |

---

## Connexion au backend Render

L'API pilote est déployée sur Render :
`https://tonde-api-pilot-fx1j.onrender.com` (préfixe `/api/v1`). Un build
`staging` ou `production` l'utilise par défaut, sans configuration.

- **Cold start** : le plan gratuit endort le service après 15 min d'inactivité.
  Le premier appel peut prendre jusqu'à ~30 s ; le client attend 30 s et affiche
  un message explicite en cas de dépassement.
- **CORS** : la WebView Tauri n'est pas une origine autorisée par le backend.
  Les requêtes passent donc par `@tauri-apps/plugin-http` (client natif Rust,
  hors CORS), avec repli sur `fetch` dans un navigateur. Les hôtes autorisés
  sont déclarés dans [src-tauri/capabilities/default.json](src-tauri/capabilities/default.json).
- **Contexte du poste** : le JWT agent ne contient pas l'organisation. Renseigner
  `VITE_TONDE_ORG_ID` / `VITE_TONDE_BRANCH_ID` au build, ou saisir ces deux
  identifiants une seule fois sur l'écran de sélection du guichet (mémorisés sur
  le poste). Les rôles d'administration les découvrent automatiquement.
- **Limites du contrat actuel** :
  - pas d'endpoint de rappel (`R` est masqué hors mode mock) ;
  - les guichets ne connaissent que ouvert/fermé : « pause » ferme le guichet ;
  - la file n'expose pas les tickets un par un : l'appel se fait via
    `/tickets/counter/call-next`, le service le plus chargé étant choisi ;
  - l'appel par identifiant de ticket n'existe pas hors ligne (501 explicite).

---

## Scripts

| Commande | Effet |
|----------|-------|
| `npm run dev` | Vite seul (navigateur + mock possible) |
| `npm run tauri dev` | App desktop complète (Rust + frontend, hot reload) |
| `npm run build` | Vérification TypeScript + build frontend |
| `npm test` | Tests unitaires (Vitest) |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run tauri build` | Installeur Windows (`.msi` / `.exe`) |

---

## Architecture

```
src/                       Frontend React
├── config/                API, WebSocket, raccourcis clavier
├── services/
│   ├── api/               Client HTTP unique (enveloppe, erreurs, refresh 401)
│   ├── database/          Pont vers le cache SQLite Rust (db_invoke)
│   └── secure/            Stockage du token (coffre OS)
├── store/                 Zustand : auth, comptoir, tickets, file, offline
├── hooks/                 Raccourcis clavier globaux
├── components/            UI (dashboard agent, transfert, aide raccourcis)
└── locales/               i18n fr / en

src-tauri/src/
├── commands/db.rs         Cache SQLite (WAL) + file de synchronisation
├── commands/storage.rs    Token : Windows Credential Manager + fallback
└── lib.rs                 Setup, état partagé, enregistrement des commandes
```

**Double client** : en production, l'app tourne dans Tauri et utilise SQLite +
le coffre OS. Dans un navigateur (dev), elle bascule sur des fallbacks mémoire /
`sessionStorage` — jamais de secret dans `localStorage`.

### Hors ligne

- Les tickets, comptoirs, files et services sont mis en cache dans SQLite à chaque
  réponse du backend.
- Les actions du guichetier (appel, absent, transfert, ouverture/fermeture) sont
  **optimistes** : l'UI répond immédiatement, l'action part dans une outbox persistée.
- L'outbox est rejouée au retour du réseau et au démarrage (3 tentatives max par action).
- Le statut de connexion est affiché en permanence dans la barre du bas.

### Sécurité du token

- Paire **access + refresh token** stockée via le **Gestionnaire d'identifiants
  Windows** (crate `keyring`), avec fallback chiffré par le plugin store si le
  coffre est indisponible.
- Aucun jeton n'est **jamais** persisté dans le state Zustand ni dans `localStorage`.
- Refresh automatique sur 401 (une seule tentative, hors routes `/auth/*`),
  rotation du refresh token à chaque renouvellement.

---

## Raccourcis clavier

| Touche | Action |
|--------|--------|
| `Espace` / `F1` | Appeler le ticket suivant |
| `Entrée` | Terminer le ticket en cours |
| `A` / `F2` | Marquer le client absent |
| `T` / `F3` | Transférer le ticket |
| `P` / `F4` | Pause / reprendre le guichet |
| `R` | Rappeler le ticket en cours (mode démo uniquement) |
| `F12` | Aide des raccourcis |
| `Ctrl+L` | Se déconnecter |
| `Échap` | Fermer le dialogue / annuler |

Les raccourcis sont ignorés pendant la saisie dans un champ texte.

---

## Contribution

Workflow branches + PR obligatoire : voir [CONTRIBUTING.md](CONTRIBUTING.md)
et [TEAM_WORKFLOW.md](TEAM_WORKFLOW.md).

## Documentation backend

Le contrat REST/WebSocket est défini par le repo `tonde-backend-` (FastAPI).
Toute évolution d'endpoint doit être vérifiée des deux côtés.
