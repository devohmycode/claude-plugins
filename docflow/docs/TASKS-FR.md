# docflow — Tâches

| | |
|---|---|
| Statut | Brouillon v0.1 |
| Date | 28 septembre 2026 |

Version anglaise : [TASKS.md](TASKS.md). Liste des travaux du [PRD](PRD-FR.md),
selon le plan de livraison de l'[architecture](ARCHITECTURE-FR.md) § 10 et les
valeurs des [spécifications](SPECS-FR.md). Chaque sprint se termine par un test
d'acceptation et n'est validé que s'il réussit.

## Comment travailler avec ce fichier

- Un sprint à la fois, dans l'ordre, sur une branche `docflow/S<n>-<slug>`
  depuis `main` (ou `docflow/S<n>-T<m>-<slug>` pour une tâche unique).
- Avant une tâche, lire les sections indiquées dans son `Refs`. Après, lancer
  `node --test tests/docflow` et `node scripts/sync-shared.mjs --check`, puis
  cocher la tâche dans ce fichier **et** dans TASKS-FR.md dans le même commit.
- Messages de commit : `<id>: <title>`, sans trailer d'attribution.
- Cocher la case d'acceptation d'un sprint en dernier, avec son résultat écrit
  dessous.
- Ouvrir une **draft** pull request vers `main` par sprint ; ne jamais la
  fusionner.
- Jusqu'à ce que S4 existe, ces étapes se font à la main ; à partir de S4,
  utiliser `/docflow:do` sur ce dépôt.

## S1 — Échafaudage

- [x] **S1-T1** Créer `docflow/` avec `.claude-plugin/plugin.json` (nom,
  version 0.1.0, auteur, licence, mots-clés) et le lister dans
  `.claude-plugin/marketplace.json` avec `"source": "./docflow"`.
  Refs: ARCHITECTURE § 3, PRD § 6.7.
- [x] **S1-T2** Lancer `node scripts/sync-shared.mjs` : copies partagées,
  locales vides, `userConfig.language`. Ajouter les autres options de
  `userConfig`. Refs: SPECS § 3. *Done when* `sync-shared.mjs --check` passe.
- [x] **S1-T3** `lib/config.mjs` : préséance des options et détection des
  checks. Refs: SPECS § 3. *Done when* les tests unitaires couvrent chaque
  niveau et chaque détecteur.
- [x] **S1-T4** `lib/state.mjs` : schéma 1, écritures atomiques, verrou avec
  expiration. Refs: SPECS § 4, ARCHITECTURE § 8.
- [x] **S1-T5** Point d'entrée `scripts/docflow.mjs` avec sortie `KEY=value`,
  codes de sortie, messages i18n, et le verbe `status`. Refs: SPECS § 5.
- [x] **S1-T6** Commandes `/docflow:status` et `/docflow:language` ;
  `locales/en.json` et ses trois traductions. Refs: PRD § 6.7.
- [x] **S1-T7** Harnais de test `tests/docflow/` avec dépôts temporaires et
  exécuteurs `git`/`gh` factices. Refs: ARCHITECTURE § 11.

