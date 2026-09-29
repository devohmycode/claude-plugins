# docflow — Product Requirements Document

| | |
|---|---|
| Statut | Brouillon v0.2 — décisions du § 12 consignées |
| Date | 28 septembre 2026 |
| Nature | Plugin Claude Code, marketplace `devohmycode-plugins` |

Version anglaise : [PRD.md](PRD.md). Documents suivants :
l'[architecture](ARCHITECTURE-FR.md), les [spécifications](SPECS-FR.md) et
les [tâches](TASKS-FR.md).

## 1. Vision

docflow mène un projet de l'idée au code fusionné par une chaîne fixe de
documents, puis laisse un agent mettre le plan en œuvre tâche par tâche ou
sprint par sprint, sur des branches, avec des tests, une liste de tâches
cochée et des pull requests en brouillon.

```text
PRD ──► ARCHITECTURE ──► SPECS ──► TASKS ──► CLAUDE.md ──► mise en œuvre
quoi et   comment        valeurs    sprints    règles pour   branche · vérifications ·
pourquoi  (modules)      exactes    et tâches  chaque agent  coche · commit · PR brouillon
```

Chaque document renvoie aux autres : tout agent qui en ouvre un trouve le cadre
complet et le suit exactement. Le plugin ne dépense des tokens de modèle que
pour rédiger et coder ; tout ce qui est mécanique est fait par des scripts.

## 2. Problème

- Demander à un agent de « construire l'application » donne un travail sans
  intention traçable : aucune exigence pour le vérifier, aucun plan pour le
  reprendre.
- Écrire ce cadre à la main est long, et garder cohérents quatre documents,
  leurs traductions et une liste de tâches est source d'erreurs.
- Les longues sessions d'agent accumulent du contexte : les mêmes fichiers sont
  relus, l'historique grossit, et le coût augmente à chaque tâche.
- Sans garde-fou, un agent commite sur `main`, oublie les tests, laisse la liste
  de tâches périmée ou ouvre une pull request fusionnée sans relecture.

## 3. Objectifs et non-objectifs

### Objectifs

1. Une commande par document, dans un ordre fixe, chacune ne lisant que ce dont
   elle a besoin.
2. Un enchaînement optionnel de toute la chaîne, avec un point de validation
   humaine après chaque document et un état reprenable.
3. Une mise en œuvre par tâche ou par sprint, chacune sur sa branche, conclue
   par les vérifications du projet, un `TASKS.md` coché, un commit et une pull
   request **en brouillon**.
4. Des traductions optionnelles des documents (`<NOM>-FR.md`, ainsi qu'en
   espagnol ou en allemand), mises à jour de façon incrémentale.
5. Un budget de tokens traité comme une exigence (§ 7).

### Non-objectifs

- Aucune fusion : docflow ne fusionne jamais de pull request et ne pousse
  jamais sur la branche par défaut.
- Aucun service de gestion de projet : `TASKS.md` dans le dépôt reste la
  seule source de vérité ; les issues GitHub n'en sont qu'un miroir optionnel
  (§ 6.8).
- Aucune génération de code hors de la tâche en cours.

## 4. Utilisateurs

- Un développeur qui démarre un projet et veut un cadre documenté avant le
  code.
- Un développeur qui reprend une base de code existante et veut le même cadre,
  écrit à partir du code (§ 6.1, mode adoption).
- Un agent qui reprend le travail dans une session ultérieure : il lit
  `CLAUDE.md`, puis `TASKS.md`, et sait exactement quoi faire ensuite.

## 5. Concepts

