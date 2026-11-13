# Guide de contribution — TONDE Desktop

> Application desktop du guichetier (Tauri 2 + React 19).
> Lis ce guide et [TEAM_WORKFLOW.md](TEAM_WORKFLOW.md) avant de toucher au code.

---

## 1. Installer le projet (une seule fois)

```bash
git clone https://github.com/tonde-sys/tonde-desktop.git
cd tonde-desktop
npm install
cp .env.example .env.local
```

Prérequis détaillés (Node 20+, Rust stable, MSVC, WebView2) : voir [README.md](README.md).

Pour travailler sans backend : `npm run dev` avec `VITE_USE_MOCK=true` dans `.env.local`.
L'API mock ne fonctionne **qu'en mode DEV**.

---

## 2. Workflow Git

`main` est protégée. **On ne pousse jamais directement sur `main`.**

```bash
git checkout main
git pull origin main
git checkout -b feat/nom-de-ta-tache
```

| Préfixe | Quand l'utiliser |
|---------|-----------------|
| `feat/` | Nouvelle fonctionnalité |
| `fix/` | Correction de bug |
| `chore/` | Outillage, dépendances, CI |
| `docs/` | Documentation |

Ensuite : commits clairs → `git push -u origin feat/...` → Pull Request →
review de Vital → merge. Détail du processus dans [TEAM_WORKFLOW.md](TEAM_WORKFLOW.md).

### Messages de commit

Format `type: description courte à l'impératif` (français accepté) :

```
feat: transfert de ticket au clavier
fix: le comptoir reste ouvert après reconnexion
chore: ajouter la CI GitHub Actions
```

---

## 3. Vérifications avant de pousser

```bash
npm run build        # TypeScript strict + build Vite
npm test             # tests unitaires Vitest
cd src-tauri && cargo check && cargo test
```

La CI (`.github/workflows/ci.yml`) exécute les mêmes vérifications sur Windows.
Une PR qui casse `main` doit être corrigée avant merge.

---

## 4. Conventions de code

- **TypeScript strict** : pas de `any` non justifié, typer les retours d'API
  dans `src/types/`.
- **UI bilingue** : toute chaîne visible passe par `react-i18next`
  (`src/locales/fr.json` et `en.json`). Pas de texte en dur dans les composants.
- **Commentaires** : en français, uniquement pour expliquer le *pourquoi*
  (contrainte cachée, contournement, invariant).
- **Client HTTP unique** : tout appel réseau passe par `src/services/api/apiService.ts`
  (gestion d'erreur, enveloppe, refresh 401, timeout). Ne pas recréer de `fetch` ad hoc.
- **Persistance** : le cache local passe par `src/services/database/db.ts` → commandes
  Rust `db_*`. Le frontend doit rester fonctionnel hors Tauri (fallbacks silencieux).
- **Raccourcis clavier** : les définitions vivent dans `src/config/shortcuts.ts`
  et le dispatcher dans `src/hooks/useKeyboardShortcuts.ts`. Toute nouvelle action
  clavier doit être ajoutée aux deux et à l'aide `F12`.
- **Tests** : les fonctions pures (state machine, client API, stores) sont testées
  avec Vitest. Un correctif de bug mérite un test de non-régression.

---

## 5. Règles de sécurité

- **Jamais de secret dans le repo** : ni token, ni mot de passe, ni clé d'API,
  ni dans `.env.local` versionné. `.env.example` ne contient que des valeurs locales.
- **Jamais de token dans `localStorage`** : le token est géré par
  `src/services/secure/tokenStorage.ts` (coffre OS via Rust en production,
  `sessionStorage` uniquement en dev navigateur).
- **Jamais d'appel à l'API mock en production** : le mock est verrouillé derrière
  `import.meta.env.DEV`.
- Les erreurs affichées à l'agent ne doivent jamais exposer un token, une réponse
  brute du serveur ou une trace technique.

---

## 6. Checklist Pull Request

- [ ] Branche à jour depuis `main`
- [ ] `npm run build` passe
- [ ] `npm test` passe
- [ ] `cargo check` + `cargo test` passent (si `src-tauri/` modifié)
- [ ] Chaînes UI ajoutées dans `fr.json` **et** `en.json`
- [ ] Aucun secret, aucune donnée personnelle dans le diff
- [ ] Testé en mode mock (navigateur) et, si possible, en fenêtre Tauri
