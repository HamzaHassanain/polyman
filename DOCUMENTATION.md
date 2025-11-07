## Table of Contents

1. [Introduction](#introduction)
2. [Installation](#installation)
3. [Quick Start](#quick-start)
4. [Configuration](#configuration)
5. [Command Reference](#command-reference)
6. [Workflows](#workflows)
7. [File Structure](#file-structure)
8. [Solution Types](#solution-types)
9. [Checker System](#checker-system)
10. [Validator System](#validator-system)
11. [Generator System](#generator-system)
12. [Troubleshooting](#troubleshooting)
13. [Best Practices](#best-practices)
14. [Examples](#examples)
15. [FAQ](#faq)
16. [Contributing](#contributing)

---

## Introduction

**Polyman** is a CLI tool designed for Codeforces problem setters to manage competitive programming problems directly from the terminal. It streamlines the entire problem preparation workflow, from template creation to complete verification.

### Features

- **Template Creation**: Scaffold new problems with complete directory structure
- **Test Generation**: Automated test case generation using custom generators
- **Validation**: Validate test inputs with custom validators
- **Solution Testing**: Run and verify multiple solution types (correct, TLE, WA, etc.)
- **Checker Integration**: Support for custom and standard testlib checkers
- **Full Verification**: Complete problem verification workflow in one command

---

## Installation

### Prerequisites

- **Node.js** (v14 or higher)
- **C++ Compiler** (g++ with C++23 support)
- **Python 3** (optional, for Python solutions)
- **Java JDK** (optional, for Java solutions)

### Install from npm

```bash
npm install -g polyman
```

### Install from Source

```bash
git clone https://github.com/yourusername/polyman.git
cd polyman
npm install
npm run build
npm link
```

### Verify Installation

```bash
polyman --version
```

---

## Quick Start

### 1. Create a New Problem

```bash
polyman new my-problem
cd my-problem
```

This creates a directory structure with all necessary files for problem development.

### 2. Configure Your Problem

Edit `Config.json` to set up your problem parameters, solutions, generators, checker, and validator.

### 3. Generate Tests

```bash
polyman run-generator all
```

### 4. Verify Everything

```bash
polyman verify
```

---

## Configuration

### Config.json Structure

```json
{
  "name": "problem-name",
  "version": "1.0",
  "description": "Problem description",
  "time-limit": 2000,
  "memory-limit": 256,
  "tags": ["math", "implementation"],

  "tags": ["difficulty"],

  "statements": {
    "english": {
      "title": "Problem Title"
    }
  },

  "solutions": [
    {
      "name": "main",
      "source": "solutions/Solution.cpp",
      "type": "main-correct"
    },
    {
      "name": "wa-solution",
      "source": "solutions/WA.cpp",
      "type": "wa"
    }
  ],

  "generators": [
    {
      "name": "gen-small",
      "source": "generators/Small.cpp",
      "tests-range": [1, 5]
    },
    {
      "name": "gen-large",
      "source": "generators/Large.cpp",
      "tests-range": [6, 10]
    }
  ],

  "checker": {
    "custom": false,
    "source": "ncmp.cpp"
  },

  "validator": {
    "source": "validator/Validator.cpp"
  }
}
```

### Configuration Fields

#### Required Fields

- **`name`** (string): Problem identifier
- **`tag`** (string): Difficulty tag
- **`time-limit`** (number): Time limit in milliseconds
- **`memory-limit`** (number): Memory limit in MB
- **`solutions`** (array): Solution configurations
- **`checker`** (object): Checker configuration
- **`validator`** (object): Validator configuration

#### Solution Configuration

```json
{
  "name": "solution-identifier",
  "source": "path/to/source.cpp",
  "type": "solution-type"
}
```

**Solution Types:**

- `main-correct` - Must exist, exactly one per problem
- `correct` - Additional correct solution
- `wa` - Wrong answer (must fail on ≥1 test)
- `tle` - Time limit exceeded
- `mle` - Memory limit exceeded
- `pe` - Presentation error
- `failed` - Runtime error

#### Checker Configuration

**Custom Checker:**

```json
{
  "custom": true,
  "source": "checker/chk.cpp"
}
```

**Standard Checker:**

```json
{
  "custom": false,
  "source": "ncmp.cpp"
}
```

#### Generator Configuration

```json
{
  "generators": [
    {
      "name": "generator-name",
      "source": "generators/Generator.cpp",
      "tests-range": [start, end]
    }
  ]
}
```

- `tests-range`: [inclusive start, inclusive end]
- Example: `[1, 10]` generates test1.txt through test10.txt

#### Samples and Manual Tests

- Please Note that, we termproraly put sample tests and manual tests inside the generators, but without a source, like below:

```json
{
  "generators": [
    {
      // name must be "samples" for sample tests
      "name": "samples",
      "source": "NA",
      "tests-range": [1, 2]
    },
    {
      // name must be "manual" for manual tests
      "name": "manual",
      "source": "NA",
      "tests-range": [3, 4]
    }
  ]
}
```

- Also note that, you must create `tests/test1.txt`, `tests/test2.txt` files manually for sample tests, it must be named exactly like that.
- Same for manual tests, you must create `tests/test3.txt`, `tests/test4.txt` files manually for manual tests.

---

## Command Reference

Creates a new problem template in the specified directory.

**Example:**

```bash
polyman new two-sum
```

**Output:**

- Complete problem structure
- Template files for solution, generator, validator, and checker
- Sample configuration file

---

### `polyman download-testlib`

Downloads `testlib.h` from the official repository to the current directory.

**Example:**

```bash
polyman download-testlib
```

**Post-Installation:**

- **Linux/Mac**: Copy to `/usr/include/` or `/usr/local/include/`
- **Windows (MinGW)**: Copy to `C:\MinGW\include\`

---

### `polyman list-checkers`

Lists all available standard checkers with descriptions.

**Example:**

```bash
polyman list-checkers
```

**Sample Output:**

```
 1. ncmp.cpp       → Compares signed int64 numbers
 2. wcmp.cpp       → Compares sequences of tokens
 3. fcmp.cpp       → Compares files line by line
 4. dcmp.cpp       → Compares doubles with precision 1E-6
 5. yesno.cpp      → YES/NO checker (case insensitive)
```

**Available Checkers:**

- [`ncmp.cpp`](assets/checkers/ncmp.cpp) - Integer comparison
- [`wcmp.cpp`](assets/checkers/wcmp.cpp) - Token sequence comparison
- [`fcmp.cpp`](assets/checkers/fcmp.cpp) - Line-by-line comparison
- [`dcmp.cpp`](assets/checkers/dcmp.cpp) - Double comparison (1E-6 precision)
- [`rcmp.cpp`](assets/checkers/rcmp.cpp) - Double comparison (1.5E-6 precision)
- [`yesno.cpp`](assets/checkers/yesno.cpp) - YES/NO validation
- [`hcmp.cpp`](assets/checkers/hcmp.cpp) - Huge integer comparison
- [`uncmp.cpp`](assets/checkers/uncmp.cpp) - Unordered sequence comparison

---

### `polyman run-generator <generator-name>`

Runs test generators to create test files.

**Examples:**

```bash
# Run specific generator
polyman run-generator gen-random

# Run all generators
polyman run-generator all
```

**Generator Requirements:**

- Must accept test number as command-line argument
- Must output test to stdout
- Example: `./generator 5` generates test5.txt

**Sample Generator (C++):**

```cpp
#include <iostream>
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);
    int n = rnd.next(1, 100);
    cout << n << endl;
    return 0;
}
```

---

### `polyman run-validator <test-number|all>`

Validates test inputs using the configured validator.

**Examples:**

```bash
# Validate specific test
polyman run-validator 5

# Validate all tests
polyman run-validator all
```

**Validator Requirements:**

- Must read from stdin
- Must exit with code 0 for valid input
- Must exit with non-zero for invalid input
- Should use testlib.h for proper error messages

**Sample Validator (C++):**

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerValidation(argc, argv);
    int n = inf.readInt(1, 100, "n");
    inf.readEoln();
    inf.readEof();
    return 0;
}
```

---

### `polyman run-solution <solution-name> <test-number|all>`

Executes solutions on test inputs to generate outputs.

**Examples:**

```bash
# Run specific solution on all tests
polyman run-solution main all

# Run solution on specific test
polyman run-solution wa-solution 5

# Run all solutions
polyman run-solution all all
```

**Output Location:**

- Outputs saved to `solutions-outputs/<solution-name>/output_test*.txt`

**Solution Types:**

- `main-correct` - Reference solution (always correct)
- `correct` - Alternative correct solution
- `wa` - Wrong Answer solution
- `tle` - Time Limit Exceeded solution
- `mle` - Memory Limit Exceeded solution
- `pe` - Presentation Error solution
- `failed` - Runtime error solution

---

### `polyman test <what>`

Tests validators, checkers, or solutions against expected behavior.

**Examples:**

```bash
# Test validator against validator_tests.json
polyman test validator

# Test checker against checker_tests.json
polyman test checker

# Test WA solution (ensures it gets WA on at least one test)
polyman test wa-solution
```

**Test Files:**

**Validator Tests** ([`validator/validator_tests.json`](template/validator/validator_tests.json)):

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

**Checker Tests** ([`checker/checker_tests.json`](template/checker/checker_tests.json)):

```json
{
  "tests": [
    {
      "stdin": "5",
      "stdout": "YES",
      "answer": "YES",
      "verdict": "OK"
    },
    {
      "stdin": "5",
      "stdout": "NO",
      "answer": "YES",
      "verdict": "WA"
    }
  ]
}
```

---

### `polyman verify`

Runs complete problem verification workflow.

**Example:**

```bash
polyman verify
```

**Verification Steps:**

1. ✅ Generate all tests
2. ✅ Test validator (self-tests)
3. ✅ Validate all generated tests
4. ✅ Test checker (self-tests)
5. ✅ Run all solutions
6. ✅ Verify solution behaviors against expected types

**Success Criteria:**

- All tests generated successfully
- Validator passes self-tests
- All tests are valid
- Checker passes self-tests
- Main solution produces correct outputs
- WA solutions get WA on at least one test
- TLE solutions exceed time limit appropriately
- All verdicts match expected solution types

---

## Workflows

### Complete Problem Preparation Workflow

Follow this end-to-end workflow to create a complete problem:

#### Step 1: Create Template

```bash
polyman new my-problem
cd my-problem
```

#### Step 2: Write Main Solution

Edit `solutions/Solution.cpp`:

```cpp
#include <iostream>
using namespace std;

int main() {
    int n;
    cin >> n;
    cout << n * n << endl;
    return 0;
}
```

#### Step 3: Write Validator

Edit `validator/Validator.cpp`:

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerValidation(argc, argv);
    int n = inf.readInt(1, 1000, "n");
    inf.readEoln();
    inf.readEof();
    return 0;
}
```

#### Step 4: Create Validator Tests

Edit `validator/validator_tests.json`:

```json
{
  "tests": [
    { "stdin": "1\n", "expectedVerdict": "VALID" },
    { "stdin": "1000\n", "expectedVerdict": "VALID" },
    { "stdin": "0\n", "expectedVerdict": "INVALID" },
    { "stdin": "1001\n", "expectedVerdict": "INVALID" }
  ]
}
```

#### Step 5: Write Generator

Edit `generators/Generator.cpp`:

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);
    int testNum = atoi(argv[1]);
    int n = rnd.next(1, min(100 * testNum, 1000));
    cout << n << endl;
    return 0;
}
```

#### Step 6: Configure Checker

For numeric output, use standard checker in `Config.json`:

```json
"checker": {
  "custom": false,
  "source": "ncmp.cpp"
}
```

For custom verification, write `checker/chk.cpp`.

#### Step 7: Update Config.json

```json
{
  "name": "square-number",
  "tag": "easy",
  "time-limit": 1000,
  "memory-limit": 256,
  "solutions": [
    {
      "name": "main",
      "source": "solutions/Solution.cpp",
      "type": "main-correct"
    }
  ],
  "generators": [
    {
      "name": "gen-all",
      "source": "generators/Generator.cpp",
      "tests-range": [1, 20]
    }
  ],
  "checker": {
    "custom": false,
    "source": "ncmp.cpp"
  },
  "validator": {
    "source": "validator/Validator.cpp"
  }
}
```

#### Step 8: Verify Problem

```bash
polyman verify
```

### Adding Wrong Answer Solutions Workflow

#### Create WA Solution

`solutions/WA.cpp`:

```cpp
#include <iostream>
using namespace std;

int main() {
    int n;
    cin >> n;
    cout << n * n + 1 << endl; // Intentionally wrong
    return 0;
}
```

#### Add to Config.json

```json
{
  "solutions": [
    {
      "name": "main",
      "source": "solutions/Solution.cpp",
      "type": "main-correct"
    },
    {
      "name": "wa-solution",
      "source": "solutions/WA.cpp",
      "type": "wa"
    }
  ]
}
```

#### Test WA Solution

```bash
# Test against main solution
polyman test wa-solution

# Or run full verification
polyman verify
```

**Expected Behavior:**

- WA solution must get WA verdict on ≥1 test
- Polyman validates this automatically

### Multiple Generators Workflow

Create different generators for different test groups:

```json
{
  "generators": [
    {
      "name": "gen-small",
      "source": "generators/Small.cpp",
      "tests-range": [1, 5]
    },
    {
      "name": "gen-medium",
      "source": "generators/Medium.cpp",
      "tests-range": [6, 15]
    },
    {
      "name": "gen-large",
      "source": "generators/Large.cpp",
      "tests-range": [16, 30]
    }
  ]
}
```

Run specific generator:

```bash
polyman run-generator gen-large
```

---

## File Structure

When you create a new problem with `polyman new <directory>`, the following structure is generated:

### NOTE: Keep in mind that, you must not change any of the directory names, as Polyman relies on these names to function properly.

```
my-problem/
├── Config.json                    # Main configuration file
├── testlib.h                      # Testlib header (if downloaded)
│
├── solutions/                  # Solution files
│   ├── acc.cpp                 # Main correct solution (required)
│   ├── acc2.java               # Other correct solution (Java)
│   └── tle.py                  # TLE solution (Python)
│
├── generators/                    # Test generators
│   └── gen.cpp                     # Main generator
│
├── checker/                       # Output checker
│   ├── chk.cpp                   # Custom checker template (YES/NO)
│   └── checker_tests.json        # Checker test cases
│
├── validator/                     # Input validator
│   ├── val.cpp                    # Validator implementation
│   └── validator_tests.json      # Validator test cases
│
├── statements/                    # Problem statements (LaTeX)
│   ├── english/
│   │   ├── legend.tex
│   │   ├── input-format.tex
│   │   ├── output-format.tex
│   │   └── notes.tex
│   └── russian/
│       ├── legend.tex
│       ├── input-format.tex
│       └── output-format.tex
│
├── tests/                         # Generated test files
│   ├── test1.txt                 # Sample test
│   ├── test2.txt                 # Sample test
│
└── solutions-outputs/             # Solution outputs (auto-created)
    ├── main/
    │   ├── output_test1.txt
    │   └── output_test*.txt
    └── <solution-name>/
        └── output_test*.txt
```

### Key Files Explained

#### Config.json

The central configuration file that defines:

- Problem metadata (name, tag, limits)
- Solutions and their types
- Generators and test ranges
- Checker configuration
- Validator configuration

#### solutions/

Contains all solution implementations:

- **acc.cpp**: Main correct solution (required, must be type `main-correct`) (you may change the name as you want but do not forget to update the `Config.json` accordingly)
- Additional solutions for testing (WA, TLE, etc.)
- Supports C++, Python, and Java

#### generators/

Contains test generation programs:

- Must accept test number as command-line argument
- Must output test to stdout
- Uses testlib.h for random generation
- ONLY C++ is supported for generators

#### validator/

Contains input validation logic:

- **Validator.cpp**: Checks if test input is valid
- **validator_tests.json**: Self-tests for validator
- Uses testlib.h for input reading
- ONLY C++ is supported for validators

#### checker/

Contains output verification logic:

- **chk.cpp**: Custom checker (if needed)
- **checker_tests.json**: Self-tests for checker
- Can use standard checkers (ncmp, wcmp, etc.)
- ONLY C++ is supported for checkers

#### tests/

Contains all test files:

- Manual tests (test1.txt, test2.txt)
- Auto-generated tests (test3.txt, test4.txt, ...)
- Input files used by solutions

#### solutions-outputs/

Auto-created directory containing solution outputs:

- Organized by solution name
- Used for comparison and verification
- Generated by `polyman run-solution`

---

## Solution Types

Polyman supports various solution types to test different aspects of your problem:

### Main Correct Solution (`main-correct`)

**Purpose**: The reference solution that always produces correct output.

**Requirements**:

- Exactly one per problem
- Must pass all tests
- Used as reference for comparing other solutions

**Example Config**:

```json
{
  "name": "main",
  "source": "solutions/acc.cpp",
  "type": "main-correct"
}
```

### Additional Correct Solution (`correct`)

**Purpose**: Alternative correct implementations.

**Use Cases**:

- Testing different algorithms
- Verifying multiple approaches work
- Language-specific implementations

**Example**:

```json
{
  "name": "python-solution",
  "source": "solutions/solution.py",
  "type": "correct"
}
```

### Wrong Answer Solution (`wa`)

**Purpose**: Solutions that produce incorrect output.

**Requirements**:

- Must get WA verdict on at least one test
- Verified by `polyman verify` or when testing solutions

**Example**:

```cpp
// solutions/WA.cpp
#include <iostream>
using namespace std;

int main() {
    int n;
    cin >> n;
    cout << n * n + 1 << endl; // Off by one error
    return 0;
}
```

**Config**:

```json
{
  "name": "wa-solution",
  "source": "solutions/WA.cpp",
  "type": "wa"
}
```

### Time Limit Exceeded Solution (`tle`)

**Purpose**: Solutions that are too slow.

**Use Cases**:

- Testing time limits are appropriate
- Demonstrating inefficient algorithms

**Example**:

```cpp
// solutions/TLE.cpp - O(n²) when O(n) is required
#include <iostream>
using namespace std;

int main() {
    int n;
    cin >> n;

    long long sum = 0;
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < n; j++) {
            sum += i * j;
        }
    }

    cout << sum << endl;
    return 0;
}
```

**Config**:

```json
{
  "name": "tle-solution",
  "source": "solutions/TLE.cpp",
  "type": "tle"
}
```

### Memory Limit Exceeded Solution (`mle`)

**Purpose**: Solutions that use too much memory.

**Example**:

```cpp
// solutions/MLE.cpp
#include <iostream>
#include <vector>
using namespace std;

int main() {
    int n;
    cin >> n;

    // Allocate way too much memory
    vector<int> huge(1000000000);
    cout << n << endl;
    return 0;
}
```

**Config**:

```json
{
  "name": "mle-solution",
  "source": "solutions/MLE.cpp",
  "type": "mle"
}
```

### Presentation Error Solution (`pe`)

**Purpose**: Solutions with formatting issues.

**Example**:

```cpp
// solutions/PE.cpp
#include <iostream>
using namespace std;

int main() {
    int n;
    cin >> n;
    cout << n * n << " "; // Extra space
    return 0;
}
```

**Config**:

```json
{
  "name": "pe-solution",
  "source": "solutions/PE.cpp",
  "type": "pe"
}
```

### Failed/Runtime Error Solution (`failed`)

**Purpose**: Solutions that crash or exit with errors.

**Example**:

```cpp
// solutions/RTE.cpp
#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> v;
    cout << v[100] << endl; // Out of bounds
    return 0;
}
```

**Config**:

```json
{
  "name": "rte-solution",
  "source": "solutions/RTE.cpp",
  "type": "failed"
}
```

### Multi-Language Solutions

**Python**:

```python
# solutions/solution.py
n = int(input())
print(n * n)
```

**Java**:

```java
// solutions/Solution.java
import java.util.Scanner;

public class Solution {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        System.out.println(n * n);
    }
}
```

**Config**:

```json
{
  "solutions": [
    {
      "name": "main",
      "source": "solutions/Solution.cpp",
      "type": "main-correct"
    },
    {
      "name": "python-sol",
      "source": "solutions/solution.py",
      "type": "correct"
    },
    {
      "name": "java-sol",
      "source": "solutions/Solution.java",
      "type": "correct"
    }
  ]
}
```

---

## Checker System

Checkers validate solution output against expected answers. Polyman supports both standard and custom checkers.

### Standard Checkers

Built-in checkers from testlib for common verification patterns:

#### Available Standard Checkers

| Checker         | Description                          | Use Case                      |
| --------------- | ------------------------------------ | ----------------------------- |
| `ncmp.cpp`      | Integer comparison                   | Single or multiple integers   |
| `wcmp.cpp`      | Token sequence comparison            | Space-separated values        |
| `fcmp.cpp`      | Line-by-line comparison              | Exact file match              |
| `dcmp.cpp`      | Double comparison (1E-6)             | Floating-point numbers        |
| `rcmp.cpp`      | Double comparison (1.5E-6)           | Precise floating-point        |
| `rcmp4.cpp`     | Double comparison (1E-4)             | Less precise floating-point   |
| `rcmp6.cpp`     | Double comparison (1E-6)             | Standard floating-point       |
| `rcmp9.cpp`     | Double comparison (1E-9)             | High precision floating-point |
| `yesno.cpp`     | YES/NO validation (case-insensitive) | Binary output problems        |
| `hcmp.cpp`      | Huge integer comparison              | Big integers                  |
| `uncmp.cpp`     | Unordered sequence comparison        | Sets, any order               |
| `lcmp.cpp`      | Lines comparison                     | Multiline output              |
| `pointscmp.cpp` | Points/scores comparison             | Scoring problems              |

#### Using Standard Checkers

**Configuration**:

```json
{
  "checker": {
    "custom": false,
    "source": "ncmp.cpp"
  }
}
```

**List available checkers**:

```bash
polyman list-checkers
```

### Custom Checkers

For problems requiring specialized output validation.

#### When to Use Custom Checkers

- Multiple valid answers exist
- Complex validation logic needed
- Partial scoring required
- Format checking beyond standard comparisons

#### Custom Checker Template

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    // Register checker with testlib
    registerTestlibCmd(argc, argv);

    // Read input (from inf stream)
    int n = inf.readInt();

    // Read participant output (from ouf stream)
    int participant_answer = ouf.readInt();

    // Read jury answer (from ans stream)
    int jury_answer = ans.readInt();

    // Validate
    if (participant_answer == jury_answer) {
        quitf(_ok, "Correct answer: %d", participant_answer);
    } else {
        quitf(_wa, "Wrong answer: expected %d, found %d",
              jury_answer, participant_answer);
    }
}
```

#### Checker Streams

- **`inf`**: Input file (test input)
- **`ouf`**: Output file (participant's output)
- **`ans`**: Answer file (jury's answer/main solution output)

#### Checker Verdicts

```cpp
quitf(_ok, "message");        // Accepted
quitf(_wa, "message");        // Wrong Answer
quitf(_pe, "message");        // Presentation Error
quitf(_fail, "message");      // Checker failure (internal error)
quitf(_dirt, "message");      // Unexpected EOF or format error
quitf(_points, score, "msg"); // Partial score (0-1)
```

#### Example: Permutation Checker

```cpp
#include "testlib.h"
#include <set>
using namespace std;

int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);

    int n = inf.readInt();
    vector<int> perm(n);
    set<int> used;

    // Read participant's permutation
    for (int i = 0; i < n; i++) {
        perm[i] = ouf.readInt(1, n, format("perm[%d]", i));
        if (used.count(perm[i])) {
            quitf(_wa, "Duplicate element %d at position %d", perm[i], i + 1);
        }
        used.insert(perm[i]);
    }

    // Ensure it's a complete permutation
    if ((int)used.size() != n) {
        quitf(_wa, "Not a valid permutation: only %d unique elements",
              (int)used.size());
    }

    quitf(_ok, "Valid permutation");
}
```

#### Configuration for Custom Checker

```json
{
  "checker": {
    "custom": true,
    "source": "checker/chk.cpp"
  }
}
```

### Testing Checkers

Create `checker/checker_tests.json`:

```json
{
  "tests": [
    {
      "stdin": "3",
      "stdout": "1 2 3",
      "answer": "3 2 1",
      "verdict": "OK"
    },
    {
      "stdin": "3",
      "stdout": "1 1 2",
      "answer": "1 2 3",
      "verdict": "WA"
    },
    {
      "stdin": "3",
      "stdout": "1 2 3 4",
      "answer": "1 2 3",
      "verdict": "PE"
    }
  ]
}
```

**Run checker tests**:

```bash
polyman test checker
```

---

## Validator System

Validators ensure test inputs meet problem constraints.

### Purpose

- Verify all test inputs are valid
- Catch invalid test data before submission
- Document input constraints formally

### Validator Template

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerValidation(argc, argv);

    // Read and validate input
    int n = inf.readInt(1, 100000, "n");
    inf.readEoln();

    inf.readEof();
    return 0;
}
```

### Testlib Validation Functions

#### Integer Reading

```cpp
// Read integer in range [min, max]
int n = inf.readInt(1, 100, "n");

// Read long long
long long x = inf.readLong(1LL, 1000000000000LL, "x");

// Read unsigned long long
unsigned long long u = inf.readULong(0ULL, 1000000000ULL, "u");
```

#### String/Token Reading

```cpp
// Read single token (no spaces)
string s = inf.readToken();

// Read token matching pattern
string s = inf.readToken("[a-z]{1,10}", "s");

// Read entire line
string line = inf.readLine();

// Read line matching pattern
string line = inf.readLine("[a-z ]+", "line");

// Read word (alphanumeric)
string word = inf.readWord();
```

#### Line Ending & EOF

```cpp
// Expect end of line
inf.readEoln();

// Expect end of file
inf.readEof();

// Expect space
inf.readSpace();
```

### Example Validators

#### Simple Integer Validator

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerValidation(argc, argv);

    int n = inf.readInt(1, 1000, "n");
    inf.readEoln();
    inf.readEof();

    return 0;
}
```

#### Array Validator

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerValidation(argc, argv);

    int n = inf.readInt(1, 100000, "n");
    inf.readEoln();

    for (int i = 0; i < n; i++) {
        inf.readInt(1, 1000000000, format("a[%d]", i));
        if (i < n - 1) {
            inf.readSpace();
        }
    }
    inf.readEoln();

    inf.readEof();
    return 0;
}
```

#### Graph Validator

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerValidation(argc, argv);

    int n = inf.readInt(1, 100000, "n");
    inf.readSpace();
    int m = inf.readInt(0, min(200000, n * (n - 1) / 2), "m");
    inf.readEoln();

    set<pair<int, int>> edges;
    for (int i = 0; i < m; i++) {
        int u = inf.readInt(1, n, format("u[%d]", i));
        inf.readSpace();
        int v = inf.readInt(1, n, format("v[%d]", i));
        inf.readEoln();

        // Check no self-loops
        ensuref(u != v, "Self-loop at edge %d", i + 1);

        // Check no duplicate edges
        if (u > v) swap(u, v);
        ensuref(!edges.count({u, v}), "Duplicate edge %d-%d", u, v);
        edges.insert({u, v});
    }

    inf.readEof();
    return 0;
}
```

#### String Pattern Validator

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerValidation(argc, argv);

    string s = inf.readToken("[a-z]{1,100}", "s");
    inf.readEoln();
    inf.readEof();

    return 0;
}
```

### Validator Testing

Create `validator/validator_tests.json`:

```json
{
  "tests": [
    {
      "stdin": "5\n",
      "expectedVerdict": "VALID"
    },
    {
      "stdin": "100\n",
      "expectedVerdict": "VALID"
    },
    {
      "stdin": "0\n",
      "expectedVerdict": "INVALID"
    },
    {
      "stdin": "101\n",
      "expectedVerdict": "INVALID"
    },
    {
      "stdin": "5",
      "expectedVerdict": "INVALID"
    }
  ]
}
```

**Run validator tests**:

```bash
polyman test validator
```

### Best Practices for Validators

1. **Be Strict**: Validate exact format (spaces, newlines, EOF)
2. **Meaningful Names**: Use descriptive variable names in error messages
3. **Check Constraints**: Verify all problem constraints
4. **Test Edge Cases**: Include minimum, maximum, and boundary values
5. **Use Patterns**: Leverage regex patterns for string validation

---

## Generator System

Generators create test cases programmatically using pseudorandom generation.

### Purpose

- Automate test creation
- Ensure comprehensive test coverage
- Generate large tests easily
- Maintain reproducibility

### Generator Template

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);

    // Get test number from command line
    int testNum = atoi(argv[1]);

    // Generate test based on test number
    int n = rnd.next(1, 100 * testNum);
    cout << n << endl;

    return 0;
}
```

### Testlib Random Functions

#### Integer Generation

```cpp
// Random integer in [min, max]
int x = rnd.next(1, 100);

// Random long long
long long x = rnd.next(1LL, 1000000000000LL);

// Random unsigned
unsigned x = rnd.next(0u, 1000000000u);

// Weighted random (returns 1..n with probability proportional to weight)
int x = rnd.wnext(1, 100, weight); // weight: -1 (decreasing), 0 (uniform), 1 (increasing)
```

#### Array Generation

```cpp
// Random permutation
vector<int> p(n);
for (int i = 0; i < n; i++) p[i] = i + 1;
shuffle(p.begin(), p.end());

// Random array
vector<int> a(n);
for (int i = 0; i < n; i++) {
    a[i] = rnd.next(1, 1000000);
}
```

#### String Generation

```cpp
// Random lowercase string
string s = rnd.next("[a-z]{10,20}");

// Random pattern-matched string
string s = rnd.next("[A-Z][a-z]{5,10}");
```

#### Graph Generation

```cpp
// Random tree (n vertices)
cout << n << endl;
for (int i = 2; i <= n; i++) {
    int parent = rnd.next(1, i - 1);
    cout << parent << " " << i << endl;
}

// Random graph (n vertices, m edges)
set<pair<int, int>> edges;
while ((int)edges.size() < m) {
    int u = rnd.next(1, n);
    int v = rnd.next(1, n);
    if (u != v) {
        if (u > v) swap(u, v);
        edges.insert({u, v});
    }
}
for (auto [u, v] : edges) {
    cout << u << " " << v << endl;
}
```

### Example Generators

#### Simple Integer Generator

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);

    int testNum = atoi(argv[1]);

    // Scale based on test number
    int n = rnd.next(1, min(1000, 10 * testNum));
    cout << n << endl;

    return 0;
}
```

#### Array Generator

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);

    int testNum = atoi(argv[1]);
    int n = rnd.next(1, min(100000, 1000 * testNum));

    cout << n << endl;
    for (int i = 0; i < n; i++) {
        if (i > 0) cout << " ";
        cout << rnd.next(1, 1000000000);
    }
    cout << endl;

    return 0;
}
```

#### Tree Generator

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);

    int n = atoi(argv[1]);
    n = min(n * 100, 100000);

    cout << n << endl;

    // Generate random tree
    for (int i = 2; i <= n; i++) {
        int parent = rnd.next(1, i - 1);
        cout << parent << " " << i << endl;
    }

    return 0;
}
```

#### Multiple Test Cases Generator

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);

    int t = rnd.next(1, 10); // Number of test cases
    cout << t << endl;

    for (int i = 0; i < t; i++) {
        int n = rnd.next(1, 100);
        cout << n << endl;
    }

    return 0;
}
```

### Generator Configuration

#### Single Generator

```json
{
  "generators": [
    {
      "name": "gen-all",
      "source": "generators/Generator.cpp",
      "tests-range": [1, 30]
    }
  ]
}
```

#### Multiple Generators

```json
{
  "generators": [
    {
      "name": "gen-small",
      "source": "generators/Small.cpp",
      "tests-range": [1, 10]
    },
    {
      "name": "gen-medium",
      "source": "generators/Medium.cpp",
      "tests-range": [11, 20]
    },
    {
      "name": "gen-large",
      "source": "generators/Large.cpp",
      "tests-range": [21, 50]
    },
    {
      "name": "gen-stress",
      "source": "generators/Stress.cpp",
      "tests-range": [51, 100]
    }
  ]
}
```

### Running Generators

```bash
# Run all generators
polyman run-generator all

# Run specific generator
polyman run-generator gen-large

# Run specific generator for specific test
./gen-large 25 > tests/test25.txt
```

### Generator Best Practices

1. **Seed Management**: testlib handles seeding automatically based on test number
2. **Progressive Difficulty**: Scale test size/difficulty with test number
3. **Edge Cases**: Include manual tests for edge cases (test1.txt, test2.txt)
4. **Validation**: Always validate generated tests with validator
5. **Reproducibility**: Same test number = same test (deterministic)

---

## Troubleshooting

### Common Issues

#### 1. Validator Compilation Fails

**Error:**

```
Failed to compile validator
```

**Solution:**

- Ensure testlib.h is installed: `polyman download-testlib`
- Check C++ compiler: `g++ --version`
- Verify validator syntax

#### 2. Generator Doesn't Produce Output

**Error:**

```
Generated test file is empty
```

**Solution:**

- Generator must write to stdout
- Test manually: `./generator 1`
- Check for runtime errors

#### 3. Checker Always Returns WA

**Solution:**

- Test checker manually:
  ```bash
  ./checker input.txt output.txt answer.txt
  ```
- Check testlib.h integration
- Verify file reading logic

#### 4. Solution Gets Unexpected Verdict

**Solution:**

- Run solution manually:
  ```bash
  ./solution < tests/test1.txt
  ```
- Check time/memory limits in Config.json
- Verify solution logic

#### 5. Tests Not Generated

**Error:**

```
No tests found in tests/ directory
```

**Solution:**

---

## Best Practices

### 1. Start Simple

Begin with minimal configuration:

- One main solution
- One generator
- Standard checker (if possible)
- Basic validator

**Rationale**: Get the core working before adding complexity.

### 2. Test Incrementally

Don't write everything at once. Test after each component:

```bash
# After writing validator
polyman test validator

# After writing generator
polyman run-generator all
polyman run-validator all

# After writing checker
polyman test checker

# After adding solutions
polyman run-solution all all

# Final verification
polyman verify
```

**Rationale**: Catch errors early when they're easier to fix.

### 3. Use Standard Checkers When Possible

Before writing a custom checker, verify if a standard one works:

```bash
polyman list-checkers
```

**Common Mappings**:

- Integer output → `ncmp.cpp`
- Float output → `dcmp.cpp` or `rcmp.cpp`
- Yes/No → `yesno.cpp`
- Token sequence → `wcmp.cpp`
- Exact match → `fcmp.cpp`

**Rationale**: Standard checkers are well-tested and save development time.

### 4. Version Control Everything

Initialize git repository from the start:

```bash
git init
git add .
git commit -m "Initial problem setup"
```

**Recommended `.gitignore`**:

```
solutions-outputs/
*.out
*.exe
*.o
*.class
__pycache__/
.vscode/
.idea/
```

**Rationale**: Track changes, enable collaboration, prevent data loss.

### 5. Document Edge Cases in Validator Tests

Include comprehensive test cases in `validator_tests.json`:

```json
{
  "tests": [
    { "stdin": "1\n", "expectedVerdict": "VALID" },
    { "stdin": "100000\n", "expectedVerdict": "VALID" },
    { "stdin": "0\n", "expectedVerdict": "INVALID" },
    { "stdin": "100001\n", "expectedVerdict": "INVALID" },
    { "stdin": "1 \n", "expectedVerdict": "INVALID" },
    { "stdin": "1", "expectedVerdict": "INVALID" }
  ]
}
```

**Include**:

- Minimum valid value
- Maximum valid value
- Below minimum (invalid)
- Above maximum (invalid)
- Format errors (extra spaces, missing newlines)

**Rationale**: Ensures validator correctly handles all cases.

### 6. Use Meaningful Test Grouping

Organize generators by difficulty/purpose:

```json
{
  "generators": [
    {
      "name": "gen-samples",
      "source": "generators/Samples.cpp",
      "tests-range": [1, 2]
    },
    {
      "name": "gen-small",
      "source": "generators/Small.cpp",
      "tests-range": [3, 10]
    },
    {
      "name": "gen-medium",
      "source": "generators/Medium.cpp",
      "tests-range": [11, 30]
    },
    {
      "name": "gen-large",
      "source": "generators/Large.cpp",
      "tests-range": [31, 50]
    },
    {
      "name": "gen-edge-cases",
      "source": "generators/Edge.cpp",
      "tests-range": [51, 60]
    }
  ]
}
```

**Rationale**: Makes test organization clear and maintainable.

### 7. Always Include Manual Sample Tests

Create `tests/test1.txt` and `tests/test2.txt` manually:

```bash
# tests/test1.txt
5

# tests/test2.txt
10
```

**Rationale**: Samples are often used in problem statements and should be carefully crafted.

### 8. Validate Generated Tests

Always run validator after generation:

```bash
polyman run-generator all
polyman run-validator all
```

**Rationale**: Catches generator bugs before they become test data issues.

### 9. Test WA Solutions Thoroughly

Don't assume WA solutions will fail. Verify:

```bash
polyman test wa-solution
```

**Rationale**: Ensures WA solution actually fails (not accidentally correct).

### 10. Use Descriptive Solution Names

Instead of:

```json
{
  "name": "sol1",
  "source": "solutions/s1.cpp",
  "type": "wa"
}
```

Use:

```json
{
  "name": "wa-off-by-one",
  "source": "solutions/WA_OffByOne.cpp",
  "type": "wa"
}
```

**Rationale**: Makes problem debugging and maintenance easier.

### 11. Set Appropriate Time Limits

**Guidelines**:

- Main solution should run in < 50% of time limit
- TLE solution should exceed limit reliably
- Account for slower languages (Python ~3x, Java ~2x slower than C++)

**Testing**:

```bash
# Run main solution and check times
polyman run-solution main all
```

**Rationale**: Prevents false positives/negatives on judge systems.

### 12. Keep Config.json Clean and Organized

Use consistent formatting:

```json
{
  "name": "problem-name",
  "tag": "medium",
  "time-limit": 2000,
  "memory-limit": 256,

  "solutions": [
    { "name": "main", "source": "solutions/Main.cpp", "type": "main-correct" },
    {
      "name": "cpp-alt",
      "source": "solutions/Alternative.cpp",
      "type": "correct"
    },
    { "name": "python", "source": "solutions/solution.py", "type": "correct" },
    { "name": "wa-greedy", "source": "solutions/WA_Greedy.cpp", "type": "wa" },
    {
      "name": "tle-bruteforce",
      "source": "solutions/TLE_Brute.cpp",
      "type": "tle"
    }
  ],

  "generators": [
    {
      "name": "gen-small",
      "source": "generators/Small.cpp",
      "tests-range": [1, 10]
    },
    {
      "name": "gen-large",
      "source": "generators/Large.cpp",
      "tests-range": [11, 30]
    }
  ],

  "checker": {
    "custom": false,
    "source": "ncmp.cpp"
  },

  "validator": {
    "source": "validator/Validator.cpp"
  }
}
```

**Rationale**: Easier to read and maintain.

---

## Examples

### Example 1: Simple Math Problem

**Problem**: Given an integer n, output n².

#### Setup

```bash
polyman new square-problem
cd square-problem
```

#### Main Solution

`solutions/Solution.cpp`:

```cpp
#include <iostream>
using namespace std;

int main() {
    long long n;
    cin >> n;
    cout << n * n << endl;
    return 0;
}
```

#### Validator

`validator/Validator.cpp`:

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerValidation(argc, argv);

    long long n = inf.readLong(-1000000LL, 1000000LL, "n");
    inf.readEoln();
    inf.readEof();

    return 0;
}
```

#### Validator Tests

`validator/validator_tests.json`:

```json
{
  "tests": [
    { "stdin": "0\n", "expectedVerdict": "VALID" },
    { "stdin": "1000000\n", "expectedVerdict": "VALID" },
    { "stdin": "-1000000\n", "expectedVerdict": "VALID" },
    { "stdin": "1000001\n", "expectedVerdict": "INVALID" }
  ]
}
```

#### Generator

`generators/Generator.cpp`:

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);

    int testNum = atoi(argv[1]);
    long long n = rnd.next(-1000000LL, 1000000LL);
    cout << n << endl;

    return 0;
}
```

#### Config

```json
{
  "name": "square-problem",
  "tag": "easy",
  "time-limit": 1000,
  "memory-limit": 256,

  "solutions": [
    {
      "name": "main",
      "source": "solutions/Solution.cpp",
      "type": "main-correct"
    }
  ],

  "generators": [
    {
      "name": "gen",
      "source": "generators/Generator.cpp",
      "tests-range": [1, 20]
    }
  ],

  "checker": { "custom": false, "source": "ncmp.cpp" },
  "validator": { "source": "validator/Validator.cpp" }
}
```

#### Verify

```bash
polyman verify
```

---

### Example 2: Permutation Validation Problem

**Problem**: Check if the output is a valid permutation of 1..n (any order accepted).

#### Custom Checker

`checker/chk.cpp`:

```cpp
#include "testlib.h"
#include <set>
using namespace std;