| Terme | Définition |
|---|---|
| **Chaîne de documents** | `docs/PRD.md` → `docs/ARCHITECTURE.md` → `docs/SPECS.md` → `docs/TASKS.md` → `CLAUDE.md`. Chaque document ne peut être écrit qu'une fois le précédent approuvé. |
| **Traduction** | `docs/<NOM>-<LANGUE>.md` (`FR`, `ES`, `DE`) à côté de chaque document anglais, même structure, liens dans les deux sens. |
| **Tâche** | Une ligne de `TASKS.md` : case à cocher, identifiant `S<n>-T<m>`, titre, références (`SPECS § 3.2`), condition *Terminé quand* optionnelle. |
| **Sprint** | Un groupe de tâches `S<n>` terminé par un **test d'acceptation** ; validé seulement s'il réussit. |
| **Exécution** | Une mise en œuvre d'une tâche ou d'un sprint : une branche, un worktree optionnel, des vérifications, un ou plusieurs commits, une pull request en brouillon. |
| **État** | `.docflow/state.json` : documents approuvés, étape en cours, verrou et exécution en cours. |

## 6. Exigences fonctionnelles

### 6.1 Documents

| Commande | Lit | Écrit |
|---|---|---|
| `/docflow:prd [idée]` | Les réponses de l'utilisateur à un court entretien (objectif, utilisateurs, périmètre, contraintes) | `docs/PRD.md` |
| `/docflow:architecture` | PRD ; pour une base de code existante, un résumé de sa structure produit par script | `docs/ARCHITECTURE.md` |
| `/docflow:specs` | PRD, architecture | `docs/SPECS.md` |
| `/docflow:tasks` | Plan de livraison de l'architecture, titres des SPECS | `docs/TASKS.md` |
| `/docflow:claude-md` | L'état seul (script) | Bloc de `CLAUDE.md` entre marqueurs |

- **D-1** Un script écrit d'abord le squelette de chaque document : tableau
  d'en-tête (statut, date), lien vers la traduction, liens vers les documents
  voisins et titres des sections obligatoires. Le modèle ne remplit que les
  sections.
- **D-2** Sections obligatoires : PRD (vision, problème, objectifs et
  non-objectifs, utilisateurs, exigences fonctionnelles et non fonctionnelles,
  critères d'acceptation, questions ouvertes) ; ARCHITECTURE (point de départ,
  vue d'ensemble, modules, contrats, données, plan de livraison, tests,
  décisions) ; SPECS (valeurs exactes : réglages, formats, limites,
  identifiants, budgets) ; TASKS (méthode de travail, sprints, tests
  d'acceptation).
- **D-3** Chaque document se termine par ses questions ouvertes ou ses
  décisions ; l'approuver (`/docflow:approve <doc>`) l'enregistre dans l'état.
  Un document suivant refuse de démarrer tant que le précédent n'est pas
  approuvé.
- **D-4** Modifier un document approuvé marque les suivants comme *périmés* ;
  `/docflow:status` les liste avec la commande pour rafraîchir chacun.
- **D-5** Mode adoption (`--adopt`) : pour une base de code existante,
  l'architecture décrit le code actuel avant la cible, et `TASKS.md` peut
  commencer par un sprint S1 déjà coché pour ce qui existe.
- **D-6** `CLAUDE.md` : docflow ne gère que le bloc compris entre
  `<!-- docflow:start -->` et `<!-- docflow:end -->`, de 40 lignes au plus : la
  chaîne de documents avec ses liens, les règles de travail (branche,
  vérifications, coche, pull request en brouillon, aucune fusion) et la
  prochaine commande à lancer. Le reste du fichier n'est jamais modifié.

### 6.2 Traductions

- **L-1** Option `doc_languages` (aucune par défaut ; parmi `fr`, `es`, `de`).
  Pour chacune, chaque document reçoit son jumeau `-FR`, `-ES` ou `-DE`.
- **L-2** Le document anglais fait référence. Un script calcule l'empreinte de
  chaque section anglaise ; seules les sections dont l'empreinte a changé sont
  envoyées à la traduction, puis réinsérées dans le jumeau.
- **L-3** La traduction s'exécute dans un agent dédié, sur un petit modèle par
  défaut ; le code, les identifiants, les commandes et les chemins ne sont
  jamais traduits.
- **L-4** Une vérification (`docflow check docs`) signale les jumeaux aux
  sections manquantes, en trop ou périmées, et les liens cassés ; elle
  s'exécute avant chaque approbation.

### 6.3 Enchaînement

- **C-1** `/docflow:run` exécute la prochaine étape en attente de la chaîne,
  puis s'arrête au point de validation (montrer le document, proposer
  d'approuver, de modifier ou d'arrêter). `--through <étape>` franchit les
  points de validation uniquement pour les étapes que l'utilisateur a déjà
  approuvées une fois.
