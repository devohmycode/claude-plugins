# docflow — de l'idée au code fusionné, par des documents liés

Version anglaise : [README.md](README.md).

docflow écrit une chaîne fixe de documents — PRD, conception technique, spécifications,
tâches et un bloc `CLAUDE.md` —, une commande par document, chacun approuvé à un point de
contrôle. Puis il réalise le plan tâche par tâche ou sprint par sprint : une branche par
unité, les checks du projet après chaque tâche, `TASKS.md` coché par le script, et une pull
request **en brouillon** que vous fusionnez vous-même.

```text
PRD ──► ARCHITECTURE ──► SPECS ──► TASKS ──► CLAUDE.md ──► /docflow:do
quoi      comment        valeurs    sprints    règles pour    branche · checks ·
et pourquoi (modules)    exactes    et tâches  chaque agent   coche · commit · PR brouillon
```

Les scripts font le travail mécanique (squelettes, liens, état, branches, checks, coches,
commits, push, pull requests) ; le modèle ne fait qu'écrire les documents et le code.

## Installation

```
/plugin marketplace add devohmycode/claude-plugins
/plugin install docflow@devohmycode-plugins
```

Il faut git et Node 18 ou plus ; la CLI GitHub (`gh`, connectée) pour les pull requests et
le miroir des issues.

## Le parcours

1. **Documents.** `/docflow:run` lance l'étape suivante de la chaîne et s'arrête à son point
   de contrôle ; relancez-le après chaque approbation. Ou appelez les étapes une à une :
   `/docflow:prd "<idée>"` (un court entretien), `/docflow:architecture`,
   `/docflow:specs`, `/docflow:tasks`, puis `/docflow:claude-md`. Chaque document renvoie
   aux autres, et `/docflow:approve <doc>` l'enregistre — modifier plus tard un document
   approuvé rend les suivants *périmés*, et `/docflow:status` dit lesquels reprendre.
2. **Réalisation.** `/docflow:do next` prend l'unité suivante de `docs/TASKS.md` — un
   sprint par défaut —, crée `docflow/S2-<slug>` et, pour chaque tâche, ne lit que sa ligne
   et les sections de SPECS qu'elle cite, écrit le code, lance les checks, et laisse le
   script cocher et commiter. Un sprint se termine par son test d'acceptation, consigné
   sous lui. Puis une pull request en brouillon. Un check qui échoue arrête le run en
   gardant sa branche ; `/docflow:do --resume` reprend, depuis la même session ou une autre.
3. **Relecture.** Vous lisez le brouillon et le fusionnez. Le `/docflow:do next` suivant
   part après lui — empilé sur la branche en attente tant qu'elle n'est pas fusionnée.

Une base de code existante ? `/docflow:prd --adopt` part d'un résumé de son arborescence
plutôt que d'une page blanche, et `/docflow:tasks --adopt` marque le premier sprint comme
fait.

## Commandes

| Commande | Rôle |
| --- | --- |
| `/docflow:prd [idée] [--adopt]` | Écrit `docs/PRD.md` à partir d'un court entretien |
| `/docflow:architecture [--adopt]` | Écrit `docs/ARCHITECTURE.md` à partir du PRD approuvé |
| `/docflow:specs` | Écrit `docs/SPECS.md` : les valeurs exactes dont la conception dépend |
| `/docflow:tasks [--adopt]` | Écrit `docs/TASKS.md` : sprints, tâches citant SPECS, tests d'acceptation |
| `/docflow:claude-md` | Écrit ou rafraîchit le bloc docflow de `CLAUDE.md` (≤ 40 lignes) |
| `/docflow:approve <doc>` | Vérifie et approuve un document ; rend les suivants périmés s'il a changé |
| `/docflow:run [--through <doc>]` | Lance l'étape en attente de la chaîne |
| `/docflow:status` | La chaîne, l'avancement du sprint, le run en cours, la commande suivante |
| `/docflow:do <next\|S<n>\|S<n>-T<m>>` | Réalise une unité (`--resume`, `--unit`, `--implementer`, `--worktree`, `--in-place`) |
| `/docflow:translate [doc] [--lang fr\|es\|de]` | Met à jour les traductions, section par section |
| `/docflow:check [doc]` | Sections manquantes ou à remplir, liens cassés, grammaire de `TASKS.md`, traductions |
| `/docflow:issues push\|pull [--apply]` | Reflète les tâches en issues GitHub, ou signale celles fermées à la main |
| `/docflow:language [en\|fr\|es\|de\|default]` | La langue des messages du plugin |

## Options

Réglez-les dans `/config` (les lignes docflow), par projet avec
`node <plugin>/scripts/docflow.mjs config <clé> <valeur>` (enregistré dans
`.docflow/config.json`, commité), ou en argument d'une commande. L'argument l'emporte sur le
projet, qui l'emporte sur `/config`, qui l'emporte sur la valeur par défaut.