int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);

    int n = inf.readInt();

    set<int> used;
    for (int i = 0; i < n; i++) {
        int x = ouf.readInt(1, n, format("perm[%d]", i));

        if (used.count(x)) {
            quitf(_wa, "Duplicate element %d at position %d", x, i + 1);
        }
        used.insert(x);
    }

    if ((int)used.size() != n) {
        quitf(_wa, "Expected %d elements, found %d", n, (int)used.size());
    }

    quitf(_ok, "Valid permutation of %d elements", n);
}
```

#### Checker Tests

`checker/checker_tests.json`:

```json
{
  "tests": [
    {
      "stdin": "3",
      "stdout": "1 2 3",
      "answer": "3 2 1",
      "verdict": "OK"
    },
    {
      "stdin": "4",
      "stdout": "4 3 2 1",
      "answer": "1 2 3 4",
      "verdict": "OK"
    },
    {
      "stdin": "3",
      "stdout": "1 1 2",
      "answer": "1 2 3",
      "verdict": "WA"
    },
    {
      "stdin": "3",
      "stdout": "1 2 4",
      "answer": "1 2 3",
      "verdict": "WA"
    }
  ]
}
```

#### Config

```json
{
  "name": "permutation-check",
  "tag": "medium",
  "time-limit": 1000,
  "memory-limit": 256,

  "solutions": [
    {
      "name": "main",
      "source": "solutions/Solution.cpp",
      "type": "main-correct"
    }
  ],

  "generators": [
    {
      "name": "gen",
      "source": "generators/Generator.cpp",
      "tests-range": [1, 20]
    }
  ],

  "checker": { "custom": true, "source": "checker/chk.cpp" },
  "validator": { "source": "validator/Validator.cpp" }
}
```

---

### Example 3: Graph Problem with Multiple Generators

**Problem**: Given a graph, solve some graph problem.

#### Generators

`generators/SmallTree.cpp`:

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);

    int n = rnd.next(5, 20);
    cout << n << endl;

    // Generate tree
    for (int i = 2; i <= n; i++) {
        int parent = rnd.next(1, i - 1);
        cout << parent << " " << i << endl;
    }

    return 0;
}
```