- **C-2** L'état rend chaque étape reprenable dans une nouvelle session :
  `/docflow:run` part toujours de l'état, jamais de la mémoire.
- **C-3** `/docflow:status` affiche, par le script seul, la chaîne (approuvé,
  périmé, manquant), l'avancement des sprints et la prochaine commande.

### 6.4 Mise en œuvre

- **I-1** `/docflow:do <tâche|sprint|next>` : `next` prend la première tâche
  non cochée, ou le sprint en cours en mode sprint (option `unit` : `task` ou
  `sprint`).
- **I-2** Le verrou d'abord : une seule exécution à la fois par dépôt ; un
  verrou occupé termine avec un message clair et ne modifie rien. docflow a son
  propre moteur de verrou, de branches et de pull requests, et ne dépend pas de
  `tracker`.
- **I-3** Le script crée la branche `docflow/<S1-T3>-<slug>` ou
  `docflow/<S2>-<slug>` depuis la branche par défaut, dans un worktree si
  `worktree` est activé, et affiche les lignes de tâches et les sections
  référencées.
- **I-4** Qui met en œuvre (option `implementer`) : `task` (un agent neuf par
  tâche), `sprint` (un agent pour le sprint) ou `session` (la session courante,
  sans agent — le moins de tokens quand le code est déjà chargé).
- **I-5** Après chaque tâche : la commande de vérification du projet (option
  `checks`, par exemple `cargo test --locked`) doit réussir ; le script coche la
  tâche dans `TASKS.md` (et dans ses jumeaux) et commite le code et la coche
  ensemble, avec un message construit à partir de l'identifiant et du titre de
  la tâche.
- **I-6** Fin d'un sprint : le test d'acceptation est exécuté (par l'agent, ou
  listé pour l'utilisateur s'il est manuel) ; son résultat est écrit sous la
  case d'acceptation, qui n'est cochée qu'en cas de succès.
- **I-7** Le script pousse la branche et ouvre une pull request **en
  brouillon** dont la description liste les tâches cochées, les vérifications
  et le résultat de l'acceptation, puis libère le verrou. Il ne fusionne
  jamais.
- **I-8** Une vérification en échec arrête l'exécution en conservant la branche
  et sans cocher la tâche ; `/docflow:do --resume` reprend à partir de là.

### 6.5 Garde-fou

- **G-1** Tant qu'une exécution tient le verrou, des hooks refusent : commits et
  pushs sur la branche par défaut, pushs forcés, `gh pr merge`, et
  modifications des documents approuvés autres que la coche de `TASKS.md`. Le
  garde-fou est limité à la session et au dépôt, comme le garde-fou partagé de
  la marketplace.
- **G-2** Un hook `Stop` refuse de terminer une exécution dont la dernière tâche
  n'est ni cochée ni signalée en échec.

### 6.6 Options

Réglées dans `/config` (`userConfig`), remplaçables par projet dans
`.docflow/config.json`, et par commande au moyen d'arguments.

| Option | Valeurs | Défaut |
|---|---|---|
| `language` | `en`, `fr`, `es`, `de` (messages du plugin) | `en` |
| `doc_languages` | liste parmi `fr`, `es`, `de` | aucune |
| `unit` | `task`, `sprint` | `sprint` |
| `implementer` | `task`, `sprint`, `session` | `session` |
| `issues` | `off`, `mirror` | `off` |
| `worktree` | `on`, `off` | `off` |
| `checks` | commande shell | détectée depuis le projet (`cargo`, `npm`, `pytest`…) |
| `branch_prefix` | chaîne | `docflow/` |
| `<étape>_model`, `<étape>_effort` | par étape : `writer`, `translator`, `implementer`, `acceptance` | `writer` inherit · `translator` haiku · `implementer` inherit · `acceptance` sonnet |

