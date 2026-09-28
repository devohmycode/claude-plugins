# docflow — Spécifications

| | |
|---|---|
| Statut | Brouillon v0.1 |
| Date | 28 septembre 2026 |
| S'applique à | Version 0.1 |

Version anglaise : [SPECS.md](SPECS.md). Ce document fixe les valeurs exactes sur lesquelles s'appuie l'[architecture](ARCHITECTURE-FR.md) ; les exigences viennent du [PRD](PRD-FR.md) ; le travail est suivi dans [TASKS-FR.md](TASKS-FR.md).

## 1. Fichiers

| Chemin (projet) | Contenu | Dans git |
|---|---|---|
| `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/SPECS.md`, `docs/TASKS.md` | La chaîne de documents | oui |
| `docs/<NAME>-FR.md`, `-ES.md`, `-DE.md` | Traductions | oui |
| `CLAUDE.md` | Bloc docflow entre les marqueurs (§ 7) | oui |
| `.docflow/config.json` | Options du projet (§ 3) | oui |
| `.docflow/state.json` | État (§ 4) | non |
| `.docflow/.gitignore` | `*` puis `!config.json` puis `!.gitignore` | oui |

## 2. Format des documents

- Première ligne `# <Project> — <Title>`, où les titres sont `Document d'exigences produit`, `Conception technique`, `Spécifications`, `Tâches`.
- Puis un tableau à deux colonnes comportant au moins `Statut` et `Date`.
- Puis la ligne de lien : `French version: [PRD-FR.md](PRD-FR.md).` dans les documents anglais, `Version anglaise : [PRD.md](PRD.md).` dans les documents français (espagnol : `Versión en inglés:`, allemand : `Englische Fassung:`), suivie de liens vers les documents voisins.
- Les sections sont numérotées `## <n>. <Title>` et `### <n>.<m> <Title>` ; une référence `SPECS § 3.2` se résout vers le titre dont le numéro est `3.2`. Une section s'étend jusqu'au prochain titre de même niveau ou de niveau supérieur.
- Sections requises (le squelette les écrit ; `check` signale celles qui manquent) :

| Document | Sections de premier niveau requises |
|---|---|
| PRD | Vision · Problème · Buts et non-buts · Utilisateurs · Exigences fonctionnelles · Exigences non fonctionnelles · Critères d'acceptation · Questions ouvertes (ou Décisions) |
| ARCHITECTURE | Principes (ou Point de départ) · Vue d'ensemble · Organisation (ou Modules) · Plan de livraison · Tests · Décisions |
| SPECS | au moins une section numérotée ; la dernière liste les budgets ou les limites |
| TASKS | Comment travailler sur ce fichier · une section par sprint `## S<n> — <title>` |

## 3. Options

Priorité : argument de commande > `.docflow/config.json` > `/config` (`userConfig`, lu avec `userOption`) > valeur par défaut.

| Clé | Type `userConfig` | Valeurs | Valeur par défaut |
|---|---|---|---|
| `language` | string, options | `en`, `fr`, `es`, `de` | `en` |
| `doc_languages` | string | sous-ensemble séparé par des virgules de `fr,es,de`, ou vide | vide |
| `unit` | string, options | `task`, `sprint` | `sprint` |
| `implementer` | string, options | `task`, `sprint`, `session` | `session` |
| `worktree` | string, options | `on`, `off` | `off` |
| `issues` | string, options | `off`, `mirror` | `off` |
| `checks` | string | commande shell, ou vide pour détecter | vide |
| `branch_prefix` | string | texte se terminant par `/` | `docflow/` |
| `writer_model`, `implementer_model` | string, options | `inherit`, `haiku`, `sonnet`, `opus`, `fable` | `inherit` |
| `translator_model` | idem | idem | `haiku` |
| `acceptance_model` | idem | idem | `sonnet` |
| `<agent>_effort` | string, options | `inherit`, `low`, `medium`, `high`, `xhigh`, `max` | `inherit` |

Détection des checks, première correspondance : `Cargo.toml` → `cargo test --locked` ; `package.json` avec un script `test` → `npm test` ; `pyproject.toml` ou `pytest.ini` → `pytest -q` ; `go.mod` → `go test ./...` ; sinon la commande demande une fois à l'utilisateur et enregistre la réponse dans `.docflow/config.json`.

## 4. État