`generators/LargeGraph.cpp`:

```cpp
#include "testlib.h"
#include <set>
using namespace std;

int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);

    int n = rnd.next(1000, 5000);
    int m = rnd.next(n - 1, min(10000, n * (n - 1) / 2));

    cout << n << " " << m << endl;

    set<pair<int, int>> edges;

    // Ensure connected (tree)
    for (int i = 2; i <= n; i++) {
        int parent = rnd.next(1, i - 1);
        int u = min(parent, i), v = max(parent, i);
        edges.insert({u, v});
    }

    // Add random edges
    while ((int)edges.size() < m) {
        int u = rnd.next(1, n);
        int v = rnd.next(1, n);
        if (u != v) {
            if (u > v) swap(u, v);
            edges.insert({u, v});
        }
    }

    for (auto [u, v] : edges) {
        cout << u << " " << v << endl;
    }

    return 0;
}
```

#### Config

```json
{
  "name": "graph-problem",
  "tag": "hard",
  "time-limit": 3000,
  "memory-limit": 512,

  "solutions": [
    {
      "name": "main",
      "source": "solutions/Solution.cpp",
      "type": "main-correct"
    },
    { "name": "tle-naive", "source": "solutions/TLE.cpp", "type": "tle" }
  ],

  "generators": [
    {
      "name": "gen-small-tree",
      "source": "generators/SmallTree.cpp",
      "tests-range": [1, 10]
    },
    {
      "name": "gen-large-graph",
      "source": "generators/LargeGraph.cpp",
      "tests-range": [11, 30]
    }
  ],

  "checker": { "custom": false, "source": "ncmp.cpp" },
  "validator": { "source": "validator/Validator.cpp" }
}
```

