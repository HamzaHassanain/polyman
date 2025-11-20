# Quick Reference: Testset Management

## CLI Commands

### List Testsets

```bash
polyman list-testsets
```

### Generate Tests

```bash
# All testsets
polyman generate all

# Specific testset
polyman generate tests

# Specific group
polyman generate tests samples

# Single test
polyman generate tests 5
```

### Validate Tests

```bash
# All testsets
polyman validate all

# Specific testset
polyman validate tests

# Specific group
polyman validate tests samples

# Single test
polyman validate tests 5
```

## Configuration Formats

### Method 1: Structured Commands (Recommended)

```json
{
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
            "type": "generator-single",
            "generator": "gen-random",
            "args": ["10", "100"],
            "group": "main"
          },
          {
            "type": "generator-range",
            "generator": "gen-large",
            "range": [1, 10],
            "group": "large"
          }
        ]
      }
    }
  ]
}
```

### Method 2: Polygon Script String

```json
{
  "testsets": [
    {
      "name": "tests",
      "generatorScript": {
        "script": "gen 1 > $\ngen 2 > $\ngen 10 100 > {3..5}"
      }
    }
  ]
}
```

### Method 3: External Script File

```json
{
  "testsets": [
    {
      "name": "tests",
      "generatorScript": {
        "scriptFile": "./tests/generation-script.txt"
      }
    }
  ]
}
```

## Polygon Script Syntax

```bash
# Single test
gen 1 > $

# Multiple tests (expands to 3 commands)
gen 10 100 > {3..5}

# Generator range (one command, 10 iterations)
gen 1..10 > $

# Manual test
manual ./tests/sample.txt > $

# Comments
# This is ignored
```

## Command Types

| Type               | Description                  | Example                                                               |
| ------------------ | ---------------------------- | --------------------------------------------------------------------- |
| `manual`           | Copy manual test file        | `{ "type": "manual", "manualFile": "./tests/sample.txt" }`            |
| `generator-single` | Run generator once           | `{ "type": "generator-single", "generator": "gen", "args": ["10"] }`  |
| `generator-range`  | Run generator multiple times | `{ "type": "generator-range", "generator": "gen", "range": [1, 10] }` |

## Test Groups

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

### Points Policies

- `EACH_TEST` - Points per test
- `COMPLETE_GROUP` - Points only if all pass

### Feedback Policies

- `NONE` - No feedback
- `POINTS` - Points only
- `ICPC` - First error only
- `COMPLETE` - Full feedback

## Output Structure

```
tests/
  tests/        # Main testset
    test1.txt
    test2.txt
    ...
  stress/       # Stress testset
    test1.txt
    test2.txt
    ...
```

## Common Patterns

### Sample Tests

```json
{
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
    }
  ]
}
```

### Random Tests

```json
{
  "commands": [
    {
      "type": "generator-range",
      "generator": "gen-random",
      "range": [1, 20],
      "group": "main"
    }
  ]
}
```

### Large Tests

```json
{
  "commands": [
    {
      "type": "generator-single",
      "generator": "gen-large",
      "args": ["1000000"],
      "group": "large"
    }
  ]
}
```

### Mixed Testset

```json
{
  "commands": [
    {
      "type": "manual",
      "manualFile": "./tests/sample1.txt",
      "group": "samples"
    },
    {
      "type": "manual",
      "manualFile": "./tests/sample2.txt",
      "group": "samples"
    },
    {
      "type": "generator-range",
      "generator": "gen-small",
      "range": [1, 5],
      "group": "small"
    },
    {
      "type": "generator-range",
      "generator": "gen-medium",
      "range": [1, 10],
      "group": "medium"
    },
    {
      "type": "generator-range",
      "generator": "gen-large",
      "range": [1, 10],
      "group": "large"
    }
  ]
}
```

## Troubleshooting

| Error                      | Solution                                     |
| -------------------------- | -------------------------------------------- |
| Testset "X" not found      | Check testsets array in Config.json          |
| Generator "X" not found    | Add generator to generators array            |
| Manual test file not found | Check file path is relative to project root  |
| Test index out of range    | Count commands in generator script (1-based) |

## See Also

- `TESTSET_MANAGEMENT.md` - Complete guide
- `TEST_GENERATION.md` - Original test generation docs
- `MIGRATION.md` - Migration from old system
- `SOURCE_TYPES.md` - Compiler/interpreter types
