# Polyman Complete User Guide

**Version 3.1.0** | A comprehensive guide for creating competitive programming problems using Polyman CLI

---

## Table of Contents

1. [Introduction](#introduction)
   - [What is Polyman?](#what-is-polyman)
   - [Key Features](#key-features)
   - [Prerequisites](#prerequisites)

2. [Getting Started](#getting-started)
   - [Installation](#installation)
   - [Creating Your First Problem](#creating-your-first-problem)
   - [Directory Structure](#directory-structure)

3. [Configuration File Reference](#configuration-file-reference)
   - [Overview](#overview)
   - [Basic Properties](#basic-properties)
   - [Statements](#statements)
   - [Solutions](#solutions)
   - [Generators](#generators)
   - [Checker](#checker)
   - [Validator](#validator)
   - [Testsets](#testsets)

4. [Writing Validators](#writing-validators)
   - [Purpose](#purpose)
   - [Basic Structure](#basic-structure)
   - [Common Validation Functions](#common-validation-functions)
   - [Validator Self-Tests](#validator-self-tests)
   - [Do's and Don'ts](#dos-and-donts)
   - [Advanced Example](#advanced-example)

5. [Writing Checkers](#writing-checkers)
   - [Purpose](#purpose-1)
   - [Basic Structure](#basic-structure-1)
   - [Checker Streams](#checker-streams)
   - [Checker Verdicts](#checker-verdicts)
   - [Checker Self-Tests](#checker-self-tests)
   - [Do's and Don'ts](#dos-and-donts-1)
   - [Floating-Point Checker Example](#floating-point-checker-example)
   - [Multiple Answer Checker Example](#multiple-answer-checker-example)

6. [Writing Generators](#writing-generators)
   - [Purpose](#purpose-2)
   - [Basic Structure](#basic-structure-2)
   - [Random Functions](#random-functions)
   - [Do's and Don'ts](#dos-and-donts-2)
   - [Advanced Example](#advanced-example-1)

7. [Writing Solutions](#writing-solutions)
   - [Main Correct Solution (MA)](#main-correct-solution-ma)
   - [Other Solution Types](#other-solution-types)
   - [Do's and Don'ts](#dos-and-donts-3)

8. [Test Generation](#test-generation)
   - [Generation Workflow](#generation-workflow)
   - [Manual Tests](#manual-tests)
   - [Generated Tests](#generated-tests)
   - [Test Organization](#test-organization)

9. [CLI Commands Reference](#cli-commands-reference)
   - [Problem Creation](#problem-creation)
   - [List Commands](#list-commands)
   - [Test Management](#test-management)
   - [Validation](#validation)
   - [Solution Execution](#solution-execution)
   - [Testing Components](#testing-components)
   - [Full Verification](#full-verification)
   - [Running Without a Terminal](#running-without-a-terminal)
   - [Exit Codes](#exit-codes)
   - [AI Provider Keys](#ai-provider-keys)

10. [Remote Operations (Polygon Integration)](#remote-operations-polygon-integration)
    - [Setup and Registration](#setup-and-registration)
    - [Listing Problems](#listing-problems)
    - [Pulling Problems](#pulling-problems)
    - [Quick Note before you read on:](#quick-note-before-you-read-on)
    - [Pushing Problems](#pushing-problems)
    - [Viewing Problem Details](#viewing-problem-details)
    - [Committing Changes](#committing-changes)
    - [Building Packages](#building-packages)

11. [Chat (AI agent)](#chat-ai-agent)
    - [Quick Start](#quick-start)
    - [Providers, keys and models](#providers-keys-and-models)
    - [New Problem or Existing Problem](#new-problem-or-existing-problem)
    - [The Terminal UI](#the-terminal-ui)
    - [Plain Mode (`--plain`)](#plain-mode---plain)
    - [What the Agent Can Do](#what-the-agent-can-do)
    - [Workflows](#workflows)
    - [Notes and Logs](#notes-and-logs)
    - [Safety and Privacy](#safety-and-privacy)
    - [Known Limits](#known-limits)

12. [Best Practices](#best-practices)
    - [Directory Organization](#1-directory-organization)
    - [Configuration Management](#2-configuration-management)
    - [Test Coverage](#3-test-coverage)
    - [Solution Testing](#4-solution-testing)
    - [Version Control](#5-version-control)

13. [Troubleshooting](#troubleshooting)
    - [Compilation Errors](#compilation-errors)
    - [Validation Errors](#validation-errors)
    - [Checker Errors](#checker-errors)
    - [Solution Errors](#solution-errors)
    - [Test Generation Errors](#test-generation-errors)
    - [Memory Issues](#memory-issues)
    - [Time Issues](#time-issues)

14. [FAQ](#faq)
    - [Do I need a custom checker?](#1-do-i-need-to-write-a-custom-checker-for-my-problem)
    - [Can I use Python for main solution?](#2-can-i-use-python-for-my-main-solution)
    - [How many tests should I include?](#3-how-many-tests-should-i-include)
    - [Interactive vs Regular problems?](#4-whats-the-difference-between-interactive-and-regular-problems)
    - [How to handle floating-point?](#5-how-do-i-handle-floating-point-problems)
    - [Multiple problems in one directory?](#6-can-i-test-multiple-problems-in-the-same-directory)
    - [How to debug WA solutions?](#7-how-do-i-debug-why-my-solution-is-getting-wa)
    - [Validator too strict/lenient?](#8-what-if-my-validator-is-too-strictlenient)

---

## Introduction

### What is Polyman?

Polyman is a command-line tool designed for competitive programming problem setters to create, validate, and verify problems locally before uploading to Codeforces Polygon or other platforms.

### Key Features

- **Local Problem Development**: Create and test problems entirely on your machine
- **Comprehensive Validation**: Validate inputs, check outputs, and verify solutions
- **Multiple Languages**: Support for C++, Java, and Python solutions
- **Standard Checkers**: Built-in testlib checkers for common comparison types
- **Full Verification**: Complete workflow automation for problem testing

### Prerequisites

- **Node.js** ^20.19.0 or ≥ 22.12.0
- **C++ Compiler** (g++ with C++23 support by default; set `cppStandard` in `Config.json` to target an older standard, or use another compiler with `POLYMAN_CXX` or `compiler.cpp`, see [Local Compiler Overrides](#local-compiler-overrides))
- **Java JDK** (optional, for Java solutions)
- **Python** (optional, for Python solutions)
- **testlib.h** (automatically downloadable via Polyman)

---

## Getting Started

### Installation

```bash
npm install -g polyman-cli
```

### Creating Your First Problem

```bash
# Create a new problem template
polyman new my-problem

# Navigate to the problem directory
cd my-problem

# Download testlib.h (required for validators, checkers, generators)
polyman download-testlib
```

### Directory Structure

After creating a new problem, you'll have:

```
my-problem/
├── Config.json              # Main configuration file
├── testlib.h               # Testlib header (after download)
├── checker/
│   ├── chk.cpp            # Checker implementation
│   └── checker_tests.json # Checker self-tests
├── validator/
│   ├── val.cpp            # Validator implementation
│   └── validator_tests.json # Validator self-tests
├── generators/
│   └── gen.cpp            # Test generator
├── solutions/
│   ├── acc.cpp            # Main correct solution
│   ├── acc2.java          # Alternative correct solution
│   └── tle.py             # Time limit solution
├── testsets/
│   └── tests/             # Generated tests appear here
└── statements/
    ├── english/           # English problem statement
    └── russian/           # Russian problem statement
```

---

## Configuration File Reference

### Overview

`Config.json` is the central configuration file that defines all aspects of your problem.

### Basic Properties

#### Required Fields

```json
{
  "name": "my-problem-name",
  "timeLimit": 1000,
  "memoryLimit": 256,
  "inputFile": "stdin",
  "outputFile": "stdout",
  "interactive": false
}
```

| Field         | Type    | Description                | Possible Values                            |
| ------------- | ------- | -------------------------- | ------------------------------------------ |
| `name`        | string  | Problem identifier         | Any valid string                           |
| `timeLimit`   | number  | Time limit in milliseconds | 100-15000 (typical: 1000-2000)             |
| `memoryLimit` | number  | Memory limit in megabytes  | 4-1024 (typical: 256-512)                  |
| `inputFile`   | string  | Input source               | `"stdin"` or filename like `"input.txt"`   |
| `outputFile`  | string  | Output destination         | `"stdout"` or filename like `"output.txt"` |
| `interactive` | boolean | Interactive problem flag   | `true` or `false`                          |

**Important Notes:**

- Time limits are in **milliseconds** (1000ms = 1 second)
- Memory limits are in **megabytes**
- Use `"stdin"`/`"stdout"` for standard I/O problems
- Set `interactive: true` only for interactive problems (Interactive Problems Are Not Supported Yet)

#### File Input and Output

Some Polygon problems read `input.txt` and write `output.txt` instead of stdin and stdout. `remote pull` saves these names in `inputFile` and `outputFile`, and `run`, `test` and `verify` use them when they run solutions:

- `"stdin"`, `"stdout"` or an empty value means the standard stream (case does not matter). This is what Polygon uses by default, and solutions run exactly as before: in the problem folder, with the test on stdin and stdout as the output.
- When `inputFile` is a file name, each solution runs on each test in its own new temp folder. polyman copies the test there under that name. stdin is empty, like on Polygon, so a solution that reads stdin on such a problem gets no input.
- When `outputFile` is a file name, polyman reads that file from the temp folder as the solution's output. stdout is thrown away. If the solution does not create the file, its output is empty.
- The two fields work on their own, for example `"inputFile": "input.txt"` with `"outputFile": "stdout"`.
- Nothing is written to the problem folder. The output goes to `solutions-outputs/` as usual, and the temp folder is removed after each test. Time and memory limits are the same as for stdin/stdout problems.
- The value must be a plain file name like `input.txt`, not a path. A value like `../input.txt` stops the run with exit code `2`.

The output of the main solution is the answer file for the checker. So on a file problem, a main that prints to stdout instead of `outputFile` has an empty output, and `verify` stops with `Main solution "..." printed nothing on every test`.

#### Optional Fields

```json
{
  "description": "A brief description of the problem",
  "tags": ["implementation", "math", "greedy"],
  "tutorial": "Solution explanation and approach",
  "cppStandard": "c++23",
  "timeLimitMultipliers": { "java": 2, "python": 3 }
}
```

| Field                  | Type   | Description                                                                          | Default          |
| ---------------------- | ------ | ------------------------------------------------------------------------------------ | ---------------- |
| `cppStandard`          | string | Standard passed to the local compiler as `-std=` (e.g. `c++17`, `c++20`)             | `c++23`          |
| `timeLimitMultipliers` | object | Per-language factors applied to `timeLimit` for local runs (`cpp`, `java`, `python`) | every factor `1` |

`cppStandard` only affects local compilation (`generate`, `validate`, `run`, `verify`). The compiler used on Polygon is chosen per file through `sourceType` (see [Source Types](#source-types)).

A C++ solution whose `sourceType` names a standard (`cpp.g++17`, `cpp.gcc14-64-msys2-g++23`, `cpp.clang++20`, ...) is built locally with that standard, so it gets the same build as on Polygon. For a solution, the `-std=` comes from the first of these that is set:

1. a `-std=` item in `compiler.flags`,
2. `cppStandard` in `Config.json`,
3. the standard in the solution's `sourceType`,
4. the default `c++23`.

So `cppStandard` still sets one standard for every file when you want that. A `sourceType` with no standard in it (`cpp.ms2017`, `cpp.ms2019`) uses the default. Generators, the validator and the checker do not read `sourceType` locally, they use `cppStandard` or the default.

`timeLimitMultipliers` also only affects local runs. Java and Python are slower than C++ at the same task (JVM startup, interpreter), so a correct `OK` solution can get TLE locally against a C++-sized limit and fail `polyman verify` even though the problem is fine. A factor scales `timeLimit` for that language only:

```json
{ "timeLimit": 1000, "timeLimitMultipliers": { "java": 2, "python": 3 } }
```

A Java solution then runs locally with `2000ms` and a Python one with `3000ms`; C++ keeps `1000ms` unless you list `cpp` too. The scaled limit is printed when a run starts, e.g. `Time Limit: 2000ms (x2 for java)`. Polygon has no per-language limits, so `polyman remote push` still sends the plain `timeLimit` — the scaling never changes the problem itself. Omitting the field keeps every solution on the declared limit, exactly as before. The language comes from the file extension (`.cpp`/`.cc`/`.cxx`, `.java`, `.py`), the same way polyman picks how to run the file locally; `sourceType` does not change it.

`run`, `test` and `verify` check the field before anything runs and stop with an error if it is wrong: a key other than `cpp`, `java` or `python`, a factor that is not a positive number (including `null`), a value that is not an object, or a factor that makes the limit bigger than `2147483647ms`.

#### Local Compiler Overrides

By default polyman compiles C++ with `g++` and Java with `javac` from your `PATH`. To use another compiler (for example `g++-15` or `clang++`) without changing your system default, add an optional `compiler` block:

```json
{
  "cppStandard": "c++20",
  "compiler": {
    "cpp": "g++-15",
    "javac": "/usr/lib/jvm/java-21-openjdk/bin/javac",
    "flags": ["-Wall", "-DLOCAL"]
  }
}
```

| Field   | Type     | Description                                                     | Default   |
| ------- | -------- | --------------------------------------------------------------- | --------- |
| `cpp`   | string   | C++ compiler executable name or path                            | `"g++"`   |
| `javac` | string   | Java compiler executable name or path                           | `"javac"` |
| `flags` | string[] | Extra flags for every C++ compile, one flag per item            | `[]`      |

The environment variables `POLYMAN_CXX` and `POLYMAN_JAVAC` take precedence over `compiler.cpp` and `compiler.javac`. This is handy for one run:

```bash
POLYMAN_CXX=clang++ polyman verify
```

So the order is: environment variable, then `Config.json`, then the default. An empty or blank environment variable counts as not set.

**How `flags` and `cppStandard` combine.** Every C++ compile starts with `-O2 -std=<cppStandard>`, then the items of `flags` are added in order. A flag of the same kind replaces the default instead of being added next to it:

- a `-std=` flag in `flags` replaces `cppStandard`,
- an `-O` flag in `flags` (`-O0`, `-O3`, `-Ofast`, ...) replaces `-O2`.

With the example above, polyman runs `g++-15 -O2 -std=c++20 -Wall -DLOCAL ...`. With `"flags": ["-O0", "-std=gnu++17"]` it runs `g++-15 -O0 -std=gnu++17 ...`, so `cppStandard` is not used. The same flags are used for every C++ source: solutions, generators, the validator and the checker. The one difference: C++ solutions also get `-DONLINE_JUDGE` right after the standard, like on Codeforces, so a solution with `#ifndef ONLINE_JUDGE freopen(...) #endif` writes to stdout. It is not added twice if `flags` already defines `ONLINE_JUDGE`.

Paths with spaces work, polyman quotes the executable and each flag. Because each item is one argument, write `["-Wall", "-Wextra"]` and not `["-Wall -Wextra"]`. On Windows, use the full path with backslashes in JSON (`"C:\\mingw64\\bin\\g++.exe"`) or forward slashes.

**Checks.** If the block is wrong, the compile step stops with a clear error and nothing is compiled: `compiler` must be an object, `cpp` and `javac` must be non-empty strings, `flags` must be an array of non-empty strings, and no other key is allowed.

**Cache.** The compiled-binary cache is keyed on the resolved compiler executable and the full flag list (see [Compilation Cache](#compilation-cache)), so switching `POLYMAN_CXX`, `compiler.cpp` or `flags` recompiles everything once.

**Java.** `compiler.flags` is only for C++. Java programs still run with `java` from your `PATH`, so if `javac` comes from a newer JDK than `java`, the run fails with `UnsupportedClassVersionError`. Put the matching JDK's `bin` first on your `PATH` in that case.

This block is local only. It is never pushed to Polygon; Polygon picks its compiler from each file's `sourceType`.

### Statements

Define problem statements in multiple languages:

```json
{
  "statements": {
    "english": {
      "encoding": "UTF-8",
      "name": "Problem Title",
      "legend": "./statements/english/legend.tex",
      "input": "./statements/english/input-format.tex",
      "output": "./statements/english/output-format.tex",
      "notes": "./statements/english/notes.tex"
    },
    "russian": {
      "encoding": "UTF-8",
      "name": "Название Задачи",
      "legend": "./statements/russian/legend.tex",
      "input": "./statements/russian/input-format.tex",
      "output": "./statements/russian/output-format.tex"
    }
  }
}
```

**Do's:**

- Always use UTF-8 encoding
- Store statement files in respective language folders
- Use LaTeX format for mathematical expressions

**Don'ts:**

- Don't use absolute paths for statement files
- Don't mix encodings within the same problem

### Solutions

Define all solutions with their expected behavior:

```json
{
  "solutions": [
    {
      "name": "main",
      "source": "./solutions/acc.cpp",
      "tag": "MA",
      "sourceType": "cpp.g++17"
    },
    {
      "name": "wa-solution",
      "source": "./solutions/wa.cpp",
      "tag": "WA",
      "sourceType": "cpp.g++17"
    },
    {
      "name": "tle-solution",
      "source": "./solutions/tle.py",
      "tag": "TL",
      "sourceType": "python.3"
    }
  ]
}
```

#### Solution Tags

| Tag  | Meaning            | Description                                       |
| ---- | ------------------ | ------------------------------------------------- |
| `MA` | Main Correct       | **Required**. The reference solution (must exist) |
| `OK` | Correct            | Alternative correct solution                      |
| `WA` | Wrong Answer       | Should get WA or PE on some tests (as on Polygon) |
| `TL` | Time Limit         | Should exceed time limit on some tests            |
| `TO` | Time/OK            | May TLE but is algorithmically correct            |
| `ML` | Memory Limit       | Should exceed memory limit                        |
| `RE` | Runtime Error      | Should crash or have runtime errors               |
| `PE` | Presentation Error | Wrong output format                               |
| `RJ` | Rejected           | Should fail for any reason                        |

#### Source Types

**C++ Compilers:**

- `cpp.g++11`, `cpp.g++14`, `cpp.g++17`, `cpp.g++20`
- `cpp.msys2-mingw64-9-g++17`, `cpp.gcc13-64-winlibs-g++20`, `cpp.gcc14-64-msys2-g++23` (64-bit; the last one is Polygon's C++23 compiler)
- `cpp.ms2017`, `cpp.ms2019`
- `cpp.clang++17`, `cpp.clang++20`

`sourceType` is honored on `polyman remote push` for solutions, generators, the checker and the validator. C++ files without one are uploaded as `cpp.g++17`. `polyman remote pull` writes each file's `sourceType` into `Config.json`, so a pull then a push keeps the same compilers. Locally, a C++ solution is built with the standard in its `sourceType` unless `cppStandard` or `compiler.flags` sets one (see [Optional Fields](#optional-fields)). Polygon retires compilers over time, so check the problem's compiler list in the Polygon UI if an upload is rejected.

C++ sources may use the `.cpp`, `.cc` or `.cxx` extension.

**Java Versions:**

- `java8`, `java21` (Polygon rejects `java11` and the dotted forms such as `java.11`)

**Python Versions:**

- `python.2`, `python.3`, `python.pypy2`, `python.pypy3`

**Do's:**

- Always include exactly **one** solution with tag `MA`
- Include solutions with different expected behaviors (WA, TL, etc.)
- Use appropriate sourceType for each solution
- You May Leave The Source Types Empty to Use Default Compilers (`cpp.g++17` for C++)

**Don'ts:**

- Don't have multiple `MA` solutions
- Don't forget to test non-MA solutions
- Don't use Python for time-critical main solutions

### Generators

Define test generators:

```json
{
  "generators": [
    {
      "name": "gen-random",
      "source": "./generators/random.cpp",
      "sourceType": "cpp.g++17"
    },
    {
      "name": "gen-special",
      "source": "./generators/special.cpp",
      "sourceType": "cpp.g++17"
    }
  ]
}
```

**Important:** Generators **must** be C++ and use testlib.h

For authoring guidance see [Writing Generators](#writing-generators).

### Checker

Define output checker:

```json
{
  "checker": {
    "name": "custom_checker",
    "source": "./checker/chk.cpp",
    "testsFilePath": "./checker/checker_tests.json",
    "isStandard": false
  }
}
```

**For Standard Checkers:**

```json
{
  "checker": {
    "name": "wcmp",
    "source": "wcmp.cpp",
    "isStandard": true
  }
}
```

#### Available Standard Checkers

Use `polyman list checkers` to see all available checkers:

- **wcmp**: Compare tokens (whitespace-insensitive)
- **ncmp**: Compare numbers with absolute/relative error
- **fcmp**: Compare floating-point numbers
- **lcmp**: Compare lines exactly
- **yesno**: Compare yes/no answers
- And many more...

For authoring guidance see [Writing Checkers](#writing-checkers).

### Validator

Define input validator:

```json
{
  "validator": {
    "name": "validator",
    "source": "./validator/val.cpp",
    "testsFilePath": "./validator/validator_tests.json"
  }
}
```

**Important:** Validators **must** be C++ and use testlib.h

For authoring guidance see [Writing Validators](#writing-validators).

### Testsets

Testsets are collections of test cases that define how your problem will be tested. Each testset can contain multiple tests organized into groups.

#### Understanding Testsets

**What is a Testset?**

- A testset is a named collection of test cases
- Common names: `"tests"`, `"pretests"`, `"system-tests"`
- Each testset generates its own folder in `testsets/<testset-name>/`
- Most problems have just one testset called `"tests"`

**Multiple Testsets Example:**

```json
{
  "testsets": [
    {
      "name": "pretests",
      "groupsEnabled": true,
      "groups": [{"name": "samples"}],
      "generatorScript": { "scriptFile": "./pretests-gen-script.txt" }
    },
    {
      "name": "system-tests",
      "groupsEnabled": true,
      "groups": [{"name": "full"}],
      "generatorScript": { "scriptFile": "./system-tests-gen-script.txt" }
    }
  ]
}
```

**For Most Problems:** Use a single testset named `"tests"`

---

#### Understanding Groups

**What are Groups?**

- Groups organize tests within a testset into logical categories
- Enable better organization and targeted testing
- Can be enabled/disabled with `groupsEnabled` field

**When to Use Groups:**

**Use Groups (`groupsEnabled: true`):**

- When you want to organize tests by type (samples, edge cases, stress tests)
- When you need to run specific categories of tests separately
- For better organization in larger problem sets

```json
{
  "groupsEnabled": true,
  "groups": [
    { "name": "samples" }, // Sample tests shown in problem statement
    { "name": "small" }, // Small tests for debugging
    { "name": "main" }, // Main test cases
    { "name": "edge" }, // Edge cases and boundaries
    { "name": "stress" } // Large random tests
  ]
}
```

```json
{
  "groupsEnabled": false,
  "generatorScript": {
    "script": "gen 1 > $\ngen 2 > $"
  }
}
```

**Important:** If `groupsEnabled: true`, you **must**:

1. Define groups in the `groups` array.
2. Tag script lines via `<#-- @group <name> -->` headers and tag every manual entry with a `group` field.
3. Only use group names that appear in the `groups` array.

---

#### Complete Testset Structure

A testset has two independent inputs:

- `generatorScript` — a Polygon-format text script (inline or in a file).
- `manualTests[]` — a list of hand-written test files with explicit indices.

```json
{
  "testsets": [
    {
      "name": "tests",
      "groupsEnabled": true,
      "groups": [
        { "name": "samples" },
        { "name": "main" },
        { "name": "edge-cases" }
      ],
      "generatorScript": {
        "scriptFile": "./generators/gen-script.txt"
      },
      "manualTests": [
        {
          "input": "./manual/tests/m-01-sample.in",
          "index": 1,
          "group": "samples",
          "useInStatements": true
        }
      ]
    }
  ]
}
```

The script (here in `generators/gen-script.txt`) is plain Codeforces-Polygon syntax:

```
<#-- @group main -->
<#list 1..50 as i>
gen-random ${i} > $
</#list>

<#-- @group edge-cases -->
gen-edge boundary-low  > $
gen-edge boundary-high > $
```

---

#### The Generator Script Format (Polygon-compatible)

Each non-empty, non-comment line has the form:

```
generator-name [args...] > target
```

Where `target` is one of:

| Form        | Meaning                                                  |
| ----------- | -------------------------------------------------------- |
| `N`         | Write the test to index `N` (e.g. `> 5` → `test5.txt`).  |
| `$`         | Smallest unused index. Polyman assigns it at parse time. |
| `{1-3,7,9}` | Multi-output. The generator itself writes the listed files (no stdout redirect). Polyman runs the generator once with cwd set to the testset directory and verifies each promised file appears. |

**Constraints:**

- Generator names **must not** include extensions (`gen.exe`, `gen.cpp` are rejected).
- Indices are unique across the script *and* `manualTests[]` — no two tests can claim the same number.
- `$` walks the smallest available index, skipping anything taken by a manual test or an earlier line.

**FreeMarker constructs:**

- `<#-- comment -->` is stripped.
- `<#-- @group <name> -->` headers tag every following script line with that group.
- `<#list a..b as i> ... ${i} ... </#list>` expands into one line per integer in the inclusive range.

**Example (the canonical Polygon shape from the docs):**

```
gen_small 1   0      1 > $
gen_small 2   10     1 > $
gen_small 5   1000   3 > $

<#-- @group big-tests -->
gen_big   1000   100000  0 > $
gen_big   100000 1000000 3 > $

<#-- @group multi -->
gen_pair 4 7 > {1-3,7}
```

The last line invokes `gen_pair 4 7` once; `gen_pair` is expected to write `1`, `2`, `3`, and `7` files in the testset directory (Polyman renames them to `test1.txt`, `test2.txt`, `test3.txt`, `test7.txt` if they aren't already named that way).

---

#### Manual tests — `manualTests[]`

Manual tests live next to the testset under `manual/<testset>/m-<NN>[-label].in`, with an optional matching `m-<NN>[-label].out` reference answer:

```json
"manualTests": [
  {
    "input": "./manual/tests/m-01-sample.in",
    "output": "./manual/tests/m-01-sample.out",
    "index": 1,
    "group": "samples",
    "useInStatements": true,
    "points": 0
  }
]
```

**What Happens:**

1. Polyman reads the `input` file.
2. Copies it to `testsets/<testset-name>/test<index>.txt` (using the explicit `index`).
3. The script's `$` operator skips reserved indices, so manuals and generator tests coexist cleanly.
4. On `polyman remote push`, the input is uploaded as a manual test on Polygon with the supplied group / points / `useInStatements` metadata.

**When to Use:**

- Sample tests shown in the problem statement (`useInStatements: true`).
- Carefully crafted edge cases.
- Tests that are hard to generate programmatically.

The `output` field is optional and round-trips with Polygon. Locally, polyman still runs the `MA` solution to derive the canonical answer during `verify` — the `.out` file is bookkeeping that survives cleanly across `pull`/`push`.

---

#### Test Numbering and Indexing

Indices are explicit and Polygon-faithful. Whatever you write after `>` is the test number. `$` resolves to the smallest positive integer not already claimed.

```
<#-- @group main -->
gen 100 > $       # → test1.txt   ($ picked 1)
gen 200 > $       # → test2.txt   ($ picked 2)
gen 999 > 50      # → test50.txt  (explicit)
gen 333 > $       # → test3.txt   ($ skips 50, picks the smallest open slot)
```

Combined with `manualTests`:

```json
"manualTests": [
  { "input": "./manual/tests/m-01.in", "index": 1 },
  { "input": "./manual/tests/m-02.in", "index": 2 }
]
```

```
gen 1 > $   # → test3.txt  (1 and 2 are taken by manuals)
gen 2 > $   # → test4.txt
```

---

#### Practical Examples

**Example 1: Simple Problem (No Groups)**

```json
{
  "testsets": [{
    "name": "tests",
    "generatorScript": {
      "script": "<#list 1..50 as i>\ngen ${i} > $\n</#list>"
    },
    "manualTests": [
      { "input": "./manual/tests/m-01-sample.in", "index": 1 },
      { "input": "./manual/tests/m-02-sample.in", "index": 2 }
    ]
  }]
}
```

**Result:** 52 tests (2 manual + 50 generated).

---

**Example 2: Standard Problem (With Groups)**

```json
{
  "testsets": [{
    "name": "tests",
    "groupsEnabled": true,
    "groups": [{ "name": "samples" }, { "name": "main" }, { "name": "edge" }],
    "generatorScript": {
      "scriptFile": "./generators/gen-script.txt"
    },
    "manualTests": [
      { "input": "./manual/tests/m-01-sample.in", "index": 1,
        "group": "samples", "useInStatements": true },
      { "input": "./manual/tests/m-02-sample.in", "index": 2,
        "group": "samples", "useInStatements": true }
    ]
  }]
}
```

```
# generators/gen-script.txt
<#-- @group main -->
<#list 1..91 as i>
gen-random ${i} > $
</#list>

<#-- @group edge -->
gen-edge tiny > $
gen-edge huge > $
```

**Result:** 95 tests — 2 samples (manual), 91 main, 2 edge.

---

#### Important Notes and Best Practices

**✅ Do's:**

1. **Always include sample tests** — manual entries with `group: "samples"` and `useInStatements: true`.
2. **Use meaningful group names** — `samples`, `edge-cases`, `stress` beats `group1`.
3. **Order tests logically** in the script — small to large reads better in the Polygon UI.
4. **Validate after generating**:
   ```bash
   polyman generate --testset tests
   polyman validate --all
   ```
5. **Use `<#list>` for many similar tests** — one block instead of 100 lines.

**❌ Don'ts:**

1. **Don't put generator extensions in the script** — `gen.exe 1 > $` is rejected. Use `gen 1 > $`.
2. **Don't reuse an index across script + manuals** — duplicates are an error.
3. **Don't put manual entries inside the script** — they belong in `manualTests[]`. The script is uploaded verbatim to Polygon, which already handles manual tests through a separate channel.
4. **Don't reference an undefined group** without adding it to `groups[]`.

**⚠️ Common Mistakes:**

```
# ❌ Wrong: extension in generator name
gen.exe 1 > $

# ✅ Correct
gen 1 > $

# ❌ Wrong: same index claimed twice
gen 1 > 5
gen 2 > 5

# ✅ Correct
gen 1 > 5
gen 2 > 6
# or
gen 1 > $
gen 2 > $
```

---

#### Testing Your Testset Configuration

After configuring testsets, verify everything works:

```bash
# 1. Generate tests
polyman generate --all

# 2. Check generated files
ls testsets/tests/

# 3. Validate tests
polyman validate --all

# 4. Run main solution
polyman run main --all

# 5. Full verification
polyman verify
```

**Expected Output Structure:**

```
testsets/
└── tests/              # Testset name
    ├── test1.txt       # First test (manual or generated)
    ├── test2.txt       # Second test
    ├── test3.txt       # And so on...
    └── test100.txt     # Last test
```

---

## Writing Validators

### Purpose

Validators ensure that test inputs conform to problem constraints.

### Basic Structure

```cpp
#include "testlib.h"

int main(int argc, char* argv[]) {
    registerValidation(argc, argv);

    // Read and validate input
    int n = inf.readInt(1, 100000, "n");
    inf.readSpace();
    int m = inf.readInt(1, 100000, "m");
    inf.readEoln();

    // Read array
    for (int i = 0; i < n; i++) {
        inf.readInt(1, 1000000000, "a[i]");
        if (i < n - 1)
            inf.readSpace();
    }
    inf.readEoln();

    // Ensure end of file
    inf.readEof();

    return 0;
}
```

### Common Validation Functions

| Function                     | Description                  | Example                    |
| ---------------------------- | ---------------------------- | -------------------------- |
| `readInt(min, max, name)`    | Read integer in range        | `readInt(1, 1e9, "n")`     |
| `readLong(min, max, name)`   | Read long long in range      | `readLong(1LL, 1e18, "x")` |
| `readDouble(min, max, name)` | Read double in range         | `readDouble(0, 1, "p")`    |
| `readString(name)`           | Read string (non-whitespace) | `readString("s")`          |
| `readToken(name)`            | Read token                   | `readToken("word")`        |
| `readLine(name)`             | Read entire line             | `readLine("text")`         |
| `readSpace()`                | Expect single space          | `readSpace()`              |
| `readSpaces()`               | Read one or more spaces      | `readSpaces()`             |
| `readEoln()`                 | Expect end of line           | `readEoln()`               |
| `readEof()`                  | Expect end of file           | `readEof()`                |

### Validator Self-Tests

Create `validator_tests.json`:

```json
[
  {
    "index": 1,
    "input": "5 3\n1 2 3 4 5\n",
    "expectedVerdict": "VALID"
  },
  {
    "index": 2,
    "input": "0 5\n",
    "expectedVerdict": "INVALID"
  },
  {
    "index": 3,
    "input": "5 3\n1 2 3 4 5 6\n",
    "expectedVerdict": "INVALID"
  }
]
```

**Why INVALID self-tests matter:** every test generated for the problem is checked with `VALID`-style input, so a validator that accepts everything (for example one that reads to EOF and returns) passes all of them. Only an INVALID self-test, an input the validator must reject, proves it rejects anything. `polyman verify` prints a warning, and lists it under `warnings` in the `--json` report, when the validator has no self-test with the `INVALID` verdict. It is a warning, not a failure: verification still passes.

### Do's and Don'ts

**✅ Do's:**

1. **Validate all constraints** mentioned in the problem statement
2. **Check format exactly** (spaces, newLines, EOF)
3. **Use meaningful variable names** in validation messages
4. **End with `readEof()`** to ensure no extra data
5. **Test validator** with both valid and invalid inputs
6. **Use strict validation** for interactive problems

**❌ Don'ts:**

1. **Don't skip validation** of any constraint
2. **Don't allow extra whitespace** unless problem allows it
3. **Don't validate output** in validator (that's checker's job)
4. **Don't use `scanf/cin`** - always use testlib functions
5. **Don't forget** to validate relationships between variables
6. **Don't allow** trailing spaces or lines unless specified

### Advanced Example

```cpp
#include "testlib.h"
#include <vector>

int main(int argc, char* argv[]) {
    registerValidation(argc, argv);

    int n = inf.readInt(1, 100000, "n");
    inf.readEoln();

    // Read and validate a tree
    std::vector<int> parent(n);
    for (int i = 1; i < n; i++) {
        parent[i] = inf.readInt(1, i, "parent[i]");
        if (i < n - 1)
            inf.readSpace();
    }
    inf.readEoln();

    // Validate no cycles (tree property)
    ensure(parent[0] == 0 || n == 1);

    inf.readEof();
    return 0;
}
```

---

## Writing Checkers

### Purpose

Checkers compare contestant output with jury answer and determine verdict.

### Basic Structure

```cpp
#include "testlib.h"

int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);

    // Read jury answer
    int jans = ans.readInt();

    // Read contestant output
    int pans = ouf.readInt();

    // Compare
    if (jans == pans) {
        quitf(_ok, "Correct answer: %d", jans);
    } else {
        quitf(_wa, "Wrong answer: expected %d, found %d", jans, pans);
    }
}
```

### Checker Streams

- **`inf`**: Input file (test input)
- **`ans`**: Answer file (jury's output)
- **`ouf`**: Output file (contestant's output)

### Checker Verdicts

```cpp
quitf(_ok, "message");              // Accepted
quitf(_wa, "message");              // Wrong Answer
quitf(_pe, "message");              // Presentation Error
quitf(_fail, "message");            // Checker failed
```

### Checker Self-Tests

Create `checker_tests.json`:

```json
[
  {
    "index": 1,
    "input": "5 3\n",
    "output": "8\n",
    "answer": "8\n",
    "expectedVerdict": "OK"
  },
  {
    "index": 2,
    "input": "5 3\n",
    "output": "7\n",
    "answer": "8\n",
    "expectedVerdict": "WRONG_ANSWER"
  },
  {
    "index": 3,
    "input": "5 3\n",
    "output": "  8  \n",
    "answer": "8\n",
    "expectedVerdict": "PRESENTATION_ERROR"
  }
]
```

### Do's and Don'ts

**✅ Do's:**

1. **Use standard checkers** when possible (`wcmp` for most problems)
2. **Read from correct streams** (inf, ans, ouf)
3. **Provide helpful messages** in quitf
4. **Handle edge cases** (empty output, extra whitespace)
5. **Test checker** with various outputs
6. **Be lenient with formatting** unless problem requires strict format

**❌ Don'ts:**

1. **Don't use `_fail`** for contestant errors (use `_wa` or `_pe`)
2. **Don't read from wrong streams**
3. **Don't crash** on invalid output (handle gracefully)
4. **Don't compare floating-point** with `==` (use epsilon)
5. **Don't forget** to test checker self-tests

### Floating-Point Checker Example

```cpp
#include "testlib.h"

int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);

    double jans = ans.readDouble();
    double pans = ouf.readDouble();

    const double EPS = 1e-6;

    if (abs(jans - pans) < EPS) {
        quitf(_ok, "Correct: %.6f", pans);
    } else {
        quitf(_wa, "Wrong: expected %.6f, found %.6f", jans, pans);
    }
}
```

### Multiple Answer Checker Example

```cpp
#include "testlib.h"
#include <set>

int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);

    int n = inf.readInt();

    // Read all possible jury answers
    std::set<int> validAnswers;
    while (!ans.seekEof()) {
        validAnswers.insert(ans.readInt());
    }

    // Read contestant answer
    int pans = ouf.readInt();

    if (validAnswers.count(pans)) {
        quitf(_ok, "One of valid answers");
    } else {
        quitf(_wa, "Invalid answer: %d", pans);
    }
}
```

---

## Writing Generators

### Purpose

Generators create test inputs programmatically.

### Basic Structure

```cpp
#include "testlib.h"
#include <iostream>

int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);

    // Read parameters
    int n = atoi(argv[1]);

    // Generate test
    std::cout << n << " " << rnd.next(1, n) << std::endl;

    for (int i = 0; i < n; i++) {
        std::cout << rnd.next(1, 1000000);
        if (i < n - 1) std::cout << " ";
    }
    std::cout << std::endl;

    return 0;
}
```

### Random Functions

| Function          | Description                | Example               |
| ----------------- | -------------------------- | --------------------- |
| `rnd.next(n)`     | Random int in [0, n)       | `rnd.next(10)` → 0..9 |
| `rnd.next(l, r)`  | Random int in [l, r]       | `rnd.next(1, 100)`    |
| `rnd.next(l, r)`  | Random long long           | `rnd.next(1LL, 1e18)` |
| `rnd.next(s)`     | Random element from string | `rnd.next("abc")`     |
| `rnd.wnext(n, w)` | Weighted random [0, n)     | `rnd.wnext(100, 3)`   |

### Do's and Don'ts

**✅ Do's:**

1. **Use command-line arguments** for test parameters
2. **Ensure deterministic generation** (same args → same test)
3. **Generate valid inputs** according to constraints
4. **Use meaningful parameters** (n, maxValue, etc.)
5. **Test generator outputs** with validator
6. **Document generator parameters** in comments

**❌ Don'ts:**

1. **Don't use `rand()`** - use testlib's `rnd`
2. **Don't generate invalid tests**
3. **Don't ignore command-line arguments**
4. **Don't exceed memory/time** during generation
5. **Don't forget edge cases** (min/max values)

### Advanced Example

```cpp
#include "testlib.h"
#include <iostream>
#include <vector>
#include <algorithm>

int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);

    int n = atoi(argv[1]);  // Number of nodes

    // Generate random tree
    std::cout << n << std::endl;

    for (int i = 2; i <= n; i++) {
        int parent = rnd.next(1, i - 1);
        std::cout << parent;
        if (i < n) std::cout << " ";
    }
    std::cout << std::endl;

    return 0;
}
```

---

## Writing Solutions

### Main Correct Solution (MA)

Your main solution should be:

- **Correct**: Solves all possible inputs
- **Efficient**: Runs within time/memory limits
- **Clean**: Well-commented and readable

```cpp
#include <iostream>
using namespace std;

int main() {
    int n, m;
    cin >> n >> m;

    // Your algorithm here
    cout << n + m << endl;

    return 0;
}
```

### Other Solution Types

**Wrong Answer (WA):**

```cpp
// Intentionally wrong algorithm
int result = n * m;  // Should be n + m
cout << result << endl;
```

**Time Limit (TL):**

```python
# Intentionally slow algorithm
n, m = map(int, input().split())
result = 0
for i in range(n * m):  # O(n*m) when O(1) is possible
    result += 1
print(result)
```

### Do's and Don'ts

**✅ Do's:**

1. **Test main solution** thoroughly
2. **Verify WA solutions** actually get WA (or PE)
3. **Verify TL solutions** actually TLE
4. **Use appropriate language** for each solution type
5. **Include alternative correct solutions** if possible

**❌ Don'ts:**


1. **Don't have bugs** in MA solution
2. **Don't make TL solution** too slow (should TLE, not timeout forever)
3. **Don't make WA solution** accidentally correct
4. **Don't forget** to test solutions against each other
5. **On naming solutions**: Do not use the same filenames with different extensions, polygon refuses it, so use acc.cpp, acc2.java, NOT acc.cpp, acc.java.
---

## Test Generation

### Generation Workflow

```bash
# 1. Compile generators
polyman generate --testset tests

# 2. Validate generated tests
polyman validate --all

# 3. Run main solution
polyman run main --all
```

### Manual Tests

Create manual test files in `tests/manual/`:

```
manual/tests/
├── m-01-sample.in
├── m-02-sample.in
└── m-03-edge.in
```

Reference in Config.json:

```json
"manualTests": [
  { "input": "./manual/tests/m-01-sample.in", "index": 1,
    "group": "samples", "useInStatements": true }
]
```

### Generated Tests

Use the Polygon-format script. A single explicit call:

```
gen-random 42 > $
```

A loop (FreeMarker `<#list>`):

```
<#list 1..10 as i>
gen-random ${i} > $
</#list>
```

### Test Organization

**Best Practice Structure:**

```json
{
  "groups": [
    {
      "name": "samples" // 1-3 tests
    },
    {
      "name": "small" // Small inputs for debugging
    },
    {
      "name": "main" // Main test cases
    },
    {
      "name": "edge" // Edge cases (min/max values)
    },
    {
      "name": "stress" // Large random tests
    }
  ]
}
```

---

## CLI Commands Reference

This section explains all available Polyman commands and what happens when you run them.

---

### Problem Creation

#### `polyman new <directory>`

Creates a new problem template in the specified directory.

**Usage:**

```bash
polyman new my-problem
```

Creates a new problem directory mirroring `template/` — see [Directory Structure](#directory-structure).

---

#### `polyman download-testlib`

Downloads the latest testlib.h from GitHub.

**Usage:**

```bash
polyman download-testlib
```

**What Happens:**

1. Downloads the latest `testlib.h` from https://github.com/MikeMirzayanov/testlib
2. Saves it to the current directory and prints instructions for system-wide install

**Note:** Required for compiling validators, checkers, and generators.

**Note:** If `testlib.h` already exists in the current directory and is different from the upstream one (line endings aside), it is not replaced and the command exits 2. It may be the `testlib.h` that `remote pull` downloaded from Polygon, and the problem should be built with that one. Delete it first if you want the upstream version.

---

### List Commands

#### `polyman list checkers`

Lists all available standard checkers from testlib (name, description, use case).

```bash
polyman list checkers
```

---

#### `polyman list testsets`

Lists all testsets defined in `Config.json` with their test counts and groups.

```bash
polyman list testsets
```

---

#### `polyman list solutions`

Lists all solutions defined in `Config.json` with names, tags, and source files.

```bash
polyman list solutions
```

---

#### `polyman list generators`

Lists all generators defined in `Config.json` with names and source files.

```bash
polyman list generators
```

---

### Test Management

#### `polyman generate`

Generates tests by executing the `generatorScript` commands for each testset.

**Usage:**

```bash
polyman generate --all                                    # All testsets
polyman generate --testset tests                          # One testset only
polyman generate --testset tests --group samples          # Just one group
polyman generate --testset tests --index 5                # Single test by command index
polyman generate --all --json > generate.json             # JSON report on stdout
```

**What Happens:**

1. Compiles any generators required by the matching commands
2. Runs each `manual` (copy) or `generator` (execute over `range`) command and writes outputs to `testsets/<testset-name>/test<N>.txt`

The `--testset`, `--group`, and `--index` flags successively narrow which commands are executed.

**`--json`:** stdout carries exactly one JSON document and every human-readable line goes to stderr. Each test is listed with where its input came from and whether it was written:

```json
{
  "schemaVersion": 1,
  "polymanVersion": "3.1.0",
  "ok": false,
  "command": "generate",
  "exitCode": 1,
  "durationMs": 912,
  "errors": ["Some tests failed to generate"],
  "tests": [
    { "testset": "tests", "index": 1, "source": "manual", "ok": true },
    { "testset": "tests", "index": 2, "source": "generator", "generator": "gen-random", "args": ["10"], "ok": false, "error": "Generator execution failed" }
  ]
}
```

`generator` and `args` are present only for generated tests, and `error` only when `ok` is false. `exitCode` is the code the process exits with.

---

### Validation

#### `polyman validate`

Validates generated tests by piping each test file through the compiled validator.

**Usage:**

```bash
polyman validate --all                                    # All tests in all testsets
polyman validate --testset tests                          # One testset
polyman validate --testset tests --group samples          # One group
polyman validate --testset tests --index 5                # One test
polyman validate --all --json > validate.json             # JSON report on stdout
```

**What Happens:**

1. Compiles the validator
2. Runs `./val < test<N>.txt` for each selected test and reports VALID / INVALID with error details

If tests fail: check validator constraints, fix the generator, or correct manual test files.

**`--json`:** stdout carries exactly one JSON document and every human-readable line goes to stderr. Each test is listed as valid or not, with the validator message:

```json
{
  "schemaVersion": 1,
  "polymanVersion": "3.1.0",
  "ok": false,
  "command": "validate",
  "exitCode": 1,
  "durationMs": 140,
  "errors": ["Some tests failed validation"],
  "tests": [
    { "testset": "tests", "index": 1, "valid": true, "message": "" },
    { "testset": "tests", "index": 2, "valid": false, "message": "FAIL Integer parameter [name=n] equals to 0, violates the range [1, 1000] (test case 1, stdin, line 1)" }
  ]
}
```

`group` is present only with `--group`. `message` is empty for a valid test.

---

### Solution Execution

#### `polyman run <name>`

Runs a solution on selected tests and checks outputs against the main solution's answers.

**Usage:**

```bash
polyman run main --all                                    # All testsets
polyman run main --testset tests                          # One testset
polyman run main --testset tests --group samples          # One group
polyman run main --testset tests --index 5                # One test
polyman run main --all --json > run.json                  # JSON report on stdout
```

**What Happens:**

1. Compiles the solution (C++: g++/clang, Java: javac, Python: none) and the checker
2. Runs the solution against each selected test, measuring time and detecting TLE/MLE/crashes
3. Invokes the checker against the main solution's answers and reports per-test verdicts plus a summary

**`--json`:** stdout carries exactly one JSON document and every human-readable line goes to stderr, so the output can be piped straight into a parser. The exit code is unchanged. Shape:

```json
{
  "schemaVersion": 1,
  "polymanVersion": "3.0.0",
  "command": "run",
  "ok": true,
  "solution": "main",
  "tag": "MA",
  "tests": [
    { "testset": "tests", "index": 1, "verdict": "OK", "timeMs": 4, "message": "" },
    { "testset": "tests", "index": 2, "verdict": "TLE", "timeMs": 1003, "message": "Time Limit Exceeded after 1000ms" }
  ],
  "summary": { "total": 2, "byVerdict": { "OK": 1, "TLE": 1 } },
  "errors": []
}
```

`verdict` is `OK` (ran to completion; `run` does not invoke the checker), `TLE`, `MLE`, or `RTE`. `tests` lists only the tests that were executed: polyman stops a solution at its first failing test in a testset. `group` is present only with `--group`; `tests[].solution` is present only for `polyman run all`. `ok` reflects whether the command itself completed, not the verdicts, and `errors` is non-empty only when `ok` is false.

---

### Testing Components

#### `polyman test validator`

Runs the validator against its self-tests in `validator/validator_tests.json`.

**Usage:**

```bash
polyman test validator
```

**What Happens:**

1. Compiles the validator
2. For each self-test, runs `./val` on the input and compares the actual verdict to the expected one; prints PASS/FAIL summary

---

#### `polyman test checker`

Runs the checker against its self-tests in `checker/checker_tests.json`.

**Usage:**

```bash
polyman test checker
```

**What Happens:**

1. Compiles the checker
2. For each self-test, runs `./checker input answer output` and compares the actual verdict to the expected one

---

#### `polyman test <solution-name>`

Tests a solution against the main correct solution and verifies it matches its declared tag (WA/TL/RE/ML/OK).

**Usage:**

```bash
polyman test wa-solution
```

**What Happens:**

1. Generates tests if needed, runs the main solution to get jury answers, then runs the target solution
2. Uses the checker to compare outputs and confirms the target solution behaves as its tag advertises (e.g., a `WA`-tagged solution passes when it gets WA or PE on at least one test, as on Polygon)
3. If the main solution prints nothing on every test while the target solution prints output on some test, it stops with an error that names the main solution. This is usually a build or flag problem (for example `freopen` under `#ifndef ONLINE_JUDGE`). The main output is the answer for the checker, so it would only show up as a wrong verdict on the other solution. An empty answer on some tests is fine, those tests go to the checker as usual. `verify` does the same check

**Use Case:** Verify that WA/TL/RE solutions actually fail as expected.

---

#### `polyman test ... --json`

All three forms accept `--json`. Like `run --json`, stdout carries exactly one JSON document and the human output goes to stderr. `exitCode` in the report is the exit code of the process.

`test validator --json` and `test checker --json` give one entry per self-test:

```json
{
  "schemaVersion": 1,
  "polymanVersion": "3.1.0",
  "ok": false,
  "command": "test checker",
  "exitCode": 1,
  "durationMs": 1591,
  "errors": ["Some checker tests failed"],
  "target": "checker",
  "cases": [
    { "index": 1, "expected": "OK", "actual": "OK", "ok": true, "message": "ok answer is YES" },
    { "index": 2, "expected": "WRONG_ANSWER", "actual": "OK", "ok": false, "message": "Expected WA but got OK" }
  ]
}
```

`index` is the position of the case in the tests file. The checker short forms `WA` and `PE` are written as `WRONG_ANSWER` and `PRESENTATION_ERROR`. `actual` is `ERROR` when the program could not run at all. A checker case has `exitCode`, the exit code the checker returned, only when `actual` is `null` (other cases have no `exitCode`). For a checker, `actual` is `OK` for exit code 0, `WRONG_ANSWER` for 1, `PRESENTATION_ERROR` for 2 and `CRASHED` for a crash code (3, a signal exit of 128 and up, or an `exit(N)` with N in 6 or 9 to 15). For the other testlib exit codes (4, 5, 7, 8 and 16 to 127) `actual` is `null`, so a self-test that expects `CRASHED` and gets, say, exit code 4 reports `"actual": null, "exitCode": 4, "ok": false`. `cases` is empty when the self-tests are skipped (standard checker, or no `testsFilePath`).

`test <solution> --json` gives the `run` report of that solution, with each verdict judged by the checker against the main solution, plus `mainSolution`, `matchesTag` and `reason`:

```json
{
  "command": "test",
  "ok": true,
  "exitCode": 0,
  "solution": "tle_solution",
  "tag": "TL",
  "mainSolution": "main",
  "matchesTag": true,
  "reason": "Behaves as expected",
  "tests": [
    { "testset": "tests", "index": 1, "verdict": "TLE", "timeMs": 1002, "message": "Time Limit Exceeded after 1000ms" }
  ],
  "summary": { "total": 1, "byVerdict": { "TLE": 1 } },
  "errors": []
}
```

---

### Full Verification

#### `polyman verify`

Runs complete problem verification workflow.

**Usage:**

```bash
polyman verify
polyman verify --json > verify.json     # JSON report on stdout, human log on stderr
```

**`--json`:** writes exactly one JSON document to stdout on every code path, including compile failures and validator self-test failures, and moves all human-readable output to stderr. The exit code is unchanged (0 only when every step passed). Shape:

```json
{
  "schemaVersion": 1,
  "polymanVersion": "3.0.0",
  "command": "verify",
  "ok": false,
  "failedStep": "test-validator",
  "steps": [
    { "name": "read-config", "ok": true, "errors": [] },
    { "name": "compile-generators", "ok": true, "errors": [] },
    { "name": "generate-tests", "ok": true, "errors": [] },
    { "name": "compile-validator", "ok": true, "errors": [] },
    {
      "name": "test-validator",
      "ok": false,
      "errors": [
        "✖ Validator Test 1 failed:\n\tFAIL Expected EOLN (test case 1, stdin, line 1)\n expected to be VALID",
        "Some validator tests failed"
      ]
    }
  ],
  "warnings": [],
  "solutions": []
}
```

Step names, in pipeline order: `read-config`, `compile-generators`, `generate-tests`, `compile-validator`, `test-validator`, `validate-tests`, `compile-checker`, `test-checker`, `compile-solutions`, `run-solutions`, `verify-solutions`. `failedStep` names the first failing step (null on success) and later steps are absent because verify stops there. `steps[].errors` holds the error lines printed during a failed step and is empty for steps that passed. `warnings` lists non-fatal findings as plain strings and is empty when there are none; a warning never changes `ok` or the exit code. Currently the only warning is "the validator has no INVALID self-tests, so nothing checks that it rejects bad input".

On success `solutions[]` has one entry per solution that ran:

```json
{
  "name": "wa",
  "tag": "WA",
  "matchesTag": true,
  "reason": "Behaves as expected",
  "tests": [
    { "testset": "tests", "index": 1, "verdict": "OK", "timeMs": 3, "message": "" },
    { "testset": "tests", "index": 2, "verdict": "WA", "timeMs": 3, "message": "wrong answer expected 3 found 4" }
  ]
}
```

`matchesTag` is the tag-conformance verdict and `reason` explains it. Per-test verdicts are `OK`, `WA`, `PE`, `TLE`, `MLE`, `RTE`; `WA` and `PE` are assigned by the checker in the comparison step. A solution that ran but was never compared (verification stopped first) is reported with `matchesTag: false` and the reason `Not evaluated: verification stopped before comparison`.

**What Happens:**

This is the **most comprehensive command**. It runs all steps in order:

1. **Step 1: Validate Configuration**
   - Checks Config.json is valid
   - Verifies all required files exist
   - Validates testset structure

2. **Step 2: Compile Generators**
   - Compiles all generators defined in Config.json
   - Reports compilation errors if any

3. **Step 3: Generate All Tests**
   - Runs `generate all` internally
   - Creates all test files for all testsets

4. **Step 4: Compile Validator**
   - Compiles validator source code
   - Reports errors if compilation fails

5. **Step 5: Test Validator**
   - Runs validator self-tests from validator_tests.json
   - Ensures validator works correctly

6. **Step 6: Validate All Tests**
   - Runs validator on all generated tests
   - Ensures all tests are valid inputs

7. **Step 7: Compile Checker**
   - Compiles checker source code
   - Reports errors if compilation fails

8. **Step 8: Test Checker**
   - Runs checker self-tests from checker_tests.json
   - Ensures checker works correctly

9. **Step 9: Compile All Solutions**
   - Compiles every solution in Config.json
   - Reports which solutions compiled successfully

10. **Step 10: Run All Solutions**
    - Runs each solution on all tests
    - Checks outputs with the checker
    - Verifies solutions behave according to their tags

11. **Step 11: Verify Solution Behaviors**
    - Confirms MA solution passes all tests
    - Confirms WA solutions get WA or PE on some tests
    - Confirms TL solutions get TL on some tests
    - Confirms other solution tags match behavior

12. **Final Report:**
    - ✓ All tests valid
    - ✓ All solutions behave correctly
    - ✗ Any issues found

**Example Output:**

```
=== Full Problem Verification ===

✓ Step 1: Validating configuration
✓ Step 2: Compiling generators
  Compiled gen-random.cpp
✓ Step 3: Generating all tests
  Generated 52 tests for testset 'tests'
✓ Step 4: Compiling validator
✓ Step 5: Testing validator
  3/3 validator tests passed
✓ Step 6: Validating all tests
  52/52 tests valid
✓ Step 7: Compiling checker
✓ Step 8: Testing checker
  3/3 checker tests passed
✓ Step 9: Compiling all solutions
  Compiled: main (C++)
  Compiled: wa-solution (C++)
  Compiled: tle-solution (Python)
✓ Step 10: Running all solutions
  main: 52/52 passed (tag: MA) ✓
  wa-solution: 45/52 passed, 7 WA (tag: WA) ✓
  tle-solution: 12/52 passed, 40 TLE (tag: TL) ✓
✓ Step 11: Verifying solution behaviors
  All solutions behave as expected

=== Verification Complete ===
✓ Problem is ready for use!
```

**When to Use:**

- Before submitting to Polygon
- After making major changes
- To ensure everything works together
- As a final check before contests

**What to Do if It Fails:**

- Read error messages carefully
- Fix the failing step
- Run `verify` again
- Repeat until all steps pass

---

### Command Execution Summary

| Command            | Compiles          | Generates | Validates  | Runs Solutions | Checks Behavior |
| ------------------ | ----------------- | --------- | ---------- | -------------- | --------------- |
| `new`              | -                 | Template  | -          | -              | -               |
| `download-testlib` | -                 | -         | -          | -              | -               |
| `generate --all`   | Generators        | ✓         | -          | -              | -               |
| `validate --all`   | Validator         | -         | ✓          | -              | -               |
| `run`              | Solution, Checker | -         | -          | ✓              | -               |
| `test validator`   | Validator         | -         | Self-tests | -              | -               |
| `test checker`     | Checker           | -         | Self-tests | -              | -               |
| `test <solution>`  | All               | ✓         | -          | ✓              | ✓               |
| `verify`           | All               | ✓         | ✓          | ✓              | ✓               |

---

### Compilation Cache

Compiling testlib-based C++ takes seconds per file, and most runs recompile sources that have not changed. Polyman therefore caches every C++ binary it builds in `.polyman/cache/compiled/` inside the problem directory.

**When a source is recompiled.** Each cached binary is keyed by a SHA-256 over:

- the source file's contents,
- the contents of every local header it reaches through `#include "..."`, followed recursively (`testlib.h`, your own helpers),
- the compile flags (`-O2`, `-std=<cppStandard>`, `-DONLINE_JUDGE` for solutions and `compiler.flags`),
- the compiler executable (`POLYMAN_CXX`, `compiler.cpp` or `g++`) and its `--version` output.

If any of these change, the source is recompiled; otherwise the cached binary is copied into place and the compiler does not run. A cached binary whose checksum no longer matches is discarded and rebuilt. `verify` prints how much compile time the cache saved:

```
  ⚡ Compile cache: 6 hits, 1 miss · saved ~38.2s
```

**testlib is compiled once.** Most of a generator's, validator's or checker's compile time is spent on `testlib.h` itself. The first compile that needs it splits a copy of the problem's `testlib.h` into declarations and definitions, compiles the definitions once into `.polyman/cache/testlib/<key>/testlib.o`, and every testlib program then only parses the declarations and links that object (about 1s instead of 5s per program). The problem's `testlib.h` is never modified. A source compiles against the original header as before when it defines a macro or uses a pragma before `#include "testlib.h"` (testlib reads settings such as `EJUDGE` that way), keeps its own `testlib.h` next to it, is compiled with `--no-cache`, or fails to build against the split while it builds against the original.

**Precompiled `<bits/stdc++.h>`.** With g++, most of a solution's compile time is parsing `<bits/stdc++.h>`. When a source's first directive is `#include <bits/stdc++.h>`, polyman builds `bits/stdc++.h.gch` once and reuses it for every problem you compile with the same compiler and flags. It is stored in your user cache (`~/.cache/polyman/pch` on Linux, `~/Library/Caches/polyman/pch` on macOS, `%LOCALAPPDATA%\polyman\pch` on Windows; `POLYMAN_CACHE_DIR` moves it). Binaries and verdicts are the same with or without it. If a compile fails with the PCH, it is retried without it and reports the normal error.

- **Disk use.** Each `.gch` is about 140 MB. At most 2 are kept (different compilers, `cppStandard` or `compiler.flags` each need their own); the least recently used is removed when a third is built.
- **Not used** with clang or Apple's `g++`, with `--no-cache`, when `CPLUS_INCLUDE_PATH` is set, or for flags the compile cache does not accept.
- **A failed build** is retried after a day and after a polyman upgrade; until then compiles go on normally.
- **Turn it off** with `POLYMAN_PCH=0`, or delete the `pch` folder to free the space. `POLYMAN_DEBUG=1` logs which path each compile took.

**Managing the cache.**

```bash
polyman cache status      # list cached binaries, their size, and when they were last used
polyman cache clear       # delete the cache; the next run recompiles everything
polyman verify --no-cache # recompile everything this run, without reading or writing the cache
```

`--no-cache` is accepted by `generate`, `validate`, `run`, `test`, and `verify`.

Entries unused for 30 days are removed, and the cache is capped at 256 MB (least recently used entries go first). The cache lives with the problem, so it survives across sessions; add `.polyman/` to your `.gitignore`.

**Limitations.** Java solutions are not cached. Headers pulled in through angle brackets (`#include <...>`) are not tracked, so after editing such a header, run `polyman cache clear`. The compile cache is used only when every flag in `compiler.flags` is on a known-safe list: `-O...`, `-std=`, `-D`/`-U`, `-W...` (not `-Wl,`/`-Wp,`/`-Wa,`), `-w`, `-pedantic`, a named set of `-f` flags (`-fno-omit-frame-pointer`, `-fopenmp`, `-fstack-protector*`, `-ftrapv`, `-fwrapv`, `-fno-exceptions`, `-fno-rtti`, `-funroll-loops`, ...), `-fsanitize=`, `-g...`, `-m...`, `-static`, `-pthread`, `-pipe` and `-s`. Any other flag (for example `-I`, `-include`, `-L`, `-l`, `-specs=`, `-T`, object files or `@file`) can read files the cache does not hash, so that compile always runs the compiler in full.

### Terminal Colors

polyman has two color themes: one for dark terminals and one for white or light terminals. By default it picks the theme from the terminal background when it starts:

1. If `COLORFGBG` is set (some terminals like iTerm2, Konsole and rxvt set it), polyman reads the background color from it.
2. If not, polyman asks the terminal for its background color (the OSC 11 query). Most modern terminals answer in a few milliseconds. A terminal that does not support the query is detected at once, and polyman waits at most 100 ms for an answer.
3. If there is still no answer, polyman uses the dark theme.

Detection only runs in an interactive terminal. It is skipped when the output or the input is not a terminal (for example `polyman verify > log.txt` or in CI), when colors are off, when `TERM=dumb`, when polyman runs as a background job, and on Windows for now. In these cases polyman uses the dark theme.

Two environment variables change this:

- `POLYMAN_THEME=dark` or `POLYMAN_THEME=light` forces a theme and skips detection. Use it when detection picks the wrong theme. `POLYMAN_THEME=auto` (or no value) means detect. Any other value uses the dark theme.
- `NO_COLOR=1` (any non-empty value, see [no-color.org](https://no-color.org)) turns all colors off. This is useful for logs and CI.

```bash
POLYMAN_THEME=light polyman verify
NO_COLOR=1 polyman verify > verify.log
```

To always use one theme, add the line to your shell profile, for example `export POLYMAN_THEME=light` in `~/.bashrc` or `~/.zshrc`.

`NO_COLOR` wins over everything else: with `NO_COLOR=1`, polyman prints no colors even if `FORCE_COLOR` or `POLYMAN_THEME` is set. `FORCE_COLOR` only controls how many colors the terminal gets (16, 256 or true color); `POLYMAN_THEME` picks the palette inside that.

---

### Tips for Efficient Workflow

**Development Cycle:**

```bash
# 1. Create problem
polyman new my-problem
cd my-problem
polyman download-testlib

# 2. Write components (validator, checker, generators, solutions)
# ... edit files ...

# 3. Test individual components
polyman test validator
polyman test checker

# 4. Generate and validate tests
polyman generate --all
polyman validate --all

# 5. Test main solution
polyman run main --all

# 6. Test WA/TL solutions
polyman test wa-solution
polyman test tle-solution

# 7. Full verification before submission
polyman verify
```

**Quick Iteration:**

```bash
# After fixing a generator
polyman generate --testset tests --group small    # Regenerate just one group
polyman validate --testset tests --group small     # Validate just that group
polyman run main --testset tests --group small  # Test just that group
```

**Debugging:**

```bash
# Test single failing test
polyman generate --testset tests --index 5
polyman validate --testset tests --index 5
polyman run main --testset tests --index 5
```

---

### Running Without a Terminal

Every command can be run by another program (an agent, a CI job) with no terminal attached. Three rules hold for all of them:

- **No waiting for input.** When stdin is not a terminal, a command never prompts. If it needs an answer it stops with exit code `2` and names the flag to pass. Today only `polyman remote push` can ask: pass `--yes` to confirm creating a new Polygon problem and `--name <name>` to choose its name.
- **No colors when output is not for a person.** Colors are off when `NO_COLOR` is set to a non-empty value (see [no-color.org](https://no-color.org)), when stdout is not a terminal, and when `POLYMAN_AGENT=1`. This also overrides `FORCE_COLOR`.
- **`POLYMAN_AGENT=1`** is set by agent runners. It turns colors off and is the switch any spinner or line-redrawing progress bar must obey: in agent mode there are none, only plain lines. polyman prints no spinners or redrawing progress bars today.

```bash
# headless push of a new problem
POLYMAN_AGENT=1 polyman remote push . --yes --name two-sum < /dev/null

# plain output for a log file
NO_COLOR=1 polyman verify > verify.log 2>&1
```

The exit code tells a script what kind of failure happened, see [Exit Codes](#exit-codes).

### Exit Codes

Every command ends with one of these codes, so a script or an agent can decide what to do next without reading the output:

| Code  | Meaning | Examples | What to do |
| ----- | ------- | -------- | ---------- |
| `0`   | The command did what was asked | `verify` passed | Continue |
| `1`   | The command ran, but the problem is wrong | A test fails validation, a solution does not match its tag, a checker test fails, a compile error | Read the output (or the `--json` report) and fix the problem |
| `2`   | Usage error | No `Config.json` here or it is not valid JSON, an invalid `compiler` or `cppStandard`, `Config.json` names a file that does not exist, an unknown solution name, an invalid package type, a prompt was needed but stdin is not a terminal, `download-testlib` found a different `testlib.h` in the current directory | Fix the command or `Config.json` |
| `3`   | Environment error | Polygon credentials are not registered, Python 3 is not installed, Node.js is too old | Fix the machine, retrying will not help |
| `4`   | Remote error | A Polygon API call or the network failed, some items were not uploaded by `remote push`, `download-testlib` could not reach GitHub | Retry once, then look at the message |
| `130` | Cancelled | Ctrl+C (SIGINT) | Nothing, the user stopped it |
| `143` | Terminated | SIGTERM, for example a CI job that timed out | Nothing, the runner stopped it |

Any other failure, for example an error polyman did not expect, ends with `1`. The error message is printed last, on its own line, with a `Hint:` line under it when polyman knows the fix. With `--json`, the `exitCode` field of the `new`, `download-testlib`, `list`, `generate`, `validate`, `test` and `remote` reports is the same code.

```bash
polyman verify
case $? in
  0) echo "ready to push" ;;
  1) echo "the problem needs a fix" ;;
  2) echo "check the command or Config.json" ;;
  3) echo "check the machine setup" ;;
  4) echo "Polygon or the network failed, try again" ;;
esac
```

### AI Provider Keys

`polyman ai` saves API keys for AI model providers and picks a default model. [`polyman chat`](#chat-ai-agent) uses these settings.

| Command | What it does |
| ------- | ------------ |
| `polyman ai login <provider>` | Saves a key. It is read from a hidden prompt, or from stdin with `--key-stdin`, never from the command line, so it stays out of shell history. |
| `polyman ai logout <provider>` | Removes the saved key. |
| `polyman ai list` | Lists the providers, which have a key (shown masked) and the default model. |
| `polyman ai models [provider]` | Lists the known models of every provider, or of one, with context size, tool support and price where known. For `openrouter` the list is live: `--search <text>` filters it, `--refresh` skips the 24 hour cache. |
| `polyman ai use <provider>/<model>` | Sets the default model, for example `polyman ai use deepseek/deepseek-flash`. A model that is not in the known (or live) list is used as is, with a warning. Only the first `/` splits, so `openrouter/deepseek/deepseek-v3.2` works. |

```bash
polyman ai login deepseek
polyman ai login openai --key-stdin < key.txt
polyman ai login custom --base-url https://my-server/v1 --model my-model
```

**Providers:** `openai`, `anthropic`, `deepseek`, `qwen` (Alibaba Cloud Model Studio), `gemini`, `groq`, `mistral`, `openrouter`, `ollama` (local, needs no key) and `custom` (any OpenAI-compatible server; `--base-url` is required and `--model` can be repeated). `--base-url` and `--model` are only accepted for `custom`.

**Where keys are kept.** In `~/.polyman/ai.json`, written with mode `0600`. If polyman creates `~/.polyman`, it creates it with mode `0700`. If the folder already exists and other users can open it, polyman leaves it as it is (other tools may share it) and warns, for example: `/home/you/.polyman has mode 0755, so other users can open it. ai.json in it stays 0600. To make the folder private: chmod 700 /home/you/.polyman`.

**Environment variables win.** If a provider's variable is set (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `DASHSCOPE_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`), it is used instead of the saved key, and `login` and `logout` say so.

**Keys are never printed.** Output shows only the masked key, and known keys are removed from every error message. A key is only handed out for its own provider's base URL (or the base URL you gave for `custom`).

`polyman ai use` also warns when the provider has no key yet, when `custom` has no base URL yet, and when the model has no tool support. An unknown provider or a malformed `<provider>/<model>` exits with code `2`.

---

## Remote Operations (Polygon Integration)

Polyman provides comprehensive integration with Codeforces Polygon, allowing you to manage problems directly from the command line. You can pull problems from Polygon, push your local changes, and manage the entire problem lifecycle without leaving your terminal.

### Setup and Registration

Before using remote operations, you need to register your Polygon API credentials locally.

#### Getting Your API Credentials

1. Log in to [Codeforces Polygon](https://polygon.codeforces.com/)
2. Go to **Settings** → **API** tab
3. Generate a new API key if you don't have one
4. Copy your **API Key** and **API Secret**

#### Registering Credentials

```bash
polyman remote register <api-key> <api-secret>
```

**Example:**

```bash
polyman remote register 991d9b535452b525afe5e102dc04ac0ada65044v a5c7c2fc8f4087660edd1139f46c017376af839g
```

**What Happens:**

- Credentials are stored locally in your home directory
- Used automatically for all future remote commands
- Never committed to version control

**Security Note:** Keep your API credentials secure. Never share them or commit them to public repositories.

---

### Listing Problems

View all problems associated with your Polygon account.

#### List All Your Problems

```bash
polyman remote list
```

**What Happens:**

1. Connects to Polygon API
2. Fetches all problems you own or have access to
3. Displays problem information in a formatted table

#### Filter by Owner

```bash
polyman remote list --owner tourist
```

Lists only problems owned by the specified user.

---

### Pulling Problems

Download an existing problem from Polygon to your local machine.

#### Quick Note before you read on:

Any value spacifed by `<problem-id>` can be resolved normaly if you prodive the relative path to a folder containing a `Config.json` file with a valid problem ID. This way you can avoid looking up the problem ID on Polygon website.


#### Basic Pull

```bash
polyman remote pull <problem-id> <directory>
```

**Example:**

```bash
polyman remote pull 123456 ./my-problem
```

**What Happens:**

1. **Step 1:** Reads API credentials
2. **Step 2:** Initializes Polygon SDK
3. **Step 3:** Fetches problem information (time/memory limits, I/O files)
4. **Step 4:** Downloads all problem files:
   - **Solutions** (all languages)
   - **Checker** (with self-tests)
   - **Validator** (with self-tests)
   - **Generators** (all source files)
   - **Resource files** (testlib.h and headers the sources include), saved next to `Config.json`
   - **Statements** (all languages as .tex files)
   - **Tests** (manual tests only)
   - **Metadata** (description, tags)
5. **Step 5:** Creates local directory structure
6. **Step 6:** Generates `Config.json` with all settings
7. **Step 7:** Downloads tests for specified testsets. Without `-t`, only the testset named `tests` is downloaded, and the closing summary says so. Polygon's API cannot list a problem's testsets, so any other testset must be named with `-t a,b`.

Result: a complete problem directory matching the polyman layout (see [Directory Structure](#directory-structure)).

#### Selective Pull

Pull only specific components:

```bash
# Pull only solutions and checker
polyman remote pull 123456 ./my-problem -s -c

# Pull only tests
polyman remote pull 123456 ./my-problem -t

# Pull specific testsets
polyman remote pull 123456 ./my-problem -t samples,tests

# Pull everything (default)
polyman remote pull 123456 ./my-problem --all
```

**Note on resource files:** Polygon keeps files like `testlib.h` or a shared header under "Resource files". `pull` saves each of them in the problem folder, next to `Config.json`, where `download-testlib` puts `testlib.h` and where `#include "..."` finds them. So a problem that has its own `testlib.h` on Polygon is built locally with the same one. The summary lists them on a "Resource files" line, and with `--json` each one is a `resource` entry in `actions`. A resource file that fails to download fails the pull (see [JSON Output for Remote Commands](#json-output-for-remote-commands)). `polyman download-testlib` does not replace a `testlib.h` that is different from the upstream one, so a pulled `testlib.h` is kept. Delete it first if you want the upstream version.

**Note on testsets:** when `-t` is not given, `pull` downloads only the testset named `tests`. Its summary lists the testsets it downloaded and reminds you that others must be named with `-t a,b`, because Polygon's API cannot list a problem's testsets. For a problem with a second testset (for example `generate`), run `polyman remote pull 123456 ./my-problem -t tests,generate`.

**Available Options:**

| Option | Flag | Description |
|--------|------|-------------|
| All | `-a, --all` | Pull all components (default) |
| Solutions | `-s, --solutions` | Pull solution files |
| Checker | `-c, --checker` | Pull checker and tests |
| Validator | `-v, --validator` | Pull validator and tests |
| Generators | `-g, --generators` | Pull generator files |
| Statements | `-S, --statements` | Pull problem statements |
| Tests | `-t, --tests [names]` | Pull tests (optionally specify testsets) |
| Metadata | `-m, --metadata` | Pull description and tags |
| Info | `-i, --info` | Pull problem info (limits) |

---

### Pushing Problems

Upload your local problem changes to Polygon.

#### Basic Push

```bash
polyman remote push <directory>
```

**Example:**

```bash
polyman remote push ./my-problem
```

**What Happens:**

1. **Step 1:** Reads API credentials
2. **Step 2:** Initializes Polygon SDK
3. **Step 3:** Reads `Config.json` to get problem ID (`problemId`; if it is missing, push offers to create a new problem)
4. **Step 4:** Updates problem information (time/memory limits, I/O files)
5. **Step 5:** Uploads solutions with tags
6. **Step 6:** Uploads and sets checker
7. **Step 7:** Uploads and sets validator (with self-tests)
8. **Step 8:** Uploads generators
9. **Step 9:** Uploads statements (all languages)
10. **Step 10:** Uploads metadata (description, tags)
11. **Step 11:** Uploads testsets:
    - Clears existing tests
    - Enables groups if configured
    - Uploads manual tests in parallel
    - Uploads generation script
12. **Final:** Displays success message

**Important Notes:**

- Line endings are automatically normalized (Unix → Windows for Polygon)
- All files are uploaded in parallel for speed
- Existing tests are cleared before upload
- Changes are NOT automatically committed

#### Selective Push

Push only specific components:

```bash
# Push only solutions and checker
polyman remote push ./my-problem -s -c

# Push only tests
polyman remote push ./my-problem -t

# Push everything except tests
polyman remote push ./my-problem -s -c -v -g -S -m -i

# Push everything (default)
polyman remote push ./my-problem --all
```

**Available Options:**

| Option | Flag | Description |
|--------|------|-------------|
| All | `-a, --all` | Push all components (default) |
| Solutions | `-s, --solutions` | Push solution files |
| Checker | `-c, --checker` | Push checker and tests |
| Validator | `-v, --validator` | Push validator and tests |
| Generators | `-g, --generators` | Push generator files |
| Statements | `-S, --statements` | Push problem statements |
| Tests | `-t, --tests` | Push testsets and manual tests |
| Metadata | `-m, --metadata` | Push description and tags |
| Info | `-i, --info` | Update problem info (limits) |
| Yes | `-y, --yes` | Create a new Polygon problem without the confirmation prompt |
| Name | `-n, --name <slug>` | Slug for the new Polygon problem instead of prompting |

#### Creating the Polygon problem headlessly

When `Config.json` has no `problemId`, `push` creates the problem on Polygon first. In a terminal it asks for confirmation and, if `Config.json.name` is missing, invalid, or taken, for a slug. Without a terminal on stdin (CI, an AI agent, `< /dev/null`) it never blocks on a prompt: it exits 1 and names the flag to pass.

```bash
polyman remote push . --yes                     # confirm creation; slug comes from Config.json.name
polyman remote push . --yes --name two-sum      # confirm and set the slug explicitly
```

A `--name` that does not match `^[a-z0-9]+(-[a-z0-9]+)*$` or already exists on Polygon fails the push instead of re-prompting.

**⚠️ Important:**

- After pushing, you must **commit changes** on Polygon
- Use selective push to update specific parts without affecting others
- Always pull before pushing to avoid conflicts
- If you replace the problem ID with a directory path that Contains `Config.json` that has a valid problem ID, it will be used.

---

### Viewing Problem Details

View comprehensive information about a problem on Polygon.

```bash
polyman remote view <problem-id>
```

**Example:**

```bash
polyman remote view 123456
```

**What Happens:**

1. Fetches problem information from Polygon
2. Displays detailed problem overview

---

### Committing Changes

After pushing changes to Polygon, you must commit them to make them permanent.

```bash
polyman remote commit <problem-id> <message>
```

**Example:**

```bash
polyman remote commit 123456 "Updated test cases and fixed validator"
```

**Using Directory Path:**

```bash
polyman remote commit ./my-problem "Added edge case tests"
```

**What Happens:**

1. Reads problem ID from Config.json (if directory path is provided)
2. Commits all pending changes on Polygon
3. Creates a new revision with your commit message

**Best Practices:**

- Write descriptive commit messages
- Commit after each logical set of changes
- Verify changes work before committing
- Use semantic commit messages (e.g., "fix:", "feat:", "docs:")

---

### Building Packages

Build a problem package on Polygon for distribution or testing.

```bash
polyman remote package <problem-id> <type>
```

**Package Types:**

| Type | Description | Contents |
|------|-------------|----------|
| `standard` | Standard package | Windows executables, scripts for both platforms, NO generated tests |
| `linux` | Linux package | Generated tests, NO compiled binaries |
| `windows` | Windows package | Generated tests, Windows compiled binaries |
| `full` | Full package | All three types above |

Every build is verified (Polygon runs all solutions on all tests). `linux` and `windows` build a full package on Polygon, because Polygon only builds those packages as part of a full one; `standard` does not.

**Examples:**

```bash
# Build standard package
polyman remote package 123456 standard

# Build Linux package with tests
polyman remote package 123456 linux

# Build full package (all types)
polyman remote package 123456 full

# Using directory path
polyman remote package ./my-problem standard
```

**What Happens:**

1. **Step 1:** Reads API credentials
2. **Step 2:** Initializes Polygon SDK
3. **Step 3:** Gets problem ID
4. **Step 4:** Validates package type
5. **Step 5:** Triggers package build and polls for completion:
   - Gets current package count
   - Submits build request
   - Polls every 30 seconds
   - Detects when package is created
   - Waits for package to finish building (READY or FAILED)
   - Maximum wait time: 15 minutes (30 polls)
6. **Step 6:** Displays package information

**Important Notes:**

- Package building is **asynchronous** - it may take several minutes
- The command automatically waits and polls for completion
- Progress updates are shown on every 30-second poll
- The command does not download the package yet. Download it from the Polygon web interface once the build is READY
- Use `standard` type for most purposes
- Use `linux` or `full` when you need test files included

**Typical Build Times:**

- Simple problems: 1-3 minutes
- Complex problems with many tests: 5-10 minutes
- Full packages: 10-15 minutes

---

### JSON Output for Remote Commands

`remote pull`, `push`, `view`, `commit` and `package` accept `--json`. Same rule as `run` and `verify`: stdout carries exactly one JSON document, and every human line goes to stderr. The exit code is unchanged.

```bash
polyman remote push . --json > push.json
polyman remote commit . "Fix validator" --json
```

Shape:

```json
{
  "schemaVersion": 1,
  "polymanVersion": "3.1.0",
  "command": "remote push",
  "ok": false,
  "exitCode": 4,
  "durationMs": 5321,
  "errors": ["solution wa: Polygon API Error: ..."],
  "problemId": 123456,
  "actions": [
    { "component": "solution", "name": "main", "action": "upload", "ok": true },
    { "component": "solution", "name": "wa", "action": "upload", "ok": false, "error": "Polygon API Error: ..." }
  ],
  "warnings": []
}
```

- Each upload, download, fetch or change is one entry in `actions`. `error` is there only when `ok` is false.
- `exitCode` is the code the process exits with. A push where some items failed to upload exits 4.
- `problemId` is always in the report. For a push that creates the problem, it is the new ID. It is `null` only when the command failed before it knew the ID.
- `errors` is plain text. The API key and secret are replaced with `[REDACTED]` everywhere in the report.
- With `--json`, `push` never prompts. To create a new problem, pass `--yes` (and `--name <slug>` if needed), or it exits 2.
- `pull` lists the files it saved and each testset it tried.
- `warnings` lists what did not fail the command but needs a look. For `pull`, it has one line for each placeholder put in `Config.json` instead of a file: the `acc.cpp` main solution (no solution downloaded), the standard `ncmp` checker, the `val.cpp` validator (none on Polygon, or the download failed) and an empty generator list with no resource files (the file list could not be fetched). Placeholders alone keep `ok: true` and exit 0.
- A file that `pull` could not download fails it, like a failed upload fails `push`. The pull still writes every other file and `Config.json`, then ends with `ok: false` and exit 4. Each such file is an `ok: false` `download` entry in `actions`, and one line in `errors` with the reason:
  - a solution, a generator, a statement language, or all statements. `Config.json` does not list it;
  - a resource file (for example `testlib.h`). It is not written to the problem folder;
  - checker or validator tests. `Config.json` then has no `testsFilePath` for it, so its self-tests are skipped instead of pointing at a missing file;
  - the description or the tags. `Config.json` then has no `description` (or `tags`) key, not an empty value, so a later `remote push` leaves the one on Polygon as it is.

  The human output lists the same files under "PULL COMPLETED WITH ERRORS" and repeats the warnings at the end. A testset Polygon refused is an `ok: false` entry in `actions`, and a refused problem fetch fails the pull.

---

### Complete Workflow Example

```bash
# One-time setup
polyman remote register <your-api-key> <your-api-secret>
polyman remote list

# Pull, edit, verify, push, commit
polyman remote pull 123456 ./my-problem
cd my-problem
polyman download-testlib
# ... edit files ...
polyman verify
polyman remote push .            # or -sct for selective
polyman remote commit . "Updated solutions and added stress tests"

# Build a package
polyman remote package . standard
```

---

### Tips and Best Practices

#### Working with Remote Operations

**✅ Do's:**

1. **Test locally before pushing**
   ```bash
   polyman verify  # Always verify before pushing
   polyman remote push .
   ```

2. **Use selective push for quick updates**
   ```bash
   polyman remote push . -s   # Only updated solutions
   polyman remote push . -t   # Only updated tests
   ```

3. **Commit frequently with descriptive messages**
   ```bash
   polyman remote commit . "feat: Added worst-case generator"
   polyman remote commit . "fix: Corrected validator bounds"
   ```

**❌ Don'ts:**

1. **Don't push without testing** — always run `polyman verify` first.
2. **Don't forget to commit** — changes are not permanent until committed.
3. **Don't share API credentials** — keep them secure and out of version control.


---

For Polygon-specific errors see [Troubleshooting - Remote Operations](#remote-operations).

---

## Chat (AI agent)

`polyman chat` opens an AI agent in your terminal. You talk with it about a problem idea, it writes the spec with you, then it builds the problem with a team of small workers and checks every step with the polyman CLI. It can also fix a problem whose `verify` fails, add stronger tests, and push to Polygon when you say yes.

The chat is a **preview**. It works, but expect rough edges. See [Known limits](#known-limits).

What it is not:

- It is not a general coding agent. It has no shell and no internet tool. It can only read and write files inside the problem folder and run polyman commands.
- It does not decide if your problem is correct. The CLI does: `generate`, `validate`, `test`, `verify` and the compiler give every pass or fail, not the model.
- It does not change Polygon on its own. Every push, commit and package build asks you first.

### Quick Start

You need what polyman needs anyway (Node.js and `g++`), plus a key for a model provider. The default model is Gemma 4 on OpenRouter. Set up the key first, see [Providers, keys and models](#providers-keys-and-models), then start the chat.

### Providers, keys and models

You bring your own key. The chat works with any model of any provider in [AI Provider Keys](#ai-provider-keys), as long as the model supports tool calls. The easiest way is OpenRouter: one key gives you Gemma, DeepSeek, Qwen, Llama and hundreds more.

```bash
# 1- save the key (get one at https://openrouter.ai/keys), or set OPENROUTER_API_KEY
polyman ai login openrouter

# 2- find a model, the list is live from OpenRouter
polyman ai models openrouter --search deepseek

# 3- make it the default, or pass it for one chat only
polyman ai use openrouter/deepseek/deepseek-v3.2
polyman chat my-problem --model qwen/qwen3-coder
```

Without a default, the chat uses `google/gemma-4-31b-it` on OpenRouter.

**How the chat picks the provider and model.** The provider is `--provider`, else the `ai.json` default, else `openrouter`. The model is `--model`, else the `ai.json` model when it is for the same provider, else `google/gemma-4-31b-it` for OpenRouter, the first saved model for `custom`, or the first known model for the other providers. An unknown provider exits with code `2` and lists the known ones. A missing key exits with code `2` and says how to add it.

```bash
polyman chat my-problem --provider deepseek --model deepseek-flash
polyman chat my-problem --provider ollama --model qwen3:8b
```

**The live model list.** `polyman ai models openrouter` shows every OpenRouter model with tool support, context size and price per 1M tokens in and out. `--search <text>` filters by id, `--refresh` skips the cache. The list is fetched without your key and cached for 24 hours in `~/.polyman/agent/models/openrouter.json`. When you are offline, the command and the chat use the old cache or the known models, they never fail because of it. `polyman ai use` warns (it does not fail) when the model is not in the live list, or when the model has no tool support.

**Budgets follow the model.** The chat reads the model's context size and max output from the live list (or the known list) and sizes itself to fit:

- max output per reply: the smallest of 8000, the model's max output, and a quarter of its context
- context the chat keeps: the smallest of 32000 and 75% of what is left after the output

Gemma 4 gets 32000 and 8000. A model with an 8k context gets 4608 and 2048. You can set the numbers yourself in `~/.polyman/ai.json`, per model:

```json
{
  "overrides": {
    "openrouter/deepseek/deepseek-v3.2": {
      "contextBudgetTokens": 64000,
      "maxOutputTokens": 8000,
      "chatMaxSteps": 30
    }
  }
}
```

The same `overrides` entry can also correct what polyman knows about a model: `tools`, `contextWindow`, `maxOutput`, `reasoning`, `parallelToolCalls`, `pricePerMTokIn` and `pricePerMTokOut`.

**Models without tools.** A model that cannot call tools can only talk, it cannot build anything. The chat says so once and goes on in chat-only mode. This also happens in the middle of a chat, when the provider answers that the model does not support tools.

**Which model to pick.** Smaller models are cheaper but make more mistakes in the workflows. The workflows were tested mostly on Gemma 4, see [Known limits](#known-limits).

### Starting a Chat

```bash
polyman chat my-problem
```

Then write what you want, for example `a problem about counting pairs with sum k, rating 1300`. The agent asks a few questions first, then writes the spec and asks `Should I build the problem?`.

`polyman chat` options:

| Option            | What it does                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `--provider <id>` | The provider for this chat, like `openrouter` or `deepseek`. Wins over the `ai.json` default.      |
| `--model <id>`    | The model for this chat, like `deepseek/deepseek-v3.2`. Wins over the `ai.json` default.           |
| `--plain`         | Line mode without the terminal UI, works with pipes. See [Plain mode](#plain-mode---plain).        |

### New Problem or Existing Problem

The folder you give decides how the chat starts:

| You run                                                         | The chat                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `polyman chat my-problem`, folder has `Config.json`             | Works on that problem. A new problem it creates goes next to it, never inside it.                             |
| `polyman chat my-problem`, folder does not exist                | Starts with no problem. When it creates one, it uses the name `my-problem` and makes it in the parent folder. |
| `polyman chat some-folder`, folder exists without `Config.json` | Starts with no problem. New problems are made inside `some-folder`.                                           |
| `polyman chat` (no folder)                                      | Same as above, with the current folder.                                                                       |

**A new problem** goes like this:

1. You give an idea (or ask for ideas, see [find_ideas](#find_ideas)).
2. The agent asks 3 to 6 short questions, each with its own suggestion: the exact task, the constraints, the intended solution, the wrong approaches the tests must break, the time limit.
3. It writes the spec to `.polyman/agent/notes.md` and asks if it should build.
4. When you say build, it creates the folder (`polyman new` and `polyman download-testlib`, you approve it), runs [prove_idea](#prove_idea), and when every check passes it runs [build_problem](#build_problem).
5. It tells you the result in 2 or 3 lines.

**An existing problem** (made by hand or pulled from Polygon) works too. The agent can read the files, run `verify`, and change files when you ask. The workflows need a spec in `.polyman/agent/notes.md` with at least the `# Idea`, `# Constraints` and `# Samples` sections. If the problem has no spec yet, ask the agent to write one from the statement first.

### The Terminal UI

The screen has the transcript at the top, the input box, and a status line at the bottom. The status line shows the problem folder (or `new problem`), the permission mode, the model, the tokens used and the cost so far.

#### Keys

| Key                     | What it does                               |
| ----------------------- | ------------------------------------------ |
| `enter`                 | Send the message                           |
| `ctrl+j`, `\` + `enter` | New line                                   |
| `up` / `down`           | Input history (when the input is empty)    |
| `esc`                   | Interrupt the agent                        |
| `shift+tab`             | Switch the mode: `ask` / `auto-edit`       |
| `ctrl+o`                | Details of a workflow task (while it runs) |
| `ctrl+c`                | Clear the input, press it twice to exit    |
| `ctrl+z`                | Quit now, stops the agent                  |

Type `/help` to see these keys in the chat. `/help` is the only command for now.

If you press `enter` while the agent works, the message is not sent. Wait for the turn to end, or press `esc` to stop it.

#### Approvals

Some tool calls wait for you. The chat shows a box with what the agent wants to do (a command, or a short diff for a file write) and three options:

1. **Yes**: allow this call once.
2. **Yes, and do not ask again for `<tool>` in this session**: allow this tool until you close the chat.
3. **No, and tell the agent what to do differently**: type a reason and press `enter`. The agent reads your reason and tries another way. `esc` goes back to the options.

Choose with the arrow keys (or `tab`) and `enter`, or press `1`, `2` or `3`. `esc` on the options interrupts the whole turn.

Option 2 is only remembered for tools that write files. Polygon tools ask every time.

#### Permission Modes

Each tool has a risk, and the mode decides which ones ask:

| Tool risk | Examples                                                   | `ask` mode (default)                  | `auto-edit` mode |
| --------- | ---------------------------------------------------------- | ------------------------------------- | ---------------- |
| read      | `read_file`, `list_files`, `remote_view`                   | never asks                            | never asks       |
| run       | `generate`, `validate`, `verify`, `start_workflow`         | never asks                            | never asks       |
| write     | `write_file`, `edit_file`, `write_notes`, `create_problem` | asks (unless allowed for the session) | never asks       |
| remote    | `remote_push`, `remote_commit`, `remote_package`           | always asks                           | always asks      |

`shift+tab` switches between `ask` and `auto-edit`. In `auto-edit` the agent writes files and then runs the code it wrote without asking you, so use it when you trust the direction.

"Run" tools compile and run the files in the problem folder. In `ask` mode they do not ask, but the agent had to get your approval to write those files first.

#### Plan Approval

A workflow does not ask for every file. It asks once, for the whole plan:

```
Run this plan?
build_problem · pairs-sum · 11 tasks · up to 4 in parallel

t1   Scaffold              no model, CLI only
t2   Statement             statements/english/legend.tex, ...
t4   Main solution         solutions/main.cpp
...
Workers write only the files above, and the CLI runs the code they write.

❯ 1. Run it    2. Edit the plan    3. Cancel
```

Each row is one task with the files it may write. `no model, CLI only` means polyman runs that task itself, with no model call.

- **Run it**: the workflow starts. Each worker may write only its own files, without asking.
- **Edit the plan**: nothing runs. Type what to change and the agent makes a new plan.
- **Cancel**: nothing runs.

Use the arrow keys or `tab` and `enter`, or the number keys. `esc` is the same as Cancel. When the workflow ends, the mode goes back to what it was before.

#### Watching a Workflow

While a workflow runs, the chat shows the task tree: each task with its status, attempts and the last check. Press `ctrl+o` to open the details of a task: its files, its brief, every attempt with each check and the error digest, the tool calls of the worker, and the result. `up` / `down` moves to another task, `esc` or `ctrl+o` closes the details.

#### Stopping and Exiting

- `esc` stops the current turn. A running workflow and its commands are stopped too.
- `ctrl+c` clears the input. Press it twice within one second to exit.
- `ctrl+z` exits at once and stops the agent.

### Plain Mode (`--plain`)

The terminal UI needs a real terminal on stdin and stdout. Without one, `polyman chat` stops with `polyman chat needs a terminal (or use --plain).` and exit code `2`. With `--plain` the chat works line by line, so it works in pipes, scripts and simple terminals. If the terminal UI fails to load, the chat also falls back to plain mode by itself.

In plain mode:

- Your prompt is `you>`. Each tool call is one line like `> verify({})`, and its result is a line that starts with `=`.
- A tool approval is `Allow <title>? [y/N/a(lways)]`. `y` allows once, `a` allows for the session, `n` or an empty line denies. Any other text denies, and the text is sent to the agent as the reason.
- A plan approval is `Run this plan? [y/N]`, after the plan is printed as a list.
- If the input ends while the chat waits for an answer, the answer is no.
- The mode is always `ask`.
- `ctrl+c` cancels the answer. `ctrl+c` twice, or `ctrl+d`, exits.

```bash
# one message, then "y" to the next approval
printf 'run verify and tell me what fails\ny\n' | polyman chat my-problem --plain
```

### What the Agent Can Do

The agent works only through these tools:

| Group            | Tools                                                                             | Notes                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Files            | `list_files`, `read_file`, `write_file`, `edit_file`                              | Only inside the problem folder, see [Safety and Privacy](#safety-and-privacy).                                                  |
| Problem commands | `create_problem`, `generate`, `validate`, `run_solution`, `test_target`, `verify` | Each one runs the polyman CLI with `--json`, never a shell. `create_problem` runs `polyman new` and `polyman download-testlib`. |
| Polygon          | `remote_push`, `remote_commit`, `remote_package`, `remote_view`                   | Push, commit and package always ask you. `remote_view` only reads. You must run `polyman remote register` yourself first.       |
| Notes            | `read_notes`, `write_notes`                                                       | The spec in `.polyman/agent/notes.md`.                                                                                          |
| Skills           | `list_skills`, `load_skill`                                                       | The instruction files of polyman (`template/instructions/`), read from the installed package.                                   |
| Ideas            | `find_ideas`                                                                      | The idea workflow, see [find_ideas](#find_ideas).                                                                               |
| Workflows        | `start_workflow`                                                                  | Runs a recipe, see [Workflows](#workflows).                                                                                     |

The agent runs one polyman command at a time. The model gets only the start and the end of a long output; the full output is in the [logs](#notes-and-logs).

### Workflows

A workflow is how the agent builds or fixes a problem. One long chat with one model loses the rules and trusts its own work, so the workflow splits the job:

- A **manager** (a model) fills a fixed plan shape, called a recipe, into a plan of small tasks.
- The **scheduler** (polyman code, no model) runs the tasks in dependency order, up to 4 at a time.
- Each **worker** (a model) does one task in a small session of its own. It can write only the files its task owns, and it has no Polygon tools.
- Each task ends with a **checkpoint** that polyman runs: the compiler, `polyman test validator`, `polyman generate`, `polyman verify`. The model never decides if a task passed.

When a task fails its check, the worker tries again with the error (attempt 2), then a fresh worker starts from the spec (attempt 3). After that the manager decides: try once more with a hint, redo an earlier task (once per workflow), or ask you a question. Tasks that depend on a failed task are skipped.

Workers never write `Config.json`. They send a small patch (add this solution, set the validator, ...) and polyman applies the patches one at a time. A patch that would make `Config.json` invalid is refused.

A whole workflow can run for at most 30 minutes. `esc` stops it.

The agent picks the recipe from what you ask. You can also name it, like `run fix_verify`.

#### find_ideas

When you ask for problem ideas, the agent does not invent them in its answer. It runs the idea workflow: 3 ideas written in parallel, each from a different angle, a check of each idea's fields and of its complexity against its own constraints, a critic review of each one (clarity, rating, known or fresh), then a ranking. You pick one, and the chat goes on to the questions.

It writes no files and needs no problem folder, so there is no plan approval. Ask for `more novel` or `other ideas` to run it again without the ideas you saw.

#### prove_idea

Checks the idea with quick programs before anything is built. The plan comes from the spec with no model call:

- Workers write a brute force, the intended solution, a random generator, and one program per wrong approach, in `.polyman/agent/prove/`.
- **Stress**: the brute force and the intended solution must agree on 300 small random tests.
- **Samples**: the samples of the spec must match both programs.
- **Max test**: the intended solution must run 3 max tests within the time limit of the spec (1 second if the spec has none).
- **Kill wrong**: each wrong approach must really fail with its verdict. A plain brute force approach in the spec must be too slow on a max test. `ML` approaches are skipped, memory is not measured here.

A failed check is the answer, not an error to fix: the workflow ends, and the agent tells you what failed with the counterexample. If the brute force and the intended solution agree but a sample does not, the sample is probably wrong, and the agent fixes it in the spec.

#### build_problem

Builds every file of the problem from the spec:

| Task                                                 | Who     | The check                                                                                                           |
| ---------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| Scaffold                                             | polyman | `Config.json` exists. Removes the template's example solutions, tests and statement, sets the limits from the spec. |
| Statement                                            | worker  | The statement files are written (not empty, not the template copy).                                                 |
| Statement critic                                     | worker  | Reviews the statement against the spec.                                                                             |
| Main solution, brute force                           | worker  | Compiles, and gives the right output on every sample of the spec.                                                   |
| Wrong solutions (one per wrong approach in the spec) | worker  | Compiles. Its tag comes from the spec.                                                                              |
| Validator                                            | worker  | `polyman test validator` passes.                                                                                    |
| Generators                                           | worker  | `polyman generate --all` passes.                                                                                    |
| Checker                                              | polyman | Picks a standard checker from the spec.                                                                             |
| Generate and validate                                | polyman | `polyman generate --all`, then `polyman validate --all`.                                                            |
| Verify                                               | polyman | `polyman verify`. When it fails, up to 3 fix rounds, like [fix_verify](#fix_verify).                                |

If the manager gives an invalid plan twice, polyman uses a default plan made from the spec.

#### fix_verify

For a problem whose `verify` fails. It runs `polyman verify`, and when it fails, up to 3 rounds of: a fixer worker reads the verify digest and changes only the files the failure points to, then `verify` runs again. When a correct solution gets a wrong answer, the main solution may be the bug, so the fixer may change it too. When a wrong solution passes every test, the tests are weak, so the fixer may change the generators and the script.

#### strengthen_tests

For wrong solutions that pass every test. A worker adds a generator or script lines whose tests break them (it keeps the old tests), then polyman runs `generate`, `validate` and `verify`.

#### What You See at the End

Every workflow ends with a short summary, like `build_problem: 11 of 11 tasks passed`, the failed and skipped tasks, and any question from the manager. The agent tells you the result in 2 or 3 lines. If something failed, it asks if it should run `fix_verify`; it does not fix the files itself.

### Notes and Logs

Everything the agent keeps is inside the problem folder, under `.polyman/agent/`:

- **`notes.md`** is the spec: the idea, constraints, input, output, intended solution, wrong approaches, edge cases, samples and decisions (time limit, memory limit, checker). Every workflow reads it, and the agent sees it on every model call. Before the problem folder exists, the notes are kept in memory and written when the folder is created. You can edit the file yourself. The exact format is in [`design/agent/briefs/SPEC-FORMAT.md`](design/agent/briefs/SPEC-FORMAT.md).
- **`logs/`** has the full output of every polyman command the agent ran, one file per run, like `2026-10-26T15-30-12-345Z-verify.log`.
- **`prove/`** has the quick programs of `prove_idea`.

If the problem is in git, decide if you want these files in it. The notes are useful to keep. The logs are not.

### Safety and Privacy

**What is sent to the model provider.** The chat sends your messages and the agent's context to the provider of the model you use. The context has:

- a system prompt with the notes, a summary of `Config.json`, the file names of the problem folder (two levels deep, without `testsets/`), the full path of the problem folder, your OS name and version, your `g++` version and the polyman version;
- the content of every file the agent reads;
- the output of every command the agent runs (cut to the start and the end), including `remote_view` output from Polygon.

So the provider sees your problem: statement, solutions, tests it reads. Their privacy policy applies. If the problem is for a contest that did not happen yet, think about which provider you send it to.

**The sandbox.** Every file path is checked by its real path, with symlinks followed. A path outside the problem folder is refused. Some files are never written by the agent: `.polyman/cache/`, `.polyman/agent/sessions/` and `testlib.h`. Inside a workflow, a worker can write only the files of its task.

**Commands.** The agent runs only the polyman CLI, as a child process, never a shell. The child process gets your environment without any `*_API_KEY` variable or provider key variable, because it compiles and runs code the model wrote.

**Secrets.** Provider keys and your Polygon key and secret are removed from tool output and error messages before the model or the screen sees them. There is no tool to register Polygon credentials: the agent tells you to run `polyman remote register` in your own terminal. If you paste something that looks like a Polygon key or secret into the chat, it is not sent to the model and not saved in the input history; the chat shows a warning instead.

**Keys.** Provider keys are stored in `~/.polyman/ai.json` with mode `0600`. A key is only sent to the base URL of its own provider. See [AI Provider Keys](#ai-provider-keys).

**Approvals show the real text.** Control characters and bidi marks in a command or path are shown as `\uXXXX`, so a file name cannot hide what it really is.

### Known Limits

The chat is a preview. The main known problems:

- The workflow epic is [#136](https://github.com/HamzaHassanain/polyman/issues/136), with the issues [#120](https://github.com/HamzaHassanain/polyman/issues/120) to [#135](https://github.com/HamzaHassanain/polyman/issues/135). Some of them:
  - one failed side task skips `verify` and the whole fix loop ([#127](https://github.com/HamzaHassanain/polyman/issues/127)),
  - the 30 minute timeout throws away all results ([#122](https://github.com/HamzaHassanain/polyman/issues/122)),
  - custom checkers are not supported, only standard ones ([#128](https://github.com/HamzaHassanain/polyman/issues/128)),
  - the statement critic can never fail ([#124](https://github.com/HamzaHassanain/polyman/issues/124)),
  - running `build_problem` again starts from zero ([#134](https://github.com/HamzaHassanain/polyman/issues/134)).
- No session resume: when you close the chat, the conversation is gone. The notes and the files stay ([#61](https://github.com/HamzaHassanain/polyman/issues/61)).
- No headless `polyman ask` command yet. Use `--plain` with a pipe for now ([#63](https://github.com/HamzaHassanain/polyman/issues/63)).
- On Windows, stopping a command and everything it started (`taskkill /T /F`) is not tested yet ([#55](https://github.com/HamzaHassanain/polyman/issues/55)).
- The workflow checks C++ solutions only.
- A workflow never touches Polygon. Push with the chat after it ends, or with `polyman remote push`.

---

## Best Practices

### 1. Directory Organization

✅ **Good:**

```
problem/
├── Config.json
├── checker/
│   ├── chk.cpp
│   └── checker_tests.json
├── validator/
│   ├── val.cpp
│   └── validator_tests.json
├── generators/
│   ├── gen-random.cpp
│   └── gen-special.cpp
├── solutions/
│   ├── main.cpp
│   ├── wa.cpp
│   └── tle.py
└── manual/
    └── tests/
        ├── m-01-sample.in
        └── m-02-sample.in
```

### 2. Configuration Management

✅ **Good:**

- Use relative paths
- Include all necessary solution types
- Group tests logically
- Document generator parameters

❌ **Bad:**

- Absolute paths
- Missing MA solution
- All tests in one group
- Undocumented generators

### 3. Test Coverage

✅ **Include:**

- Sample tests (2-3)
- Small tests for debugging
- Main test cases
- Edge cases (min/max)
- Corner cases (n=1, empty, etc.)
- Stress tests

❌ **Avoid:**

- Only sample tests
- No edge cases
- Duplicate tests
- Tests without purpose

### 4. Solution Testing

```bash
# Always verify your workflow
polyman verify

# This catches:
# - Invalid test inputs
# - Checker errors
# - Solution mismatches
# - TLE/WA not behaving as expected
```

### 5. Version Control

✅ **Commit:**

- Config.json
- All source files
- Manual tests
- Self-test configurations

❌ **Don't commit:**

- Compiled binaries
- Generated test files
- testlib.h (download on setup)
- solutions-outputs/

**Recommended `.gitignore`:**

```
# Compiled files
*.exe
*.out
*.class
__pycache__/

# Generated tests
testsets/*/test*.txt

# Solution outputs
solutions-outputs/

# Compilation cache
.polyman/

# System files
.DS_Store
Thumbs.db
```

---

## Troubleshooting

### A crashing solution is judged TLE on Ubuntu

**Problem:** On an Ubuntu desktop, a solution that aborts (for example a failed `assert`, or `abort()`) gets Time Limit Exceeded instead of Runtime Error, so a solution tagged `RE` fails `verify`.

**Cause:** Ubuntu's crash reporter, apport, writes a core dump when a program aborts, and the process ends only after that. On one machine this took about 1.15 s, more than a 1000 ms time limit, so the run was stopped as a timeout. CI runners and machines without apport are not affected.

**Solution:** stop apport while you verify:

```bash
sudo systemctl stop apport
```

It starts again at the next boot. With a larger `timeLimit` the same solution is judged RE.

### Compilation Errors

**Problem:** Validator/Checker won't compile

```
Error: testlib.h: No such file or directory
```

**Solution:**

```bash
# Download testlib.h first
polyman download-testlib

# Or copy to system include directory
sudo cp testlib.h /usr/include/
```

---

**Problem:** Generator compilation fails

```
Error: undefined reference to registerGen
```

**Solution:**

- Ensure you're using `#include "testlib.h"`
- Ensure testlib.h is in the same directory
- Check that you called `registerGen(argc, argv, 1)`

---

### Validation Errors

**Problem:** Validator rejects valid test

```
FAIL: expected EOLN but found space
```

**Solution:**

- Check exact input format in validator
- Ensure proper use of `readSpace()` and `readEoln()`
- Verify no trailing spaces in test files

---

**Problem:** Generated test fails validation

```
FAIL: Integer x out of range [1, 100000]
```

**Solution:**

- Check generator's output range
- Verify generator parameters are correct
- Run generator manually to see output

---

### Checker Errors

**Problem:** Checker crashes on contestant output

```
CRASHED: Unexpected end of file
```

**Solution:**

- Handle EOF gracefully in checker
- Use `seekEof()` before reading
- Catch exceptions and return `_pe` or `_wa`

---

**Problem:** Checker gives wrong verdict

```
Expected WA but got OK
```

**Solution:**

- Review checker logic
- Test checker with checker_tests.json
- Verify you're reading from correct streams (ans vs ouf)

---

### Solution Errors

**Problem:** Main solution gets WA

```
Solution main marked as MA but got Wrong Answer
```

**Solution:**

- Debug main solution algorithm
- Test against sample inputs manually
- Check for edge cases (overflow, off-by-one)
- Verify input/output format matches

---

**Problem:** WA solution passes all tests

```
Solution wa-solution marked as WA but did not get Wrong Answer or Presentation Error on any test
```

**Solution:**

- Make WA solution's bug more obvious
- Add specific test cases that expose the bug
- Verify the bug is actually wrong (not an alternative correct solution)

---

**Problem:** TL solution doesn't TLE

```
Solution tle-solution marked as TL but did not timeout
```

**Solution:**

- Make algorithm slower (higher complexity)
- Increase test input sizes
- Check time limit isn't too generous
- Use stress tests with maximum n

---

### Test Generation Errors

**Problem:** Manual test file not found

```
Error: Manual test input not found: ./manual/tests/m-01-sample.in
```

**Solution:**

- Create the directory: `mkdir -p manual/tests`
- Verify the `input` path in `manualTests[]` matches an `m-*.in` file on disk.
- Use relative path from Config.json location

---

**Problem:** Generator not found

```
Error: Generator gen-random not defined
```

**Solution:**

- Add generator to Config.json generators array
- Ensure generator name matches exactly
- Compile generator first

---

### Memory Issues

**Problem:** Solution exceeds memory limit during testing

```
Memory Limit Exceeded (256 MB)
```

**Solution:**

- If it's ML solution: Expected behavior ✓
- If it's MA solution:
  - Optimize data structures
  - Reduce memory usage
  - Check for memory leaks
  - Increase memoryLimit if appropriate

---

### Time Issues

**Problem:** Compilation takes too long

```
Timeout while compiling validator
```

**Solution:**

- Simplify validator code
- Remove unnecessary includes
- Use faster compilation flags
- Check for infinite template recursion

### Remote Operations

#### Authentication Errors

**Error:** `Authentication failed` or `Invalid API credentials`

**Solution:**
```bash
# Re-register credentials
polyman remote register <api-key> <api-secret>

# Verify credentials on Polygon website
# Settings → API → Check if key is active
```

#### Problem Not Found

**Error:** `Problem 123456 not found` or `Access denied`

**Solutions:**
- Verify problem ID: `polyman remote list`
- Check you have access to the problem on Polygon
- Ensure problem hasn't been deleted

#### Push Failures

**Error:** `Failed to upload file` or `Polygon API error`

**Solutions:**
```bash
# Check file exists and is valid
ls -la <file-path>

# Verify Config.json has problemId
cat Config.json | grep problemId

# Try selective push to isolate issue
polyman remote push . -s  # Just solutions
polyman remote push . -c  # Just checker
```

#### Package Build Timeout

**Error:** `Package build timed out after 30 minutes`

**Solutions:**
- Problem may have too many tests or complex generation
- Check Polygon web interface for actual package status
- Package might still be building - wait and check later
- Try building `standard` package instead of `full`

#### Line Ending Issues

**Issue:** Tests fail on Polygon but work locally

**Solution:**
- Polyman automatically handles line ending conversion
- Ensure you're using latest version
- Manually verify test files don't have mixed line endings

---

## FAQ

### 1. Do I need to write a custom checker for my problem?

**Answer:** No, in most cases you can use a standard checker:

- **Token comparison** (whitespace-insensitive): Use `wcmp`
- **Number comparison**: Use `ncmp` or `fcmp`
- **Line-by-line**: Use `lcmp`
- **Yes/No**: Use `yesno`

Only write a custom checker if:

- Multiple valid answers exist
- Output requires validation beyond simple comparison
- Special precision handling needed
- Output order doesn't matter

---

### 2. Can I use Python for my main solution?

**Answer:** Yes, but with caution:

✅ **Good for:**

- Problems with generous time limits (3-5 seconds)
- I/O-light problems
- String manipulation
- Math problems

❌ **Not recommended for:**

- Time-critical algorithms
- Heavy I/O problems
- Large data structures
- When TLE solutions are needed (Python may TLE on main solution)

**Best practice:** Write main solution in C++, use Python for alternative OK solutions.

---

### 3. How many tests should I include?

**Answer:** Typical problem structure:

- **Samples**: 2-3 tests (shown in statement)
- **Small**: 5-10 tests (for debugging)
- **Main**: 20-50 tests (covers all cases)
- **Edge**: 5-10 tests (boundaries, corner cases)
- **Stress**: 10-30 tests (large random)

**Total**: 40-100 tests for most problems

**Key principle:** Quality over quantity. Each test should serve a purpose.

---

### 4. What's the difference between interactive and regular problems?

**Answer:**

**Regular Problem:**

- Solution reads all input at start
- Produces output once
- Uses `stdin`/`stdout`

**Interactive Problem:**

- Solution communicates back-and-forth with interactor
- Multiple read/write cycles
- Uses flush after each output
- Set `"interactive": true` in Config.json
- Requires custom interactor program

**Example interactive I/O:**

```cpp
// Solution
cout << "query 5" << endl;  // Must flush
int response;
cin >> response;
```

**Note:** Polyman currently has limited interactive support. Use regular problems unless necessary.

---

### 5. How do I handle floating-point problems?

**Answer:**

**In Validator:**

```cpp
double x = inf.readDouble(0.0, 1e9, "x");
```

**In Checker:**

```cpp
#include "testlib.h"

int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);

    double jans = ans.readDouble();
    double pans = ouf.readDouble();

    const double EPS = 1e-6;  // Or use relative error

    if (abs(jans - pans) < EPS) {
        quitf(_ok, "Correct: %.9f", pans);
    } else {
        quitf(_wa, "Wrong: expected %.9f, found %.9f, diff %.9f",
              jans, pans, abs(jans - pans));
    }
}
```

**Or use standard checker:**

- `fcmp` with absolute error: `fcmp 1e-6`
- `rcmp` with relative error: `rcmp 1e-9`

**Best practice:** Specify precision clearly in problem statement.

---

### 6. Can I test multiple problems in the same directory?

**Answer:** No, each problem should have its own directory:

```bash
problems/
├── problem-a/
│   ├── Config.json
│   ├── checker/
│   └── ...
└── problem-b/
    ├── Config.json
    ├── checker/
    └── ...
```

Each directory is independent. Use separate `Config.json` for each problem.

---

### 7. How do I debug why my solution is getting WA?

**Steps:**

1. **Run on samples manually:**

   ```bash
   ./solution < manual/tests/m-01-sample.in
   ```

2. **Run specific test:**

   ```bash
   polyman run main --testset tests --index 5
   ```

3. **Check solution output:**

   ```bash
   cat solutions-outputs/main/tests/output_test5.txt
   ```

4. **Compare with checker:**

   ```bash
   # The checker will show detailed error message
   polyman test main
   ```

5. **Add debug output** to solution (remove before submission)

6. **Create minimal failing test** and debug

---

### 8. What if my validator is too strict/lenient?

**Too strict:**

```
FAIL: Expected EOLN but found space
```

**Solution:**

- Use `readEoln()` only when newLine is required
- Use `readSpace()` for required spaces
- Use `readSpaces()` if multiple spaces allowed
- Check problem statement format specification

**Too lenient:**

```
Accepted invalid input: -5 when range is [1, 100]
```

**Solution:**

- Add range checks: `readInt(1, 100, "n")`
- Add constraint validation
- Test validator with invalid inputs

---

### 9. How do I set up continuous integration for my problems?

**GitHub Actions example:**

```yaml
# .github/workflows/verify.yml
name: Verify Problem

on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Polyman
        run: npm install -g polyman-cli

      - name: Download testlib
        run: polyman download-testlib

      - name: Full Verification
        run: polyman verify
```

This automatically tests your problem on every commit.

---

### 10. Can I export my problem to Codeforces Polygon?

**Answer:** Yes. `polyman remote push` uploads your local problem to Polygon:

```bash
polyman remote push ./my-problem
```

It uploads solutions, checker, validator, generators, statements, tests, metadata and limits. Use the per-component flags (for example `-s -c` for solutions and checker only) to push part of the problem. If `Config.json` has no `problemId`, it creates the Polygon problem first. See [Push to Polygon](#basic-push) for details.

If you prefer to do it by hand, create the problem on Polygon and upload the validator, checker, generators, solutions and tests through the Polygon web interface.

---

## Additional Resources

### Official Documentation

- **Testlib GitHub**: https://github.com/MikeMirzayanov/testlib
- **Codeforces Polygon**: https://polygon.codeforces.com/
- **Testlib Tutorial**: https://codeforces.com/testlib

### Example Problems

Check the template directory for a complete example problem.

### Community

- Ask questions on Codeforces forums
- Join problem setting communities
- Share your experiences

---

## Appendix: Complete Example

See the included template for a fully working example problem with:

- ✓ Sample validator
- ✓ Custom checker
- ✓ Test generators
- ✓ Multiple solutions (MA, OK, TL)
- ✓ Manual and generated tests
- ✓ Self-tests for validator and checker

Study this template to understand the complete workflow!

---

**Happy Problem Setting!** 🎉

If you encounter issues not covered in this guide, please report them or consult the Polyman documentation.