```json
{
  "schema": 1,
  "docs": {
    "PRD": { "approved": "2026-09-28T13:44:00Z", "fingerprint": "3f9a0c2b1d4e", "stale": false }
  },
  "translations": {
    "PRD": { "fr": { "1": "a1b2c3d4e5f6", "2": "0f1e2d3c4b5a" } }
  },
  "lock": { "session": "<CLAUDE_CODE_SESSION_ID>", "since": "2026-09-28T14:00:00Z", "expires": "2026-09-28T18:00:00Z" },
  "run": {
    "unit": "S2", "tasks": ["S2-T1", "S2-T2"], "done": ["S2-T1"], "status": "running",
    "base": "main", "branch": "docflow/S2-placement", "worktree": null, "origin_branch": "main"
  },
  "guard": { "session": "<id>", "root": "C:/repo", "worktree": null }
}
```

- `fingerprint` : les 12 premiers chiffres hexadécimaux du SHA-256 calculé sur le texte, avec les fins de ligne normalisées en `\n` et les espaces de fin de ligne supprimées ; les empreintes de section hachent le corps de la section sans sa ligne de titre.
- Un verrou plus ancien que `expires` (4 heures après `since`) peut être repris après avoir demandé à l'utilisateur.
- `run.status` : `running`, `failed`, `finishing`.

## 5. Interface du script

`node "${CLAUDE_PLUGIN_ROOT}/scripts/docflow.mjs" <verb> [args]`. La sortie comporte une paire `KEY=value` par ligne (valeurs sans saut de ligne ; listes séparées par des virgules), puis tout message destiné à l'utilisateur sur des lignes commençant par `# `.

| Verbe | Affiche | Codes de sortie |
|---|---|---|
| `status` | `DOC_<NAME>=approved\|stale\|draft\|missing`, `SPRINT=`, `DONE=`, `TOTAL=`, `NEXT=` (une commande) | 0 |
| `stage <doc> [--adopt]` | `DOC=`, `INPUTS=`, `SECTIONS=`, `LANGS=` | 0, 3, 4 |
| `section <DOC> <n[.m]>` | le texte de la section (brut) | 0, 2 |
| `check [doc]` | `ISSUES=<n>`, puis `# <file>:<line> <problem>` | 0 (aucun problème), 1 |
| `approve <doc>` | `APPROVED=`, `STALE=` (documents suivants marqués obsolètes) | 0, 1 |
| `claude-md` | `CLAUDE_MD=created\|updated\|unchanged`, `LINES=` | 0 |
| `translate plan <doc>` | `LANG=<l> CHANGED=<section ids>` par langue | 0 |
| `translate apply <doc> <lang> <file>` | `UPDATED=<section ids>` | 0, 2 |
| `task show <id>` | la ligne de la tâche, puis chaque section référencée | 0, 2 |
| `do start <unit\|next> [--resume] [--worktree\|--in-place]` | `UNIT=`, `TASKS=`, `BRANCH=`, `WORKDIR=`, `IMPLEMENTER=` | 0, 2, 3, 4, 75 |
| `do check <id>` | `CHECKS=pass\|fail`, `LOG=<file>` en cas d'échec | 0, 5 |
| `do commit <id>` | `COMMIT=<sha>`, `TICKED=<id>` | 0, 1 |
| `do acceptance <sprint>` | `TEST=` (texte), `MANUAL=0\|1` | 0, 2 |
| `do result <sprint> passed\|failed "<evidence>"` | `RECORDED=`, `TICKED=0\|1` | 0 |
| `do finish` | `PR=<url>`, `RESTORED=<branch>` | 0, 1 |
| `issues push` | `CREATED=`, `UPDATED=`, `UNCHANGED=` | 0, 3 |
| `issues pull [--apply]` | `CLOSED=`, `REOPENED=`, `APPLIED=0\|1` | 0, 3 |

| Sortie | Signification |
|---|---|
| 0 | Succès |
| 1 | Rien à faire ou un problème signalé (`check`), ou une étape git a échoué |
| 2 | Document, section, tâche ou sprint inconnu |
| 3 | Dépôt absent ou sans commit ni remote (contrat `REPO=`) |
| 4 | Blocage : document prédécesseur non approuvé |
| 5 | Échec des checks |
| 75 | Verrou détenu par une autre session |

## 6. Grammaire de TASKS.md

```text
## S<n> — <title>
- [ ] **S<n>-T<m>** [(#<issue>)] <title>. [Refs: <DOC> § <n[.m]>[, …].]
  [*Done when* <condition>.]
- [ ] **S<n> acceptance** [(#<issue>)] — <test>.
  [*Result (<YYYY-MM-DD>): passed|failed — <evidence>.*]
```

