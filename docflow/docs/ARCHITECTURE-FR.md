# docflow — Conception technique

| | |
|---|---|
| Statut | Brouillon v0.1 |
| Date | 28 septembre 2026 |
| Met en œuvre | [PRD](PRD-FR.md) v0.2 |

Version anglaise : [ARCHITECTURE.md](ARCHITECTURE.md). Les valeurs exactes
(fichiers, schémas, commandes, sorties, codes de sortie) sont fixées dans les
[spécifications](SPECS-FR.md) ; l'avancement est suivi dans [TASKS-FR.md](TASKS-FR.md).

## 1. Principes

1. **Les scripts font, le modèle écrit.** Chaque fichier de commande est une
   courte recette : appeler le script, lire ses lignes `KEY=value`, écrire de
   la prose ou du code seulement là où le script le demande, rappeler le
   script (PRD § 7, T-1, T-2).
2. **Le dépôt est l'état.** Les documents, `TASKS.md` et
   `.docflow/state.json` contiennent tout ; aucune étape ne dépend de la
   conversation, si bien que chaque étape reprend dans une nouvelle session
   (C-2).
3. **Lire le moins possible.** Le script extrait les sections et les lignes
   de tâches ; une commande ne charge jamais un document entier qu'elle ne
   réécrit pas (T-3).
4. **Un seul moteur, aucune dépendance envers d'autres plugins** (PRD § 12,
   décision 2), mais les modules partagés du marketplace sont utilisés comme
   le fait chaque plugin.

## 2. Vue d'ensemble

```text
 user ──► /docflow:<command>  (commands/*.md, English instructions)
              │
              │  node "${CLAUDE_PLUGIN_ROOT}/scripts/docflow.mjs" <verb> …
              ▼
        docflow.mjs ──► lib/config · state · docs · tasks · run · issues · claudemd
              │             │
              │             └─ shared copies: i18n · repo · scope · findings
              ▼
        KEY=value lines + exit code ──► the command decides the next step
              │
              ├─► the session writes a section / implements a task   (default)
              └─► Agent: writer · translator · implementer · acceptance

 hooks/hooks.json ──► scripts/hook.mjs   PreToolUse guard · Stop / SubagentStop check
```

## 3. Structure du plugin

```text
docflow/
  .claude-plugin/plugin.json   manifest, userConfig options (SPECS § 3)
  commands/                    prd, architecture, specs, tasks, claude-md, approve,
                               run, do, status, translate, check, issues, language
  agents/                      writer, translator, implementer, acceptance
  hooks/hooks.json             PreToolUse, Stop, SubagentStop → scripts/hook.mjs
  templates/<lang>/            prd.md, architecture.md, specs.md, tasks.md skeletons
  locales/                     en.json (reference), fr.json, es.json, de.json
  scripts/
    docflow.mjs                command-line entry: parses the verb, prints KEY=value
    hook.mjs                   hook entry
    lib/config.mjs             options: arguments > project > /config > defaults
    lib/state.mjs              .docflow/state.json read/write, lock
    lib/docs.mjs               skeletons, links, section index, fingerprints, checks
    lib/tasks.mjs              TASKS.md parser and editor (tick, result, issue numbers)
    lib/run.mjs                branches, worktrees, checks, commits, push, pull requests
    lib/issues.mjs             GitHub issues mirror through `gh`
    lib/claudemd.mjs           the CLAUDE.md block
    i18n.mjs repo.mjs scope.mjs findings.mjs   generated copies (sync-shared.mjs)
  docs/                        PRD, ARCHITECTURE, SPECS, TASKS (+ -FR twins)
  README.md
tests/docflow/                 node:test suites, run by the marketplace CI
```

Le plugin est répertorié dans le marketplace avec `"source": "./docflow"` ;
`scripts/sync-shared.mjs` l'y trouve et maintient synchronisés ses copies
partagées ainsi que son champ `userConfig.language`.

## 4. Modules du script

