# Polyman JSDoc Documentation

This document provides an overview of the JSDoc documentation added to the Polyman codebase.

## 📚 Fully Documented Files

### Core Files

#### `src/types.d.ts`

TypeScript type definitions with comprehensive JSDoc comments.

**Documented Types:**

- `SolutionLang` - Supported programming languages (cpp, python, java)
- `SolutionType` - Solution behavior types (main-correct, correct, incorrect, tle, mle, wa, etc.)
- `Solution` - Solution program configuration
- `Generator` - Test generator configuration
- `Checker` - Output validator configuration
- `CheckerVerdict` - Checker output verdicts (OK, WA, PE)
- `VerdictTracker` - Tracks different verdict types
- `CheckerTest` - Checker self-test case structure
- `Validator` - Input validator configuration
- `ValidatorVerdict` - Validator output verdicts
- `ValidatorTest` - Validator self-test case structure
- `ConfigFile` - Main problem configuration interface

**Example from code:**

```typescript
/**
 * Represents a solution program for the problem.
 * @typedef {Object} Solution
 * @property {string} name - Unique identifier for the solution
 * @property {string} source - Path to the solution source file
 * @property {SolutionType} type - Expected behavior of this solution
 * @example
 * {
 *   name: "main",
 *   source: "solutions/main.cpp",
 *   type: "main-correct"
 * }
 */
```

---

#### `src/formatter.ts`

Terminal output formatting with Codeforces theme.

**Documented Class:** `Formatter`

**Documented Methods:**

- `success(message)` - Prints green success message
- `error(message)` - Prints red error message
- `warning(message)` - Prints yellow warning
- `info(message)` - Prints white info message
- `log(message)` - Prints gray dimmed message
- `checkmark()` - Returns green ✓ icon
- `cross()` - Returns red ✖ icon
- `warningIcon()` - Returns yellow ⚠ icon
- `infoIcon()` - Returns blue ℹ icon
- `section(title)` - Prints section header with border
- `step(stepNumber, title)` - Prints numbered step
- `stepComplete(message?)` - Prints step completion
- `highlight(text)` - Returns Codeforces blue text
- `dim(text)` - Returns dimmed text
- `bold(text)` - Returns bold text
- `accent(text)` - Returns Codeforces red text
- `primary(text)` - Returns Codeforces blue text
- `successBox(message)` - Prints success box
- `errorBox(message)` - Prints error box

**Exported Instance:** `fmt` - Singleton formatter instance

---

#### `src/actions.ts`

High-level action functions for CLI commands.

**Documented Functions:**

- `createTemplate(directory)` - Create new problem template with full structure
- `listAvailableCheckers()` - Display all standard checkers with descriptions
- `downloadTestlib()` - Download testlib.h from GitHub with installation guide
- `generateTests(generatorName)` - Run generators to create test files
- `validateTests(arg)` - Validate test inputs using validator
- `solveTests(solutionName, arg)` - Run solutions on tests with time/memory limits
- `testWhat(what)` - Test validator/checker/solution programs
- `fullVerification()` - Complete problem verification workflow

**Example from code:**

```typescript
/**
 * Performs complete problem verification workflow.
 * Executes all steps: test generation, validator testing, test validation,
 * checker testing, solution execution, and solution verification.
 *
 * Verification steps:
 * 1. Generate all tests using generators
 * 2. Run validator self-tests
 * 3. Validate all generated tests
 * 4. Run checker self-tests
 * 5. Execute all solutions on all tests
 * 6. Verify each solution behaves according to its type (TLE, WA, etc.)
 *
 * @example
 * await fullVerification();
 */
```

---

#### `src/executor.ts`

Command execution engine with resource management.

**Documented Interfaces:**

- `ExecutionResult` - Contains stdout, stderr, exitCode, success, timedOut, memoryExceeded
- `ExecutionOptions` - Configuration for timeout, memory limits, callbacks, etc.

**Documented Class:** `CommandExecutor`

**Public Methods:**

