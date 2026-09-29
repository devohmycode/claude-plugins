# Writing one document of the chain

This recipe is followed by `/docflow:prd`, `/docflow:architecture`, `/docflow:specs`,
`/docflow:tasks` and `/docflow:run`. `${CLAUDE_PLUGIN_ROOT}` stands for the plugin
directory this file was read from. Below, `DOCFLOW` is
`node "${CLAUDE_PLUGIN_ROOT}/scripts/docflow.mjs"` and `STAGE` is the stage the command
names (`prd`, `architecture`, `specs` or `tasks`). The script does everything mechanical;
you write prose only where it says so.

## 1. Stage

Run `DOCFLOW stage STAGE` (add `--adopt` when the user passed it, `--agent` when they asked
for the writer agent). Exit code 3 with `REPO=`: follow the command's "Not a git
repository yet" section. Exit code 4 (`GATE=<doc>`): the previous document is not approved —
relay the `# ` message, which names the command to run, and stop. Otherwise read:

- `DOC`: the file to write — its skeleton exists now (`CREATED=1`) or from before;
- `STATUS`: `draft`, `stale` or `approved`;
- `INPUTS`: what to read, comma-separated; `SECTIONS`: the ids of the sections still to fill;
- `CHANGED` (stale only): the sections of earlier documents that changed since approval;
- `LANGS`: translations to update afterwards; `ADOPT=1`: an existing code base;
- `WRITER`: `session` (you write) or `agent` (with `AGENT=` and `MODEL=`).

## 2. Read only the inputs

For each item of `INPUTS`, run `DOCFLOW section <item>`: `PRD` prints a whole document,
`ARCHITECTURE § 6` one section, `SPECS headings` the headings only, `LAYOUT` the summary of
the existing code. When `STATUS=stale`, read only the `CHANGED` sections instead
(`DOCFLOW section PRD § 2`). Do not open the documents of the chain with Read, apart from
`DOC` itself; read code only in adopt mode, and only what the layout points to.

## 3. Ask what only the user knows

Follow the command's notes for this stage. Ask in one message, the fewest questions that
change the document; never ask what the inputs already say. When there is nothing to ask,
go on.

## 4. Write

- `WRITER=session`: Read `DOC` once, then fill each section of `SECTIONS` in place with
  Edit, replacing its `<!-- docflow:todo … -->` marker — the marker says what belongs there.
  Keep every heading and its number, the title table and the link lines: the script owns
  them. You may add numbered subsections (`### 5.1 …`) and rename a section only where its
  marker says so. Be concrete and short; no filler, no restating other documents — refer
  to them (`PRD § 5.2`).
- `WRITER=agent`: launch the Agent tool with `subagent_type` = `AGENT` (and `model` =
  `MODEL` unless it is `inherit`). The prompt gives `DOC`, `SECTIONS` (or `CHANGED`), the
  `INPUTS` items to read, the user's answers verbatim, `LANGUAGE=English` and `DOCFLOW` (the
  full command, with the plugin path). Do not write the document yourself.
- `STATUS=stale`: revise only what the `CHANGED` sections affect; leave the rest as it is.

## 5. Check

Run `DOCFLOW check STAGE`. Exit code 1: fix exactly the `# ` lines it prints, then run it
again until `ISSUES=0`. Do not re-read the whole document to do so.

## 6. Translations

When `LANGS` is not empty, follow `${CLAUDE_PLUGIN_ROOT}/commands/translate.md` for this
document: only the changed sections are translated.

## 7. Checkpoint

Show the user, in at most ten lines, what the document now says (one line per section
written) and its open questions or decisions. Then **ask** with `AskUserQuestion`:

- "Approve" → `DOCFLOW approve STAGE`; relay `APPROVED`, `STALE` (documents to refresh, in
  order) and the next command (`NEXT`). Exit code 1 prints problems: fix them, then approve
  again.
- "Amend" (the user says what) → apply it, then back to step 5.
- "Stop here" → leave the draft as it is: the same command resumes it later.

Never approve without that answer — except under `/docflow:run --through`, for a document
the user already approved once (see `run.md`).