---

## FAQ

### General Questions

**Q: What is Polyman?**  
A: Polyman is a CLI tool for Codeforces problem setters to automate problem preparation, including test generation, validation, and solution verification.

**Q: Do I need to know testlib.h?**  
A: Yes, basic testlib knowledge is recommended. See [testlib documentation](https://github.com/MikeMirzayanov/testlib).

---

### Installation & Setup

**Q: What compilers are supported?**  
A: Polyman supports g++ (C++), Python 3, and Java. C++23 features are used in templates.

**Q: How do I install testlib.h?**  
A:

```bash
polyman download-testlib
sudo cp testlib.h /usr/local/include/
```

**Q: Can I use Polyman on Windows?**  
A: Yes, but you need MinGW or WSL for C++ compilation.

---

### Configuration

**Q: What's the difference between `main-correct` and `correct`?**  
A: `main-correct` is the reference solution (exactly one required). `correct` solutions are additional correct implementations.

**Q: Can I have multiple `main-correct` solutions?**  
A: No, exactly one `main-correct` solution is required per problem.

**Q: What time limits should I use?**  
A: Set limits so the main solution runs in < 50% of the time limit. Common values: 1000ms (easy), 2000ms (medium), 3000ms (hard).

**Q: How do I set memory limits?**  
A: Typical values: 256MB (standard), 512MB (large data structures), 1024MB (special cases).

---

### Generators

**Q: Why use generators instead of manual tests?**  
A: Generators enable:

- Large test creation
- Reproducibility
- Comprehensive coverage
- Edge case testing

**Q: How are test numbers used?**  
A: The test number is passed as `argv[1]` to the generator. Use it to scale difficulty or change test properties.

**Q: Can I create tests manually?**  
A: Yes, place them in `tests/test1.txt`, `tests/test2.txt`, etc.

**Q: How do I generate specific test?**  
A:

```bash
./generator 5 > tests/test5.txt
```

---

### Validators

**Q: What happens if validator fails?**  
A: The test is marked as invalid. Fix the generator or test file.

**Q: Can I skip validator?**  
A: Not recommended. Validators ensure test quality and catch generator bugs.

**Q: How strict should validators be?**  
A: Very strict. Validate exact format including spaces, newlines, and EOF.

**Q: What's the difference between `readEoln()` and `readEof()`?**  
A:

- `readEoln()`: Expects end of line (`\n`)
- `readEof()`: Expects end of file (no more data)

---

### Checkers

**Q: When should I use custom checkers?**  
A: When:

- Multiple valid answers exist
- Answer order doesn't matter
- Complex validation logic needed
- Partial scoring required

**Q: What's the difference between `inf`, `ouf`, and `ans`?**  
A:

- `inf`: Input file (test input)
- `ouf`: Output file (participant's output)
- `ans`: Answer file (jury's answer)

**Q: Can I use standard checkers for floating-point?**  
A: Yes, use `dcmp.cpp` (1E-6), `rcmp.cpp` (1.5E-6), or `rcmp9.cpp` (1E-9).

**Q: How do I test custom checkers?**  
A:

```bash
polyman test checker
```

---

### Solutions

**Q: How do I test WA solutions?**  
A:

```bash
polyman test wa-solution-name
```

**Q: What if WA solution passes all tests?**  
A: Add more test cases that expose the bug, or fix the WA solution to actually be wrong.

**Q: Can I use Python for main solution?**  
A: Yes, but be mindful of time limits (Python is ~3x slower than C++).

**Q: How do I handle TLE solutions?**  
A: Set `time-limit` in Config.json appropriately. TLE solutions should reliably exceed the limit on large tests.

---

### Testing & Verification

**Q: What does `polyman verify` do?**  
A: Runs the complete workflow:

1. Generate all tests
2. Test validator
3. Validate all tests
4. Test checker
5. Run all solutions
6. Verify solution verdicts

**Q: How long should verification take?**  
A: Depends on problem complexity. Typically seconds to minutes.

**Q: What if verification fails?**  
A: Check the error message. Common issues:

- WA solution doesn't fail
- TLE solution doesn't timeout
- Validator fails on generated test
- Checker gives wrong verdict

**Q: Can I run specific tests only?**  
A: Yes:

```bash
polyman run-solution main 5
polyman run-validator 10
```

---

### Troubleshooting

**Q: Generator produces empty test files**  
A: Ensure generator outputs to stdout, not stderr. Check for runtime errors.

**Q: Validator always fails**  
A: Check:

- testlib.h is included
- Exact format matching (spaces, newlines, EOF)
- Constraint bounds

**Q: Checker gives unexpected verdicts**  
A: Test manually:

```bash
./checker tests/test1.txt solutions-outputs/main/output_test1.txt solutions-outputs/main/output_test1.txt
```

**Q: Solution times out unexpectedly**  
A: Check:

- Time limit is reasonable
- Solution algorithm complexity
- Large test generation

**Q: Compilation fails**  
A: Verify:

- C++ compiler installed (`g++ --version`)
- testlib.h in include path
- Correct C++ standard (C++17 or later)

---

## Contributing

We welcome contributions to Polyman! Here's how you can help:

### Reporting Bugs

1. **Check existing issues** on GitHub
2. **Create detailed bug report** including:
   - Polyman version (`polyman --version`)
   - Operating system
   - Steps to reproduce
   - Expected vs actual behavior
   - Error messages/logs

### Suggesting Features

1. **Open feature request** on GitHub Issues
2. **Describe use case** and benefits
3. **Provide examples** if applicable

### Contributing Code

1. **Fork the repository**
2. **Create feature branch**: `git checkout -b feature/your-feature`
3. **Make changes** with clear commits
4. **Add tests** for new functionality
5. **Update documentation** as needed
6. **Submit pull request**

### Code Style

- Follow existing TypeScript/JavaScript conventions
- Use ESLint and Prettier for formatting
- Write meaningful commit messages
- Add JSDoc comments for new functions

### Testing Contributions

Before submitting:

```bash
npm run lint        # Check code style
npm run build       # Ensure builds successfully
npm test            # Run test suite (if available)
```

### Documentation Improvements

- Fix typos and unclear explanations
- Add examples and use cases
- Improve existing sections
- Translate to other languages

### Community

- Be respectful and constructive
- Help others in issues and discussions
- Share your problems and templates

---

## License

Polyman is released under the MIT License. See [LICENSE](LICENCE) file for details.

---

## Support

For issues, questions, and discussions:

- **GitHub Issues**: [polyman/issues](https://github.com/HamzaHassanain/polyman/issues)
- **Documentation**: [Online Docs](https://hamzahassanain.github.io/polyman/)
- **Repository**: [github.com/HamzaHassanain/polyman](https://github.com/HamzaHassanain/polyman)
