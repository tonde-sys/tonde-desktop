# Distribution et mise à jour — TONDE Desktop

Ce document couvre la publication d'un installeur Windows et la mise à jour
automatique des postes déjà installés. Il ne remplace pas une procédure de
recette : voir la checklist en fin de page.

---

## 1. Deux signatures, deux problèmes différents

C'est la confusion la plus fréquente, et elle coûte cher.

| | Authenticode (certificat Windows) | minisign (clé Tauri) |
|---|---|---|
| Protège contre | « Éditeur inconnu », SmartScreen | Un paquet de mise à jour falsifié |
| Vérifié par | Windows, au lancement de l'installeur | L'application, avant d'installer |
| Coût | 250–700 €/an, ou ~10 €/mois en Azure | Gratuit, généré localement |
| État aujourd'hui | **non configuré** | **configuré** |

La mise à jour automatique fonctionne **dès maintenant** : elle repose
uniquement sur la clé minisign. Authenticode reste une décision d'achat, sans
laquelle Windows affichera un avertissement au premier lancement.

---

## 2. La clé de mise à jour

Générée sur le poste de développement :

```
C:\Users\Vizane\.tonde\tonde-updater.key        <- privée, à sauvegarder
C:\Users\Vizane\.tonde\tonde-updater.key.pub    <- publique, déjà dans la config
```

La clé publique est en dur dans `src-tauri/tauri.conf.json`
(`plugins.updater.pubkey`). Elle doit correspondre exactement à la clé privée
utilisée par la CI, sinon **tous les postes refuseront la mise à jour**.

À faire une seule fois :

1. Copier `tonde-updater.key` dans un gestionnaire de secrets (hors machine).
2. GitHub → `tonde-sys/tonde-desktop` → Settings → Secrets → Actions :
   - `TAURI_SIGNING_PRIVATE_KEY` : contenu intégral du fichier `.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` : vide (la clé a été générée sans mot de passe)

> **Si la clé est perdue**, il n'existe aucun recours : chaque poste installé
> devra être réinstallé à la main avec un installeur signé par une nouvelle
> clé. C'est le seul point de défaillance irréversible de la chaîne.

---

## 3. Publier une version

Les trois fichiers de version doivent rester alignés, sinon l'updater ne
proposera jamais la mise à jour :

```bash
# 1. Bump (les trois, à la même valeur)
#    package.json · src-tauri/Cargo.toml · src-tauri/tauri.conf.json

# 2. Commit + tag
git add -A
git commit -m "chore(release): 0.2.1"
git tag v0.2.1
git push origin main --tags
```

Le workflow `.github/workflows/release.yml` prend le relais :

1. vérifie que `vX.Y.Z` == version de `package.json` == version de `Cargo.toml`
   (échec immédiat sinon) ;
2. construit `msi` et `nsis` sur `windows-latest` ;
3. signe les artefacts de mise à jour avec la clé minisign ;
4. publie une release GitHub avec `latest.json`.

Sortie locale si besoin de construire à la main :

```bash
npm run tauri build
# src-tauri/target/release/bundle/msi/*.msi
# src-tauri/target/release/bundle/nsis/*-setup.exe
```

---

## 4. Ce que fait le poste

- Vérification **8 s** après le démarrage, puis toutes les **6 h**.
- Si une version supérieure existe : bandeau en bas à droite, avec le numéro
  de version et un bouton **Installer**.
- **Aucun redémarrage automatique.** L'agent installe quand aucun ticket n'est
  en service ; l'application se relance ensuite (`relaunch`).
- « Plus tard » mémorise la version écartée : le bandeau ne revient qu'à la
  version suivante.
- Poste hors-ligne, proxy filtrant, endpoint indisponible : échec **silencieux**
  (une trace dans la console uniquement). Le guichet ne doit jamais être bloqué
  par une vérification de mise à jour.

Endpoint :