### 6.7 Règles de la marketplace

- **M-1** Messages en anglais, français, espagnol et allemand via le moteur
  i18n partagé ; fichiers d'instructions en anglais.
- **M-2** Les commandes qui ont besoin de git vérifient l'état du dépôt avec le
  `repo.mjs` partagé et proposent de le créer (contrat `REPO=`), en demandant
  avant de créer un dépôt GitHub.
- **M-3** Le plugin vit dans `docflow/` et figure dans
  `.claude-plugin/marketplace.json`. C'est un écart volontaire au nommage
  `<nom>-plugin/` des autres plugins (décision du § 12).

### 6.8 Miroir des issues GitHub

Avec `issues: mirror`, les tâches sont reflétées en issues GitHub pour que
`tracker` ou une personne puisse les prendre en charge ; `TASKS.md` reste la
source de vérité.

- **S-1** `/docflow:issues push` crée une issue par tâche non cochée, intitulée
  `S2-T3 <titre>`, avec les étiquettes `docflow` et `sprint:S2`, et dont la
  description contient la ligne de la tâche, ses références et une clé de
  déduplication `docflow:<id de tâche>`, écrite au format de clé que `tracker`
  reconnaît. Une nouvelle exécution ne crée rien en double et met à jour les
  titres ou références modifiés.
- **S-2** Le numéro de l'issue d'une tâche est écrit après son identifiant
  dans `TASKS.md` (`**S2-T3** (#42)`) ; la pull request en brouillon d'une
  exécution contient `Closes #42` pour chaque tâche qu'elle coche.
- **S-3** `/docflow:issues pull` signale les issues fermées ou rouvertes hors de
  docflow et, après confirmation, coche ou décoche les tâches correspondantes.
- **S-4** Les tests d'acceptation des sprints sont eux aussi reflétés en issues,
  avec l'étiquette `acceptance`, et ne sont fermés que lorsque leur case est
  cochée.

## 7. Économie de tokens

Traitée comme un ensemble d'exigences, vérifiées dans les tests d'acceptation.

| Id | Exigence |
|---|---|
| **T-1** | Le travail mécanique est fait par des scripts, jamais par le modèle : squelettes, liens, état, branches, worktrees, vérifications, coches, commits, pushs, pull requests. |
| **T-2** | Les scripts répondent par de courtes lignes `CLÉ=valeur` et des codes de sortie ; le modèle ne lit aucun journal sauf en cas d'échec d'une étape, et alors uniquement la partie en échec. |
| **T-3** | Chaque étape ne lit que ses entrées (§ 6.1). La mise en œuvre lit la ligne de la tâche et les sections qu'elle référence, extraites par `docflow section SPECS 3.2`, jamais des documents entiers. |
| **T-4** | Le défaut `implementer: session` réutilise le code déjà chargé dans la session ; `implementer: task` lance un agent neuf par tâche quand la session devient volumineuse, l'orchestrateur ne gardant que les identifiants et les résultats. |
| **T-5** | Un modèle par étape : traduction et résumés d'acceptation sur de petits modèles par défaut. |
| **T-6** | La traduction est incrémentale (§ 6.2) ; une section inchangée n'est jamais renvoyée. |
| **T-7** | Le bloc de `CLAUDE.md` reste sous 40 lignes, car il est chargé à chaque session. |
| **T-8** | Aucune commande ne relit un fichier qu'elle vient d'écrire ; le script indique ce qui a changé. |

## 8. Composants du plugin

