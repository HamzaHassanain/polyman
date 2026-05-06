# Polyman Complete User Guide

**Version 1.0.0** | A comprehensive guide for creating competitive programming problems using Polyman CLI

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

10. [Remote Operations (Polygon Integration)](#remote-operations-polygon-integration)
    - [Setup and Registration](#setup-and-registration)
    - [Listing Problems](#listing-problems)
    - [Pulling Problems](#pulling-problems)
    - [Quick Note before you read on:](#quick-note-before-you-read-on)
    - [Pushing Problems](#pushing-problems)
    - [Viewing Problem Details](#viewing-problem-details)
    - [Committing Changes](#committing-changes)
    - [Building Packages](#building-packages)

11. [Best Practices](#best-practices)
    - [Directory Organization](#1-directory-organization)
    - [Configuration Management](#2-configuration-management)
    - [Test Coverage](#3-test-coverage)
    - [Solution Testing](#4-solution-testing)
    - [Version Control](#5-version-control)

12. [Troubleshooting](#troubleshooting)
    - [Compilation Errors](#compilation-errors)
    - [Validation Errors](#validation-errors)
    - [Checker Errors](#checker-errors)
    - [Solution Errors](#solution-errors)
    - [Test Generation Errors](#test-generation-errors)
    - [Memory Issues](#memory-issues)
    - [Time Issues](#time-issues)

13. [FAQ](#faq)
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

- **Node.js** v14 or higher
- **C++ Compiler** (g++, clang, or MSVC)
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

#### Optional Fields

```json
{
  "description": "A brief description of the problem",
  "tags": ["implementation", "math", "greedy"],
  "tutorial": "Solution explanation and approach"
}
```

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
| `WA` | Wrong Answer       | Should get Wrong Answer on some tests             |
| `TL` | Time Limit         | Should exceed time limit on some tests            |
| `TO` | Time/OK            | May TLE but is algorithmically correct            |
| `ML` | Memory Limit       | Should exceed memory limit                        |
| `RE` | Runtime Error      | Should crash or have runtime errors               |
| `PE` | Presentation Error | Wrong output format                               |
| `RJ` | Rejected           | Should fail for any reason                        |

#### Source Types

**C++ Compilers:**

- `cpp.g++11`, `cpp.g++14`, `cpp.g++17`, `cpp.g++20`
- `cpp.ms2017`, `cpp.ms2019`
- `cpp.clang++17`, `cpp.clang++20`

**Java Versions:**

- `java.8`, `java.11`, `java.17`, `java.21`

**Python Versions:**

- `python.2`, `python.3`, `python.pypy2`, `python.pypy3`

**Do's:**

- Always include exactly **one** solution with tag `MA`
- Include solutions with different expected behaviors (WA, TL, etc.)
- Use appropriate sourceType for each solution
- You May Leave The Source Types Empty to Use Default Compilers

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
    "source": "./checker/wcmp.cpp",
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

### ✅ Do's:

1. **Validate all constraints** mentioned in the problem statement
2. **Check format exactly** (spaces, newLines, EOF)
3. **Use meaningful variable names** in validation messages
4. **End with `readEof()`** to ensure no extra data
5. **Test validator** with both valid and invalid inputs
6. **Use strict validation** for interactive problems

### ❌ Don'ts:

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

### ✅ Do's:

1. **Use standard checkers** when possible (`wcmp` for most problems)
2. **Read from correct streams** (inf, ans, ouf)
3. **Provide helpful messages** in quitf
4. **Handle edge cases** (empty output, extra whitespace)
5. **Test checker** with various outputs
6. **Be lenient with formatting** unless problem requires strict format

### ❌ Don'ts:

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

### ✅ Do's:

1. **Use command-line arguments** for test parameters
2. **Ensure deterministic generation** (same args → same test)
3. **Generate valid inputs** according to constraints
4. **Use meaningful parameters** (n, maxValue, etc.)
5. **Test generator outputs** with validator
6. **Document generator parameters** in comments

### ❌ Don'ts:

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

### ✅ Do's:

1. **Test main solution** thoroughly
2. **Verify WA solutions** actually get WA
3. **Verify TL solutions** actually TLE
4. **Use appropriate language** for each solution type
5. **Include alternative correct solutions** if possible

### ❌ Don'ts:


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
```

**What Happens:**

1. Compiles any generators required by the matching commands
2. Runs each `manual` (copy) or `generator` (execute over `range`) command and writes outputs to `testsets/<testset-name>/test<N>.txt`

The `--testset`, `--group`, and `--index` flags successively narrow which commands are executed.

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
```

**What Happens:**

1. Compiles the validator
2. Runs `./val < test<N>.txt` for each selected test and reports VALID / INVALID with error details

If tests fail: check validator constraints, fix the generator, or correct manual test files.

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
```

**What Happens:**

1. Compiles the solution (C++: g++/clang, Java: javac, Python: none) and the checker
2. Runs the solution against each selected test, measuring time and detecting TLE/MLE/crashes
3. Invokes the checker against the main solution's answers and reports per-test verdicts plus a summary

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
2. Uses the checker to compare outputs and confirms the target solution behaves as its tag advertises (e.g., a `WA`-tagged solution must fail at least one test)

**Use Case:** Verify that WA/TL/RE solutions actually fail as expected.

---

### Full Verification

#### `polyman verify`

Runs complete problem verification workflow.

**Usage:**

```bash
polyman verify
```

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
    - Confirms WA solutions get WA on some tests
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
   - **Statements** (all languages as .tex files)
   - **Tests** (manual tests only)
   - **Metadata** (description, tags)
5. **Step 5:** Creates local directory structure
6. **Step 6:** Generates `Config.json` with all settings
7. **Step 7:** Downloads tests for specified testsets

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
polyman remote push <problem-id> <directory>
```

**Example:**

```bash
polyman remote push 123456 ./my-problem
```

**What Happens:**

1. **Step 1:** Reads API credentials
2. **Step 2:** Initializes Polygon SDK
3. **Step 3:** Reads `Config.json` to get problem ID
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
polyman remote push 123456 ./my-problem -s -c

# Push only tests
polyman remote push 123456 ./my-problem -t

# Push everything except tests
polyman remote push 123456 ./my-problem -s -c -v -g -S -m -i

# Push everything (default)
polyman remote push 123456 ./my-problem --all
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
   - Polls every 60 seconds
   - Detects when package is created
   - Waits for package to finish building (READY or FAILED)
   - Maximum wait time: 30 minutes
6. **Step 6:** Displays package information

**Important Notes:**

- Package building is **asynchronous** - it may take several minutes
- The command automatically waits and polls for completion
- Progress updates are shown every minute
- Download the package from Polygon web interface (automatic download coming soon)
- Use `standard` type for most purposes
- Use `linux` or `full` when you need test files included

**Typical Build Times:**

- Simple problems: 1-3 minutes
- Complex problems with many tests: 5-10 minutes
- Full packages: 10-15 minutes

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
polyman remote push 123456 ./my-problem            # or -sct for selective
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
   polyman remote push . .
   ```

2. **Use selective push for quick updates**
   ```bash
   polyman remote push . . -s   # Only updated solutions
   polyman remote push . . -t   # Only updated tests
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

# System files
.DS_Store
Thumbs.db
```

---

## Troubleshooting

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
Solution wa-solution marked as WA but passed all tests
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
polyman remote push . . -s  # Just solutions
polyman remote push . . -c  # Just checker
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
      - uses: actions/checkout@v2

      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '16'

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

**Answer:** Polyman uses Polygon-compatible format. To upload:

1. **Create problem on Polygon** (manually for now)
2. **Upload files** via Polygon interface:
   - Validator, Checker, Generators
   - Solutions
   - Tests (can be generated on Polygon too)
3. **Configure** using Polygon UI

**Future:** Polyman will support direct Polygon API integration for automated upload.

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