| Module | Responsabilité | Fonctions clés |
|---|---|---|
| `config` | Résoudre chaque option selon la priorité *argument > `.docflow/config.json` > `/config` (`userOption`) > valeur par défaut* ; détecter la commande de contrôles | `loadConfig(root, args)` |
| `state` | Charger, valider et enregistrer l'état de façon atomique ; approbations, péremption, verrou avec session propriétaire et expiration | `readState`, `writeState`, `approve`, `markStale`, `acquireLock`, `releaseLock` |
| `docs` | Écrire un squelette à partir d'un modèle ; indexer les sections numérotées ; extraire une section ; calculer l'empreinte des sections ; lister les liens ; vérifier les jumeaux et les liens | `skeleton`, `indexSections`, `section`, `fingerprints`, `checkDocs` |
| `tasks` | Analyser `TASKS.md` en sprints, tâches, entrées de recette d'acceptation ; cocher ou décocher ; écrire les résultats et les numéros d'issue ; répercuter les coches dans les jumeaux | `parseTasks`, `nextUnit`, `tick`, `recordResult`, `setIssue` |
| `run` | Planifier et exécuter une exécution : branche de base, nom de branche, worktree optionnel, vérifications, commit, push, pull request en brouillon, restauration | `startRun`, `runChecks`, `commitTask`, `finishRun`, `resumeRun` |
| `issues` | Publier les tâches comme issues, récupérer les états fermé/rouvert, conserver les clés et les labels | `pushIssues`, `pullIssues` |
| `claudemd` | Écrire ou rafraîchir le bloc balisé de `CLAUDE.md` | `writeBlock` |
| `hook` | Décider d'un appel d'outil (garde-fou) et d'un arrêt (complétude) | `preToolUse`, `onStop` |

Chaque module est un ensemble de fonctions pures appliquées à des entrées,
plus une fine couche d'entrées-sorties, de sorte que les tests s'exécutent
sur des répertoires temporaires et de faux exécuteurs `git`/`gh`.

## 5. Recettes de commande

Un fichier de commande suit le même schéma ; le script est noté ci-dessous
`DOCFLOW`.

### 5.1 Étape de document (`prd`, `architecture`, `specs`, `tasks`)

1. `DOCFLOW stage <doc>` → contrôle de barrière (prédécesseur approuvé),
   vérification du dépôt, squelette écrit s'il est absent ; affiche `DOC=`,
   `INPUTS=` (références de sections à lire), `SECTIONS=` (sections à
   remplir), `LANGS=`.
2. Le modèle lit uniquement `INPUTS` (via `DOCFLOW section <ref>`), pose à
   l'utilisateur les questions que l'étape requiert (entretien PRD), et
   remplit sur place les sections listées avec `Edit`.
3. `DOCFLOW check <doc>` → sections manquantes, liens rompus ; le modèle
   corrige uniquement ce qui est signalé.
4. Si `LANGS` n'est pas vide : `/docflow:translate <doc>` (§ 5.4).
5. Point de contrôle : afficher les questions ouvertes ; à l'approbation,
   `DOCFLOW approve <doc>`, qui rafraîchit aussi le bloc `CLAUDE.md`.

### 5.2 Enchaînement (`run`, `status`)

`DOCFLOW status` calcule, à partir de l'état et des seules empreintes de
fichiers, le statut de chaque document et la commande suivante.
`/docflow:run` exécute cette commande et s'arrête à son point de contrôle ;
`--through <doc>` saute les points de contrôle déjà franchis une fois.

### 5.3 Implémentation (`do`)

```text
DOCFLOW do start <S2|S2-T3|next>      lock, base, branch, worktree → UNIT=, TASKS=, WORKDIR=
  for each task in TASKS:
    DOCFLOW task show <id>            task line + referenced sections (extracted)
    implement (session | agent)
    DOCFLOW do check <id>             runs the checks → CHECKS=pass|fail, LOG= (tail on fail)
    DOCFLOW do commit <id>            tick (+ twins), commit code and tick together
  DOCFLOW do acceptance <S2>          prints the test; result recorded by `do result`
DOCFLOW do finish                      push, draft pull request, restore, release lock → PR=
```

Une vérification en échec laisse la branche et le verrou avec l'état
d'exécution réglé sur `failed` ; `DOCFLOW do start --resume` reprend à partir
de la première tâche non cochée.

### 5.4 Traduction (`translate`)

`DOCFLOW translate plan <doc>` compare les empreintes des sections anglaises
à celles enregistrées pour chaque jumeau et affiche les identifiants des
sections modifiées. L'agent translator ne reçoit que ces sections et les
retourne ; `DOCFLOW translate apply <doc> <lang>` les insère dans le jumeau,
réécrit ses liens et enregistre les nouvelles empreintes.

### 5.5 Issues (`issues`)

`DOCFLOW issues push` liste, via `gh`, les issues existantes portant une clé
docflow, crée celles qui manquent, met à jour les titres et corps modifiés,
et écrit les numéros d'issue dans `TASKS.md`. `DOCFLOW issues pull` signale
les divergences ; la commande demande confirmation avant
`DOCFLOW issues pull --apply`.

## 6. Agents

