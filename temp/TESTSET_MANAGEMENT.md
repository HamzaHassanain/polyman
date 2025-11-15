# Testset Management Guide

This guide explains how to use polyman's testset management system, including test generation, organization, and Polygon script parsing.

## Overview

Polyman supports Polygon-style testsets with:

- **Multiple testsets** (tests, stress, examples, etc.)
- **Test groups** for organized scoring and feedback
- **Generator scripts** in Polygon format or structured commands
- **Flexible test generation** (all, by testset, by group, or by index)

---

## Configuration

### Basic Testset Structure

```json
{
  "testsets": [
    {
      "name": "tests",
      "generatorScript": {
        "commands": [...]
      },
      "groupsEnabled": true,
      "pointsEnabled": false,
      "groups": [...]
    }
  ]
}
```

### Generator Script Formats

Polyman supports three ways to define test generation:

#### 1. Structured Commands (Recommended)

```json
{
  "generatorScript": {
    "commands": [
      {
        "type": "manual",
        "manualFile": "./tests/manual/sample1.txt",
        "group": "samples"
      },
      {
        "type": "generator-single",
        "generator": "gen-random",
        "args": ["10", "100"],
        "group": "main"
      },
      {
        "type": "generator-range",
        "generator": "gen-large",
        "args": ["1000"],
        "range": [1, 10],
        "group": "large"
      }
    ]
  }
}
```

**Command Types:**

- `manual`: Copy a manual test file
- `generator-single`: Run generator once
- `generator-range`: Run generator multiple times with incrementing argument

#### 2. Polygon Script String

```json
{
  "generatorScript": {
    "script": "gen 1 > $\ngen 2 > $\ngen 10 100 > {3..5}\ngen-large 1..10 > $"
  }
}
```

#### 3. External Script File

```json
{
  "generatorScript": {
    "scriptFile": "./tests/generation-script.txt"
  }
}
```

### Test Groups

```json
{
  "groupsEnabled": true,
  "groups": [
    {
      "name": "samples",
      "pointsPolicy": "EACH_TEST",
      "feedbackPolicy": "COMPLETE",
      "dependencies": []
    },
    {
      "name": "main",
      "pointsPolicy": "COMPLETE_GROUP",
      "feedbackPolicy": "ICPC",
      "dependencies": ["samples"]
    }
  ]
}
```

**Points Policies:**

- `EACH_TEST`: Points awarded per test
- `COMPLETE_GROUP`: Points awarded only if all tests pass

**Feedback Policies:**

- `NONE`: No feedback
- `POINTS`: Show points only
- `ICPC`: First error only (like ACM ICPC)
- `COMPLETE`: Full feedback on all tests

---

## CLI Commands

### List Available Testsets

```bash
polyman list-testsets
```

**Output:**

```
📋 AVAILABLE TESTSETS

  Found 2 testset(s)

  1. tests: 15 tests, groups: samples, main, large
  2. stress: 100 tests, groups: none
```

### Generate Tests

#### Generate All Testsets

```bash
polyman generate all
```

Generates all testsets defined in `Config.json`.

#### Generate Specific Testset

```bash
polyman generate tests
```

Generates all tests in the `tests` testset.

#### Generate Specific Group

```bash
polyman generate tests samples
```

Generates only tests in the `samples` group within the `tests` testset.

#### Generate Single Test

```bash
polyman generate tests 5
```

Generates only test #5 in the `tests` testset.

### Validate Tests

#### Validate All Testsets

```bash
polyman validate all
```

Validates all tests in all testsets.

#### Validate Specific Testset

```bash
polyman validate tests
```

Validates all tests in the `tests` testset.

#### Validate Specific Group

```bash
polyman validate tests samples
```

Validates only tests in the `samples` group within the `tests` testset.

#### Validate Single Test

```bash
polyman validate tests 5
```

Validates only test #5 in the `tests` testset.

---

## Polygon Script Format

Polyman supports Polygon's test generation script syntax:

### Basic Syntax

```
<generator> <args...> > <target>
```

### Targets

- `$` - Next test number (auto-incremented)
- `{N..M}` - Test range (expands to multiple commands)

### Examples

```bash
# Single test
gen 1 > $

# Multiple tests with same parameters
gen 10 100 > {1..5}

# Expands to:
# gen 10 100 > 1
# gen 10 100 > 2
# gen 10 100 > 3
# gen 10 100 > 4
# gen 10 100 > 5

# Generator with range argument
gen 1..10 > $

# Creates one command that runs generator 10 times
# with incrementing value (1, 2, 3, ..., 10)
```

### Manual Tests

```bash
manual ./tests/manual/sample1.txt > $
manual ./tests/manual/sample2.txt > $
```

### Comments

Lines starting with `#` are ignored:

```bash
# Sample tests
gen 1 > $
gen 2 > $

# Large tests
gen 1000 10000 > {3..10}
```

---

## Complete Example

### Config.json