| Composant | Contenu |
|---|---|
| Commandes | `prd`, `architecture`, `specs`, `tasks`, `claude-md`, `approve`, `run`, `do`, `status`, `translate`, `check`, `issues`, `language` |
| Agents | `writer` (un ensemble de sections d'un document), `translator` (des sections), `implementer` (une tâche ou un sprint), `acceptance` (exécute un test d'acceptation et en rend compte) |
| Scripts | `docflow.mjs` (état, squelettes, liens, sections, empreintes, verrou, branches, vérifications, coches, commits, pull requests), les modules partagés `i18n.mjs`, `repo.mjs`, `guard.mjs` |
| Hooks | `PreToolUse` (garde-fou), `Stop` / `SubagentStop` (complétude de l'exécution) |
| Modèles | Un squelette par document et par langue |

## 9. Formats des documents

- Tableau d'en-tête, puis une ligne de traduction et les liens vers les voisins,
  puis des sections numérotées (`## 1. …`), afin que des références comme
  `SPECS § 3.2` se résolvent par script.
- Grammaire de `TASKS.md`, analysée par le script :

  ```text
  ## S2 — <titre du sprint>
  - [ ] **S2-T3** <titre>. Refs: SPECS § 2.2, ARCHITECTURE § 5.1.
    *Done when* <condition>.
  - [ ] **S2 acceptance** — <test>.
    *Result (<date>): <passed|failed> — <preuve>.*
  ```

## 10. Exigences non fonctionnelles

- **N-1** Node.js uniquement (comme les autres plugins) ; chemins Windows, macOS
  et Linux.
- **N-2** Aucun accès réseau hormis `git` et `gh`.
- **N-3** Chaque étape de script est idempotente et reprenable après une
  interruption.
- **N-4** Une exécution ne laisse jamais le dépôt local sur une autre branche
  sans le dire ; avec `worktree: off`, la branche d'origine est rétablie après
  la pull request.
- **N-5** Tests unitaires du script (analyse, empreintes, état, verrou, plans
  git) dans la suite de tests de la marketplace ; `sync-shared.mjs --check`
  réussit.

## 11. Critères d'acceptation

1. Sur un dépôt vide, lancer `/docflow:run` cinq fois avec les approbations
   produit les cinq documents, chacun lié à ses voisins et à son jumeau
   français si `doc_languages` contient `fr` ; `docflow check docs` ne signale
   rien.
2. Modifier une section des SPECS anglaises puis lancer `/docflow:translate` ne
   renvoie que cette section.
3. `/docflow:do next` sur une tâche la met en œuvre sur sa propre branche, lance
   les vérifications, la coche dans `TASKS.md` et dans son jumeau, commite et
   ouvre une pull request en brouillon ; la branche par défaut n'a pas changé.
4. `/docflow:do S2` avec la valeur par défaut `unit: sprint` fait de même pour
   chaque tâche de S2, consigne le résultat de l'acceptation et ne la coche
   qu'en cas de succès.
5. Pendant une exécution, un `git push` vers la branche par défaut et un
   `gh pr merge` sont refusés par le garde-fou.
6. Une nouvelle session ouverte sur le dépôt lit `CLAUDE.md`, et
   `/docflow:status` indique la prochaine commande sans lire aucun document.
7. Contrôle des tokens : mettre en œuvre une tâche avec `implementer: task` ne
   charge, dans l'agent, que la ligne de la tâche, ses sections référencées et
   le code qu'il modifie.
8. Avec `issues: mirror`, lancer deux fois `/docflow:issues push` ne crée
   l'issue de chaque tâche qu'une fois ; la pull request en brouillon d'un
   sprint ferme les issues de ses tâches cochées ; une issue fermée à la main
   est signalée par `/docflow:issues pull`.

## 12. Décisions

Consignées le 28 septembre 2026.

1. Le plugin vit dans `docflow/`, et non dans `docflow-plugin/` (§ 6.7, M-3).
2. docflow garde son propre moteur de verrou, de branches et de pull requests ;
   il ne réutilise pas celui de `tracker` (§ 6.4, I-2).
3. Les tâches peuvent être reflétées en issues GitHub que `tracker` peut
   prendre en charge (§ 6.8).
4. Valeurs par défaut `unit: sprint` et `implementer: session` : moins de
   tokens, au prix d'un contexte de session plus grand (§ 6.6).
