<div align="center">

<img src="logo.png" alt="Polyman Logo" width="200"/>

# Polyman

**A Comprehensive CLI Tool for Codeforces Problem Setters**

[![npm version](https://img.shields.io/npm/v/polyman.svg?style=flat-square)](https://www.npmjs.com/package/polyman)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Documentation](https://img.shields.io/badge/docs-TypeDoc-blue?style=flat-square)](https://hamzahassanain.github.io/polyman/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

[Features](#features) •
[Installation](#installation) •
[Quick Start](#quick-start) •
[Documentation](#documentation) •
[Examples](#examples) •
[Contributing](#contributing)

</div>

---

## Overview

Polyman is a CLI tool that will allow codeforces problem setters to never get out of their coding environment to create a new problem. You can create, test, or update your problems and then submit them to polygon directly from your terminal.

## Features

- **Template Generation** - Scaffold complete problem structures in seconds
- **Test Automation** - Generate test cases with custom generators
- **Input Validation** - Ensure test inputs meet constraints
- **Smart Checkers** - Use standard or custom output validators
- **Solution Testing** - Verify correct, WA, TLE, and other solution types
- **Full Verification** - Complete workflow in one command
- **Multi-Language** - Support for C++, Python, and Java
- **Detailed Reports** - Colorful terminal output with verdicts

## Installation

### Prerequisites

- **Node.js** v14 or higher
- **C++ Compiler** (g++ with C++17+)
- **Python 3** (optional, for Python solutions)
- **Java JDK** (optional, for Java solutions)

### Install via npm

```bash
npm install -g polyman-cli
```

### Install from Source

```bash
git clone https://github.com/HamzaHassanain/polyman.git
cd polyman
npm install
npm run build
npm link
```

### Verify Installation

```bash
polyman --version
```

## Quick Start

### 1. Create a New Problem

```bash
polyman new my-problem
cd my-problem
```

This generates a complete problem structure with templates for solutions, generators, validators, and checkers.

### 2. Configure Your Problem

Edit `Config.json`:

```json
{
  "name": "my-problem",
  "tag": "easy",
  "time-limit": 2000,
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
      "name": "gen-random",
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

### 3. Generate Tests

```bash
polyman run-generator all
```

### 4. Verify Everything

```bash
polyman verify
```

This runs the complete verification workflow:

- Generate all tests
- Test validator
- Validate all tests
- Test checker
- Run all solutions
- Verify solution verdicts

## Documentation

### Command Reference

| Command                              | Description                        |
| ------------------------------------ | ---------------------------------- |
| `polyman new <dir>`                  | Create new problem template        |
| `polyman download-testlib`           | Download testlib.h header          |
| `polyman list-checkers`              | List available standard checkers   |
| `polyman run-generator <name>`       | Generate test cases                |
| `polyman run-validator <test>`       | Validate test inputs               |
| `polyman run-solution <name> <test>` | Execute solutions                  |
| `polyman test <what>`                | Test validators/checkers/solutions |
| `polyman verify`                     | Run complete verification          |

### Solution Types

- **`main-correct`** - Reference solution (required)
- **`correct`** - Additional correct solutions
- **`wa`** - Wrong answer solutions
- **`tle`** - Time limit exceeded solutions
- **`mle`** - Memory limit exceeded solutions
- **`pe`** - Presentation error solutions
- **`failed`** - Runtime error solutions

### Standard Checkers

- `ncmp.cpp` - Integer comparison
- `wcmp.cpp` - Token sequence comparison
- `fcmp.cpp` - Line-by-line comparison
- `dcmp.cpp` - Double comparison (1E-6)
- `yesno.cpp` - YES/NO validation
- And [more...](https://hamzahassanain.github.io/polyman/)

**[Full Documentation](https://hamzahassanain.github.io/polyman/)** | **[API Reference](https://hamzahassanain.github.io/polyman/)**

## Examples

### Simple Integer Problem

```cpp
// solutions/Solution.cpp
#include <iostream>
using namespace std;

int main() {
    int n;
    cin >> n;
    cout << n * n << endl;
    return 0;
}
```

```cpp
// validator/Validator.cpp
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

```cpp
// generators/Generator.cpp
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

See [more examples](https://hamzahassanain.github.io/polyman/#examples) in the documentation.

## Project Structure

```
my-problem/
├── Config.json              # Problem configuration
├── solutions/
│   ├── Solution.cpp        # Main correct solution
│   └── WA.cpp              # Wrong answer solution
├── generators/
│   └── Generator.cpp       # Test generator
├── validator/
│   ├── Validator.cpp       # Input validator
│   └── validator_tests.json
├── checker/
│   ├── chk.cpp            # Custom checker (optional)
│   └── checker_tests.json
├── tests/                  # Generated test files
└── solutions-outputs/      # Solution outputs (auto-created)
```

## Workflow

1. **Create** - Generate problem template
2. **Write** - Implement solution, validator, generator
3. **Configure** - Update Config.json
4. **Generate** - Create test cases
5. **Validate** - Check test inputs
6. **Execute** - Run solutions
7. **Verify** - Complete verification

```bash
polyman new problem && cd problem
# Edit files...
polyman verify
```

## Features in Detail

### Validators

Ensure test inputs meet problem constraints using testlib.h:

```cpp
int n = inf.readInt(1, 100000, "n");  // Range validation
inf.readEoln();                       // Format validation
inf.readEof();                        // End of file validation
```

### Generators

Create test cases programmatically:

```cpp
int n = rnd.next(1, 100);            // Random integer
string s = rnd.next("[a-z]{10,20}"); // Random string
```

### Checkers

Validate solution output with standard or custom checkers:

```cpp
quitf(_ok, "Correct answer");        // Accept
quitf(_wa, "Wrong answer");          // Reject
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENCE) file for details.

## Acknowledgments

- [testlib](https://github.com/MikeMirzayanov/testlib) by Mike Mirzayanov
- Codeforces platform and community
- All contributors and users

## Support

- **Documentation**: [hamzahassanain.github.io/polyman](https://hamzahassanain.github.io/polyman/)
- **Issues**: [GitHub Issues](https://github.com/HamzaHassanain/polyman/issues)