| Option | Valeurs | Défaut |
| --- | --- | --- |
| `language` | `en`, `fr`, `es`, `de` | `en` |
| `doc_languages` | traductions à tenir, par exemple `fr` ou `fr,de` | aucune |
| `unit` | `task`, `sprint` — ce que prend `/docflow:do next` | `sprint` |
| `implementer` | `session`, `task` (un agent neuf par tâche), `sprint` (un agent par sprint) | `session` |
| `worktree` | `true` (un checkout séparé par run), `false` (votre checkout change de branche) ; `on`/`off` restent lus | `false` |
| `issues` | `off`, `mirror` | `off` |
| `checks` | la commande qui teste le projet ; détectée depuis `Cargo.toml`, `package.json`, `pyproject.toml`, `go.mod`, sinon demandée une fois | détectée |
| `branch_prefix` | texte terminé par `/` | `docflow/` |
| `<agent>_model` | `inherit`, `haiku`, `sonnet`, `opus`, `fable` — pour `writer`, `translator`, `implementer`, `acceptance` | `inherit` ; `haiku` pour le traducteur, `sonnet` pour l'acceptation |
| `<agent>_effort` | `inherit`, `low` … `max` | `inherit` |

## La garde

Pendant un run — dans la session qui l'a lancé, et dans son dépôt seulement —, un hook
refuse un push vers la branche par défaut, un push forcé, un commit sur la branche par
défaut, `gh pr merge`, et toute modification d'un document approuvé ou de `TASKS.md` autre
que celle du script. Quand la session s'arrête, un autre hook vérifie que la tâche en cours
a été commitée ou déclarée en échec. docflow ne fusionne jamais.

## Traductions

Avec `doc_languages: fr`, chaque document a une traduction (`docs/PRD-FR.md`…). Le script
calcule l'empreinte de chaque section anglaise ; `/docflow:translate` n'envoie au
traducteur, sur un petit modèle, que les sections qui ont changé, puis les réinsère. Coches
et résultats sont écrits par le script dans chaque traduction de `TASKS.md`.

## Miroir des issues

Avec `issues: mirror`, `/docflow:issues push` ouvre une issue par tâche non cochée et par
test d'acceptation (`S2-T3 <titre>`, labels `docflow` et `sprint:S2`), écrit son numéro
après l'identifiant dans `TASKS.md` (`**S2-T3** (#42)`), et ne l'ouvre jamais deux fois : le
corps porte la clé `<!-- tracker:key=id:docflow-S2-T3 -->`, que lit aussi le plugin
[tracker](../tracker-plugin/). La pull request d'un run liste `Closes #42` pour chaque tâche
qu'il coche. `/docflow:issues pull` signale les issues fermées ou rouvertes à la main, et
s'y aligne avec votre accord. `TASKS.md` reste la référence.

## Dépenser moins de jetons

- Laissez les scripts répondre : `/docflow:status` ne lit aucun document, et un check en
  échec ne montre que les 60 dernières lignes de son journal.
- Gardez des tâches courtes qui citent des sections de SPECS (`Refs: SPECS § 3.2`) :
  l'implémenteur lit ces sections, jamais des documents entiers.
- `implementer: session` (par défaut) réutilise le code déjà chargé ; passez à
  `implementer: task` sur un long sprint, pour que chaque tâche parte d'un contexte propre.
- Laissez le traducteur sur `haiku` et l'acceptation sur `sonnet` ; ne réglez
  `writer_model` que si les documents l'exigent.
- Traduisez une fois l'anglais stabilisé : une section inchangée n'est jamais renvoyée.

## Fichiers

| Chemin | Contenu | Dans git |
| --- | --- | --- |
| `docs/PRD.md`, `ARCHITECTURE.md`, `SPECS.md`, `TASKS.md` (+ traductions) | La chaîne de documents | oui |
| `CLAUDE.md` | Le bloc docflow, entre marqueurs | oui |
| `.docflow/config.json` | Options du projet | oui |
| `.docflow/state.json` | Approbations, empreintes, verrou, run | non |
| `.docflow/logs/` | Le journal complet de chaque passage des checks | non |

## Langue

Anglais par défaut ; français, espagnol ou allemand avec `/docflow:language`, la ligne
**Language** de `/config`, ou `CLAUDE_PLUGINS_LANGUAGE` pour tous les plugins de cette
marketplace. Les documents s'écrivent en anglais ; leurs traductions suivent
`doc_languages`.

## Conception

Le plugin suit sa propre chaîne : [PRD](docs/PRD-FR.md) →
[architecture](docs/ARCHITECTURE-FR.md) → [spécifications](docs/SPECS-FR.md) →
[tâches](docs/TASKS-FR.md).