- Regex d'une ligne de tâche : `^- \[( |x)\] \*\*(S\d+-T\d+)\*\*(?: \(#(\d+)\))? (.+)$`.
- Les lignes de continuation commencent par deux espaces. Les références d'une tâche sont tous les `<DOC> § <n>` présents dans sa ligne et ses lignes de continuation.
- Cocher ne change que `[ ]` en `[x]` dans `TASKS.md` et dans chaque jumeau, en faisant correspondre par id, jamais par texte.
- Ordre des unités : `next` en mode `task` est la première tâche non cochée ; en mode `sprint`, le premier sprint comportant une tâche ou une acceptance non cochée.

## 7. Bloc CLAUDE.md

```markdown
<!-- docflow:start -->
## docflow

This project follows docflow. Read, in order: [PRD](docs/PRD.md) →
[ARCHITECTURE](docs/ARCHITECTURE.md) → [SPECS](docs/SPECS.md) →
[TASKS](docs/TASKS.md).

- Work only through `/docflow:do`; one sprint (or task) per branch.
- Run the checks, let docflow tick `docs/TASKS.md`, never tick by hand.
- Pull requests are drafts; never merge, never push to `main`.
- Documents are approved; change them through their `/docflow:<doc>` command.
- Next: `/docflow:do next` — <next unit and title>.
<!-- docflow:end -->
```

Au maximum 40 lignes ; le bloc est inséré à la fin de `CLAUDE.md` quand il est absent, remplacé quand il est présent, et le fichier est créé quand il manque. Des liens traduits sont ajoutés quand `doc_languages` est défini.

## 8. Git et GitHub

| Élément | Format |
|---|---|
| Branche | `<branch_prefix><unit>-<slug>` : `docflow/S2-placement`, `docflow/S2-T3-drop-rules` ; slug = titre en ASCII minuscule, mots joints par `-`, au maximum 40 caractères |
| Worktree | `<repo>/../<repo-name>.docflow/<unit>` |
| Commit | `<id>: <task title>`, corps `Refs: <references>` ; aucun trailer d'attribution |
| Pull request | Brouillon ; titre `<unit>: <sprint or task title>` ; corps : tâches cochées, `Checks: <command> — passed`, résultat de l'acceptance, `Closes #<n>` par issue mise en miroir |
| Issue | Titre `<id> <title>` ; étiquettes `docflow`, `sprint:S<n>` (et `acceptance`) ; corps : la ligne de la tâche, les références, puis `<!-- tracker:key=id:docflow-<id> -->` |

Refus du garde (`PreToolUse`, pendant qu'une exécution est active dans cette session et ce dépôt) :

| Appel d'outil | Refusé quand |
|---|---|
| `git push` | la cible est la branche par défaut, ou `--force` / `-f` / `--force-with-lease` |
| `git commit` | la branche courante est la branche par défaut |
| `gh pr merge` | toujours |
| `Edit` / `Write` | la cible est un document approuvé, sauf les modifications de `docs/TASKS*.md` faites par le script |

## 9. Commandes

| Commande | Arguments |
|---|---|
| `/docflow:prd` | `[idea] [--adopt]` |
| `/docflow:architecture`, `/docflow:specs`, `/docflow:tasks` | `[--adopt]` |
| `/docflow:claude-md` | — |
| `/docflow:approve` | `<prd\|architecture\|specs\|tasks>` |
| `/docflow:run` | `[--through <doc>]` |
| `/docflow:status` | — |
| `/docflow:do` | `<next\|S<n>\|S<n>-T<m>> [--resume] [--unit task\|sprint] [--implementer task\|sprint\|session] [--worktree\|--in-place]` |
| `/docflow:translate` | `[doc] [--lang fr\|es\|de]` |
| `/docflow:check` | `[doc]` |
| `/docflow:issues` | `push\|pull [--apply]` |
| `/docflow:language` | `[en\|fr\|es\|de\|default]` |

## 10. Budgets

| Mesure | Limite |
|---|---|
| Tout verbe du script sauf `do check`, `do finish` et `issues` | < 1 s sur un dépôt de 5 000 fichiers |
| Décision du hook | < 100 ms |
| Bloc `CLAUDE.md` | ≤ 40 lignes |
| Fichier de commande | ≤ 120 lignes |
| Sortie d'un verbe en cas de succès | ≤ 20 lignes |
| Journal affiché après l'échec des checks | dernières 60 lignes |