```json
{
  "name": "my-problem",
  "timeLimit": 2000,
  "memoryLimit": 512,
  "inputFile": "stdin",
  "outputFile": "stdout",
  "interactive": false,

  "generators": [
    {
      "name": "gen-random",
      "source": "./generators/random.cpp",
      "sourceType": "cpp.g++17"
    },
    {
      "name": "gen-large",
      "source": "./generators/large.cpp",
      "sourceType": "cpp.g++17"
    }
  ],

  "testsets": [
    {
      "name": "tests",
      "generatorScript": {
        "commands": [
          {
            "type": "manual",
            "manualFile": "./tests/manual/sample1.txt",
            "group": "samples"
          },
          {
            "type": "manual",
            "manualFile": "./tests/manual/sample2.txt",
            "group": "samples"
          },
          {
            "type": "generator-single",
            "generator": "gen-random",
            "args": ["1"],
            "group": "small"
          },
          {
            "type": "generator-single",
            "generator": "gen-random",
            "args": ["2"],
            "group": "small"
          },
          {
            "type": "generator-range",
            "generator": "gen-random",
            "range": [3, 10],
            "group": "medium"
          },
          {
            "type": "generator-range",
            "generator": "gen-large",
            "args": ["1000"],
            "range": [1, 20],
            "group": "large"
          }
        ]
      },
      "groupsEnabled": true,
      "groups": [
        {
          "name": "samples",
          "pointsPolicy": "EACH_TEST",
          "feedbackPolicy": "COMPLETE",
          "dependencies": []
        },
        {
          "name": "small",
          "pointsPolicy": "EACH_TEST",
          "feedbackPolicy": "ICPC",
          "dependencies": ["samples"]
        },
        {
          "name": "medium",
          "pointsPolicy": "COMPLETE_GROUP",
          "feedbackPolicy": "ICPC",
          "dependencies": ["samples", "small"]
        },
        {
          "name": "large",
          "pointsPolicy": "COMPLETE_GROUP",
          "feedbackPolicy": "POINTS",
          "dependencies": ["samples", "small", "medium"]
        }
      ]
    },
    {
      "name": "stress",
      "generatorScript": {
        "script": "gen-random 1..100 > $"
      },
      "groupsEnabled": false
    }
  ],

  "solutions": [...],
  "checker": {...},
  "validator": {...},
  "statements": {...}
}
```

### Usage

```bash
# List testsets
polyman list-testsets
# Output:
#   1. tests: 32 tests, groups: samples, small, medium, large
#   2. stress: 100 tests, groups: none

# Generate all testsets
polyman generate all

# Generate only main testset
polyman generate tests

# Generate samples group
polyman generate tests samples

# Generate test 5 specifically
polyman generate tests 5

# Validate all testsets
polyman validate all

# Validate specific testset
polyman validate tests

# Validate samples group
polyman validate tests samples

# Validate test 5 specifically
polyman validate tests 5

# Run solution on testset
polyman run-solution main all
```

---

## Output Structure

Tests are organized by testset:

```
tests/
  tests/           # Main testset
    test1.txt
    test2.txt
    ...
    test32.txt
  stress/          # Stress testset
    test1.txt
    test2.txt
    ...
    test100.txt
```

---

## Advanced: Polygon Script Parser

The script parser converts Polygon format to structured commands:

### Input (Polygon Script)

```
gen 1 > $
gen 2 > $
gen 10 20 > {3..5}
gen-large 1..10 > $
manual ./tests/sample.txt > $
```

### Output (Structured Commands)

```json
[
  { "type": "generator-single", "generator": "gen", "args": ["1"] },
  { "type": "generator-single", "generator": "gen", "args": ["2"] },
  { "type": "generator-single", "generator": "gen", "args": ["10", "20"] },
  { "type": "generator-single", "generator": "gen", "args": ["10", "20"] },
  { "type": "generator-single", "generator": "gen", "args": ["10", "20"] },
  {
    "type": "generator-range",
    "generator": "gen-large",
    "range": [1, 10],
    "args": []
  },
  { "type": "manual", "manualFile": "./tests/sample.txt" }
]
```

---

## Troubleshooting

### Common Errors

**Error: Testset "tests" not found**

- Check `Config.json` has a testsets array
- Verify testset name matches exactly (case-sensitive)

**Error: Generator "gen-random" not found**

- Check generator is defined in `generators` array
- Verify generator name matches in script

**Error: Manual test file not found**

- Check file path is relative to project root
- Verify file exists

**Error: Test index out of range**

- Count the commands in your generator script
- Indices are 1-based, not 0-based

---

## Migration from Old System

If you're migrating from the old testRange system:

### Before (Old)

```json
{
  "generators": [
    {
      "name": "gen",
      "source": "./generators/gen.cpp",
      "testRange": { "from": 1, "to": 10 }
    }
  ]
}
```

### After (New)

```json
{
  "generators": [
    {
      "name": "gen",
      "source": "./generators/gen.cpp"
    }
  ],
  "testsets": [
    {
      "name": "tests",
      "generatorScript": {
        "commands": [
          {
            "type": "generator-range",
            "generator": "gen",
            "range": [1, 10]
          }
        ]
      }
    }
  ]
}
```

See `MIGRATION.md` for detailed migration instructions.

---

## Best Practices

1. **Use structured commands** for better readability and IDE support
2. **Organize tests into groups** for better feedback and scoring
3. **Start with manual tests** for samples/examples
4. **Use generator-range** for large test sets
5. **Set proper dependencies** between test groups
6. **Test your generators** before generating full testsets
7. **Keep generator scripts** version controlled

---

## API Reference

See:

- `src/helpers/testset.ts` - Testset management functions
- `src/helpers/script-parser.ts` - Polygon script parser
- `src/types.d.ts` - Type definitions for testsets and generator scripts