```
https://github.com/tonde-sys/tonde-desktop/releases/latest/download/latest.json
```

> Dépendance à surveiller : cet endpoint suppose le dépôt **public**. S'il passe
> en privé, les postes perdront la mise à jour (l'updater n'envoie pas de token).
> Il faudra alors héberger `latest.json` sur un domaine à toi.

---

## 5. Authenticode — les trois options

### a) Certificat OV (le plus courant)

- 250–450 €/an, clé sur support matériel ou HSM cloud.
- SmartScreen reste méfiant les premières semaines : la réputation se construit
  avec le volume de téléchargements.

### b) Certificat EV

- 400–700 €/an, réputation immédiate auprès de SmartScreen.
- Contraignant : clé matérielle obligatoire, pas d'export.

### c) Azure Trusted Signing (le meilleur rapport qualité/prix)

- ~10 €/mois, signature dans le cloud, pas de support physique.
- Validation d'identité de l'entreprise requise (ancienneté et documents).
- C'est l'option que je recommande pour un premier client bancaire.

Une fois le certificat obtenu, **aucune modification de code** : il suffit de
renseigner le secret `TAURI_WINDOWS_SIGN_CONFIG` avec un JSON fusionné dans la
configuration au moment du build.

Avec Azure Trusted Signing (via `trusted-signing-cli`) :

```json
{"bundle":{"windows":{"signCommand":{"cmd":"trusted-signing-cli","args":["-e","https://eus.codesigning.azure.net/","-a","<compte>","-c","<profil>","-r","<region>","%1"]}}}}
```

Avec un certificat PFX installé sur le runner :

```json
{"bundle":{"windows":{"certificateThumbprint":"<empreinte>","digestAlgorithm":"sha256","timestampUrl":"http://timestamp.digicert.com"}}}
```

### d) Pilote sans certificat (auto-signé)

Acceptable pour 2–5 postes chez un client pilote, à condition que son service
informatique installe le certificat racine dans le magasin « Autorités de
confiance » (GPO). Sans cela, chaque poste affiche « Éditeur inconnu » et il
faut cliquer « Informations complémentaires → Exécuter quand même ».

---

## 6. Installation chez un client

Le bundle est en `perMachine` : installation pour tous les utilisateurs du
poste, droits administrateur requis (normal en environnement bancaire).

```bat
:: MSI, silencieux (GPO / Intune / SCCM)
msiexec /i "TONDE Desktop_0.2.0_x64_en-US.msi" /qn

:: NSIS, silencieux
"TONDE Desktop_0.2.0_x64-setup.exe" /S
```

Après installation, le poste a besoin de son contexte :

```
VITE_TONDE_ORG_ID=<uuid de l'organisation>
VITE_TONDE_BRANCH_ID=<uuid de l'agence>
```

fournis **au build** (variables d'environnement au moment de `npm run tauri
build`), ou saisis une fois à l'écran de sélection du guichet.

### Checklist de recette, par poste

- [ ] l'agent se connecte avec **son** compte (pas un compte partagé) ;
- [ ] le guichet s'ouvre, un ticket est appelé puis terminé ;
- [ ] l'écran de salle affiche le numéro dans la seconde ;
- [ ] débrancher le réseau : la file reste consultable, les actions partent en
      file d'attente locale et se rejouent à la reconnexion ;
- [ ] le bandeau de mise à jour apparaît quand une version supérieure existe ;
- [ ] « Plus tard » ne fait pas revenir le bandeau au redémarrage.

---

## 7. Limites connues

- **x64 uniquement** — pas de build arm64 ni 32 bits.
- **CSP désactivée** (`app.security.csp: null`) : à durcir avant une mise en
  production large, sinon une injection dans le WebView n'est pas contenue.
- **Pas de MSIX** : certains services informatiques ne déploient que par ce
  format. À prévoir si un client l'exige.
- **Mise à jour non différentielle** : chaque version télécharge l'installeur
  complet (~10–20 Mo).
