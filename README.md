<div align="center">

<img src="logo.png" alt="Polyman Logo" width="200"/>

# Polyman

**CLI tool for Codeforces problem setters** to automate the complete workflow for creating, testing, and verifying competitive programming problems.

[![npm version](https://img.shields.io/npm/v/polyman.svg?style=flat-square)](https://www.npmjs.com/package/polyman-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Documentation](https://img.shields.io/badge/docs-TypeDoc-blue?style=flat-square)](https://hamzahassanain.github.io/polyman/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

---

**📚 Quick Links** | [Installation](#installation) • [Quick Start](#quick-start) • [Commands](#commands) • [Docs](#documentation) • [License](#license)

</div>

## Why Polyman?

Stop switching between environments. Create competitive programming problems entirely in your terminal:

✅ **Problem Templates** – Generate complete folder structures in one command  
✅ **Test Generation** – Automate test case creation with C++ generators  
✅ **Validation** – Validate inputs against problem constraints  
✅ **Multi-Solution Testing** – Test correct, wrong, TLE, and RE solutions simultaneously  
✅ **Smart Checkers** – Use standard checkers or write custom ones  
✅ **Complete Verification** – Full workflow in a single `verify` command  
✅ **Polygon Sync** – Pull problems, work locally, push changes back  
✅ **Multi-Language** – C++, Java, and Python support

Polyman eliminates manual testing and syncing, letting you focus on problem design.

## Installation

### System Requirements

- **Node.js** ≥ 14
- **C++ Compiler** (g++ with C++17+)
- **Python 3** (optional - for Python solutions)
- **Java JDK** (optional - for Java solutions)

### Quick Install

```bash
npm install -g polyman-cli
```

Build from source:

```bash
git clone https://github.com/HamzaHassanain/polyman.git
cd polyman && npm install && npm run build && npm link
```

Verify: `polyman --version`

## Quick Start

### Create & Test a Problem

```bash
# Create new problem
polyman new my-problem
cd my-problem

# Download testlib (required for validators/generators)
polyman download-testlib

# Run complete verification
polyman verify
```

### Work with Polygon

```bash
# Setup (one-time)
polyman remote register

# Pull problem
polyman remote pull 123456 ./my-problem

# Work locally, then push back
polyman remote push . .
polyman remote commit . "Updated solutions"
```

## Commands

### Essential Commands

| Command                        | Purpose                         |
| ------------------------------ | ------------------------------- |
| `polyman new <dir>`            | Create new problem template     |
| `polyman download-testlib`     | Download testlib.h header       |
| `polyman generate --all`       | Generate all test cases         |
| `polyman validate --all`       | Validate test inputs            |
| `polyman run <solution> --all` | Run solution on all tests       |
| `polyman test <component>`     | Test validator/checker/solution |
| `polyman verify`               | Complete verification workflow  |

### Polygon Commands

| Command                              | Purpose              |
| ------------------------------------ | -------------------- |
| `polyman remote register`            | Save API credentials |
| `polyman remote list`                | List your problems   |
| `polyman remote pull <id> <dir>`     | Download problem     |
| `polyman remote push <id> <dir>`     | Upload changes       |
| `polyman remote commit <id> "msg"`   | Commit changes       |
| `polyman remote package <id> <type>` | Build package        |

For detailed usage, see [GUIDE.md](GUIDE.md#cli-commands-reference).

## Solution Tags

Every solution needs a tag indicating its expected behavior:

| Tag  | Meaning            | Purpose                                |
| ---- | ------------------ | -------------------------------------- |
| `MA` | Main Correct       | **Required** - Reference solution      |
| `OK` | Correct            | Alternative correct approach           |
| `WA` | Wrong Answer       | Should fail on some tests              |
| `TL` | Time Limit         | Should timeout on some tests           |
| `TO` | Time/OK            | May TLE but is algorithmically correct |
| `ML` | Memory Limit       | Should exceed memory                   |
| `RE` | Runtime Error      | Should crash                           |
| `PE` | Presentation Error | Wrong format                           |
| `RJ` | Rejected           | Should fail for any reason             |

For full details, see [GUIDE.md - Solution Types](GUIDE.md#solution-tags).

## Standard Checkers

Polyman includes testlib checkers for common output formats:

```bash
polyman list checkers
```

**Common checkers:**

- `ncmp` - Sequence of numbers (most problems)
- `wcmp` - Sequence of tokens/words
- `dcmp` / `rcmp*` - Floating-point numbers
- `yesno` - Yes/No answers
- `lcmp` - Exact line comparison

For details, see [GUIDE.md - Standard Checkers](GUIDE.md#available-standard-checkers).

## Project Structure

After `polyman new my-problem`, you get:

```
my-problem/
├── Config.json              # Problem configuration
├── solutions/               # Solution files (main + WA/TL/etc)
├── generators/              # Test generators
├── validator/               # Input validator
├── checker/                 # Custom checker (if needed)
├── statements/              # Problem statements
└── tests/                   # Generated test files
```

See [GUIDE.md - Directory Structure](GUIDE.md#directory-structure) for full details.

## Configuration

The `Config.json` file defines your problem:

```json
{
  "name": "problem-name",
  "timeLimit": 2000,
  "memoryLimit": 256,
  "inputFile": "stdin",
  "outputFile": "stdout",
  "solutions": [
    {
      "name": "main",
      "source": "./solutions/main.cpp",
      "tag": "MA",
      "sourceType": "cpp.g++17"
    }
  ],
  "generators": [
    {
      "name": "gen",
      "source": "./generators/gen.cpp"
    }
  ],
  "checker": {
    "name": "ncmp",
    "isStandard": true
  },
  "validator": {
    "name": "validator",
    "source": "./validator/validator.cpp"
  },
  "testsets": [
    {
      "name": "tests",
      "generatorScript": {
        "commands": [
          {
            "type": "generator",
            "generator": "gen",
            "range": [1, 50]
          }
        ]
      }
    }
  ]
}
```

See [GUIDE.md - Configuration Reference](GUIDE.md#configuration-file-reference) for complete documentation.

## Documentation

Choose your learning path:

### 📖 For Beginners

**[Complete User Guide](GUIDE.md)** - Comprehensive reference with configuration examples, validators, generators, checkers, and best practices.

### 🎓 Step-by-Step

**[Step-by-Step Tutorial](TUTORIAL.md)** - Learn by creating a simple "Sum of Two Numbers" problem from scratch.

### 🔧 For Developers

**[Technical Documentation](DOCUMENTATION.md)** - Architecture overview, type system, API reference, and implementation details.

### ⚙️ Platform-Specific

**[Windows Notes](NOTES.md)** - Important considerations for Windows users regarding line endings and process cleanup.

### 📚 API Reference

**[TypeDoc Documentation](https://hamzahassanain.github.io/polyman/)** - Generated API documentation for developers.

## Workflow Summary

1. **Create** → `polyman new my-problem`
2. **Setup** → `polyman download-testlib` + edit Config.json
3. **Implement** → Write solutions, validator, generator, checker
4. **Generate** → `polyman generate --all`
5. **Verify** → `polyman verify`
6. **Sync** → `polyman remote push .` + `polyman remote commit . "msg"`

Detailed walkthrough: [GUIDE.md - Workflow](GUIDE.md#workflow)

## Common Issues

**Q: My test times out. How do I debug?**  
See [GUIDE.md - Troubleshooting](GUIDE.md#troubleshooting) for performance tips and debugging strategies.

**Q: Do I need a custom checker?**  
For most problems, a standard checker like `wcmp` or `ncmp` is sufficient. See [GUIDE.md - FAQ](GUIDE.md#faq).

**Q: Windows users: Process not killed on TLE?**  
Check [NOTES.md](NOTES.md#solutions-validators-generators-and-checkers-that-exceed-the-time-limit) for cleanup instructions.

## Support

- **Issues**: [GitHub Issues](https://github.com/HamzaHassanain/polyman/issues)
- **Documentation**: [https://hamzahassanain.github.io/polyman/](https://hamzahassanain.github.io/polyman/)
- **Codeforces**: [https://codeforces.com/](https://codeforces.com/) • [Polygon](https://polygon.codeforces.com/)

## Contributing

Contributions welcome! To contribute:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make changes with clear commit messages
4. Push and open a Pull Request

Please ensure code follows the existing style and includes tests.

## License

MIT License. See [LICENSE](LICENCE) for details.

## Acknowledgments

- **testlib** by Mike Mirzayanov - Validators, generators, and checkers
- **Codeforces** - Platform and community
- **Contributors** - All who have helped improve Polyman