| Agent | Reçoit | Retourne | Modèle par défaut |
|---|---|---|---|
| `writer` | Identifiants de sections à remplir, entrées extraites, réponses de l'utilisateur | Sections remplies, écrites sur place | inherit |
| `translator` | Sections anglaises modifiées, langue cible, glossaire des identifiants | Sections traduites sous forme de texte | haiku |
| `implementer` | Une tâche ou un sprint : lignes de tâches, sections référencées, `WORKDIR` | Modifications de code ; ne coche ni ne commit jamais (c'est le script qui le fait) | inherit |
| `acceptance` | Le texte de la recette d'acceptation et le `WORKDIR` de l'exécution | `RESULT=passed|failed` et une preuve d'une ligne | sonnet |

Avec les valeurs par défaut (`unit: sprint`, `implementer: session`), la
session elle-même joue les rôles `writer` et `implementer` ; les agents sont
utilisés quand l'option ou l'argument le demande, et toujours pour la
traduction.

## 7. Hooks et garde-fou

- Le garde-fou est armé par `do start` dans `.docflow/state.json`
  (identifiant de session, racine, worktree) et désarmé par `do finish` ;
  `scope.mjs` le limite à cette session et à ce dépôt.
- `PreToolUse` (`Bash`, `Edit`, `Write`) : refuse les push vers la branche
  par défaut, les push forcés, `gh pr merge`, les commits sur la branche par
  défaut, et les modifications de documents approuvés autres que les coches
  et résultats de `TASKS.md` (SPECS § 8).
- `Stop` / `SubagentStop` : tant qu'une exécution est active, refuse de
  s'arrêter quand la tâche courante n'est ni cochée ni enregistrée comme
  échouée.
- En dehors d'une exécution, les hooks autorisent tout et coûtent une seule
  lecture d'état.

## 8. Données

- `.docflow/state.json` : approbations avec empreintes, marques de
  péremption, verrou, exécution (unité, branche, worktree, tâche courante,
  statut), empreintes de traduction. Les fichiers commités sont les
  documents et `TASKS.md` ; `.docflow/` est ignoré par git sauf
  `config.json`.
- `.docflow/config.json` : options du projet (SPECS § 3).
- Les documents suivent les formats du PRD § 9 ; les numéros de section sont
  les ancres de chaque référence.

## 9. Gestion des erreurs

- Chaque verbe affiche `OK=1` ou `ERROR=<code>` avec un message traduit et un
  code de sortie stable (SPECS § 5) ; les commandes se branchent sur les
  codes de sortie, jamais sur la prose.
- Les échecs de git et `gh` sont signalés avec la commande en échec et
  seulement les 20 dernières lignes de sa sortie.
- Les écritures d'état sont atomiques (écriture dans un fichier temporaire,
  puis renommage).

## 10. Plan de livraison

| Étape | Contenu |
|---|---|
| 1 | Amorçage : manifeste, entrée marketplace, locales, copies partagées, `config`, `state`, `docflow.mjs` avec `status`, harnais de test. |
| 2 | Chaîne documentaire : modèles, `docs`, `stage`, `section`, `check`, `approve`, `claudemd`, `run` ; commandes de `prd` à `claude-md`, `approve`, `run`, `status`, `check`. |
| 3 | Traductions : empreintes, `translate plan/apply`, agent `translator`, commande `translate`. |
| 4 | Moteur d'implémentation : `tasks`, `run`, verbes `do`, agents `implementer` et `acceptance`, hooks et garde-fou. |
| 5 | Miroir des issues : module et commande `issues`, `Closes #` dans les pull requests. |
| 6 | Documentation et dogfooding : README, publication marketplace, docflow appliqué à un projet réel (Taskbar Hub `--adopt`). |

## 11. Tests

- Tests unitaires par module sur des dépôts temporaires ; `git` et `gh`
  derrière des exécuteurs injectables afin que les pull requests et les
  issues soient simulées.
- Fichiers de référence pour les squelettes, les modifications de
  `TASKS.md` et le bloc `CLAUDE.md`.
- `node scripts/sync-shared.mjs --check` et la vérification du catalogue de
  locales en CI.
- Les contrôles de tokens du PRD § 11 mesurés en comptant les fichiers que
  lit chaque recette.

## 12. Décisions

1. Scripts Node.js uniquement, comme les autres plugins ; aucune étape de
   build.
2. `TASKS.md` est modifié par le script, jamais par le modèle, afin que sa
   grammaire reste analysable.
3. La session est par défaut writer et implementer (PRD décision 4) ; les
   agents sont optionnels, sauf le translator.
4. Les clés d'issue réutilisent le commentaire de clé partagé de
   `findings.mjs`, si bien que `tracker` reconnaît les issues docflow sans
   modification.