- `execute(command, options)` - Execute command with timeout/memory limits
- `executeWithRedirect(command, options, inputFile?, outputFile?)` - Execute with I/O redirection
- `registerTempFile(filePath)` - Register temp file for tracking
- `cleanup()` - Kill processes and clear state
- `getTempFiles()` - Get list of temp files

**Private Methods (All Documented):**

- `applyMemoryLimit(command, memoryLimitMB?)` - Apply platform-specific memory limits
- `spawnProcess(command, options)` - Spawn child process with tracking
- `createEmptyResult()` - Create default execution result
- `createOutputCollectors(child)` - Setup stdout/stderr collectors
- `cancellableDelay(ms)` - Create cancellable timeout promise
- `handleTimeout(...)` - Handle process timeout scenario
- `attachEventHandlers(...)` - Attach process lifecycle handlers
- `handleProcessClose(...)` - Handle process close event
- `isMemoryError(code, signal, stderr)` - Detect memory errors
- `handleMemoryError(...)` - Handle memory limit exceeded
- `handleSuccess(...)` - Handle successful execution
- `handleError(...)` - Handle execution failure
- `handleProcessError(...)` - Handle spawn errors
- `killProcessTree(pid)` - Kill process and children
- `buildRedirectedCommand(...)` - Build command with I/O redirection
- `killAllActiveProcesses()` - Kill all tracked processes

**Exported Instance:** `executor` - Singleton executor instance

---

#### `src/cli.ts`

Command-line interface entry point.

**Documented Commands:**

- `new <directory>` - Create new problem template
- `download-testlib` - Download testlib.h from GitHub
- `list-checkers` - List available standard checkers
- `run-generator <generator-name>` - Run test generators
- `run-validator <test>` - Validate test files
- `run-solution <solution-name> <test>` - Run solutions on tests
- `test <what>` - Test validator/checker/solutions
- `verify` - Full problem verification

**Example from code:**

```typescript
/**
 * Command: verify
 * Runs full verification of the problem.
 * Includes: test generation, validation, checker testing, solution execution, and comparison.
 *
 * @example
 * polyman verify
 */
```

---

### Helper Files

#### `src/helpers/utils.ts`

Common utilities for compilation, files, and errors.

**Documented Constants:**

- `DEFAULT_TIMEOUT` - 10000ms
- `DEFAULT_MEMORY_LIMIT` - 1024MB

**Documented Functions:**

- `compileCPP(sourcePath)` - Compile C++ with g++ (C++23, -O2)
- `compileJava(sourcePath)` - Compile Java and return run command
- `filterTestsByRange(testFiles, testBegin?, testEnd?)` - Filter tests by number range
- `readConfigFile()` - Read and parse Config.json
- `isNumeric(value)` - Check if string is numeric
- `logError(error)` - Log error with cross icon
- `logErrorAndExit(error)` - Log error and exit process
- `logErrorAndThrow(error, message?)` - Log error and re-throw
- `throwError(error, message?)` - Throw error ensuring Error instance
- `ensureDirectoryExists(dirName)` - Create directory if needed
- `removeDirectoryRecursively(dirName)` - Remove directory and contents
- `readFirstLine(filePath)` - Read first line of file efficiently

---

#### `src/helpers/testlib-download.ts`

Download utilities for testlib.h.

**Documented Functions:**

- `downloadFile(url)` - Download file from URL with redirect handling

---

#### `src/helpers/checker.ts`

Checker compilation, testing, and execution.

**Documented Functions:**

- `runChecker(execCommand, inputFilePath, outputFilePath, answerFilePath, expectedVerdict)` - Run checker on solution output
- `ensureCheckerExists(checker)` - Validate checker configuration exists
- `testCheckerItself()` - Test checker against its test suite
- `runCheckerTests(checker)` - Run all checker self-tests
- `compileChecker(checker)` - Compile custom or standard checker
- `getExpectedCheckerVerdict(solutionType)` - Map solution type to expected verdict

**Example from code:**

```typescript
/**
 * Runs a checker program to validate solution output against expected answer.
 * The checker receives three files: input, output (participant's answer), and answer (jury's answer).
 *
 * @throws {Error} If checker verdict doesn't match expected verdict
 * @throws {Error} If checker exceeds time or memory limits (exits process)
 */
```