- [x] **S1 acceptance** — Après installation locale du marketplace,
  `/docflow:status` sur un dépôt vide affiche chaque document comme `missing`
  et `NEXT=/docflow:prd` ; `node --test tests/docflow` et
  `sync-shared.mjs --check` passent ; les messages suivent
  `/docflow:language fr`.
  *Result (2026-09-28): passed — claude -p --plugin-dir docflow on an empty repository: /docflow:status printed the four documents as missing and NEXT=/docflow:prd; after /docflow:language fr the status message came in French; node --test tests/docflow/*.test.mjs 43/43, sync-shared.mjs --check and claude plugin validate pass.*

## S2 — Chaîne de documents

- [x] **S2-T1** Gabarits des quatre documents en anglais, avec les sections
  requises et les lignes de lien. Refs: SPECS § 2.
- [x] **S2-T2** `lib/docs.mjs` : squelette, index des sections, `section`,
  liens, empreintes, `check`. Refs: SPECS § 2, § 4.
- [x] **S2-T3** Verbes `stage`, `section`, `check`, `approve` avec la barrière
  et l'obsolescence. Refs: SPECS § 5, PRD § 6.1 (D-3, D-4).
- [x] **S2-T4** `lib/claudemd.mjs` et le verbe `claude-md`. Refs: SPECS § 7.
- [x] **S2-T5** Commandes `prd` (avec l'entretien), `architecture`, `specs`,
  `tasks`, `claude-md`, `approve`, `check`, `run`. Refs: ARCHITECTURE § 5.1–5.2.
- [x] **S2-T6** Mode d'adoption pour une base de code existante (`--adopt`) :
  résumé de la structure par script, S1 de `TASKS.md` pré-coché.
  Refs: PRD § 6.1 (D-5).
- [x] **S2-T7** Agent `writer`. Refs: ARCHITECTURE § 6.

- [x] **S2 acceptance** — Sur un dépôt vide, `/docflow:run` répété avec les
  approbations produit les quatre documents et le bloc `CLAUDE.md` ; chaque
  document renvoie vers ses voisins ; `/docflow:check` ne signale rien ;
  modifier le PRD approuvé marque les autres comme obsolètes dans
  `/docflow:status`.
  *Result (2026-09-28): passed — claude -p --plugin-dir docflow (sonnet) on an empty repository: five /docflow:run with approvals produced PRD, ARCHITECTURE, SPECS, TASKS (17 entries) and a 13-line CLAUDE.md block; each document links to the three others; docflow check reported ISSUES=0; after editing the approved PRD, status showed PRD draft and ARCHITECTURE, SPECS, TASKS stale.*

## S3 — Traductions

- [x] **S3-T1** Empreintes de section par jumeau dans l'état ; `translate
  plan`. Refs: SPECS § 4, PRD § 6.2.
- [x] **S3-T2** `translate apply` : fusionner les sections, réécrire les
  lignes de lien, enregistrer les empreintes. Refs: SPECS § 2, § 5.
- [x] **S3-T3** Gabarits en français, espagnol et allemand. Refs: SPECS § 2.
- [x] **S3-T4** Agent `translator` et `/docflow:translate` ; identifiants,
  code et chemins non modifiés. Refs: ARCHITECTURE § 5.4, § 6.
- [x] **S3-T5** `check` couvre les jumeaux : sections manquantes, en trop ou
  obsolètes. Refs: PRD § 6.2 (L-4).

- [x] **S3 acceptance** — Avec `doc_languages: fr`, la chaîne de S2 produit
  les jumeaux français ; modifier une section anglaise puis lancer
  `/docflow:translate` n'envoie que cette section ; `/docflow:check` ne
  signale plus rien ensuite.
  *Result (2026-09-28): passed — claude -p --plugin-dir docflow on the S2 acceptance project with doc_languages fr: /docflow:translate wrote PRD-FR, ARCHITECTURE-FR, SPECS-FR and TASKS-FR through haiku translator agents (ids, grammar and paths kept); after one sentence was added to SPECS § 3, /docflow:translate specs sent a source file holding that section only; docflow check reported ISSUES=0 before and after.*

## S4 — Moteur de mise en œuvre

- [x] **S4-T1** `lib/tasks.mjs` : analyseur, unité `next`, coche dans les
  jumeaux, résultats, numéros d'issue. Refs: SPECS § 6. *Done when* les tests
  golden-file passent.
- [x] **S4-T2** `lib/run.mjs` : branche de base, nommage de branche, worktree
  ou sur place, checks avec fin de log, commit, push, draft pull request,
  restauration. Refs: SPECS § 8, ARCHITECTURE § 5.3.
- [x] **S4-T3** Verbes `task show`, `do start|check|commit|acceptance|result|finish`
  et `--resume`. Refs: SPECS § 5.
- [x] **S4-T4** Commande `/docflow:do` pour les implémenteurs `session`,
  `task` et `sprint` ; agents `implementer` et `acceptance`. Refs: PRD § 6.4.
- [x] **S4-T5** Hooks : garde (`PreToolUse`) et complétude (`Stop`,
  `SubagentStop`) délimités avec `scope.mjs`. Refs: SPECS § 8, ARCHITECTURE § 7.

- [x] **S4 acceptance** — Sur un projet d'exemple avec un sprint de deux
  tâches : `/docflow:do next` met en œuvre le sprint sur `docflow/S1-…`,
  exécute les checks, coche les deux tâches et l'acceptation dans
  `TASKS.md` et son jumeau, ouvre une draft pull request ; `main` reste
  inchangée ; pendant l'exécution, `git push origin main` et `gh pr merge`
  sont refusés ; un échec de check forcé arrête l'exécution et `--resume`
  la termine.
  *Result (2026-09-28): passed — claude -p --plugin-dir docflow (sonnet) on a sample Node project with a two-task sprint, a French twin of TASKS.md, a bare origin and a fake gh: /docflow:do next with checks forced to fail stopped at S1-T1 (RUN=failed:S1, branch kept); in the same session git push origin main and gh pr merge 1 were refused by the hook; /docflow:do --resume in a new session implemented both tasks on docflow/S1-adding, ticked them and the acceptance in TASKS.md and TASKS-FR.md, and opened a draft pull request against main; main and origin/main unchanged.*

## S5 — Miroir des issues

- [x] **S5-T1** `lib/issues.mjs` et `issues push` : créer, mettre à jour, ne
  jamais dupliquer ; commentaire de clé de suivi. Refs: SPECS § 8, PRD § 6.8.
- [x] **S5-T2** Numéros d'issue dans `TASKS.md` ; `Closes #` dans les draft
  pull requests. Refs: PRD § 6.8 (S-2).
- [x] **S5-T3** `issues pull` et `--apply`. Refs: PRD § 6.8 (S-3).
- [x] **S5-T4** Commande `/docflow:issues` avec les checks du dépôt et de
  GitHub. Refs: PRD § 6.7 (M-2).

- [x] **S5 acceptance** — Avec `issues: mirror`, lancer `/docflow:issues push`
  deux fois ne crée chaque issue qu'une fois ; la détection de clé façon
  `/tracker:open` les retrouve ; la draft pull request d'un sprint ferme les
  issues de ses tâches quand elle est fusionnée à la main ; une issue fermée
  à la main est signalée par `/docflow:issues pull`.
  *Result (2026-09-28): passed — claude -p --plugin-dir docflow (sonnet) on a sample project with issues mirror, a French twin of TASKS.md, a bare origin and a fake gh: /docflow:issues push created five issues (#1 to #5: two sprints, their acceptance tests labelled acceptance) and wrote their numbers in TASKS.md and TASKS-FR.md; a second push created nothing (UNCHANGED=5); the tracker plugin keysInBody read id:docflow-<id> on each of them; the S1 run opened a draft pull request listing Closes #1, #2 and #3 and not #4; after S1 was merged by hand and its issues closed, #4 closed by hand was the only one /docflow:issues pull reported, and the command asked before applying.*

## S6 — Documentation et mise en pratique

- [ ] **S6-T1** `docflow/README.md` (et `README-FR.md`) : installation,
  options, commandes, le flux, astuces de tokens.
- [ ] **S6-T2** Publication 0.1.0 du marketplace : versions dans
  `plugin.json` et `marketplace.json`, entrée dans le README racine.
- [ ] **S6-T3** Appliquer docflow à Taskbar Hub avec `--adopt` et faire
  passer un sprint par `/docflow:do`.
- [ ] **S6-T4** Mesurer les budgets de SPECS § 10 et les checks de tokens de
  PRD § 11 ; les consigner.

- [ ] **S6 acceptance** — Chaque critère d'acceptation de PRD § 11 passe sur
  une installation neuve depuis le marketplace ; le sprint Taskbar Hub a
  produit une draft pull request avec les tâches cochées et aucune
  modification manuelle de `TASKS.md`.
