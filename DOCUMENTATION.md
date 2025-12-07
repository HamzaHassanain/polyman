**Complete Technical Reference for Polyman CLI Tool**

A TypeScript-based CLI tool for Codeforces problem setters that automates problem preparation workflows including test generation, validation, solution verification, and checker integration.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Components](#core-components)
   - [Entry Point](#entry-point-srclits)
   - [Command Mapping](#command-mapping)
3. [Type System](#type-system)
   - [Solution Tags](#solution-tags)
   - [Source Types](#source-types)
   - [Local Interfaces](#local-interfaces)
   - [Configuration Interface](#configuration-file-interface)
4. [CLI Interface](#cli-interface)
   - [Command Parser](#command-parser-srclits)
5. [Action Layer](#action-layer)
   - [Template Management](#createtemplatedirectory-string)
   - [Testlib Integration](#downloadtestlib)
   - [Checker Listing](#listavailablecheckers)
   - [Test Generation](#generatetestsgeneratorname-string)
   - [Test Validation](#validateteststarget-string-modifier-string)
   - [Solution Execution](#solvetestssolutionname-string-testnumber-string)
   - [Component Testing](#testwhatwhat-string)
   - [Full Verification](#fullverification)
   - [Remote Operations](#remote-operations)
6. [Helper Modules](#helper-modules)
   - [Remote Helper Modules](#remote-helper-modules)
   - [Utility Functions](#utility-functions-srchelpersutilsts)
   - [Generator Module](#generator-module-srchelpersgeratorts)
   - [Validator Module](#validator-module-srchelpersvalidatorts)
   - [Checker Module](#checker-module-srchelperscheckerts)
   - [Solution Module](#solution-module-srchelpersolutionts)
   - [Template Helpers](#template-helpers-srchelpersreate-templatets)
   - [Testlib Download](#testlib-download-srchelperstestlib-downloadts)
7. [Execution Engine](#execution-engine)
8. [Formatter System](#formatter-system)
   - [Output Methods](#methods)
   - [Utility Methods](#utility-methods)
9. [Configuration Schema](#configuration-schema)
   - [Config.json Structure](#configjson-structure)
   - [Required Fields](#required-fields)
   - [Optional Fields](#optional-fields)
10. [Compilation Pipeline](#compilation-pipeline)
    - [Language Support](#language-support)
    - [Compilation Flow](#compilation-flow)
11. [Validation System](#validation-system)
    - [Validator Exit Codes](#validator-exit-codes)
    - [Validation Workflow](#validation-workflow)
    - [Self-Testing](#self-testing)
12. [Solution Testing](#solution-testing)
    - [Execution Flow](#execution-flow)
    - [Verdict Detection](#verdict-detection)
13. [Checker Integration](#checker-integration)
    - [Standard Checkers](#standard-checkers)
    - [Custom Checkers](#custom-checkers)
    - [Checker Execution](#checker-execution)
14. [Generator System](#generator-system)
    - [Generator Interface](#generator-interface)
    - [Generation Flow](#generation-flow)
    - [Special Generators](#special-generators)
15. [Error Handling](#error-handling)
    - [Error Flow](#error-flow)
    - [Error Types](#error-types)
16. [Polygon Integration](#polygon-integration)
    - [Polygon SDK](#polygon-sdk)
    - [API Authentication](#api-authentication)
    - [Remote Operations Flow](#remote-operations-flow)
17. [File Structure](#file-structure)
    - [Template Structure](#template-structure)
    - [Generated Project Structure](#generated-project-structure)
18. [Development Guide](#development-guide)
    - [Building from Source](#building-from-source)
    - [Code Structure](#code-structure)
    - [Adding New Features](#adding-new-features)
    - [Testing](#testing)
    - [ESLint Configuration](#eslint-configuration)
19. [API Reference](#api-reference)
    - [Key Exports](#key-exports)
    - [Polygon SDK API](#polygon-sdk-api)
20. [Implementation Notes](#implementation-notes)
    - [Performance Considerations](#performance-considerations)
    - [Platform Differences](#platform-differences)
    - [Security](#security)
    - [Future Enhancements](#future-enhancements)

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

Polyman's core architecture consists of a CLI layer that delegates to action functions, which coordinate helper modules for specific tasks.

### Entry Point: `src/cli.ts`

The CLI interface uses Commander.js to define all user-facing commands:

### Command Mapping

**Commands:**

- `new <directory>` → `createTemplate`
- `download-testlib` → `downloadTestlib`
- `list checkers` → `listAvailableCheckers`
- `generate [options]` → `generateTests`
- `validate [options]` → `validateTests`
- `run <solution-name> [options]` → `solveTests`
- `test <what>` → `testWhat`
- `verify` → `fullVerification`
- `list testsets` → Lists all testsets from configuration

**Example:**

```typescript
program
  .command('verify')
  .description('Run full verification of the problem')
  .action(fullVerification);
```

---

## Type System

### Core Type Definitions: `src/types.d.ts`

This section documents all TypeScript type definitions used throughout Polyman.

### Solution Tags

```typescript
type SolutionTag =
  | 'MA' // Main correct solution (required, exactly one)
  | 'OK' // Additional correct solution
  | 'WA' // Wrong Answer
  | 'TL' // Time Limit Exceeded
  | 'ML' // Memory Limit Exceeded
  | 'PE' // Presentation Error
  | 'RE'; // Runtime Error
```

### Source Types

Polyman supports multiple programming languages and compiler versions for solutions, while generators, validators, and checkers must use C++ with testlib.h.

```typescript
type CppSourceType =
  | 'cpp.g++11'
  | 'cpp.g++14'
  | 'cpp.g++17'
  | 'cpp.g++20'
  | 'cpp.ms2017'
  | 'cpp.ms2019'
  | 'cpp.clang++17'
  | 'cpp.clang++20';

type JavaSourceType = 'java.8' | 'java.11' | 'java.17' | 'java.21';

type PythonSourceType =
  | 'python.2'
  | 'python.3'
  | 'python.pypy2'
  | 'python.pypy3';

type SolutionSourceType = CppSourceType | JavaSourceType | PythonSourceType;

type TestlibSourceType = CppSourceType;
```

### Local Interfaces

These interfaces define the structure of local configuration objects that reference files in your problem directory.

#### LocalSolution Interface

```typescript
interface LocalSolution {
  name: string; // Solution name/identifier
  source: string; // Path to solution source file
  tag: SolutionTag; // Expected behavior tag
  sourceType?: SolutionSourceType; // Language/compiler (C++, Java, or Python)
}
```

#### LocalGenerator Interface

```typescript
interface LocalGenerator {
  name: string; // Generator name/identifier
  source: string; // Path to generator source file (must be C++)
  sourceType?: TestlibSourceType; // C++ compiler version (generators must use testlib.h)
}
```

#### LocalChecker Interface

```typescript
interface LocalChecker {
  name: string; // Checker name
  source: string; // Path to checker source or standard checker name
  isStandard?: boolean; // True if using standard testlib checker
  testsFilePath?: string; // Path to checker tests JSON file
  sourceType?: TestlibSourceType; // C++ compiler version (checkers must use testlib.h)
}
```

#### LocalValidator Interface

```typescript
interface LocalValidator {
  name: string; // Validator name
  source: string; // Path to validator source file (must be C++)
  sourceType?: TestlibSourceType; // C++ compiler version (validators must use testlib.h)
  testsFilePath?: string; // Path to validator tests JSON file
}
```

#### Testset Interfaces

```typescript
interface GeneratorScriptCommand {
  type: 'manual' | 'generator';
  generator?: string;
  number?: number;
  index?: number;
  manualFile?: string;
  group?: string;
  points?: number;
  range?: [number, number];
}

interface GeneratorScript {
  commands?: GeneratorScriptCommand[];
  script?: string;
  scriptFile?: string;
}

interface LocalTestGroup {
  name: string;
  pointsPolicy?: 'COMPLETE_GROUP' | 'EACH_TEST';
  feedbackPolicy?: 'NONE' | 'POINTS' | 'ICPC' | 'COMPLETE';
  dependencies?: string[];
}

interface LocalTestset {
  name: string;
  generatorScript?: GeneratorScript;
  groupsEnabled?: boolean;
  pointsEnabled?: boolean;
  groups?: LocalTestGroup[];
}
```

### Configuration File Interface

The main configuration file that defines all aspects of a competitive programming problem.

```typescript
interface ConfigFile {
  // Polygon metadata
  problemId?: number;
  name: string;
  owner?: string;
  revision?: number;

  // Problem info
  timeLimit: number; // Milliseconds
  memoryLimit: number; // Megabytes
  inputFile: string; // 'stdin' or filename
  outputFile: string; // 'stdout' or filename
  interactive: boolean;

  // Tags and descriptions
  tags?: string[];
  description?: string;
  tutorial?: string;

  // Statements
  statements: {
    [language: string]: Statement;
  };

  // Solutions
  solutions: LocalSolution[];

  // Generators
  generators?: LocalGenerator[];

  // Checker
  checker: LocalChecker;

  // Validator
  validator: LocalValidator;

  // Testsets
  testsets?: LocalTestset[];
}

interface Statement {
  encoding: string;
  name: string;
  legend: string;
  input: string;
  output: string;
  scoring?: string;
  interaction?: string;
  notes?: string;
  tutorial?: string;
}
```

---

## CLI Interface

### Command Parser: `src/cli.ts`

The CLI layer is minimal and delegates to action functions:

```typescript
// Creates new problem template
program
  .command('new <directory>')
  .description('Create a new problem template')
  .action(createTemplate);

// Downloads testlib.h from GitHub
program
  .command('download-testlib')
  .description('Download testlib.h header file')
  .action(downloadTestlib);

// Lists available standard checkers
program
  .command('list checkers')
  .description('List all available standard checkers')
  .action(listAvailableCheckers);

// Runs generators to create test files
program
  .command('generate')
  .description('Generate tests for testsets')
  .option('-a, --all', 'Generate all testsets')
  .option('-t, --testset <name>', 'Generate specific testset')
  .option('-g, --group <name>', 'Generate specific group within testset')
  .option('-i, --index <number>', 'Generate specific test by index')
  .action(generateTests);

// Validates test inputs
program
  .command('validate')
  .description('Validate tests using validator')
  .option('-a, --all', 'Validate all testsets')
  .option('-t, --testset <name>', 'Validate specific testset')
  .option('-g, --group <name>', 'Validate specific group within testset')
  .option('-i, --index <number>', 'Validate specific test by index')
  .action(validateTests);

// Executes solutions on tests
program
  .command('run <solution-name>')
  .description('Run solution on tests')
  .option('-a, --all', 'Run on all testsets')
  .option('-t, --testset <name>', 'Run on specific testset')
  .option('-g, --group <name>', 'Run on specific group within testset')
  .option('-i, --index <number>', 'Run on specific test by index')
  .action(solveTests);

// Tests validators/checkers/solutions
program
  .command('test <what>')
  .description('Test validator, checker, or solution')
  .action(testWhat);

// Complete verification workflow
program
  .command('verify')
  .description('Run full problem verification')
  .action(fullVerification);
```

---

## Action Layer

All Actions are separated into steps, each step calls relevant helper functions to perform the task, each step is supposed to be completely independent from others to allow better maintainability and testability.

### Action Functions: `src/actions.ts`

High-level workflow orchestration functions that coordinate helper modules.

### Template Management

#### `createTemplate(directory: string)`

Creates new problem directory structure from template.

**Workflow:**

1. Validates directory doesn't exist
2. Copies template files from `template/`
3. Logs success message

**Called by:** `polyman new <dir>`

---

### Testlib Integration

#### `downloadTestlib()`

Downloads testlib.h from official repository.

**Workflow:**

1. Fetches from `https://raw.githubusercontent.com/MikeMirzayanov/testlib/master/testlib.h`
2. Saves to current directory
3. Displays installation instructions per OS

**Called by:** `polyman download-testlib`

**Implementation:**

```typescript
const testlibUrl =
  'https://raw.githubusercontent.com/MikeMirzayanov/testlib/master/testlib.h';
const testlibContent = await downloadFile(testlibUrl);
fs.writeFileSync('testlib.h', testlibContent, 'utf-8');
```

---

### Checker Listing

#### `listAvailableCheckers()`

Lists all standard checkers from `assets/checkers/`.

**Workflow:**

1. Reads checker directory
2. Parses description from C++ comments (`// Description:`)
3. Formats output with `fmt`

**Called by:** `polyman list checkers`

**Output Format:**

```
1. ncmp.cpp       → Compares signed int64 numbers
2. wcmp.cpp       → Compares sequences of tokens
...
```

---

### Test Generation

#### `generateTests(generatorName: string)`

Runs generators to create test input files.

**Workflow:**

1. Reads `Config.json`
2. Validates generators exist via `ensureGeneratorsExist`
3. Runs matching generators via `runMatchingGenerators`

**Called by:** `polyman generate [options]`

**Options:**

- `--all`: Generate all testsets
- `--testset <name>`: Testset name
- `--group <name>`: (Optional) Group name within testset
- `--index <number>`: (Optional) Test number within testset

---

### Test Validation

#### `validateTests(target: string, modifier?: string)`

Validates test input files using validator.

**Workflow:**

1. Validates input parameter (testset name or 'all')
2. Ensures validator exists via `ensureValidatorExists`
3. Validates tests via `validateSingleTest` or `validateAllTests`

**Called by:** `polyman validate [options]`

**Options:**

- `--all`: Validate all testsets
- `--testset <name>`: Testset name
- `--group <name>`: (Optional) Group name within testset
- `--index <number>`: (Optional) Test number within testset

---

### Solution Execution

#### `solveTests(solutionName: string, testNumber: string)`

Executes solutions on test inputs.

**Workflow:**

1. Reads configuration
2. Validates solutions exist via `validateSolutionsExist`
3. Runs solutions via `runSingleSolutionOnTests` or `runMatchingSolutionsOnTests`

**Called by:** `polyman run <name> [options]`

**Options:**

- `--all`: Run on all testsets
- `--testset <name>`: Testset name
- `--group <name>`: (Optional) Group name within testset
- `--index <number>`: (Optional) Test number within testset

---

### Component Testing

#### `testWhat(what: string)`

Tests validators, checkers, or solutions against expected behavior.

**Workflow:**

**For 'validator':**

1. Calls `testValidatorItself`
2. Runs validator against `validator_tests.json`

**For 'checker':**

1. Calls `testCheckerItself`
2. Runs checker against `checker_tests.json`

**For solution name:**

1. Calls `testSolutionAgainstMainCorrect`
2. Compares solution output with main-correct using checker
3. Validates verdict matches expected type

**Called by:** `polyman test <what>`

---

### Full Verification

#### `fullVerification()`

Complete problem verification workflow.

**Workflow:**

1. **Generate Tests:** Runs all generators
2. **Test Validator:** Self-tests via `testValidatorItself`
3. **Validate All Tests:** Ensures all inputs are valid
4. **Test Checker:** Self-tests via `testCheckerItself`
5. **Run All Solutions:** Executes all solutions on all tests
6. **Verify Solutions:** Compares all solutions against main-correct

**Called by:** `polyman verify`

**Success Criteria:**

- All tests generated
- Validator passes self-tests
- All tests are valid
- Checker passes self-tests
- Main solution produces correct outputs
- WA solutions get WA on ≥1 test
- TLE solutions exceed time limit
- All verdicts match expected types

---

### Remote Operations

Polyman provides comprehensive Polygon integration for remote problem management. All remote commands are namespaced under `polyman remote`.

#### `registerApiKeyAndSecretAction(apiKey: string, secret: string)`

Registers Polygon API credentials locally for future use.

**Workflow:**

1. Validates credentials format
2. Stores in home directory (`~/.polyman/credentials.json`)
3. Encrypts sensitive data
4. Logs success message

**Called by:** `polyman remote register <api-key> <secret>`

**Storage Location:**

- Linux/macOS: `~/.polyman/credentials.json`
- Windows: `%USERPROFILE%\.polyman\credentials.json`

---

#### `remoteListProblemsAction(owner?: string)`

Lists all problems from Polygon accessible to the user.

**Workflow:**

1. **Step 1:** Read API credentials via `stepReadCredentials`
2. **Step 2:** Initialize Polygon SDK via `stepInitializeSDK`
3. **Step 3:** List problems via `stepListProblems`
4. **Step 4:** Display problems via `stepDisplayProblems`

**Called by:**

- `polyman remote list`
- `polyman remote list --owner <username>`

**Output Format:**

```
╔════════════════════════════════════════════════════════════════╗
║  YOUR PROBLEMS ON POLYGON                                       ║
╚════════════════════════════════════════════════════════════════╝

ID      | Name                | Owner    | Access | Modified
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
123456  | A Plus B            | tourist  | WRITE  | Yes
789012  | Graph Problem       | you      | OWNER  | No
```

---

#### `remotePullProblemAction(problemId: string, directory: string, options: PullOptions)`

Downloads a problem from Polygon to local directory.

**Workflow:**

1. **Step 1:** Read API credentials
2. **Step 2:** Initialize Polygon SDK
3. **Step 3:** Fetch problem information (time/memory limits, I/O files)
4. **Step 4:** Create local directory structure
5. **Step 5:** Download problem files:
   - Solutions (all languages)
   - Checker (with self-tests)
   - Validator (with self-tests)
   - Generators (all source files)
   - Statements (all languages as .tex files)
   - Tests (manual tests, fetched in parallel)
   - Metadata (description, tags)
6. **Step 6:** Generate `Config.json` with complete configuration
7. **Step 7:** Normalize line endings (Windows → Unix)

**Called by:** `polyman remote pull <problem-id> <directory> [options]`

**Options:**

```typescript
interface PullOptions {
  all?: boolean; // Pull all components (default)
  solutions?: boolean; // Pull solutions only
  checker?: boolean; // Pull checker only
  validator?: boolean; // Pull validator only
  generators?: boolean; // Pull generators only
  statements?: boolean; // Pull statements only
  tests?: string; // Pull tests (optionally specify testsets)
  metadata?: boolean; // Pull description and tags
  info?: boolean; // Pull problem info (limits)
}
```

**Examples:**

```bash
# Pull everything (default)
polyman remote pull 123456 ./my-problem

# Pull only solutions and checker
polyman remote pull 123456 ./my-problem -s -c

# Pull specific testsets
polyman remote pull 123456 ./my-problem -t samples,tests
```

**Line Ending Normalization:**

All text files are automatically converted from Windows (CRLF) to Unix (LF) line endings during pull.

---

#### `remotePushProblemAction(directory: string, options: PushOptions)`

Uploads local problem changes to Polygon.

**Workflow:**

1. **Step 1:** Read API credentials
2. **Step 2:** Initialize Polygon SDK
3. **Step 3:** Read `Config.json` to get problem ID
4. **Step 4:** Update problem information (time/memory limits, I/O files)
5. **Step 5:** Upload solutions with tags
6. **Step 6:** Upload and set checker
7. **Step 7:** Upload and set validator (with self-tests)
8. **Step 8:** Upload generators
9. **Step 9:** Upload statements (all languages)
10. **Step 10:** Upload metadata (description, tags)
11. **Step 11:** Upload testsets:
    - Enable groups if configured
    - Upload manual tests in parallel
    - Upload generation script
12. **Step 12:** Normalize line endings (Unix → Windows for Polygon)

**Called by:** `polyman remote push <directory> [options]`

**Options:**

```typescript
interface PushOptions {
  all?: boolean; // Push all components (default)
  solutions?: boolean; // Push solutions
  checker?: boolean; // Push checker
  validator?: boolean; // Push validator
  generators?: boolean; // Push generators
  statements?: boolean; // Push statements
  tests?: boolean; // Push testsets and tests
  metadata?: boolean; // Push description and tags
  info?: boolean; // Update problem info (limits)
}
```

**Examples:**

```bash
# Push everything (default)
polyman remote push . ./my-problem

# Push only solutions and checker
polyman remote push . ./my-problem -s -c

# Push only tests
polyman remote push . ./my-problem -t
```

**Important Notes:**

- Line endings are automatically normalized (Unix → Windows)
- Manual tests are uploaded in parallel for performance
- Changes are NOT automatically committed (use `polyman remote commit`)
- If you replace the problem ID with a directory path that Contains `Config.json` that has a valid problem ID, it will be used.

---

#### `remoteViewProblemAction(problemIdOrPath: string)`

Displays comprehensive information about a problem on Polygon.

**Workflow:**

1. **Step 1:** Read API credentials
2. **Step 2:** Initialize Polygon SDK
3. **Step 3:** Get problem ID (from argument or Config.json)
4. **Step 4:** Fetch problem information
5. **Step 5:** Fetch statements
6. **Step 6:** Fetch solutions
7. **Step 7:** Fetch files (checker, validator, generators)
8. **Step 8:** Fetch packages
9. **Step 9:** Display comprehensive overview

**Called by:**

- `polyman remote view <problem-id>`
- `polyman remote view ./my-problem`

**Output Format:**

```
╔════════════════════════════════════════════════════════════════╗
║  PROBLEM DETAILS                                                ║
╚════════════════════════════════════════════════════════════════╝

Basic Information:
  ID: 123456
  Name: A Plus B
  Owner: tourist
  Access: WRITE
  Modified: Yes
  Revision: 42

Limits:
  Time Limit: 1000 ms
  Memory Limit: 256 MB
  Input: stdin
  Output: stdout
  Interactive: No

Components:
  Solutions: 5 files
  Checker: custom_checker.cpp
  Validator: validator.cpp
  Generators: 3 files
  Statements: 2 languages (english, russian)

Packages:
  Latest Package: Revision 40 (Available)
  Total Packages: 12
```

---

#### `remoteCommitProblemAction(problemIdOrPath: string, commitMessage: string)`

Commits pending changes to Polygon problem.

**Workflow:**

1. **Step 1:** Read API credentials
2. **Step 2:** Initialize Polygon SDK
3. **Step 3:** Get problem ID (from argument or Config.json)
4. **Step 4:** Commit changes with message via SDK

**Called by:**

- `polyman remote commit <problem-id> <message>`
- `polyman remote commit ./my-problem <message>`

**Examples:**

```bash
# Commit with problem ID
polyman remote commit 123456 "Updated test cases"

# Commit using directory path
polyman remote commit ./my-problem "Fixed validator"
```

**API Call:**

```typescript
await sdk.commitChanges(problemId, {
  message: commitMessage,
});
```

---

#### `remotePackageProblemAction(problemIdOrPath: string, packageType: string)`

Builds a problem package on Polygon and waits for completion.

**Workflow:**

1. **Step 1:** Read API credentials
2. **Step 2:** Initialize Polygon SDK
3. **Step 3:** Get problem ID
4. **Step 4:** Validate package type (standard, linux, windows, full)
5. **Step 5:** Build package and poll for completion:
   - Get initial package count
   - Trigger build via SDK
   - Poll every 60 seconds
   - Detect new package creation
   - Wait for READY or FAILED state
   - Maximum wait: 30 minutes
6. **Step 6:** Display package information

**Called by:**

- `polyman remote package <problem-id> <type>`
- `polyman remote package ./my-problem <type>`

**Package Types:**

- `standard` - Windows executables, no generated tests
- `linux` - Generated tests, no binaries
- `windows` - Generated tests, Windows binaries
- `full` - All three types above

**Examples:**

```bash
# Build standard package
polyman remote package 123456 standard

# Build full package
polyman remote package ./my-problem full
```

**Polling Logic:**

```typescript
while (attempts < maxAttempts) {
  await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 minute
  const currentPackages = await sdk.listPackages(problemId);

  if (currentPackages.length > initialCount) {
    const latestPackage = /* get latest package */;
    if (latestPackage.state === 'READY' || latestPackage.state === 'FAILED') {
      break;
    }
  }
}
```

---

## Helper Modules

Helper modules contain domain-specific logic for generators, validators, checkers, solutions, and utilities.

### Remote Helper Modules

Polyman includes specialized helper modules for Polygon integration located in `src/helpers/remote/`.

#### Pulling Module: `src/helpers/remote/pulling.ts`

Handles downloading problem components from Polygon.

**Key Functions:**

**`downloadSolutions(sdk: PolygonSDK, problemId: number, problemDir: string)`**

Downloads all solutions from Polygon.

**Workflow:**

1. Fetches solution list via SDK
2. Downloads each solution source code
3. Normalizes line endings (Windows → Unix)
4. Saves to `solutions/` directory
5. Returns solution metadata for Config.json

**Returns:**

```typescript
{
  data: Array<{
    name: string;
    source: string;
    tag: SolutionTag;
  }>;
  count: number;
}
```

---

**`downloadChecker(sdk: PolygonSDK, problemId: number, problemDir: string)`**

Downloads checker from Polygon.

**Workflow:**

1. Fetches checker name via SDK
2. Checks if standard checker (contains `std::`)
3. If custom:
   - Downloads checker source
   - Normalizes line endings
   - Downloads checker tests
   - Normalizes test data
4. Returns checker metadata

**Returns:**

```typescript
{
  data: {
    name: string;
    source: string;
    isStandard: boolean;
    testsFilePath?: string;
  };
  count: number;
}
```

---

**`downloadValidator(sdk: PolygonSDK, problemId: number, problemDir: string)`**

Downloads validator from Polygon.

**Workflow:**

1. Fetches validator source
2. Normalizes line endings
3. Downloads validator tests
4. Normalizes test inputs
5. Returns validator metadata

---

**`downloadGenerators(sdk: PolygonSDK, problemId: number, problemDir: string, validatorName: string)`**

Downloads all generator source files.

**Workflow:**

1. Fetches all source files
2. Filters out checker, validator, and solutions
3. Downloads each generator
4. Normalizes line endings
5. Returns generator metadata

---

**`downloadStatements(sdk: PolygonSDK, problemId: number, problemDir: string)`**

Downloads problem statements in all languages.

**Workflow:**

1. Fetches statements for all languages
2. For each language:
   - Creates language directory
   - Saves legend, input, output, notes, tutorial as .tex files
   - Normalizes line endings
3. Returns statement configuration

---

**`fetchProblemMetadata(sdk: PolygonSDK, problemId: number)`**

Fetches problem description and tags.

**Returns:**

```typescript
{
  description: string;
  tags: string[];
}
```

---

**`downloadTestsetAndBuildGenerationScripts(sdk: PolygonSDK, problemId: number, problemDir: string, testsetName: string, generators: LocalGenerator[])`**

Downloads tests and builds testset configuration.

**Workflow:**

1. Fetches test metadata (without inputs for speed)
2. Identifies manual tests
3. **Fetches manual test inputs in parallel** for performance
4. Normalizes line endings
5. Saves to `manual/<testset>/` directory
6. Fetches generation script
7. Parses script to extract generator commands
8. Builds testset configuration with groups

**Performance Optimization:**

Manual test inputs are fetched in parallel using `Promise.all()`:

```typescript
const manualTestPromises = manualTests.map(async test => {
  const input = await sdk.getTestInput(problemId, testsetName, test.index);
  return { test, input };
});

const results = await Promise.all(manualTestPromises);
```

**Returns:**

```typescript
{
  testset: LocalTestset;
  manualCount: number;
}
```

---

#### Pushing Module: `src/helpers/remote/pushing.ts`

Handles uploading problem components to Polygon.

**Key Functions:**

**`uploadSolutions(sdk: PolygonSDK, problemId: number, problemDir: string, config: ConfigFile)`**

Uploads all solutions to Polygon.

**Workflow:**

1. For each solution:
   - Reads source file
   - Normalizes line endings (Unix → Windows)
   - Uploads via SDK with tag
2. Returns count of uploaded solutions

---

**`uploadChecker(sdk: PolygonSDK, problemId: number, problemDir: string, config: ConfigFile)`**

Uploads checker to Polygon.

**Workflow:**

1. If custom checker:
   - Reads source file
   - Normalizes line endings
   - Uploads source
   - Uploads checker tests (normalized)
2. Sets checker via SDK
3. Returns count of uploaded files

---

**`uploadValidator(sdk: PolygonSDK, problemId: number, problemDir: string, config: ConfigFile)`**

Uploads validator to Polygon.

**Workflow:**

1. Reads validator source
2. Normalizes line endings
3. Uploads source
4. Uploads validator tests (normalized)
5. Sets validator via SDK
6. Returns count of uploaded files

---

**`uploadGenerators(sdk: PolygonSDK, problemId: number, problemDir: string, config: ConfigFile)`**

Uploads all generators to Polygon.

**Workflow:**

1. For each generator:
   - Reads source file
   - Normalizes line endings
   - Uploads via SDK
2. Returns count of uploaded files

---

**`uploadStatements(sdk: PolygonSDK, problemId: number, problemDir: string, config: ConfigFile)`**

Uploads problem statements to Polygon.

**Workflow:**

1. For each language:
   - Reads all statement files (.tex)
   - Normalizes line endings
   - Builds statement object
   - Uploads via SDK
2. Returns count of uploaded statements

---

**`uploadMetadata(sdk: PolygonSDK, problemId: number, config: ConfigFile)`**

Uploads problem description and tags.

---

**`uploadTestsets(sdk: PolygonSDK, problemId: number, problemDir: string, config: ConfigFile)`**

Uploads testsets and tests to Polygon.

**Workflow:**

1. For each testset:
   - Clears existing tests
   - Enables groups if configured
   - **Uploads manual tests in parallel** for performance
   - Builds and uploads generation script
2. Returns test counts

**Performance Optimization:**

Manual tests are uploaded in parallel:

```typescript
const manualTestsPromises = createManualTestsPromises(
  sdk,
  problemId,
  problemDir,
  testset,
  indices
);

await Promise.all(manualTestsPromises);
```

**Test Upload:**

Each manual test:

- Reads file content
- Normalizes line endings (Unix → Windows)
- Uploads via `sdk.saveTest()` with options (group, points, useInStatements)

---

**`updateProblemInfo(sdk: PolygonSDK, problemId: number, config: ConfigFile)`**

Updates problem information (limits, I/O files).

**API Call:**

```typescript
await sdk.updateProblemInfo(problemId, {
  inputFile: config.inputFile,
  outputFile: config.outputFile,
  interactive: config.interactive,
  timeLimit: config.timeLimit,
  memoryLimit: config.memoryLimit,
});
```

---

#### Utils Module: `src/helpers/remote/utils.ts`

Utility functions for remote operations.

**Key Functions:**

**`normalizeLineEndingsFromWinToUnix(content: string): string`**

Converts Windows line endings (CRLF) to Unix (LF).

```typescript
return content.replace(/\r\n/g, '\n');
```

**Used during:** Pull operations

---

**`normalizeLineEndingsFromUnixToWin(content: string): string`**

Converts Unix line endings (LF) to Windows (CRLF).

```typescript
return content.replace(/\n/g, '\r\n');
```

**Used during:** Push operations

---

**`readCredentialsFromHomeDirectory(): { apiKey: string; secret: string }`**

Reads stored API credentials.

**Location:**

- Linux/macOS: `~/.polyman/credentials.json`
- Windows: `%USERPROFILE%\.polyman\credentials.json`

---

**`saveCredentialsToHomeDirectory(apiKey: string, secret: string)`**

Stores API credentials securely.

---

**`getProblemIdFromPath(path: string): number`**

Extracts problem ID from Config.json in directory.

**Usage:**

```typescript
// User provides directory path instead of problem ID
const problemId = getProblemIdFromPath('./my-problem');
```

---

### Utility Functions: `src/helpers/utils.ts`

Core utility functions for compilation, configuration, and file operations.

### Compilation Functions

**`compileCPP(sourcePath: string): Promise<string>`**

Compiles C++ source using g++.

```typescript
// Compilation command:
g++ -o <output> <source>
```

**Parameters:**

- `sourcePath`: Path to `.cpp` file

**Returns:** Path to compiled executable

**Throws:** Error if not `.cpp` or compilation fails

---

**`compileJava(sourcePath: string): Promise<string>`**

Compiles Java source using javac.

**Returns:** Class name (e.g., 'Solution')

---

### Configuration Functions

**`readConfigFile(): ConfigFile`**

Reads and parses `Config.json`.

**Returns:** Parsed configuration object

**Throws:** Error if file doesn't exist or has invalid JSON

---

**`isNumeric(value: string): boolean`**

Checks if string represents a number.

---

### File Operations

**`ensureDirectoryExists(dirName: string)`**

Creates directory if it doesn't exist (recursive).

```typescript
ensureDirectoryExists('tests');
ensureDirectoryExists('nested/path/to/dir');
```

---

**`removeDirectory(dirName: string)`**

Removes directory and all contents.

---

**`readFirstLine(filePath: string): string`**

Reads first line from file (used for verdict detection).

---

### Error Handling

**`logError(error: unknown)`**

Logs error with formatted output.

---

**`logErrorAndExit(error: unknown)`**

Logs error and exits with code 1.

---

**`logErrorAndThrow(error: unknown, message?: string)`**

Logs error and re-throws.

---

**`throwError(error: unknown, message?: string): never`**

Throws error, ensuring it's an Error instance.

---

### Generator Module: `src/helpers/generator.ts`

Handles test case generation.

#### `ensureGeneratorsExist(generators: LocalGenerator[] | undefined)`

Type assertion that throws if no generators defined.

---

#### `runMatchingGenerators(generators: LocalGenerator[], generatorName: string)`

Runs generators matching name or 'all'.

**Workflow:**

1. Filters generators by name
2. For each generator:
   - Compiles generator via `compileCPP`
   - Generates test files via `generateTestFiles`

**Special Cases:**

- `name: 'samples'` → Uses existing manual test files
- `name: 'manual'` → Uses existing manual test files
- Others → Compiles and runs generator

---

**Private Functions:**

**`compileGenerator(generator: LocalGenerator): Promise<string>`**

Compiles generator C++ source.

**Returns:** Path to compiled executable

---

**`generateTestFiles(compiledPath: string, generator: LocalGenerator, testsDir: string)`**

Generates test files by running generator for each test number in range.

**Command:**

```bash
./generator <testNum> > tests/test<testNum>.txt
```

---

**`ensureTestsDirectory(): string`**

Creates `tests/` directory if needed.

---

### Validator Module: `src/helpers/validator.ts`

Input validation system.

#### `ensureValidatorExists(validator: LocalValidator | undefined)`

Type assertion for validator existence.

---

#### `validateSingleTest(testNumber: number)`

Validates a single test file.

**Workflow:**

1. Compiles validator via `compileValidator`
2. Runs validator with test input
3. Checks exit code (0 = VALID, 3 = INVALID)

**Command:**

```bash
./validator < tests/test<N>.txt
```

---

#### `validateAllTests()`

Validates all test files in `tests/` directory.

**Workflow:**

1. Reads all test files
2. Validates each via `validateSingleTest`
3. Reports results

---

#### `testValidatorItself()`

Validator self-testing using `validator_tests.json`.

**Workflow:**

1. Parses validator tests via `parseValidatorTests`
2. Creates test files via `makeValidatorTests`
3. Validates each test
4. Compares actual verdict with expected

**Test File Format:**

```json
{
  "tests": [
    {
      "stdin": "5\n",
      "expectedVerdict": "VALID"
    },
    {
      "stdin": "101\n",
      "expectedVerdict": "INVALID"
    }
  ]
}
```

---

**Private Functions:**

**`compileValidator(): Promise<void>`**

Compiles validator C++ source.

---

**`parseValidatorTests(): Promise<ValidatorTest[]>`**

Reads and parses `validator/validator_tests.json`.

---

**`makeValidatorTests()`**

Creates test files in `validator_tests/` directory.

---

**`runValidator(compiledPath: string, testFilePath: string): Promise<ValidatorVerdict>`**

Executes validator and returns verdict based on exit code.

---

**`getValidatorVerdict(exitCode: number): ValidatorVerdict`**

Maps exit code to verdict (0 → VALID, 3 → INVALID).

---

### Checker Module: `src/helpers/checker.ts`

Output verification system.

#### `ensureCheckerExists(checker: LocalChecker | undefined)`

Type assertion for checker existence.

---

#### `compileChecker(checker: LocalChecker): Promise<void>`

Compiles checker.

**For custom checkers:**

```bash
g++ -o checker checker/chk.cpp
```

**For standard checkers:**
Copies from `assets/checkers/` and compiles.

---

#### `runChecker(compiledPath: string, inputFile: string, outputFile: string, answerFile: string): Promise<CheckerVerdict>`

Runs checker to compare output with answer.

**Command:**

```bash
./checker <input> <output> <answer>
```

**Returns:** Verdict from checker output (OK/WA/PE)

---

#### `testCheckerItself()`

Checker self-testing using `checker_tests.json`.

**Workflow:**

1. Parses checker tests via `parseCheckerTests`
2. Creates test files (input, output, answer)
3. Runs checker on each test
4. Compares actual verdict with expected

**Test File Format:**

```json
{
  "tests": [
    {
      "stdin": "3",
      "stdout": "YES",
      "answer": "YES",
      "verdict": "OK"
    },
    {
      "stdin": "3",
      "stdout": "NO",
      "answer": "YES",
      "verdict": "WA"
    }
  ]
}
```

---

#### `getExpectedCheckerVerdict(solutionTag: SolutionTag): CheckerVerdict`

Maps solution tag to expected checker verdict.

**Mapping:**

- `'MA'`, `'OK'`, `'TL'`, `'ML'` → `'OK'` or `'WRONG_ANSWER'` (depends on checker)
- `'WA'` → `'WRONG_ANSWER'`
- `'PE'` → `'PRESENTATION_ERROR'`
- `'RE'` → Depends on runtime behavior

---

**Private Functions:**

**`parseCheckerTests(): Promise<CheckerTest[]>`**

Reads `checker/checker_tests.json`.

---

**`makeCheckerTests()`**

Creates test files in `checker_tests/` directory.

---

**`getCheckerVerdict(output: string): CheckerVerdict`**

Parses checker output for verdict.

---

### Solution Module: `src/helpers/solution.ts`

Solution execution and verification.

#### `validateSolutionsExist(solutions: LocalSolution[] | undefined)`

Type assertion for solutions existence.

---

#### `ensureMainSolutionExists(solutions: LocalSolution[] | undefined)`

Type assertion ensuring main-correct solution exists.

**Throws:** If no `main-correct` solution found.

---

#### `ensureSolutionExists(solutions: LocalSolution[] | undefined, solutionName: string)`

Type assertion for specific solution existence.

---

#### `getMainSolution(solutions: LocalSolution[]): LocalSolution`

Returns the main-correct solution.

---

#### `runSingleSolutionOnTests(config: ConfigFile, solutionName: string, testNumber: string)`

Runs a solution on test(s).

**Workflow:**

1. Finds solution by name
2. Compiles solution via `compileSolution`
3. Runs on test(s) via `runSolutionOnTests`

---

#### `runMatchingSolutionsOnTests(config: ConfigFile, solutionName: string, testNumber: string)`

Runs solution(s) matching name on test(s).

**Parameters:**

- `solutionName`: Solution name or 'all'
- `testNumber`: Test number or 'all'

---

#### `testSolutionAgainstMainCorrect(solutionName: string)`

Tests solution against main-correct using checker.

**Workflow:**

1. Runs main-correct solution on all tests
2. Runs target solution on all tests
3. Compares outputs using checker
4. Validates verdict matches expected type

**Verification:**

- WA solutions must get WA on ≥1 test
- TLE solutions must TLE on ≥1 test
- Correct solutions must get OK on all tests

---

#### `startTheComparisonProcess(solutions: LocalSolution[], checker: LocalChecker)`

Compares all solutions against main-correct.

**Workflow:**

1. Compiles checker
2. For each non-main solution:
   - Compares outputs with checker
   - Tracks verdicts
   - Validates against expected type

---

**Private Functions:**

**`compileSolution(sourcePath: string): Promise<void>`**

Compiles solution based on language.

**Supported Languages:**

- C++ → `compileCPP`
- Java → `compileJava`
- Python → Returns interpreter command

---

**`runSolutionOnTests(solution: LocalSolution, compiledPath: string, testFiles: string[])`**

Executes solution on test files.

**For each test:**

1. Creates output directory
2. Runs solution with test input
3. Saves output to file
4. Handles TLE/MLE/RTE verdicts

---

**`runSolutionOnTest(compiledPath: string, testFilePath: string, outputPath: string, timeLimit: number, memoryLimit: number, solutionTag: SolutionTag): Promise<void>`**

Runs solution on single test.

**Verdict Detection:**

- First line starts with "Time Limit Exceeded" → TLE
- First line starts with "Memory Limit Exceeded" → MLE
- First line starts with "Runtime Error" → RTE
- Otherwise → OK (checker will verify correctness)

---

**`ensureOutputDirectory(solutionName: string): string`**

Creates `solutions-outputs/<solution-name>/` directory.

---

**`compareSolutionWithMainCorrect(solution: LocalSolution, mainSolution: LocalSolution, checker: LocalChecker, compiledChecker: string, testFiles: string[]): Promise<VerdictTracker>`**

Compares solution outputs with main-correct.

**Returns:** Verdict tracker with counts per verdict type.

---

**`validateSolutionVerdicts(solution: LocalSolution, verdictTracker: VerdictTracker)`**

Validates verdicts match expected solution type.

**Rules:**

- WA solutions must have ≥1 WA verdict
- Correct solutions must have all OK verdicts
- TLE solutions must have ≥1 TLE verdict

---

**`isTLE(firstLine: string): boolean`**

Checks if first line indicates TLE.

---

**`isMLE(firstLine: string): boolean`**

Checks if first line indicates MLE.

---

**`isRTE(firstLine: string): boolean`**

Checks if first line indicates RTE.

---

**`isTLEValue(solutionTag: SolutionTag): boolean`**

Checks if solution tag allows TLE verdict.

---

**`isMLEValue(solutionTag: SolutionTag): boolean`**

Checks if solution tag allows MLE verdict.

---

### Template Helpers: `src/helpers/create-template.ts`

Template creation utilities.

#### `copyTemplate(sourceDir: string, targetDir: string)`

Recursively copies template directory.

---

#### `logTemplateCreationSuccess(problemName: string)`

Logs success message with next steps.

---

### Testlib Download: `src/helpers/testlib-download.ts`

#### `downloadFile(url: string): Promise<string>`

Downloads file from URL.

**Uses:** Node.js `https` module

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

#### Methods

**`section(title: string)`**

Prints section header with box.

```
╭─────────────────────────────────╮
│  📁 SECTION TITLE               │
╰─────────────────────────────────╯
```

---

**`step(stepNumber: number, title: string)`**

Prints numbered step header.

```
╭─ STEP 1: Creating Directory
```

---

**`stepComplete(message: string)`**

Prints step completion.

```
╰─ ✓ Done
```

---

**`success(message: string)`**

Prints success message (green).

---

**`error(message: string)`**

Prints error message (red).

---

**`warning(message: string)`**

Prints warning message (yellow).

---

**`info(message: string)`**

Prints info message (blue).

---

**`log(message: string)`**

Prints plain message.

---

**`successBox(title: string)`**

Prints success box with checkmark.

---

**`errorBox(title: string)`**

Prints error box with X mark.

---

### Utility Methods

**Utility Methods:**

- `primary(text: string)`: Blue color
- `highlight(text: string)`: Cyan color
- `dim(text: string)`: Dimmed text
- `successIcon()`: ✓ icon
- `errorIcon()`: ✗ icon
- `warningIcon()`: ⚠ icon
- `infoIcon()`: ℹ icon

---

## Configuration Schema

The `Config.json` file is the heart of every Polyman problem, defining all metadata, constraints, and components.

### Config.json Structure

**Location:** `Config.json` in problem root

**Full Schema:**

```json
{
  "name": "problem-name",
  "description": "Problem description",
  "timeLimit": 2000,
  "memoryLimit": 256,
  "inputFile": "stdin",
  "outputFile": "stdout",
  "interactive": false,
  "tags": ["tag1", "tag2"],

  "statements": {
    "english": {
      "encoding": "UTF-8",
      "name": "Problem Title",
      "legend": "./statements/english/legend.tex",
      "input": "./statements/english/input-format.tex",
      "output": "./statements/english/output-format.tex",
      "notes": "./statements/english/notes.tex"
    }
  },

  "solutions": [
    {
      "name": "main",
      "source": "./solutions/Solution.cpp",
      "tag": "MA",
      "sourceType": "cpp.g++17"
    }
  ],

  "generators": [
    {
      "name": "gen-all",
      "source": "./generators/Generator.cpp"
    }
  ],

  "checker": {
    "name": "ncmp.cpp",
    "isStandard": true
  },

  "validator": {
    "name": "validator",
    "source": "./validator/Validator.cpp",
    "testsFilePath": "./validator/validator_tests.json"
  },

  "testsets": [
    {
      "name": "tests",
      "generatorScript": {
        "commands": [
          {
            "type": "generator",
            "generator": "gen-all",
            "range": [1, 20],
            "group": "main"
          }
        ]
      },
      "groupsEnabled": true,
      "groups": [
        {
          "name": "main"
        }
      ]
    }
  ]
}
```

### Required Fields

**Required Fields:**

- `name`
- `timeLimit`
- `memoryLimit`
- `inputFile`
- `outputFile`
- `solutions` (must include exactly one with tag `MA`)
- `checker`
- `validator`
- `testsets`

### Optional Fields

**Optional Fields:**

- `description`
- `tags`
- `interactive`
- `statements`

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

### Validator Exit Codes

- `0` → VALID
- `3` → INVALID
- Other → Error

### Validation Workflow

1. Compile validator C++ source
2. For each test file:
   - Run validator with test as stdin
   - Check exit code
   - Log result

### Self-Testing

Validator tests from `validator/validator_tests.json`:

**Test Structure:**

```json
{
  "tests": [
    {
      "stdin": "test input content",
      "expectedVerdict": "VALID" | "INVALID"
    }
  ]
}
```

**Verification:**

1. Create test files in `validator_tests/`
2. Run validator on each
3. Compare actual verdict with expected
4. Report mismatches

---

## Solution Testing

### Execution Flow

1. **Compilation:**
   - Compile solution via `compileSolution`

2. **Execution:**
   - For each test:
     - Run solution with test input
     - Capture output
     - Detect TLE/MLE/RTE
     - Save output to file

3. **Comparison:**
   - Run checker on (input, output, answer)
   - Get verdict (OK/WA/PE)

4. **Verification:**
   - Check verdicts match expected type
   - Ensure WA solutions fail on ≥1 test
   - Ensure TLE solutions timeout on ≥1 test

### Verdict Detection

**From Output File First Line:**

- `"Time Limit Exceeded"` → TLE
- `"Memory Limit Exceeded"` → MLE
- `"Runtime Error"` → RTE
- Otherwise → Run checker

**Verdict Tracking:**

```typescript
type VerdictTracker = {
  didWA: boolean;
  didTLE: boolean;
  didMLE: boolean;
  didRTE: boolean;
};
```

---

## Checker Integration

### Standard Checkers

Located in `assets/checkers/`.

**Available:**

- `ncmp.cpp` - Sequence of signed 64-bit integers
- `icmp.cpp` - Single signed 32-bit integer
- `wcmp.cpp` - Sequence of tokens (words)
- `fcmp.cpp` - Line-by-line exact comparison
- `lcmp.cpp` - Line-by-line comparison ignoring extra whitespace
- `dcmp.cpp` - Double with absolute/relative error 1E-6
- `rcmp.cpp` - Double with absolute error 1.5E-6
- `rcmp4.cpp` - Double with 4 decimal places precision
- `rcmp6.cpp` - Double with 6 decimal places precision
- `rcmp9.cpp` - Double with 9 decimal places precision
- `rncmp.cpp` - Sequence of doubles with absolute error 1.5E-5
- `acmp.cpp` - Double with maximal absolute error
- `yesno.cpp` - Single YES/NO answer (case insensitive)
- `nyesno.cpp` - Multiple YES/NO answers (case insensitive)
- `hcmp.cpp` - Arbitrary-precision (huge) integers
- `uncmp.cpp` - Unordered sequence of signed 64-bit integers
- `caseicmp.cpp` - Case-sensitive single integer comparison
- `casencmp.cpp` - Case-sensitive sequence of integers
- `casewcmp.cpp` - Case-sensitive sequence of tokens

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

### Generator Interface

**Input:** Test number as command-line argument

**Output:** Test content to stdout

**Example:**

```cpp
int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);
    int testNum = atoi(argv[1]);

    int n = rnd.next(1, testNum * 100);
    cout << n << endl;

    return 0;
}
```

### Generation Flow

1. Compile generator C++ source
2. For each test in range:
   ```bash
   ./generator <testNum> > tests/test<testNum>.txt
   ```
3. Verify test file created

### Special Generators

**Samples (`name: 'samples'`):**

- No source compilation
- Uses existing `tests/test1.txt`, `tests/test2.txt`, etc.

**Manual (`name: 'manual'`):**

- No source compilation
- Uses existing manually created test files

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

#### Key SDK Methods

**Problem Management:**

- `listProblems(options?)` - List all accessible problems
- `getProblemInfo(problemId)` - Get problem details
- `updateProblemInfo(problemId, info)` - Update limits and settings
- `updateWorkingCopy(problemId)` - Update working copy from repository
- `discardWorkingCopy(problemId)` - Discard uncommitted changes
- `commitChanges(problemId, options)` - Commit changes with message

**Statements:**

- `getStatements(problemId)` - Get statements in all languages
- `saveStatement(problemId, lang, statement)` - Upload/update statement
- `getStatementResources(problemId)` - List statement resources
- `saveStatementResource(problemId, name, file)` - Upload resource file

**Solutions:**

- `getSolutions(problemId)` - List all solutions
- `viewSolution(problemId, name)` - Get solution source code
- `saveSolution(problemId, name, file, tag)` - Upload solution with tag
- `editSolutionExtraTags(problemId, name, tags)` - Update solution tags

**Checker & Validator:**

- `getChecker(problemId)` - Get current checker name
- `setChecker(problemId, checker)` - Set problem checker
- `getValidator(problemId)` - Get current validator name
- `setValidator(problemId, validator)` - Set problem validator
- `getCheckerTests(problemId)` - Get checker self-tests
- `saveCheckerTest(problemId, test)` - Add/edit checker test
- `getValidatorTests(problemId)` - Get validator self-tests
- `saveValidatorTest(problemId, test)` - Add/edit validator test

**Generators:**

- `getFiles(problemId)` - List all problem files
- `viewFile(problemId, type, name)` - Get file content
- `saveFile(problemId, type, name, file)` - Upload file
- `getScript(problemId, testset)` - Get generation script
- `saveScript(problemId, testset, script)` - Update generation script

**Tests:**

- `getTests(problemId, testset, noInputs?)` - List tests
- `getTestInput(problemId, testset, index)` - Get test input
- `getTestAnswer(problemId, testset, index)` - Get test answer
- `saveTest(problemId, testset, index, input, options)` - Add/edit test
- `setTestGroup(problemId, testset, group, indices)` - Assign tests to group
- `enableGroups(problemId, testset, enable)` - Enable/disable test groups
- `enablePoints(problemId, testset, enable)` - Enable/disable points
- `viewTestGroup(problemId, testset, group)` - Get group info
- `saveTestGroup(problemId, testset, group, options)` - Create/edit group

**Metadata:**

- `viewTags(problemId)` - Get problem tags
- `saveTags(problemId, tags)` - Update tags
- `viewGeneralDescription(problemId)` - Get description
- `saveGeneralDescription(problemId, description)` - Update description
- `viewGeneralTutorial(problemId)` - Get tutorial
- `saveGeneralTutorial(problemId, tutorial)` - Update tutorial

**Packages:**

- `listPackages(problemId)` - List all built packages
- `downloadPackage(problemId, packageId, type)` - Download package zip
- `buildPackage(problemId, full, verify)` - Build new package

**Contests:**

- `getContestProblems(contestId)` - List problems in contest

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

### Template Structure

```
template/
├── Config.json                    # Configuration template
├── GUIDE.md                       # User guide
├── solutions/
│   └── acc.cpp                    # Main solution template
├── generators/
│   └── gen.cpp                    # Generator template
├── validator/
│   ├── val.cpp                    # Validator template
│   └── validator_tests.json      # Validator tests template
├── checker/
│   ├── chk.cpp                    # Custom checker template
│   └── checker_tests.json        # Checker tests template
└── statements/
    └── english/
        ├── legend.tex
        └── ...
```

### Generated Project Structure

```
my-problem/
├── Config.json
├── testlib.h                      # Downloaded via polyman download-testlib
├── solutions/
│   ├── Solution.cpp
│   └── WA.cpp
├── generators/
│   └── Generator.cpp
├── validator/
│   ├── Validator.cpp
│   └── validator_tests.json
├── checker/
│   ├── chk.cpp
│   └── checker_tests.json
├── tests/                         # Generated by 'polyman generate'
│   ├── test1.txt
│   └── ...
└── solutions-outputs/             # Generated by 'polyman run'
    ├── main/
    │   ├── output_test1.txt
    │   └── ...
    └── wa-solution/
        └── ...
```

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

For detailed API documentation of all functions, classes, and types, see the auto-generated TypeDoc documentation.

### Key Exports

**From `src/actions.ts`:**

- `createTemplate`
- `downloadTestlib`
- `listAvailableCheckers`
- `generateTests`
- `validateTests`
- `solveTests`
- `testWhat`
- `fullVerification`

**From `src/helpers/utils.ts`:**

- `compileCPP`
- `compileJava`
- `readConfigFile`
- `ensureDirectoryExists`
- `removeDirectory`
- `logError`
- `logErrorAndExit`

**From `src/helpers/generator.ts`:**

- `ensureGeneratorsExist`
- `runMatchingGenerators`

**From `src/helpers/validator.ts`:**

- `ensureValidatorExists`
- `validateSingleTest`
- `validateAllTests`
- `testValidatorItself`

**From `src/helpers/checker.ts`:**

- `ensureCheckerExists`
- `compileChecker`
- `runChecker`
- `testCheckerItself`
- `getExpectedCheckerVerdict`

**From `src/helpers/solution.ts`:**

- `validateSolutionsExist`
- `ensureMainSolutionExists`
- `ensureSolutionExists`
- `getMainSolution`
- `runSingleSolutionOnTests`
- `runMatchingSolutionsOnTests`
- `testSolutionAgainstMainCorrect`
- `startTheComparisonProcess`

**From `src/formatter.ts`:**

- `fmt` (Formatter instance)

**From `src/executor.ts`:**

- `executor`

**From `src/polygon.ts`:**

- `PolygonSDK` (Polygon API SDK class)
- `PolygonConfig`
- `PolygonProblem`
- `PolygonSolution`
- `PolygonTest`
- `PolygonTestGroup`
- `PolygonFile`
- `PolygonStatement`
- `PolygonPackage`
- `PackageState` ('NOT_STARTED' | 'WAITING' | 'RUNNING' | 'READY' | 'FAILED')

**Remote Operations (from `src/actions.ts`):**

- `registerApiKeyAndSecretAction(apiKey, apiSecret)` - Register Polygon credentials
- `remoteListProblemsAction(options?)` - List accessible problems
- `remotePullProblemAction(problemId, targetPath, options?)` - Download problem
- `remotePushProblemAction(problemPath, options?)` - Upload changes to Polygon
- `remoteViewProblemAction(problemId)` - Display problem details
- `remoteCommitProblemAction(problemPath, message)` - Commit changes
- `remotePackageProblemAction(problemPath, options?)` - Build package

**Remote Helpers (from `src/helpers/remote/`):**

_pulling.ts:_

- `downloadSolutions(sdk, problemId, targetPath)`
- `downloadChecker(sdk, problemId, targetPath)`
- `downloadValidator(sdk, problemId, targetPath)`
- `downloadGenerators(sdk, problemId, targetPath)`
- `downloadStatements(sdk, problemId, targetPath)`
- `fetchProblemMetadata(sdk, problemId)`
- `downloadTestsetAndBuildGenerationScripts(sdk, problemId, targetPath)`

_pushing.ts:_

- `uploadSolutions(sdk, problemId, solutions)`
- `uploadChecker(sdk, problemId, checker, problemPath)`
- `uploadValidator(sdk, problemId, validator, problemPath)`
- `uploadGenerators(sdk, problemId, generators, problemPath)`
- `uploadStatements(sdk, problemId, statements, problemPath)`
- `uploadMetadata(sdk, problemId, config)`
- `uploadTestsets(sdk, problemId, testsets, problemPath)`
- `updateProblemInfo(sdk, problemId, config)`

_utils.ts (remote utilities):_

- `normalizeLineEndingsFromWinToUnix(text)` - Convert CRLF to LF
- `normalizeLineEndingsFromUnixToWin(text)` - Convert LF to CRLF
- `readCredentialsFromHomeDirectory()` - Load API credentials
- `saveCredentialsToHomeDirectory(apiKey, apiSecret)` - Store credentials
- `getProblemIdFromPath(problemPath)` - Extract problem ID from Config.json

_viewer.ts:_

- `displayProblemInfo(problem, sdk?)` - Format and display problem details

**From `src/types.d.ts`:**

- `ConfigFile`
- `LocalSolution`
- `LocalGenerator`
- `LocalChecker`
- `LocalValidator`
- `LocalTestset`
- `LocalTestGroup`
- `GeneratorScript`
- `GeneratorScriptCommand`
- `SolutionTag`
- `SolutionSourceType`
- `TestlibSourceType`
- `CppSourceType`
- `JavaSourceType`
- `PythonSourceType`
- `Statement`
- `CheckerVerdict`
- `ValidatorVerdict`
- `VerdictTracker`
- `PullOptions` (remote pull configuration)
- `PushOptions` (remote push configuration)

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