---

#### `src/helpers/validator.ts`

Input validator compilation, testing, and execution.

**Documented Functions:**

- `validateSingleTest(validator, testNumber)` - Validate a single test file
- `validateAllTests(validator)` - Validate all generated tests
- `ensureValidatorExists(validator)` - Validate validator configuration exists
- `testValidatorItself()` - Test validator against its test suite
- `runValidatorTests(validator)` - Run all validator self-tests

---

#### `src/helpers/generator.ts`

Test generator compilation and execution.

**Documented Functions:**

- `ensureGeneratorsExist(generators)` - Validate generators configuration
- `runMatchingGenerators(generators, generatorName)` - Run specified generators
- `handleGenerationError(error, isCancelationPoint)` - Handle generation errors

**Example from code:**

```typescript
/**
 * Runs matching test generators based on name.
 * Compiles and executes generators, creating test files in the tests/ directory.
 * Fails fast - stops on first generator failure.
 *
 * @example
 * await runMatchingGenerators(config.generators, 'gen-random');
 */
```

---

#### `src/helpers/solution.ts`

Solution compilation, execution, and verification.

**Public Functions:**

- `validateSolutionsExist(solutions)` - Validate solutions configuration
- `findMatchingSolutions(solutions, solutionName)` - Find solutions by name
- `runSingleSolutionOnTests(solution, config, testNumber?)` - Run single solution on tests
- `runMatchingSolutionsOnTests(solutions, solutionName, config, testNumber?)` - Run solutions on tests
- `testSolutionAgainstMainCorrect(solutionName)` - Test solution against main-correct
- `ensureMainSolutionExists(solutions)` - Validate main-correct exists
- `ensureSolutionExists(solutions, solutionName)` - Validate specific solution exists
- `getMainSolution(solutions)` - Get main-correct solution
- `startTheComparisonProcess(checker, mainSolution, targetSolution)` - Compare solutions with checker

**Private Helper Functions (All Documented):**

- `getTestFilesToRun(testsDir, testNumber?)` - Get test files to execute
- `runSolution(solution, compiledPath, timeout, memoryLimitMB, inputFile)` - Execute single solution
- `ensureOutputDirectory(solutionName)` - Create output directory
- `compileSolution(sourcePath)` - Compile based on file extension
- `createVerdictTracker()` - Create verdict tracking object
- `writeErrorOutputAndThrow(outputPath, stderr)` - Write RTE and throw
- `writeTimeoutOutputAndThrow(outputPath, timeout)` - Write TLE and throw
- `writeMemoryOutputAndThrow(outputPath, memoryLimit)` - Write MLE and throw
- `getTestFiles(testsDir)` - Get all test files
- `checkIfShouldSkip(...)` - Check if test should be skipped
- `validateMainSolutionOutput(firstLine, testFile)` - Validate main solution
- `validateTargetSolutionOutput(...)` - Validate target solution
- `shouldSkipCheckerComparison(firstLine)` - Determine if checker should skip
- `validateExpectedVerdicts(targetSolution, verdictTracker)` - Validate solution behavior
- `isTLE(firstLine)` - Check for TLE in output
- `isMLE(firstLine)` - Check for MLE in output
- `isRTE(firstLine)` - Check for RTE in output
- `isTLEValue(solutionType)` - Check if type allows TLE
- `isValidMLEValue(solutionType)` - Check if type allows MLE
- `isValidRTEValue(solutionType)` - Check if type allows RTE
- `isValidWAValue(solutionType)` - Check if type allows WA

**Example from code:**

```typescript
/**
 * Tests a solution against the main correct solution using the checker.
 * Runs both solutions on all tests, then compares outputs with the checker.
 * Validates that the solution behaves according to its expected type (TLE, WA, etc.).
 *
 * @example
 * await testSolutionAgainstMainCorrect('wa-solution');
 */
```

---

#### `src/helpers/create-template.ts`

Template creation utilities.

**Documented Functions:**

