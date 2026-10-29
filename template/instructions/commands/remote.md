# `polyman remote …`

All Polygon-side operations. Authentication is via API key + secret stored once with `register`. The remote talks to the Polygon HTTPS API.

Subcommands: `register`, `list`, `pull`, `push`, `view`, `commit`, `package`.

## In `polyman chat`

Do not run these commands as shell commands. Use the tools:

- `remote_push`: push the problem. For a problem that is not on Polygon yet, ask the user for a name and pass it as `newProblemName`.
- `remote_commit`: commit after every push, with a short message.
- `remote_package`: build a package after the commit (`standard` by default).
- `remote_view`: see the problem as it is on Polygon.

There is no register tool. Never ask for, write or repeat the API key or secret. If a tool says Polygon is not set up, tell the user to run `polyman remote register <api-key> <secret>` in their own terminal, not in the chat.

---

## `polyman remote register <api-key> <secret>`

```bash
polyman remote register 991d… a4c7…
```

Stores credentials at `~/.polyman/api_key` and `~/.polyman/secret_key`. Run **once per machine**. To rotate, register again — the new value overwrites.

**What NOT to do:**
- Don't paste credentials into shared shells / screen sessions — they go to `~/.polyman/` in plaintext but should still be treated as secrets.
- Don't commit `~/.polyman/`. It's outside the repo by design; don't pull it in.
- Don't paste credentials into an AI chat. They go to the model provider.

---

## `polyman remote list [--owner <username>]`

```bash
polyman remote list                    # everything you can see
polyman remote list --owner tourist    # filter by Polygon username
```

Read-only. Shows problems accessible to the registered account, with their Polygon ID, name, owner, and access level.

---

## `polyman remote pull <problem-id> <directory> [flags]`

Downloads a problem from Polygon into `<directory>`. Creates `Config.json` and the on-disk layout. Default is `--all`.

```bash
polyman remote pull 123456 ./my-problem            # everything
polyman remote pull 123456 ./my-problem -s -c      # solutions + checker only
polyman remote pull 123456 .                       # use existing Config.json's problemId
```

Flags (each enables one component; presence implies non-`--all` mode):

| Short | Long | Pulls |
| --- | --- | --- |
| `-a` | `--all` | Everything (default if no flag is set). |
| `-s` | `--solutions` | Solutions. |
| `-c` | `--checker` | Checker. |
| `-v` | `--validator` | Validator + `validator_tests.json`. |
| `-g` | `--generators` | Generator sources. |
| `-S` | `--statements` | Statement fragments. |
| `-t <names>` | `--tests <names>` | Tests. Optional comma-separated testset names; default `tests`. |
| `-m` | `--metadata` | Description and tags. |
| `-i` | `--info` | Time/memory limits, input/output file. |

**Round-trip:** the generator script comes back **verbatim** as `generatorScript.script` text. polyman does not parse it. Manual tests come back as `m-<NN>.in` files (zero-padded index) under `manual/<testset>/` plus a `manualTests[]` entry.

**What NOT to do:**
- Don't pull into a non-empty directory unless you know what you're overwriting.
- Don't expect manual test indices to match the pre-existing local layout. Polygon's indices are authoritative; your local files get rewritten.

---

## `polyman remote push <directory> [flags]`

Uploads the local problem to Polygon. If `Config.json.problemId` is missing, polyman creates a new Polygon problem first. On a terminal it asks for confirmation and a slug; headless (no TTY on stdin) it refuses to block on a prompt and exits 1 naming the flag to pass instead.

```bash
polyman remote push .
polyman remote push . -s -t                          # solutions + tests only
polyman remote push . --yes --name two-sum           # create the Polygon problem without prompts
```

Creation flags (only relevant when `problemId` is missing):

| Short | Long | Effect |
| --- | --- | --- |
| `-y` | `--yes` | Skip the "create a new problem?" confirmation. |
| `-n <slug>` | `--name <slug>` | Use this slug instead of prompting. Must match `^[a-z0-9]+(-[a-z0-9]+)*$` and be free on Polygon; otherwise the push fails instead of re-prompting. Without it, a valid `Config.json.name` is used as-is. |

Flags mirror `pull`:

| Short | Long | Pushes |
| --- | --- | --- |
| `-a` | `--all` | Everything. |
| `-s` | `--solutions` | Solutions. |
| `-c` | `--checker` | Checker (and tests if custom). |
| `-v` | `--validator` | Validator (and tests). |
| `-g` | `--generators` | Generator sources. |
| `-S` | `--statements` | Statement fragments. |
| `-t` | `--tests` | Manual tests + the script verbatim. |
| `-m` | `--metadata` | Description + tags. |
| `-i` | `--info` | Time/memory limits, input/output file, interactive flag. |

After every push, run `polyman remote commit . "msg"` — without it, Polygon doesn't make a new revision and packages built later won't include the change.

**What NOT to do:**
- Don't push without committing afterwards.
- Don't push to the wrong account. Credentials are global per machine; double-check `Config.json.problemId` resolves to the problem you expect (`polyman remote view .` first).
- Don't push partial state in a sequence that breaks `verify` on the Polygon side. Run `polyman verify` locally first.

---

## `polyman remote view <problem-id>`

Read-only display of a problem's Polygon-side state: info, statements, solutions, files, packages, checker, validator, sample tests.

```bash
polyman remote view 123456
polyman remote view .          # uses Config.json.problemId
```

Useful before pushing to confirm what's already up there.

---

## `polyman remote commit <problem-id> "<message>"`

Creates a new Polygon revision capturing the most recent push.

```bash
polyman remote commit . "Tightened constraints to n <= 200000"
polyman remote commit 123456 "Added stress tests for graph cases"
```

Idempotent if there are no changes since the last commit.

**What NOT to do:**
- Don't commit before pushing — there's nothing to commit.
- Don't write tag-style or 1-word messages ("update", "fix"). Polygon revisions are version-controlled; future-you will thank present-you for prose.

---

## `polyman remote package <problem-id> <type>`

Triggers Polygon to build a package and waits up to ~30 minutes for it to finish, polling every 30 s. `<type>` is one of:

| Type | Use |
| --- | --- |
| `standard` | The default contest-ready package (Linux). |
| `linux` | Linux-only package. |
| `windows` | Windows-only package. |
| `full` | Triggers Polygon's **full verification** in addition to packaging. Long. |

```bash
polyman remote package . standard
polyman remote package 123456 linux
polyman remote package . full          # long; triggers full Polygon-side verification
```

The command does not download the package — polyman only triggers the build and reports the resulting state (`READY` / `FAILED`). Download from the Polygon UI.

**What NOT to do:**
- Don't run `package … full` casually — it's expensive on Polygon's side and slows you down for 5-30 minutes.
- Don't run before `polyman remote commit` — you'll package a stale revision.
