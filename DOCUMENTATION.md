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
16. [File Structure](#file-structure)
17. [Development Guide](#development-guide)
18. [API Reference](#api-reference)
19. [Implementation Notes](#implementation-notes)

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
- **`src/helpers/generator.ts`** — Generator compilation, script parsing, and test file production. Handles the special `samples` and `manual` generator names that bypass compilation.
- **`src/helpers/validator.ts`** — Validator compilation, validation of generated test inputs, and validator self-testing against `validator_tests.json`.
- **`src/helpers/checker.ts`** — Checker compilation (custom or standard from `assets/checkers/`), checker invocation, and checker self-testing. Owns the verdict mapping from checker stdout to `CheckerVerdict`.
- **`src/helpers/solution.ts`** — Solution compilation, execution against a testset, and verdict comparison. Responsible for enforcing the solution-tag contract (e.g. WA solutions must produce WA on at least one test).
- **`src/helpers/create-template.ts`** — Materialises the bundled `template/` tree into a new problem directory when `polyman new` runs.
- **`src/helpers/testlib-download.ts`** — Fetches `testlib.h` from the upstream GitHub repo for the `polyman download-testlib` command.
- **`src/helpers/testset.ts`** — Testset and group resolution: given filters from CLI options, returns the matching testsets, groups, and indices.
- **`src/helpers/script-parser.ts`** — Parses Polygon-style generation scripts and the structured `commands[]` form into a flat list of test-production instructions.
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
// Linux memory limiting
if (process.platform === 'linux' && memoryLimitMB > 0) {
  const memoryLimitKB = memoryLimitMB * 1024;
  command = `ulimit -v ${memoryLimitKB} && ${command}`;
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
g++ -o output source.cpp
```

**Java:**

```bash
javac source.java
java ClassName < input.txt > output.txt
```

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

Each solution is compiled, then run against every test in the active testset under the configured time and memory limits. The runner inspects the first line of the captured output for the sentinel verdicts `Time Limit Exceeded`, `Memory Limit Exceeded`, and `Runtime Error`; otherwise it invokes the checker on the (input, output, answer) triple to obtain `OK`/`WA`/`PE`. Aggregated `VerdictTracker` flags (`didWA`, `didTLE`, `didMLE`, `didRTE`) are then matched against the solution's declared `SolutionTag` so that, e.g., a `WA` solution must fail at least one test and a `MA` solution must pass them all.

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

Generators are testlib C++ programs that take the test number as `argv[1]` and write the test content to stdout. The generator helper compiles the source once, then for each test in the requested range invokes `./generator <testNum> > tests/test<testNum>.txt` and verifies the file was produced. Two reserved generator names bypass compilation: `samples` reuses pre-existing `tests/test*.txt` files (typically the statement examples) and `manual` reuses files placed by the author under `manual/`.

---

## Error Handling

Polyman provides comprehensive error handling with formatted output and proper exit codes.

### Error Flow

1. **Catch Error:** In action or helper function
2. **Log Error:** Via `logError`
3. **Handle Error:**
   - Exit: `logErrorAndExit`
   - Throw: `logErrorAndThrow`

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
polyman remote push . ./my-problem
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

---

## License

MIT License - See `LICENCE` file for details.

---

**This technical documentation is auto-generated alongside TypeDoc API documentation. For the latest version, visit the [online documentation](https://hamzahassanain.github.io/polyman/).**