- `logTemplateCreationSuccess(directory)` - Display next steps after creation
- `copyTemplate(srcDir, destDir)` - Recursively copy template files
- `handleTemplateCreationError(error)` - Handle template creation errors

---

## 📖 Documentation Standards

All JSDoc comments follow these principles:

### 1. **File-level Documentation**

Each file starts with a `@fileoverview` describing its purpose:

```typescript
/**
 * @fileoverview Terminal output formatter with Codeforces-themed styling.
 * Provides consistent, colorful CLI output using chalk library.
 */
```

### 2. **Function Documentation**

Every public function includes:

- Brief description
- `@param` tags for all parameters
- `@returns` tag for return value
- `@throws` tags for errors
- `@example` tags with real code from the codebase

### 3. **Type Documentation**

All TypeScript types include:

- `@typedef` with type name
- Property descriptions with `@property`
- Examples showing actual usage

### 4. **Class Documentation**

Classes include:

- `@class` tag
- Description of purpose
- `@example` showing typical usage

### 5. **Real Examples**

All examples come from actual codebase usage:

```typescript
// From actions.ts:
fmt.section('📁 CREATE NEW PROBLEM TEMPLATE');
fmt.step(1, 'Creating Directory Structure');
```

---

## 🔍 Viewing Documentation

### Using VSCode

Hover over any function, class, or type to see inline documentation.

### Generating HTML Docs

You can generate HTML documentation using JSDoc:

```bash
npm install -g jsdoc
jsdoc src/**/*.ts -d docs
```

### TypeScript IntelliSense

All documentation is visible in IDE autocomplete and parameter hints.

---

## ✅ Documentation Complete!

All source files in the Polyman project now have comprehensive JSDoc documentation:

### ✅ Completed Files:

- ✅ `src/types.d.ts` - Type definitions
- ✅ `src/formatter.ts` - Terminal formatting
- ✅ `src/actions.ts` - CLI action functions
- ✅ `src/executor.ts` - Command execution
- ✅ `src/cli.ts` - CLI commands
- ✅ `src/helpers/utils.ts` - Utility functions
- ✅ `src/helpers/testlib-download.ts` - Testlib downloader
- ✅ `src/helpers/checker.ts` - Checker utilities
- ✅ `src/helpers/validator.ts` - Validator utilities
- ✅ `src/helpers/generator.ts` - Generator utilities
- ✅ `src/helpers/solution.ts` - Solution utilities
- ✅ `src/helpers/create-template.ts` - Template creation

### 📊 Documentation Statistics:

- **Total Files**: 12
- **Total Functions/Methods**: 89+
- **Total Private Helper Functions**: 35+
- **Total Types/Interfaces**: 12+
- **Total CLI Commands**: 8
- **All include**: `@param`, `@returns`, `@throws`, and `@example` tags
- **100% Coverage**: All public AND private functions documented

---

## 📝 Future Maintenance

When adding new code, ensure:

- [ ] File has `@fileoverview` at the top
- [ ] All public functions have JSDoc comments
- [ ] All parameters documented with `@param`
- [ ] Return values documented with `@returns`
- [ ] Errors documented with `@throws`
- [ ] At least one `@example` per function
- [ ] Examples use real code from the codebase
- [ ] Types have `@typedef` and `@property` tags
- [ ] Classes have `@class` tag
- [ ] Exported instances documented as `@constant`

---

## 🎯 Benefits

With proper JSDoc documentation:

1. **Better IDE Support** - IntelliSense shows full parameter and return type information
2. **Type Safety** - JavaScript files get type checking through JSDoc
3. **Self-Documenting Code** - Developers understand usage without reading implementation
4. **Easier Onboarding** - New contributors can quickly understand the codebase
5. **Generated Docs** - Can create HTML documentation automatically
6. **Error Prevention** - `@throws` tags help developers handle errors properly

---

## 📚 Resources

- [JSDoc Official Documentation](https://jsdoc.app/)
- [TypeScript JSDoc Reference](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html)
- [VSCode JSDoc Support](https://code.visualstudio.com/docs/languages/javascript#_jsdoc-support)
