# Source Types Reference

This document lists all supported source types (compilers/interpreters) for different file types in polyman.

## Overview

- **Solutions**: Can be written in C++, Java, or Python
- **Generators**: Must be C++ (require testlib.h)
- **Validators**: Must be C++ (require testlib.h)
- **Checkers**: Must be C++ (require testlib.h)

---

## C++ Source Types

### Modern C++ (Recommended)

```typescript
'cpp.g++17'; // G++ with C++17 standard (recommended)
'cpp.g++20'; // G++ with C++20 standard
```

### Older C++ Standards

```typescript
'cpp.g++11'; // G++ with C++11 standard
'cpp.g++14'; // G++ with C++14 standard
```

### Microsoft Visual C++

```typescript
'cpp.ms2017'; // MSVC 2017
'cpp.ms2019'; // MSVC 2019
```

### Clang

```typescript
'cpp.clang++17'; // Clang with C++17
'cpp.clang++20'; // Clang with C++20
```

---

## Java Source Types

```typescript
'java.8'; // Java 8
'java.11'; // Java 11 (LTS)
'java.17'; // Java 17 (LTS)
'java.21'; // Java 21 (LTS)
```

---

## Python Source Types

### CPython

```typescript
'python.2'; // Python 2.7 (deprecated)
'python.3'; // Python 3.x
```

### PyPy (JIT-compiled)

```typescript
'python.pypy2'; // PyPy for Python 2
'python.pypy3'; // PyPy for Python 3 (faster)
```

---

## Usage Examples

### Solutions (Any Language)

```json
{
  "solutions": [
    {
      "name": "main",
      "source": "./solutions/main.cpp",
      "tag": "MA",
      "sourceType": "cpp.g++17"
    },
    {
      "name": "java_solution",
      "source": "./solutions/Solution.java",
      "tag": "OK",
      "sourceType": "java.11"
    },
    {
      "name": "python_solution",
      "source": "./solutions/solution.py",
      "tag": "OK",
      "sourceType": "python.3"
    }
  ]
}
```

### Generators (C++ Only)

```json
{
  "generators": [
    {
      "name": "gen-random",
      "source": "./generators/random.cpp",
      "sourceType": "cpp.g++17"
    },
    {
      "name": "gen-large",
      "source": "./generators/large.cpp",
      "sourceType": "cpp.g++20"
    }
  ]
}
```

### Validator (C++ Only)

```json
{
  "validator": {
    "name": "validator",
    "source": "./validator/val.cpp",
    "sourceType": "cpp.g++17"
  }
}
```

### Checker (C++ Only)

```json
{
  "checker": {
    "name": "checker",
    "source": "./checker/chk.cpp",
    "sourceType": "cpp.g++17",
    "isStandard": false
  }
}
```

---

## TypeScript Type Definitions

### For Solutions

```typescript
type SolutionSourceType =
  | CppSourceType // Any C++ compiler
  | JavaSourceType // Any Java version
  | PythonSourceType; // Any Python interpreter
```

### For Generators, Validators, Checkers

```typescript
type TestlibSourceType = CppSourceType; // C++ only
```

This ensures type safety - you cannot accidentally assign a Python source type to a validator!

---

## Recommendations

### C++ Projects

**Recommended**: `cpp.g++17`

- Wide support
- Modern features (auto, lambdas, range-based for)
- Good balance of features and compatibility

**For Cutting Edge**: `cpp.g++20`

- Latest features (concepts, ranges, coroutines)
- May not be available on older judges

### Java Projects

**Recommended**: `java.11`

- LTS (Long Term Support)
- Modern features (var, improved streams)
- Wide availability

**For Latest Features**: `java.17` or `java.21`

- Both are LTS versions
- More modern syntax and APIs

### Python Projects

**For Compatibility**: `python.3`

- Standard CPython
- Reliable and widely supported

**For Speed**: `python.pypy3`

- JIT compilation (much faster)
- Great for CPU-intensive solutions
- May have slightly different behavior

---

## Polygon Compatibility

All these source types are officially supported by Codeforces Polygon. They map directly to Polygon's compiler/interpreter configurations.

When uploading to Polygon via the SDK:

```typescript
await sdk.saveSolution(problemId, 'main.cpp', code, 'MA', {
  sourceType: 'cpp.g++17', // Polygon recognizes this
});
```

---

## Type Safety

The TypeScript type system enforces correct source types:

```typescript
// ✅ Valid - Solutions can use any language
const solution: LocalSolution = {
  name: 'main',
  source: './main.py',
  tag: 'MA',
  sourceType: 'python.3', // OK
};

// ❌ Invalid - Validators must be C++
const validator: LocalValidator = {
  name: 'val',
  source: './val.py',
  sourceType: 'python.3', // ❌ Type error!
};

// ✅ Valid - Validators with C++
const validValidator: LocalValidator = {
  name: 'val',
  source: './val.cpp',
  sourceType: 'cpp.g++17', // ✅ OK
};
```

---

## Default Values

If `sourceType` is omitted:

- **C++ files** → Defaults to `cpp.g++17`
- **Java files** → Defaults to `java.11`
- **Python files** → Defaults to `python.3`

However, it's **recommended to always specify** the source type explicitly for clarity and consistency.

---

## Migration Notes

If you're updating old configuration files:

**Before** (old style):

```json
{
  "sourceType": "cpp.g++"
}
```

**After** (new style):

```json
{
  "sourceType": "cpp.g++17"
}
```

Make sure to use the full, specific compiler version for better control and reproducibility.
