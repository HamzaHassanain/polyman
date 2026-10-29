**Complete Technical Reference for Polyman CLI Tool**

A TypeScript-based CLI tool for Codeforces problem setters that automates problem preparation workflows including test generation, validation, solution verification, and checker integration.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Components](#core-components)
3. [Type System](#type-system)
4. [Action Layer](#action-layer)
5. [Helper Modules](#helper-modules)
6. [Execution Engine](#execution-engine)
7. [Formatter System](#formatter-system)
8. [Configuration Schema](#configuration-schema)
9. [Compilation Pipeline](#compilation-pipeline)
10. [Validation System](#validation-system)
11. [Solution Testing](#solution-testing)
12. [Checker Integration](#checker-integration)
13. [Generator System](#generator-system)
14. [Error Handling](#error-handling)
15. [Polygon Integration](#polygon-integration)
    - [Polygon SDK](#polygon-sdk)
    - [API Authentication](#api-authentication)
    - [Remote Operations Flow](#remote-operations-flow)
16. [Agent Architecture (src/agent)](#agent-architecture-srcagent)
    - [Layers](#layers)
    - [Providers, keys and models](#providers-keys-and-models)
    - [The Event Protocol](#the-event-protocol)
    - [The Workflow Engine](#the-workflow-engine)
    - [Adding a Tool](#adding-a-tool)
    - [Adding a Recipe](#adding-a-recipe)
    - [Testing the Agent](#testing-the-agent)
    - [Evals](#evals)
17. [File Structure](#file-structure)
18. [Development Guide](#development-guide)
19. [API Reference](#api-reference)
20. [Implementation Notes](#implementation-notes)

---

## Architecture Overview

Polyman follows a layered architecture:

```
┌─────────────────────────────────────┐
│     CLI Layer (cli.ts)              │
│     Commander.js command parsing    │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│     Action Layer (actions.ts)       │
│     High-level workflow orchestration│
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│     Helper Layer (helpers/)         │
│     Domain-specific logic modules   │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│     Execution Engine (executor.ts)  │
│     Process management & I/O        │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│     Formatter (formatter.ts)        │
│     Terminal output styling         │
└─────────────────────────────────────┘
```

---

## Core Components

The CLI entry point is `src/cli.ts`. It uses Commander.js to parse argv and delegate to action functions in `src/actions.ts`. See [GUIDE.md - CLI Commands Reference](GUIDE.md#cli-commands-reference) for user-facing command descriptions, or read `src/cli.ts` for the wiring.

---

## Type System

All TypeScript types live in `src/types.d.ts`. The key shapes are `ConfigFile` (the on-disk Config.json schema), `LocalSolution`, `LocalGenerator`, `LocalChecker`, `LocalValidator`, `LocalTestset`, plus `SolutionTag` and the source-type unions for C++/Java/Python. See `src/types.d.ts` for the full definitions and JSDoc, or [GUIDE.md - Configuration Reference](GUIDE.md#configuration-file-reference) for usage.

---

## Action Layer

Action functions in `src/actions.ts` orchestrate workflows by composing helpers. Each action is structured as a sequence of independent `step…` calls (see `src/steps.ts`) which compile, run, and verify components. See [GUIDE.md - CLI Commands Reference](GUIDE.md#cli-commands-reference) for what each action does from the user perspective.

---

## Helper Modules

Each helper module owns a single domain. Function-level documentation is on TypeDoc; this section lists the responsibility of each module so contributors know where to look.

- **`src/helpers/utils.ts`** — Cross-cutting utilities: config file reading, directory management, C++ and Java compilation, error logging, and the shared exit/throw helpers used by every action.
- **`src/helpers/generator.ts`** — Generator compilation and test file production. Drives Polygon-format scripts: parses, resolves to concrete test indices, then runs each generator (or copies each manual test) into the testset's output directory.
- **`src/helpers/validator.ts`** — Validator compilation, validation of generated test inputs, and validator self-testing against `validator_tests.json`.
- **`src/helpers/checker.ts`** — Checker compilation (custom or standard from `assets/checkers/`), checker invocation, and checker self-testing. Owns the verdict mapping from checker stdout to `CheckerVerdict`.
- **`src/helpers/solution.ts`** — Solution compilation, execution against a testset, and verdict comparison. Responsible for enforcing the solution-tag contract (e.g. a WA solution must produce WA or PE on at least one test, as on Polygon).
- **`src/helpers/create-template.ts`** — Materialises the bundled `template/` tree into a new problem directory when `polyman new` runs.
- **`src/helpers/testlib-download.ts`** — Fetches `testlib.h` from the upstream GitHub repo for the `polyman download-testlib` command.
- **`src/helpers/testset.ts`** — Testset and group resolution: given filters from CLI options, returns the matching testsets, groups, and indices.
- **`src/helpers/script-parser.ts`** — Parses Polygon-format generation scripts (`gen [args] > N|$|{indices}`, FreeMarker comments and `<#list>` loops, `<#-- @group X -->` headers) and resolves them, together with `manualTests[]`, into a flat list of test-production instructions with concrete indices.
- **`src/helpers/remote/`** — Polygon integration. `pulling.ts` and `pushing.ts` implement the per-component download/upload steps; `utils.ts` handles credentials, line-ending normalization, and problem-id extraction; `viewer.ts` formats `polyman remote view` output.

For function-level docs see TypeDoc at https://hamzahassanain.github.io/polyman/.

---

## Execution Engine

### Executor: `src/executor.ts`

Low-level process execution with timeout and memory limit support.

#### `executor.executeWithTimeout(command: string, args: string[], timeoutMs: number, memoryLimitMB: number): Promise<ExecutionResult>`

Executes command with resource limits.

**Parameters:**

- `command`: Executable path or command
- `args`: Command-line arguments
- `timeoutMs`: Maximum execution time
- `memoryLimitMB`: Maximum memory usage

**Returns:**

```typescript
interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  memoryExceeded: boolean;
}
```

**Platform Support:**

- **Linux:** Uses `ulimit` for memory limiting
- **macOS:** Memory limiting not supported (warning shown)
- **Windows:** Memory limiting not supported (warning shown)

**Implementation:**

```typescript
// Memory limiting (Java gets -Xmx instead)
if (memoryLimitMB > 0 && process.platform === 'darwin') {
  // macOS: ulimit -v fails there, so the limit is skipped and a warning is shown once
} else if (memoryLimitMB > 0 && process.platform !== 'win32') {
  const memoryLimitKB = memoryLimitMB * 1024;
  command = `(ulimit -v ${memoryLimitKB}; ${command})`;
}

// Spawn process with timeout
const child = spawn(command, args, { shell: true });
const timeout = setTimeout(() => {
  child.kill();
  timedOut = true;
}, timeoutMs);
```

---

## Formatter System

### Formatter Class: `src/formatter.ts`

Terminal output styling with Codeforces theme.

The actual colors come from `src/theme.ts`: a dark theme and a light theme. A non-empty `NO_COLOR` turns all colors off. `POLYMAN_THEME=dark` or `POLYMAN_THEME=light` forces a theme. When `POLYMAN_THEME` is unset or `auto`, `resolveTheme()` detects the terminal background with `src/helpers/terminal-background.ts`: first `COLORFGBG`, then an OSC 11 query followed by a DA1 query (the DA1 answer tells a terminal without OSC 11 support apart from a slow one), with a 100 ms timeout, and dark as the fallback. Detection is skipped when stdin or stdout is not a TTY, when chalk has no colors, when `TERM=dumb`, for background jobs, and on Windows.

Detection is async, but `fmt` is created when the module loads, so `src/cli.ts` awaits `resolveTheme()` once before `program.parse()` and applies the result with `fmt.setTheme(theme)` and `printComprehensiveHelp(program, theme)`. The sync `getTheme(env)` does no detection (unset means dark); it is the default for `new Formatter()` and for tests.

**Colors:**

- Primary: `#1E88E5` (blue)
- Error: `#FF6B6B` (red)
- Success: `#4CAF50` (green)
- Warning: `#FFC107` (yellow)

### Output Methods

**`section(title: string)`**

Prints section header with box.

```
╭─────────────────────────────────╮
│  📁 SECTION TITLE               │
╰─────────────────────────────────╯
```

**`step(stepNumber: number, title: string)`**

Prints numbered step header.

```
╭─ STEP 1: Creating Directory
```

**`stepComplete(message: string)`**

Prints step completion (`╰─ ✓ Done`).

Other methods: `success`, `error`, `warning`, `info`, `log`, `successBox`, `errorBox`.

### Utility Methods

- `primary(text: string)`: Blue color
- `highlight(text: string)`: Cyan color
- `dim(text: string)`: Dimmed text
- `successIcon()`: ✓ icon
- `errorIcon()`: ✗ icon
- `warningIcon()`: ⚠ icon
- `infoIcon()`: ℹ icon

---

## Configuration Schema

The on-disk `Config.json` schema is described in [GUIDE.md - Configuration File Reference](GUIDE.md#configuration-file-reference) for users, and defined as TypeScript interfaces in `src/types.d.ts` (`ConfigFile`).

---

## Compilation Pipeline

### Language Support

**C++:**

```bash
g++ -O2 -std=<cppStandard> <compiler.flags...> -iquote <problem-root> -o output source.cpp
```

The executable comes from `POLYMAN_CXX`, then `compiler.cpp` in `Config.json`, then `g++` (`resolveCppCompiler` in `src/helpers/utils.ts`). The flags come from `resolveCppFlags`: a `-std=` item in `compiler.flags` replaces `-std=<cppStandard>` and an `-O` item replaces `-O2`. For a solution, `compileSolution` in `src/helpers/solution.ts` passes the standard named in its `sourceType` (`cpp.g++17` gives `c++17`) as the fallback when `Config.json` has no `cppStandard`. Solutions are compiled with `{ onlineJudge: true }`, which adds `-DONLINE_JUDGE` after the standard (like Codeforces), unless `compiler.flags` already defines it. Checkers, validators and generators do not get it. The resolved executable and flags are part of the compile-cache key.

The problem root (the current working directory) is passed via `-iquote` so sources in subdirectories such as `generators/` can `#include "testlib.h"` from the root-level copy without a system-wide install. Every path and argument that reaches the shell is quoted with `quoteShellArgument` (`src/helpers/shell.ts`), so problem directories containing spaces or shell metacharacters work.

**Java:**

```bash
javac source.java
java ClassName < input.txt > output.txt
```

`javac` comes from `POLYMAN_JAVAC`, then `compiler.javac`, then `javac` (`resolveJavaCompiler`). `java` is always taken from `PATH`.

**Python:**

```bash
python3 source.py < input.txt > output.txt
```

### Compilation Flow

1. Detect language from file extension
2. Call appropriate compiler function:
   - `.cpp` → `compileCPP`
   - `.java` → `compileJava`
   - `.py` → Return interpreter command
3. Handle compilation errors
4. Return executable path or command

---

## Validation System

The validator is a C++ program built against testlib that reads a test input on stdin and exits `0` for VALID or `3` for INVALID (any other code is an error). The validation workflow compiles the validator once and runs it over each test file in the requested testset, logging per-test results. Validator self-tests live in `validator/validator_tests.json` as `{stdin, expectedVerdict}` pairs and are exercised by `polyman test validator` to verify the validator agrees with its own contract before being used on generated tests.

---

## Solution Testing

Each solution is compiled, then run against every test in the active testset under the configured time and memory limits. The runner inspects the first line of the captured output for the sentinel verdicts `Time Limit Exceeded`, `Memory Limit Exceeded`, and `Runtime Error`; otherwise it invokes the checker on the (input, output, answer) triple to obtain `OK`/`WA`/`PE`. Aggregated `VerdictTracker` flags (`didWA`, `didPE`, `didTLE`, `didMLE`, `didRTE`) are then matched against the solution's declared `SolutionTag` so that, e.g., a `WA` solution must get WA or PE on at least one test (as on Polygon) and a `MA` solution must pass them all.

---

## Checker Integration

### Standard Checkers

Standard checkers ship in `assets/checkers/*.cpp` (vendored testlib checkers — do not modify). Run `polyman list checkers` for the runtime list, or see [GUIDE.md - Standard Checkers](GUIDE.md#available-standard-checkers).

### Custom Checkers

**Location:** `checker/chk.cpp`

**Interface:**

```cpp
int main(int argc, char* argv[]) {
  registerTestlibCmd(argc, argv);

  // Read input
  // Read output (ouf)
  // Read answer (ans)

  // Compare and return verdict:
  // quitf(_ok, "Correct");
  // quitf(_wa, "Wrong Answer");
  // quitf(_pe, "Presentation Error");
}
```

### Checker Execution

**Command:**

```bash
./checker <input_file> <output_file> <answer_file>
```

**Output Parsing:**

- First word determines verdict
- `ok`/`OK` → OK
- `wrong`/`WA` → WA
- `presentation`/`PE` → PE

---

## Generator System

Generators are testlib C++ programs that take parameters as positional `argv[]` and write the test content to stdout. The pipeline is:

1. **Parse** — `script-parser.ts` reads the testset's `generatorScript.script` (or `scriptFile`) as Codeforces-Polygon syntax: each non-comment line is `gen-name [args...] > target` where `target` is `N`, `$` (smallest unused), or `{1-3,7}` (multi-output). FreeMarker `<#-- comments -->` and `<#list a..b as i> ... ${i} ... </#list>` blocks are supported, and `<#-- @group <name> -->` headers tag every following line.
2. **Resolve** — `script-parser.ts:resolveTests` merges parsed lines with the testset's `manualTests[]`, assigning concrete Polygon indices to every `$`. Manual indices and explicit indices reserve slots; `$` walks the smallest free integer. Duplicate indices are an error.
3. **Compile + run** — `generator.ts:executeResolvedTests` compiles each referenced generator once and, per resolved test, either copies the manual `.in` file into `testsets/<name>/test<index>.txt`, runs the generator with stdout redirected to that file, or (for `> {indices}` lines) runs the generator with cwd set to the testset directory and verifies it wrote the promised files itself.

Generator names with extensions (`gen.exe`, `gen.cpp`) are rejected — Polygon strips them on the server side, so polyman keeps the same constraint.

---

## Error Handling

Polyman provides comprehensive error handling with formatted output and proper exit codes.

### Error Flow

1. **Throw:** Helpers and steps throw. When the kind of failure is known they throw a `PolymanError(message, exitCode, hint?)` from `src/errors.ts` (codes: `1` problem failed, `2` usage error, `3` environment error, `4` remote error).
2. **Catch in the action:** The action prints its error box, finishes the `--json` report with the code, and throws the error again.
3. **Exit in one place:** The `.catch` on `program.parseAsync` in `cli.ts` prints the message (and the hint) and exits with `exitCodeFor(error)`. Any error that is not a `PolymanError` exits with `1`.

Only two places call `process.exit` on their own: the SIGINT/SIGTERM handler in `executor.ts` (exit `130`/`143`, a signal does not go through an action) and `node-version-check.ts` (exit `3`, it runs before anything else loads). See [GUIDE.md](GUIDE.md#exit-codes) for the full table.

### Error Types

**Configuration Errors:**

- Config.json not found
- Invalid JSON
- Missing required fields
- No main-correct solution

**Compilation Errors:**

- Source file not found
- Compilation failed
- Invalid syntax

**Execution Errors:**

- TLE (timeout)
- MLE (memory exceeded)
- RTE (runtime error)
- Exit code ≠ 0

**Validation Errors:**

- Test file not found
- Validator failed
- Invalid test input

**Checker Errors:**

- Checker compilation failed
- Unexpected verdict format
- Answer file not found

---

## Polygon Integration

Polyman provides comprehensive integration with the Codeforces Polygon system through a type-safe TypeScript SDK and remote operations.

### Polygon SDK

**Location:** `src/polygon.ts`

The Polygon SDK is a complete TypeScript implementation of the Polygon API v1, providing type-safe methods for all Polygon operations.

#### SDK Architecture

```typescript
class PolygonSDK {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;

  constructor(config: PolygonConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.baseUrl || 'https://polygon.codeforces.com/api';
  }

  // 54+ API methods for complete Polygon integration
}
```

The SDK exposes 50+ methods grouped under Problem Management, Statements, Solutions, Checker & Validator, Generators, Tests, Metadata, Packages, and Contests. See `src/polygon.ts` for the full method signatures and JSDoc, or TypeDoc for the rendered API.

### API Authentication

Polygon API uses SHA-512 signature-based authentication.

#### Authentication Flow

1. **API Credentials:**

   ```typescript
   {
     apiKey: 'your-api-key',
     apiSecret: 'your-api-secret'
   }
   ```

2. **Request Signing:**

   ```typescript
   // Generate 6-character random prefix
   const rand = generateRandomString(6);

   // Sort parameters alphabetically
   const sortedParams = Object.keys(params).sort();

   // Build signature string
   const sigString = `${rand}/${methodName}?${paramString}#${apiSecret}`;

   // Compute SHA-512 hash
   const hash = crypto.createHash('sha512').update(sigString).digest('hex');

   // Final signature
   const apiSig = rand + hash;
   ```

3. **Request Parameters:**
   - `apiKey` - Your API key
   - `time` - Current Unix timestamp
   - `apiSig` - Computed signature
   - Method-specific parameters

4. **API Call:**

   ```
   POST https://polygon.codeforces.com/api/{method}
   Content-Type: application/x-www-form-urlencoded

   apiKey=xxx&time=xxx&apiSig=xxx&problemId=xxx&...
   ```

#### Security Considerations

- API credentials stored in `~/.polyman/credentials.json`
- File permissions set to 600 (owner read/write only)
- Credentials never logged or displayed
- Signature includes timestamp to prevent replay attacks
- Each request has unique random prefix

### Remote Operations Flow

#### Pull Operation Flow

```
User Command
    ↓
polyman remote pull 123456 ./my-problem
    ↓
remotePullProblemAction
    ↓
┌────────────────────────────────────┐
│ Step 1: Read Credentials           │
│ - Load from ~/.polyman/            │
└────────────────────────────────────┘
    ↓
┌────────────────────────────────────┐
│ Step 2: Initialize SDK              │
│ - Create PolygonSDK instance        │
│ - Configure authentication          │
└────────────────────────────────────┘
    ↓
┌────────────────────────────────────┐
│ Step 3: Fetch Problem Info          │
│ - Get limits, I/O files             │
│ - Get problem metadata              │
└────────────────────────────────────┘
    ↓
┌────────────────────────────────────┐
│ Step 4: Create Directory            │
│ - Create problem directory          │
│ - Create subdirectories             │
└────────────────────────────────────┘
    ↓
┌────────────────────────────────────┐
│ Step 5: Download Components         │
│ ┌──────────────────────────────┐   │
│ │ Solutions (parallel)         │   │
│ │ Checker + tests              │   │
│ │ Validator + tests            │   │
│ │ Generators                   │   │
│ │ Statements (all languages)   │   │
│ │ Tests (parallel fetch)       │   │
│ │ Metadata                     │   │
│ └──────────────────────────────┘   │
│ - Normalize line endings (→ Unix)   │
└────────────────────────────────────┘
    ↓
┌────────────────────────────────────┐
│ Step 6: Generate Config.json        │
│ - Build complete configuration      │
│ - Include all metadata              │
└────────────────────────────────────┘
    ↓
Success! Problem ready for local work
```

#### Push Operation Flow

```
User Command
    ↓
polyman remote push ./my-problem
    ↓
remotePushProblemAction
    ↓
┌────────────────────────────────────┐
│ Step 1: Read Credentials           │
└────────────────────────────────────┘
    ↓
┌────────────────────────────────────┐
│ Step 2: Initialize SDK              │
└────────────────────────────────────┘
    ↓
┌────────────────────────────────────┐
│ Step 3: Read Config.json            │
│ - Get problem ID                    │
│ - Get all configurations            │
└────────────────────────────────────┘
    ↓
┌────────────────────────────────────┐
│ Step 4: Update Problem Info         │
│ - Upload time/memory limits         │
│ - Upload I/O file settings          │
└────────────────────────────────────┘
    ↓
┌────────────────────────────────────┐
│ Step 5-11: Upload Components        │
│ ┌──────────────────────────────┐   │
│ │ Solutions with tags          │   │
│ │ Checker + set active         │   │
│ │ Validator + tests + set      │   │
│ │ Generators                   │   │
│ │ Statements (all languages)   │   │
│ │ Metadata                     │   │
│ │ Testsets:                    │   │
│ │   - Clear existing           │   │
│ │   - Enable groups            │   │
│ │   - Upload tests (parallel)  │   │
│ │   - Upload script            │   │
│ └──────────────────────────────┘   │
│ - Normalize line endings (→ Win)    │
└────────────────────────────────────┘
    ↓
Success! Changes uploaded to Polygon
(Don't forget to commit!)
```

#### Performance Optimizations

**Parallel Test Operations:**

Both pull and push operations fetch/upload manual tests in parallel for significant performance improvements:

**Pull (Parallel Fetch):**

```typescript
// Fetch test metadata without inputs (fast)
const tests = await sdk.getTests(problemId, testsetName, true);
const manualTests = tests.filter(t => t.manual);

// Fetch all inputs in parallel
const promises = manualTests.map(test =>
  sdk.getTestInput(problemId, testsetName, test.index)
);
const results = await Promise.all(promises);
```

**Push (Parallel Upload):**

```typescript
// Create upload promises for all manual tests
const promises = manualTests.map(test =>
  sdk.saveTest(problemId, testsetName, index, input, options)
);

// Upload all in parallel
await Promise.all(promises);
```

**Performance Impact:**

- 50 manual tests: ~50 seconds sequential → ~2 seconds parallel
- 100 manual tests: ~100 seconds sequential → ~3 seconds parallel

---

## Agent Architecture (src/agent)

`polyman chat` and the `polyman ai` commands live in `src/agent/`. The user side is in [GUIDE.md - Chat (AI agent)](GUIDE.md#chat-ai-agent). The design docs are in [`design/agent/`](design/agent/README.md); this section is a map of the code, not a copy of them.

The main rule (design decision D1): the agent never imports `actions.ts` or `steps.ts`. It runs the polyman CLI as a child process with `--json`, like a user would. A crash or a `process.exit` in the CLI cannot kill the chat, and the CLI stays the one source of truth.

### Layers

```
cli.ts                    `chat` and `ai` load the agent with import(), only when they run
  ↓
agent/index.ts            createChatRuntime(): bus, gate, runner, tools, sandbox, prompt, session
  ↓
agent/core/               AgentSession (the loop), event bus, context trimming, system prompt
  ↓
agent/tools/              registry, permission gate, sandbox, the tools themselves
  ↓
agent/runner/             NodeCliRunner: runs dist/cli.js as a child process
  ↓
agent/providers/          the model APIs (streaming, retries, keys)
  ↓
agent/tui/ or plain.ts    Ink terminal UI, or the line mode; both only read events
```

- **`cli.ts`** loads `agent/index.js` and `agent/ai-commands.js` with a dynamic `import()`. Other commands never load the agent code, so they do not start slower.
- **`agent/index.ts`**: `resolveChatStart()` decides the problem folder (a folder with `Config.json`, or "new problem" mode). `createChatRuntime()` wires everything and needs no terminal and no key, so tests call it with a mock provider. `startChat()` adds the real provider and the UI.
- **`agent/core/`**:
  - `session.ts`: `AgentSession`, the agent loop. One turn asks the model, runs the tool calls it asks for, and asks again, until the model stops, the step limit, a cancel or an error. It has a repeat guard (the same call with the same arguments at most twice per turn, reset after a successful write) and it redacts secrets from tool output and errors. The chat and every workflow worker use this same class.
  - `event-bus.ts`, `events.ts`: the event protocol, see below.
  - `context.ts`: trims a copy of the history to the context budget before each model call. The history itself is never changed.
  - `prompt.ts`: `ChatPromptBuilder` builds the system prompt before each call: the rules (`workflow/prompts.ts`), the skills index, the environment (OS, `g++`, polyman version) and the problem state (notes, a `Config.json` summary, file names).
  - `text-tool-call.ts`: finds a tool call the model wrote as text, so the session can ask it to use the real format.
  - `pasted-key.ts`: blocks a message that looks like a Polygon key before it is sent.
- **`agent/tools/`**:
  - `registry.ts`: every call goes through the same checks: the tool exists, the arguments are valid JSON and match the schema (`schema.ts`), there is a problem folder when the tool needs one, the permission gate allows it, it runs with a time limit, and its output is cut to a size the model can read. A failure is an error output the model reads, never a throw (only a cancel throws).
  - `permissions.ts`: `DefaultPermissionGate`. Each tool has a risk (`read`, `run`, `write`, `remote`) and the mode (`ask`, `auto-edit`, `plan-approved`) decides what asks the user. `remote` always asks. Asking emits `approval_needed` and waits for `resolve()`.
  - `sandbox.ts`: `FolderSandbox` checks every path by its real path (symlinks followed). It refuses paths outside the problem folder and writes to `.polyman/cache/`, `.polyman/agent/sessions/` and `testlib.h`. A workflow worker gets a sandbox with `allowWrite` set to the files its task owns.
  - `fs-tools.ts`, `cli-tools.ts`, `remote-tools.ts`, `notes-tools.ts`, `ideas-tool.ts`, `workflow-tool.ts`, and `skills.ts` one level up: the tools. `skills.ts` reads `template/instructions/*.md` from the installed package.
- **`agent/runner/`**: `NodeCliRunner` spawns `process.execPath dist/cli.js ...`, never a shell. All runs go through one FIFO lock (`lock.ts`), so parallel workers never compile or time solutions at the same time. The child gets `POLYMAN_AGENT=1`, `NO_COLOR=1` and the environment without API keys. On POSIX the child leads its own process group and `kill-tree.ts` kills the whole group on a timeout or a cancel; on Windows it uses `taskkill /T /F`. The full output goes to `<problem>/.polyman/agent/logs/`, the tool result keeps only the start and the end.
- **`agent/providers/`**: see [Providers, keys and models](#providers-keys-and-models). `mock.ts` (`MockProvider`) plays a fixed script and is what the tests use.
- **`agent/tui/`**: the Ink UI. It is the only ESM part of polyman (`src/agent/tui/package.json` has `"type": "module"`, and `npm run build` copies it to `dist/`), because Ink is ESM only. `agent/index.ts` loads it with a variable path. `store.ts` is a pure reducer from events to screen state, so most UI logic is tested without a terminal. `keybindings.ts` has the keys and `/help`. `dev/run.tsx` starts the UI with a fake session: `npm run build && node dist/agent/tui/dev/run.js`.
- **`agent/plain.ts`**: the line mode (`--plain`) with `readline`. It is also the fallback when the TUI fails to load.

### Providers, keys and models

<!-- PROVIDERS: filled by the any-model PR -->

### The Event Protocol

Everything the core reports is an event on the bus (`core/events.ts`). The TUI, the plain mode, the evals and the tests read the same events. `SimpleEventBus` gives each event a `seq` number.

| Event                                               | When                                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `turn_start`, `turn_end`                            | A user message starts a turn. `turn_end` has the reason: `done`, `cancelled`, `max_steps` or `error`.             |
| `text_delta`, `reasoning_delta`                     | A chunk of the answer or of the model's reasoning.                                                                |
| `tool_call`, `tool_progress`, `tool_result`         | A tool call, a progress line (stderr of the CLI), and its result. Events from a workflow worker carry a `taskId`. |
| `approval_needed`, `approval_resolved`              | A call waits for the user, and the answer (`allow_once`, `allow_session`, or `deny` with a reason).               |
| `usage`                                             | Token counts of one model call, and its cost when the provider reports it.                                        |
| `notes_updated`, `problem_dir_changed`, `compacted` | The spec changed, `create_problem` made a new folder, old messages were trimmed.                                  |
| `plan_created`, `plan_approval_needed`              | The manager made a plan, and the plan waits for the user.                                                         |
| `task_started`, `task_checkpoint`, `task_done`      | A workflow task started an attempt, ran its check, and ended.                                                     |
| `workflow_done`                                     | The workflow ended, with `ok`, a summary and the cost.                                                            |

The UI answers approvals with `session.resolveApproval()`, which calls the gate's `resolve()`.

### The Workflow Engine

The idea is in [10-workflow-manager.md](design/agent/10-workflow-manager.md): do not make the model smarter, make each of its tasks smaller and check every task with real tools. The contract is `workflow/types.ts`.

- **`tools/workflow-tool.ts`**: the `start_workflow` tool. It reads the spec from the notes, checks that the spec has the sections the recipe needs, builds a `WorkflowScheduler` and runs it inside the chat turn, so `esc` stops it. Its risk is `run`, because the user approves the plan instead. It puts the gate's mode back when the workflow ends.
- **`workflow/manager.ts`**: the manager. It fills a recipe into a plan with the `submit_plan` tool, and with the `decide` tool it chooses what to do with a task that failed 3 times (`retry_with_hint`, `redo_task` or `ask_user`). It does not use a session, only a few plain model calls. It never checks the plan.
- **`workflow/scheduler.ts`**: `WorkflowScheduler`, our code, no model. It gets the plan (a second try with the errors, then a default plan from `recipes.ts`), checks it with `checkPlan()`, asks the user once (`gate.askPlan()`, which puts the gate in `plan-approved`), and runs the tasks in dependency order with at most `WORKFLOW_LIMITS.parallel` workers at a time. The retry ladder: attempt 2 continues the worker session with the error digest, attempt 3 is a fresh worker with a short note, then the manager decides. A `verify` task runs up to `WORKFLOW_LIMITS.fixRounds` fix rounds. A failed task skips the tasks that depend on it.
- **`workflow/worker.ts`**: one task as a small `AgentSession` with its own prompt, tools, sandbox (`allowWrite` = the task's files), gate and a private bus. A worker gets only a few tools: `read_file`, `list_files`, `load_skill`, the write tools when the task writes, `verify` for a fix task, `review` for the statement critic, and `finish_task`. `finish_task` runs the task's real check first, so the worker can fix a failure in the same session.
- **`workflow/checkpoints.ts`**: `CliCheckpoints` runs the real check of each task kind with the compiler and the CLI (`test validator --json`, `generate --all --json`, `validate --all --json`, `verify --json`), and runs the tasks that need no model (`scaffold`, `checker`, `generate_validate`, `verify` and the `prove_idea` checks). `MemoCheckpoints` skips a check that already passed when the task's files and `Config.json` did not change.
- **`workflow/config-patch.ts`**: the single writer of `Config.json` during a workflow. Workers return a `ConfigPatch`, the scheduler applies the patches one at a time, and a patch that makes the config invalid is refused with nothing written. `dropTemplateExamples()` removes the template's examples in the scaffold task.
- **`workflow/recipes.ts`**: the recipes (`build_problem`, `fix_verify`, `strengthen_tests`, `prove_idea`, `find_ideas`): which task kinds a plan may have, which it must have, and the order rules. Also `checkPlan()`, `addRecipeDependencies()` and the fixed or default plans (`buildProblemSkeleton()`, `fixVerifyPlan()`, `strengthenTestsSkeleton()`, `proveIdeaPlan()`).
- **`workflow/prove.ts`**: the `prove_idea` checks (stress, samples, max test, kill wrong) on the quick programs in `.polyman/agent/prove/`. `compile.ts` compiles and runs them without the CLI.
- **`workflow/ideas.ts`**: `IdeaWorkflow` for `find_ideas`. It emits the same plan and task events, so the UI shows the same tree.
- **`workflow/spec.ts`**: parses the spec. The format is in [`design/agent/briefs/SPEC-FORMAT.md`](design/agent/briefs/SPEC-FORMAT.md).
- **`workflow/prompts.ts`**: the prompts of the chat agent, the manager and each worker kind.

### Adding a Tool

1. Write a `Tool` (`tools/types.ts`) in the file of its group, or a new file in `src/agent/tools/`: a snake_case `name`, a plain `description`, a JSON Schema in `parameters`, a `risk`, `needsProblem`, and `describe()` for the approval title and command.
2. In `run()`, pass every path through `ctx.sandbox.resolve()` and every polyman command through `ctx.runner` with `--json`. Return a short `content` for the model and the full data in `data` for the UI. Return `isError: true` for a failure, do not throw.
3. Register it in `createChatRuntime()` in `src/agent/index.ts`. If workers need it, add it to the tools of `gemmaSchedulerFactory()` in `tools/workflow-tool.ts` and to `workerToolNames()` in `workflow/worker.ts`.
4. Pick the risk with care: it decides when the user is asked. Anything that changes Polygon is `remote`.
5. If the agent must know when to use it, add a line to `chatSystemPrompt()` in `workflow/prompts.ts`.
6. Add tests in `tests/agent/tools/`, and a safety test in `tests/agent/safety/` if it touches files or secrets.

### Adding a Recipe

1. Add the name to `Plan['recipe']` in `workflow/types.ts`, and any new task kind to `TaskKind`.
2. Add the recipe to `RECIPES` in `workflow/recipes.ts`: allowed kinds, required kinds and order rules. If the plan has a fixed shape, write a plan function (like `fixVerifyPlan()`) and use it in `makePlan()` in `scheduler.ts`, so no model call is needed. Add a default plan if the manager can fail.
3. For a new task kind: its check in `CliCheckpoints.check()` (worker kinds) or `runNoModelTask()` (no model kinds) in `checkpoints.ts`, its worker prompt and info in `workflow/prompts.ts`, its tools in `workerToolNames()`, and the kind lists in `recipes.ts` (`NO_MODEL_KINDS`, `MUST_OWN_FILES`).
4. Describe the recipe for the manager in `recipeDescription()` in `workflow/prompts.ts`.
5. Add it to the `recipe` enum of `start_workflow` and to `workflowSpecProblems()` in `tools/workflow-tool.ts`, and tell the chat agent when to use it in `chatSystemPrompt()`.
6. Add tests in `tests/agent/workflow/` (`recipes.test.ts`, `scheduler.test.ts`, `checkpoints.test.ts`).

### Testing the Agent

`npm test` runs the agent tests with the rest. They need no key and no network.

- **Mock provider.** `MockProvider` plays a script of model turns (text, tool calls, usage, errors). Most core, tool and workflow tests use it with `createChatRuntime()`.
- **Recorded fixtures.** `tests/fixtures/agent/openai/` and `tests/fixtures/agent/anthropic/` have HTTP responses in the providers' wire formats, close to what `curl -i` prints. The provider tests parse them.
- **Fake CLI.** `tests/agent/fixtures/fake-cli.mjs` is a small fake polyman for the runner tests: it prints lines, sleeps, starts children and exits with a code.
- **TUI.** `tests/agent/tui/` renders the components and the whole `App` with `ink-testing-library` and sends keys to it. `store.test.ts` tests the reducer alone.
- **Safety.** `tests/agent/safety/` has path escapes, protected files, permissions, secrets, limits and bad tool calls.
- **End to end.** `tests/agent/e2e/build-problem.test.ts` runs a scripted model through the real chat runtime, tools, scheduler, checkpoints and `dist/cli.js` to build a problem in a temp folder, and the real `polyman verify` must pass. It needs `npm run build` and `g++`, and is skipped without them.

### Evals

The evals run the agent with a real model. They are not part of `npm test`. They need `npm run build` and `g++`. The probe, real, baseline and wf runs also need an OpenRouter key in `OPENROUTER_API_KEY` (only read from the environment, never written to a file). They copy `corpus/vendor/testlib.h` instead of downloading it.

**They cost real money.** A probe run is a few cents, but a real or baseline run can cost up to about $0.60 per case. Use the `--max-cost` option, and run one case before `--all`.

| Folder            | What it does                                                                                                                                                                                                                         | Run                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `evals/cases/`    | The test problems (`pairs-sum`, `max-subarray`, `bracket-depth`): a `spec.md` and a hidden `reference/` (main, brute, wrong solutions, tests, answers) the agent never sees. `check.mjs` checks the cases themselves, with no model. | `node evals/cases/check.mjs [--case <id>]`     |
| `evals/probe/`    | One model call per case, no agent loop: does the model call the right tool with valid arguments?                                                                                                                                     | `node evals/probe/probe.mjs --runs 3`          |
| `evals/real/`     | The whole `build_problem` workflow on a case, then `verify` and hidden checks against the reference.                                                                                                                                 | `node evals/real/run.mjs --case pairs-sum`     |
| `evals/baseline/` | The same build with one long chat session and no workflow, to compare with `evals/real/`. `compare.mjs` puts them side by side.                                                                                                      | `node evals/baseline/run.mjs --case pairs-sum` |
| `evals/broken/`   | Three copies of pairs-sum, each with one planted bug that `verify` catches. Used to test `fix_verify` and `strengthen_tests`, no model needed to run `verify` on them.                                                               | see `evals/broken/README.md`                   |
| `evals/wf/`       | `drive.mjs`, a small script that runs the real `build_problem` workflow on one case.                                                                                                                                                 | `node evals/wf/drive.mjs --case pairs-sum`     |

Each folder's `README.md` has the options, what one run does and the last results. The results go to `evals/*/results/`, which is git-ignored.

---

## File Structure

See [GUIDE.md - Directory Structure](GUIDE.md#directory-structure) for the canonical layout of a Polyman problem directory and the bundled template tree.

---

## Development Guide

### Building from Source

```bash
git clone https://github.com/HamzaHassanain/polyman.git
cd polyman
npm install
npm run build
npm link
```

### Code Structure

**Entry Points:**

- `src/cli.ts` - CLI commands
- `src/actions.ts` - Action functions

**Core Logic:**

- `src/helpers/` - Domain modules
- `src/executor.ts` - Process execution
- `src/formatter.ts` - Output formatting

**Agent (`polyman chat`, `polyman ai`), see [Agent Architecture](#agent-architecture-srcagent):**

- `src/agent/index.ts` - `startChat()` and `createChatRuntime()`
- `src/agent/core/` - Agent loop, event bus, context, system prompt
- `src/agent/tools/` - Tools, registry, permission gate, sandbox
- `src/agent/runner/` - Runs the CLI as a child process
- `src/agent/providers/` - Model providers and keys
- `src/agent/workflow/` - Workflow manager, scheduler, workers, checkpoints
- `src/agent/tui/` - Ink terminal UI (ESM)
- `evals/` - Evals with a real model, not part of `npm test`
- `design/agent/` - Design docs of the agent

**Types:**

- `src/types.d.ts` - TypeScript type definitions

**Assets:**

- `assets/checkers/` - Standard checkers
- `template/` - Problem template

### Adding New Features

**New Command:**

1. Add action function in `src/actions.ts`
2. Register command in `src/cli.ts`
3. Document in README and DOCUMENTATION

**New Helper Module:**

1. Create file in `src/helpers/`
2. Export functions
3. Import in `src/actions.ts`

**New Solution Type:**

1. Add type to `src/types.d.ts`
2. Handle in `getExpectedCheckerVerdict`
3. Update verdict validation in `src/helpers/solution.ts`

### Testing

```bash
# Lint code
npm run lint

# Build
npm run build

# Unit tests (the agent tests need no key and no network)
npm test

# Manual testing
polyman new test-problem
cd test-problem
# Test commands...
```

### ESLint Configuration

See `eslint.config.js` for linting rules.

**Key Rules:**

- TypeScript strict mode
- Prettier integration
- No unused variables (except prefixed with `_`)
- No explicit `any` (warning)

---

## API Reference

TypeDoc generates the full API reference: https://hamzahassanain.github.io/polyman/. Key entry points: `src/cli.ts` (commands), `src/actions.ts` (orchestration), `src/polygon.ts` (Polygon SDK), `src/types.d.ts` (types).

---

## Implementation Notes

Important considerations for development, deployment, and platform-specific behavior.

### Performance Considerations

- **Parallel Execution:** Currently sequential; could parallelize test generation and solution execution
- **Caching:** Compiled executables are not cached between runs
- **Memory Limiting:** Only supported on Linux via `ulimit`

### Platform Differences

**Linux:**

- Full support for memory limiting
- Recommended platform

**macOS:**

- Memory limiting not supported
- Warning shown when memory limit specified

**Windows:**

- Memory limiting not supported
- Requires MinGW or WSL for C++ compilation

### Security

- **Command Injection:** Uses `spawn` with `shell: true`; sanitize user input if accepting external configs
- **File System:** Direct file operations; validate paths to prevent directory traversal

### Future Enhancements

- Parallel test execution
- Compiled executable caching
- Windows native memory limiting
- Progress bars for long operations
- Config validation schema
- Interactive mode

---

## Related Documentation

- **User Guide:** `README.md`
- **Template Guide:** `GUIDE.md`
- **Testlib Documentation:** [testlib on GitHub](https://github.com/MikeMirzayanov/testlib)
- **Polygon System:** [Codeforces Polygon](https://polygon.codeforces.com/)
- **Agent design:** [`design/agent/`](design/agent/README.md)

---

## License

MIT License - See `LICENCE` file for details.

---

**This technical documentation is auto-generated alongside TypeDoc API documentation. For the latest version, visit the [online documentation](https://hamzahassanain.github.io/polyman/).**
