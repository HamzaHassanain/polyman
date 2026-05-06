# A Quick Tutorial On How To Create A Coding Problem with Polyman

Welcome! This tutorial will guide you step-by-step through creating your first competitive programming problem using Polyman. Don't worry if you've never created a problem before - we'll explain everything along the way.

Before You Start, If you are a Windows User, please check the [NOTES](./NOTES.md) first, then things will make more sense while
reading this tutorial.

## Table of Contents

1. [What You'll Create](#what-youll-create)
2. [Prerequisites](#prerequisites)
3. [Understanding Problem Components](#understanding-problem-components)
4. [Step 1: Create Your Problem](#step-1-create-your-problem)
5. [Step 2: Understand the Problem Idea](#step-2-understand-the-problem-idea)
6. [Step 3: Write the Problem Statement](#step-3-write-the-problem-statement)
7. [Step 4: Write the Solution](#step-4-write-the-solution)
8. [Step 5: Configure the Problem](#step-5-configure-the-problem)
9. [Step 6: Write the Validator](#step-6-write-the-validator)
10. [Step 7: Write the Generator](#step-7-write-the-generator)
11. [Step 8: Add Sample Tests](#step-8-add-sample-tests)
12. [Step 9: Choose a Checker](#step-9-choose-a-checker)
13. [Step 10: Test Everything](#step-10-test-everything)
14. [Step 11: Upload to Polygon](#step-11-upload-to-polygon-optional)
15. [Next Steps](#next-steps)

---

## What You'll Create

In this tutorial, you'll create a simple problem called **"Sum of Two Numbers"**:

- **Problem:** Given two integers A and B, output their sum.
- **Input:** Two integers A and B (1 ≤ A, B ≤ 1000)
- **Output:** One integer, the sum A + B

This is a simple problem, but it will teach you all the fundamental concepts of problem setting.

---

## Prerequisites

Before starting, make sure you have:

1. **A C++ compiler** - We'll use g++ (comes with most systems)
2. **A text editor** - Any editor works (VS Code, Sublime, even Notepad)
3. **Basic C++ knowledge** - You should know how to read input and write output

To install Polyman, run:

```bash
npm install -g polyman-cli
```

For full system requirements see [README.md - Installation](README.md#installation).

---

## Understanding Problem Components

Before we start coding, let's understand what makes up a competitive programming problem. Every problem needs these components:

### 1. **Problem Statement**

The description contestants read. It explains:

- What the problem is about
- Input format
- Output format
- Constraints (limits on input values)
- Example test cases with explanations

**Location:** `statements/english/` folder

### 2. **Solution**

The correct program that solves the problem. This is your reference answer.

- You must have exactly ONE main solution (tagged as `MA`)
- You can have additional correct solutions (tagged as `OK`)
- The main solution's output becomes the "correct answer" for all tests

**Location:** `solutions/` folder

### 3. **Validator**

A program that checks if test **inputs** are valid according to your constraints.

**Example:** If your problem says "1 ≤ N ≤ 100", the validator ensures all tests have N in that range.

**Why needed?** Prevents invalid tests from being used in contests.

**Location:** `validator/` folder

### 4. **Generator**

A program that automatically creates test cases.

**Why not create tests manually?**

- Saves time (can generate 100s of tests in seconds)
- Creates diverse, random tests
- Easy to regenerate if needed
- Can create tests with specific patterns

**Location:** `generators/` folder

### 5. **Checker**

A program that compares contestant's output with the correct answer.

**Two types:**

- **Standard checkers:** Pre-made for common formats (numbers, strings, etc.)
- **Custom checkers:** For problems with multiple valid answers

**Location:** `checker/` folder (only needed for custom checkers)

### 6. **Tests**

The actual test input files used to judge solutions.

**Two types:**

- **Sample tests:** Shown to contestants in the problem statement
- **Hidden tests:** Not shown, used for final judgment

**Location:** `testsets/tests/` folder

### 7. **Configuration**

The `Config.json` file that ties everything together:

- Time and memory limits
- Input/output files (stdin/stdout or files)
- Lists all solutions, generators, validators
- Defines which tests to generate

**Location:** `Config.json` in problem root

---

Now let's build each component step by step!

---

## Step 1: Create Your Problem

Open your terminal and run:

```bash
polyman new sum-problem
cd sum-problem
```

This creates a new folder called `sum-problem` with everything you need:

```
sum-problem/
├── Config.json          # Problem settings
├── solutions/           # Your solutions go here
├── generators/          # Programs to create test cases
├── validator/           # Checks if inputs are valid
├── checker/             # Checks if outputs are correct
└── statements/          # Problem descriptions
```

Next, download the testlib library (needed for validators and generators):

```bash
polyman download-testlib
```

You should see a message that `testlib.h` was downloaded successfully.

---

## Step 2: Understand the Problem Idea

Before writing code, let's be clear about what we're creating:

**Problem Statement:**

> You will receive two integers A and B. Output their sum.

**Example:**

- Input: `3 5`
- Output: `8`

**Constraints:**

- 1 ≤ A ≤ 1000
- 1 ≤ B ≤ 1000

These constraints are important - they tell contestants (and our validator) what values are acceptable.

---

## Step 3: Write the Problem Statement

The problem statement is what contestants will read. Let's write a clear, complete statement for our problem.

Open `statements/english/legend.tex` and write:

```latex
You are given two integers $a$ and $b$. Your task is to calculate their sum.
```

Open `statements/english/input-format.tex` and write:

```latex
The only line contains two integers $a$ and $b$ ($1 \le a, b \le 1000$) --- the numbers you need to add.
```

Open `statements/english/output-format.tex` and write:

```latex
Print a single integer --- the sum $a + b$.
```

Open `statements/english/notes.tex` and write:

```latex
In the first example, $3 + 5 = 8$.

In the second example, $1000 + 1000 = 2000$.
```

### Understanding the Statement Structure

A good problem statement has four parts:

1. **Legend** (`legend.tex`): The story or description
   - What is the problem about?
   - What should the solution do?

2. **Input Format** (`input-format.tex`): How input is structured
   - How many lines?
   - What's on each line?
   - What are the constraints?

3. **Output Format** (`output-format.tex`): How output should look
   - What to print?
   - How to format it?

4. **Notes** (`notes.tex`): Examples explained
   - Walk through sample cases
   - Clarify tricky parts

**LaTeX Tips:**

- Use `$...$` for math symbols: `$a$`, `$1 \le n \le 100$`
- Use `\le` for ≤ and `\ge` for ≥
- Keep it simple and clear

---

## Step 4: Write the Solution

The solution is the **correct program** that solves the problem. This is what contestants should write (though they might write it differently).

Open `solutions/Solution.cpp` and replace everything with:

```cpp
#include <iostream>
using namespace std;

int main() {
    int a, b;
    cin >> a >> b;
    cout << a + b << endl;
    return 0;
}
```

**What this does:**

1. Reads two integers `a` and `b`
2. Outputs their sum
3. That's it!

Save the file. This is your **main correct solution** - the reference answer that will be used to check other solutions.

---

## Step 5: Configure the Problem

The `Config.json` file tells Polyman about your problem. Open it and update it to look like this:

```json
{
  "name": "sum-problem",
  "description": "Calculate the sum of two numbers",
  "timeLimit": 1000,
  "memoryLimit": 256,
  "inputFile": "stdin",
  "outputFile": "stdout",
  "interactive": false,
  "tags": ["math", "implementation"],

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
      "name": "gen",
      "source": "./generators/Generator.cpp"
    }
  ],

  "checker": {
    "name": "ncmp",
    "source": "ncmp.cpp",
    "isStandard": true
  },

  "validator": {
    "name": "validator",
    "source": "./validator/Validator.cpp"
  },

  "testsets": [
    {
      "name": "tests",
      "generatorScript": {
        "script": "<#-- @group main -->\n<#list 1..10 as i>\ngen ${i} > $\n</#list>"
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

**Let me explain the key parts:**

- **`timeLimit`**: Maximum time (in milliseconds) the solution can run - 1000ms = 1 second
- **`memoryLimit`**: Maximum memory in megabytes - 256MB is standard
- **`inputFile/outputFile`**: Use "stdin"/"stdout" for standard input/output
- **`solutions`**: List of solutions
  - `"tag": "MA"` means this is the **Main** correct solution
- **`generators`**: Programs that create test cases
- **`checker`**: How to check if an answer is correct
  - `"ncmp"` is a standard checker for comparing numbers
- **`validator`**: Checks if test inputs are valid
- **`testsets`**: Defines which tests to generate
  - We'll generate tests 1 through 10 using our generator

---

## Step 6: Write the Validator

The validator ensures all test inputs follow the problem's constraints. It's like a bouncer at a club - only valid inputs get in!

Open `validator/Validator.cpp` and write:

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerValidation(argc, argv);

    // Read first integer A (must be between 1 and 1000)
    int a = inf.readInt(1, 1000, "a");

    // Read a space
    inf.readSpace();

    // Read second integer B (must be between 1 and 1000)
    int b = inf.readInt(1, 1000, "b");

    // Must end with a newLine
    inf.readEoln();

    // Must be end of file (no extra input)
    inf.readEof();

    return 0;
}
```

**What this does:**

1. **`registerValidation(argc, argv)`**: Sets up the validator
2. **`inf.readInt(1, 1000, "a")`**: Reads an integer between 1 and 1000
   - If the number is outside this range, validation FAILS
3. **`inf.readSpace()`**: Expects exactly one space
4. **`inf.readInt(1, 1000, "b")`**: Reads the second integer
5. **`inf.readEoln()`**: Expects end of line (newLine character)
6. **`inf.readEof()`**: Expects end of file (nothing more)

If the input doesn't match this format exactly, the validator will reject it. This ensures all your tests are properly formatted.

---

## Step 7: Write the Generator

The generator creates test cases automatically. Instead of manually typing 10 different test files, you write one program that creates them all!

Open `generators/Generator.cpp` and write:

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);

    // Get the test number (1, 2, 3, ...)
    int testNum = atoi(argv[1]);

    // Generate random A and B based on test number
    // Early tests use small numbers, later tests use bigger numbers
    int maxValue = min(100 * testNum, 1000);

    int a = rnd.next(1, maxValue);
    int b = rnd.next(1, maxValue);

    // Output the test case
    cout << a << " " << b << endl;

    return 0;
}
```

**What this does:**

1. **`registerGen(argc, argv, 1)`**: Sets up the generator
2. **`atoi(argv[1])`**: Gets the test number from the command line
   - For test 1, `testNum = 1`
   - For test 5, `testNum = 5`
3. **`rnd.next(1, maxValue)`**: Generates a random number between 1 and maxValue
4. **Test progression**:
   - Test 1: numbers up to 100
   - Test 5: numbers up to 500
   - Test 10: numbers up to 1000

This way, early tests are simple, and later tests are harder!

**Why not just write test files manually?**

- Generators save time
- They create diverse, random tests
- Easy to create hundreds of tests
- You can regenerate tests anytime

---

## Step 8: Add Sample Tests

Sample tests are shown to contestants in the problem statement. They help contestants understand the problem and test their solutions.

Let's create two sample tests manually.

### Sample Test 1

Create the directory structure first:

```bash
mkdir -p manual/tests
```

Create file `manual/tests/m-01-sample.in`:

```
3 5
```

This is a simple case with small numbers.

### Sample Test 2

Create file `manual/tests/m-02-sample.in`:

```
1000 1000
```

This tests the upper constraint boundary.

### Why Have Sample Tests?

Sample tests serve multiple purposes:

1. **Help contestants understand** the problem format
2. **Show edge cases** (like maximum values)
3. **Verify basic correctness** before submission
4. **Document expected behavior**

**Important:** Sample tests should be:

- Clear and simple
- Cover different cases
- Include edge cases (min/max values)
- NOT too many (2-3 is usually enough)

Now let's update our `Config.json` to include these sample tests along with generated tests.

Update the `testsets` section in `Config.json`:

```json
"testsets": [
  {
    "name": "tests",
    "generatorScript": {
      "script": "<#-- @group main -->\n<#list 3..12 as i>\ngen ${i} > $\n</#list>"
    },
    "manualTests": [
      {
        "input": "./manual/tests/m-01-sample.in",
        "index": 1,
        "group": "samples",
        "useInStatements": true
      },
      {
        "input": "./manual/tests/m-02-sample.in",
        "index": 2,
        "group": "samples",
        "useInStatements": true
      }
    ],
    "groupsEnabled": true,
    "groups": [
      { "name": "samples" },
      { "name": "main" }
    ]
  }
]
```

**What changed?**

1. **Manual tests** live in `manualTests[]`, separate from the generator script:
   - `input` points to the on-disk file (`m-<NN>[-label].in` convention).
   - `index` is the explicit Polygon test number — manuals reserve 1 and 2.
   - `useInStatements: true` makes Polygon embed them under the statement.
   - `group: "samples"` tags them.

2. **Generated tests** are produced by the inline Polygon-format script:
   - `<#-- @group main -->` tags every following line with the `main` group.
   - `<#list 3..12 as i>` expands into ten lines, each running `gen ${i} > $`.
   - `> $` resolves to the smallest unused index. Since 1 and 2 are taken by the manuals, generated tests fill 3–12.

So now we have:

- 2 sample tests (manual, shown in statements) — indices 1 and 2.
- 10 generated tests (random, hidden) — indices 3–12.
- Total: 12 tests.

---

## Step 9: Choose a Checker

The checker compares the contestant's output with the correct answer. For our simple problem, we use a **standard checker**.

We already configured this in `Config.json`:

```json
"checker": {
  "name": "ncmp",
  "source": "ncmp.cpp",
  "isStandard": true
}
```

**`ncmp`** is a standard checker that compares sequences of numbers. It's perfect for our problem!

To see all available standard checkers, run:

```bash
polyman list checkers
```

You'll see checkers for:

- Single numbers (`icmp`)
- Multiple numbers (`ncmp`) ← We're using this!
- Floating-point numbers (`rcmp`, `dcmp`)
- Yes/No answers (`yesno`)
- And more...

For most problems, a standard checker works fine. You only need a custom checker for complex problems (like graphs where multiple answers are valid).

---

## Step 10: Test Everything

Now comes the exciting part - let's test our problem!

### Generate Tests

Run:

```bash
polyman generate -a
```

This will:

1. Compile `Generator.cpp`
2. Skip tests 1-2 (they're manual, already exist)
3. Generate tests 3-12 using the generator
4. Create files `tests/test3.txt` through `tests/test12.txt`

You can look at the generated tests:

```bash
cat manual/tests/m-01-sample.in
cat testsets/tests/test5.txt
cat testsets/tests/test12.txt
```

You should see:

- m-01-sample.in: `3 5` (our manual sample)
- test5.txt and test12.txt: random pairs of numbers

### Validate Tests

Run:

```bash
polyman validate -a
```

This will:

1. Compile `Validator.cpp`
2. Run it on each test file (1-12)
3. Check if each test passes validation

You should see green "VALID" for all tests. If any test is invalid, the validator will tell you why.

### Run Solution

Run:

```bash
polyman run main -a
```

This will:

1. Compile `Solution.cpp`
2. Run it on all 12 tests
3. Save outputs to `solutions-outputs/main/`

### Verify Everything

Finally, run the complete verification:

```bash
polyman verify
```

This does everything:

- Generates all tests (skips manual ones)
- Validates all tests
- Runs all solutions
- Checks outputs with the checker
- Verifies solution verdicts match their tags
- Reports any issues

If everything is correct, you'll see a beautiful success message!

**What verification checks:**

1. All tests are generated
2. All tests pass validation
3. Main solution compiles and runs
4. Main solution produces correct output
5. Checker correctly identifies correct/wrong answers
6. All solution tags match their actual behavior

---

## Step 11: Upload to Polygon (Optional)

Now that your problem is tested and working locally, you can upload it to Codeforces Polygon.

### First Time Setup

Get your API credentials from [https://polygon.codeforces.com](https://polygon.codeforces.com/) (top-right settings → API Keys → generate key + secret), then register them with Polyman:

```bash
polyman remote register <api-key> <api-secret>
```

These credentials are stored locally for future use.

### Push Your Problem

```bash
polyman remote push . . -a
```

If your `Config.json` has no problem ID, this creates a new problem on Polygon and writes the ID back to `Config.json`.

### Commit Your Changes

```bash
polyman remote commit . "Updated solutions and added new test cases"
```

### Build a Package

```bash
polyman remote package . standard
```

For full options, package types, and troubleshooting, see [GUIDE.md - Remote Operations](GUIDE.md#remote-operations-polygon-integration).

---

## Next Steps

Congratulations! You've created your first competitive programming problem and learned how to upload it to Polygon! 🎉

### What to Try Next

1. **Create a harder problem** - Try something more complex than addition
2. **Add more test cases** - Change the range in `Config.json` to `[3, 52]` for 50 generated tests
3. **Try different generators** - Create a generator that makes edge cases (like `1 1` or `1000 1000`)
4. **Write more statements** - Add problem descriptions in other languages (Russian, etc.)
5. **Custom checker** - For a problem with multiple valid answers, write a custom checker
6. **Work with Polygon** - Use `polyman remote` commands to sync with Codeforces Polygon


### Learning Resources

- **Full Documentation**: Read `GUIDE.md` in this directory for detailed explanations
- **testlib.h Documentation**: [https://github.com/MikeMirzayanov/testlib](https://github.com/MikeMirzayanov/testlib)
- **Polygon Platform**: [https://polygon.codeforces.com/](https://polygon.codeforces.com/)
- **Polyman Commands**: Run `polyman --help` to see all available commands

---

## Quick Reference

For the full CLI reference with per-command walkthroughs, see [GUIDE.md - CLI Commands Reference](GUIDE.md#cli-commands-reference). Run `polyman --help` for an inline summary.

---

Happy problem setting! If you have questions, check the full documentation or open an issue on GitHub.
