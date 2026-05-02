# Redundancy map — polyman docs

**Files audited (8217 lines total):**
- `README.md` (294) — landing page
- `GUIDE.md` (3838) — comprehensive end-user reference
- `TUTORIAL.md` (905) — worked "Sum of Two Numbers" example
- `DOCUMENTATION.md` (3092) — architecture / internals
- `NOTES.md` (88) — Windows quirks (no overlap with anything; leave alone)

**Recommendation:** keep all 5 files. Each has a clear audience (newcomer / user / first-timer / contributor / Windows user). The duplication is internal-to-each-doc and across-pairs, not structural. Cuts below assume the **Light** option from my earlier message.

Notation: ✅ = canonical owner, 🔗 = replace with 1-2 line summary + link to canonical, ✂️ = delete entirely (also covered by canonical or by source/runtime).

---

## Cross-doc duplicated topics

### 1. What polyman is + key features
- ✅ **README §Why Polyman** — keep, it's the elevator pitch
- 🔗 GUIDE §Introduction — collapse to one paragraph + link to README
- ✂️ DOCUMENTATION header line — fine to keep (one line)

### 2. Installation
- ✅ **README §Installation** — npm install + build-from-source, system requirements (this is what npmjs.com shows)
- 🔗 GUIDE §Getting Started/Installation — 1 line + link
- 🔗 TUTORIAL §Prerequisites — 1 line + link
- 🔗 DOCUMENTATION §Building from Source — keep (it's contributor-flavored, distinct from user install) but trim to commands only

### 3. Quick start (new → download-testlib → verify)
- ✅ **README §Quick Start** — keep terse 3-step
- 🔗 GUIDE §Creating Your First Problem — 1 line + "follow TUTORIAL.md for a walkthrough"
- ✅ **TUTORIAL Step 1+2** — keep (it's the worked example, that's the whole point)

### 4. Directory structure tree
Currently appears 4 times:
- ✅ **GUIDE §Directory Structure** — keep one canonical tree
- 🔗 README §Project Structure — keep current 6-line summary, add link
- ✂️ DOCUMENTATION §Generated Project Structure — delete (also stale: shows `tests/manual/` but template uses `manual/tests/`, lists `Solution.cpp` but template ships `acc.cpp`)
- ✂️ DOCUMENTATION §Template Structure — delete (lists `template/GUIDE.md` which doesn't exist)
- 🔗 TUTORIAL Step 1 — keep its mini tree (5 lines, fine), add link

### 5. Config.json schema
- ✅ **GUIDE §Configuration File Reference** — most thorough, keep canonical
- 🔗 README §Configuration — keep minimal example, link to GUIDE for full ref
- 🔗 DOCUMENTATION §Configuration Schema — replace JSON dump with link to GUIDE; replace type-interface code dumps with link to `src/types.d.ts`
- ✅ **TUTORIAL Step 5** — keep (worked example for the sum problem)

### 6. Solution tag table (MA/OK/WA/TL/TO/ML/RE/PE/RJ)
Appears 5+ times. Authoritative source is `src/types.d.ts:214`.
- ✅ **GUIDE §Solutions/Solution Tags** — keep the full table here
- 🔗 README §Solution Tags — keep brief table (it's hot info), add "see GUIDE for full description"
- ✂️ DOCUMENTATION §Solution Tags — delete (also **stale: lists only 7 of 9 tags**, missing `TO` and `RJ`)
- 🔗 TUTORIAL §Step 5 — already a 1-line mention, fine
- ✅ **template/CLAUDE.md** — keep (just added; agent-facing)

### 7. Source types (cpp.g++17, java.11, python.3, ...)
- ✅ **GUIDE §Source Types** — canonical user-facing
- ✂️ DOCUMENTATION §Source Types — delete (just repeats types.d.ts code with no extra info)
- ✅ **src/types.d.ts** — runtime truth

### 8. Standard checkers list
- ✅ **`polyman list checkers`** at runtime is the real source
- 🔗 GUIDE §Available Standard Checkers — keep brief table linking to runtime command and to `assets/checkers/` source
- ✂️ README §Standard Checkers — replace full list with "Run `polyman list checkers` to see all" + 5 most common
- ✂️ DOCUMENTATION §Standard Checkers — delete the 18-item list, link to assets/checkers/

### 9. CLI command tables / per-command walkthroughs
Massive duplication.
- ✅ **GUIDE §CLI Commands Reference** — canonical detailed per-command (the "What Happens" walkthroughs are good, keep)
- 🔗 README §Commands — keep current compact tables, link to GUIDE
- 🔗 TUTORIAL §Quick Reference — collapse to "see GUIDE §CLI Commands Reference"
- ✂️ DOCUMENTATION §Command Mapping + §CLI Interface — delete; both just dump cli.ts source verbatim
- ✅ **`polyman --help`** at runtime; **src/cli.ts** JSDoc as code-side truth

### 10. Workflow / development cycle bullets
- ✅ **GUIDE §Tips for Efficient Workflow + §Workflow** — canonical
- 🔗 README §Workflow Summary — keep 6-step list + link
- ✅ **TUTORIAL §Step 10** — keep (it's the worked verification step)

### 11. Polygon: register / pull / push / commit / package
- ✅ **GUIDE §Remote Operations** — canonical user-facing walkthrough
- 🔗 README §Work with Polygon — keep current 5-line example block + link
- 🔗 TUTORIAL §Step 11 — currently 100 lines; trim to ~30: "register, push, commit" example then link to GUIDE for the full options reference
- ✅ **DOCUMENTATION §Polygon Integration** — keep but split: canonical for **SDK class, HMAC auth, flow diagrams** (this is unique technical content); delete its rehash of user-facing pull/push options

### 12. Validator / Checker / Generator authoring
- ✅ **GUIDE §Writing Validators / Writing Checkers / Writing Generators** — canonical (these are deep)
- 🔗 TUTORIAL §Step 6/7/9 — keep worked sum-problem versions, but each section should end with "for full reference see GUIDE §Writing …"

### 13. Statement structure (legend / input-format / output-format / notes .tex)
- ✅ **GUIDE §Statements** — canonical
- 🔗 TUTORIAL §Step 3 — keep worked version + link

### 14. Testset / group / generator-script-command schema
- ✅ **GUIDE §Testsets** — canonical (very detailed)
- 🔗 TUTORIAL §Step 8 — keep worked version + link

### 15. `polyman verify` step-by-step
- ✅ **GUIDE §Full Verification** — canonical user-facing
- 🔗 DOCUMENTATION §Full Verification — drop the 6-step rehash; replace with one para describing the orchestration layer + link to GUIDE

### 16. Type interfaces (LocalSolution, LocalGenerator, ConfigFile, …)
- ✅ **`src/types.d.ts`** — runtime/code truth
- ✂️ DOCUMENTATION §Type System — drop the verbatim TypeScript code blocks; replace with a one-line description per interface + a "see `src/types.d.ts:NNN`" pointer

### 17. Helper module function-by-function
- ✅ **`src/helpers/*.ts` source** — runtime truth (TypeDoc covers it on the public site)
- ✂️ DOCUMENTATION §Helper Modules — drop the function-by-function listings (1500+ lines); keep one paragraph per module describing role + responsibilities, point to TypeDoc for API. This is the **biggest single cut**.

### 18. Architecture overview / layered diagram
- ✅ **DOCUMENTATION §Architecture Overview** — canonical, unique

### 19. Build from source / contributor setup
- ✅ **DOCUMENTATION §Development Guide** — keep, it's the contributor entry point
- 🔗 README §Quick Install — keep its 1-line build-from-source recipe linking to DOCUMENTATION
- ✅ **CLAUDE.md** — already covers this for agents (just added)

### 20. Troubleshooting / FAQ
- ✅ **GUIDE §Troubleshooting + §FAQ** — canonical
- 🔗 README §Common Issues — keep 3 Q&A linking to GUIDE
- 🔗 TUTORIAL Polygon-troubleshooting subsection — collapse to "see GUIDE §Troubleshooting Remote Operations"
- **GUIDE itself**: merge §Troubleshooting Remote Operations (currently a sub-section of §Remote Operations) into the main §Troubleshooting as a subsection — they're the same kind of content split across two locations

---

## Within-GUIDE redundancies

These are internal duplications inside GUIDE.md alone:

- **Validator/Checker/Generator** each get described twice: once in §Configuration File Reference and once in §Writing X. The Config-Reference versions are 5-15 lines each — collapse to "name, source, sourceType — see §Writing Validators for authoring".
- **§Testsets §Summary** (after the Practical Examples) repeats most of what was just said in the same section. Delete the Summary block (~50 lines).
- **Validator/Checker self-tests JSON shape** — appears in both §Config Ref and §Writing X. Keep in §Writing X only.
- **Do's / Don'ts blocks** — almost every sub-section has them. Many bullet points repeat across sections (e.g., "use relative paths", "test thoroughly"). One pass to dedupe within each chapter would cut ~10%.

---

## Within-DOCUMENTATION redundancies

- **Solution tags** mentioned in §Type System AND in §Polygon SDK section — keep one (and delete since GUIDE owns it; see #6 above).
- **Source types** appears in §Type System AND §Compilation Pipeline. Keep brief reference in §Compilation Pipeline only.
- **Generator interface** appears in §Type System (LocalGenerator), §Generator System, AND §Helper Modules/Generator Module. Keep one architectural mention.
- **Pull/Push flow** described twice: once as enumerated steps in §Remote Operations, once as ASCII flow diagrams in §Polygon Integration. The diagrams are clearer; keep them, drop the enumeration.

---

## Stale content found while reading (fix when cutting)

- `DOCUMENTATION.md:174` — `SolutionTag` lists 7 tags, missing `TO` and `RJ` (types.d.ts has 9).
- `DOCUMENTATION.md:2961` — `PackageState = 'NOT_STARTED' | 'WAITING' | 'RUNNING' | 'READY' | 'FAILED'` but types.d.ts says `'PENDING' | 'RUNNING' | 'READY' | 'FAILED'`.
- `DOCUMENTATION.md:2755` — Template Structure lists `template/GUIDE.md` which doesn't exist.
- `DOCUMENTATION.md:2789` — Generated Project shows `tests/` but actual is `tests/` for output and `manual/tests/` for inputs; also names `Solution.cpp` while template ships `acc.cpp`.
- `TUTORIAL.md:626` — *"We use `-a` (short for `--all`) instead of `--all`"* — phrasing implies they aren't equivalent; they are.
- `TUTORIAL.md:669-672` — uses `polyman solve main -a` and notes *"The command is `solve` not `run`"* — actual CLI command is `run`, not `solve`. **TUTORIAL is wrong here.**
- `src/helpers/create-template.ts:39,42` — printed message says `polyman generate all` / `validate all` (no dashes); actual flag is `--all`.

---

## Estimated impact

If you accept all the above:

| File | Current | After cut | % reduction |
| ---- | ------- | --------- | ----------- |
| README.md | 294 | ~270 | ~10% |
| GUIDE.md | 3838 | ~2900 | ~25% (mostly internal dedup + consolidating troubleshooting) |
| TUTORIAL.md | 905 | ~700 | ~25% (Quick Reference + Polygon section trimmed; stale notes fixed) |
| DOCUMENTATION.md | 3092 | ~1100 | ~65% (drop function-by-function listings, type code dumps, command-mapping rehash, user-facing Polygon walkthrough) |
| NOTES.md | 88 | 88 | 0% (untouched) |
| **Total** | **8217** | **~5060** | **~38%** |

The biggest single cut is the Helper Modules listing in DOCUMENTATION (#17): TypeDoc already publishes this, and the source is the truth.

---

## Execution plan

If you sign off on this map, I'll spawn 3-4 parallel subagents (one per file) to apply the cuts, then a final pass to verify all cross-doc links resolve. Stale-content fixes get applied at the same time. Updates to `CLAUDE.md` / `template/CLAUDE.md` / `template/AGENTS.md` link targets will follow.

**Decisions you need to make:**
1. Approve the canonical-owner choices above? Any topic you want to flip (e.g., keep the Source-Types code dump in DOCUMENTATION instead of dropping)?
2. Do the stale-content fixes (TUTORIAL `solve` → `run`, DOC PackageState, etc.) at the same time, or as a separate commit?
3. The biggest cut is DOCUMENTATION dropping its function-by-function helper listings (~1500 lines). TypeDoc covers this on hamzahassanain.github.io/polyman/. OK to delete or do you want them kept locally as a markdown mirror?
