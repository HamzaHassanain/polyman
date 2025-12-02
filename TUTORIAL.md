# A Quick Tutorial On How To Create A Coding Problem with Polyman

Welcome! This tutorial will guide you step-by-step through creating your first competitive programming problem using Polyman. Don't worry if you've never created a problem before - we'll explain everything along the way.

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
15. [Step 12: Add More Solutions](#step-12-add-more-solutions-optional)
16. [Next Steps](#next-steps)

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

1. **Polyman installed** - Run `polyman --version` to check
2. **A C++ compiler** - We'll use g++ (comes with most systems)
3. **A text editor** - Any editor works (VS Code, Sublime, even Notepad)
4. **Basic C++ knowledge** - You should know how to read input and write output

If you don't have Polyman installed, run:

```bash
npm install -g polyman-cli
```

---

## Understanding Problem Components

Before we start coding, let's understand what makes up a competitive programming problem. Every problem needs these components:

### 1. **Problem Statement** 📝

The description contestants read. It explains:

- What the problem is about
- Input format
- Output format
- Constraints (limits on input values)
- Example test cases with explanations

**Location:** `statements/english/` folder

### 2. **Solution** 💻

The correct program that solves the problem. This is your reference answer.

- You must have exactly ONE main solution (tagged as `MA`)
- You can have additional correct solutions (tagged as `OK`)
- The main solution's output becomes the "correct answer" for all tests

**Location:** `solutions/` folder

### 3. **Validator** ✅

A program that checks if test **inputs** are valid according to your constraints.

**Example:** If your problem says "1 ≤ N ≤ 100", the validator ensures all tests have N in that range.

**Why needed?** Prevents invalid tests from being used in contests.

**Location:** `validator/` folder

### 4. **Generator** 🎲

A program that automatically creates test cases.

**Why not create tests manually?**

- Saves time (can generate 100s of tests in seconds)
- Creates diverse, random tests
- Easy to regenerate if needed
- Can create tests with specific patterns

**Location:** `generators/` folder

### 5. **Checker** ⚖️

A program that compares contestant's output with the correct answer.

**Two types:**

- **Standard checkers:** Pre-made for common formats (numbers, strings, etc.)
- **Custom checkers:** For problems with multiple valid answers

**Location:** `checker/` folder (only needed for custom checkers)

### 6. **Tests** 📁

The actual test input files used to judge solutions.

**Two types:**

- **Sample tests:** Shown to contestants in the problem statement
- **Hidden tests:** Not shown, used for final judgment

**Location:** `testsets/tests/` folder

### 7. **Configuration** ⚙️

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
        "commands": [
          {
            "type": "generator",
            "generator": "gen",
            "range": [1, 10],
            "group": "main"
          }
        ]
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

    // Must end with a newline
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
5. **`inf.readEoln()`**: Expects end of line (newline character)
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

Create file `manual/tests/sample1.txt`:

```
3 5
```

This is a simple case with small numbers.

### Sample Test 2

Create file `manual/tests/sample2.txt`:

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
      "commands": [
        {
          "useInStatements": true,
          "type": "manual",
          "manualFile": "./manual/tests/sample1.txt",
          "group": "samples"
        },
        {
          "useInStatements": true,
          "type": "manual",
          "manualFile": "./manual/tests/sample2.txt",
          "group": "samples"
        },
        {
          "type": "generator",
          "generator": "gen",
          "range": [3, 12],
          "group": "main"
        }
      ]
    },
    "groupsEnabled": true,
    "groups": [
      {
        "name": "samples"
      },
      {
        "name": "main"
      }
    ]
  }
]
```

**What changed?**

1. **Manual tests (samples):** These are our sample tests we created manually
   - `"type": "manual"` means we wrote these ourselves
   - `"manualFile": "./manual/tests/sample1.txt"` points to the actual file
   - `"useInStatements": true` means these will be shown in the problem statement
   - `"group": "samples"` puts them in the samples group
   - We have two manual test commands, one for each sample

2. **Generated tests (3-12):** These will be created by the generator
   - `"type": "generator"` means use a generator
   - `"range": [3, 12]` means generate tests 3 through 12 (10 tests)
   - `"group": "main"` puts them in the main group

So now we have:

- 2 sample tests (manual, shown in statements)
- 10 generated tests (random, hidden)
- Total: 12 tests

---

## Step 9: Choose a Checker

The checker compares the contestant's output with the correct answer. For our simple problem, we use a **standard checker**.

We already configured this in `Config.json`:

```json
"checker": {
  "name": "ncmp",
  "isStandard": true
}
```

**`ncmp`** is a standard checker that compares sequences of numbers. It's perfect for our problem!

To see all available standard checkers, run:

```bash
polyman list-checkers
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

**Note:** We use `-a` (short for `--all`) instead of `--all`.

This will:

1. Compile `Generator.cpp`
2. Skip tests 1-2 (they're manual, already exist)
3. Generate tests 3-12 using the generator
4. Create files `tests/test3.txt` through `tests/test12.txt`

You can look at the generated tests:

```bash
cat manual/tests/sample1.txt
cat testsets/tests/test5.txt
cat testsets/tests/test12.txt
```

You should see:

- sample1.txt: `3 5` (our manual sample)
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
polyman solve main -a
```

**Note:** The command is `solve` not `run`.

This will:

1. Compile `Solution.cpp`
2. Run it on all 12 tests
3. Save outputs to `solutions-outputs/main/`

You can check the outputs:

```bash
cat solutions-outputs/main/output1.txt
cat solutions-outputs/main/output2.txt
```

You should see:

- output1.txt: `8` (because 3 + 5 = 8)
- output2.txt: `2000` (because 1000 + 1000 = 2000)

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

If everything is correct, you'll see a beautiful success message! 🎉

**What verification checks:**

1. ✅ All tests are generated
2. ✅ All tests pass validation
3. ✅ Main solution compiles and runs
4. ✅ Main solution produces correct output
5. ✅ Checker correctly identifies correct/wrong answers
6. ✅ All solution tags match their actual behavior

---

## Step 11: Upload to Polygon (Optional)

Now that your problem is fully tested and working locally, you might want to upload it to Codeforces Polygon. Polyman makes this process seamless with its Polygon integration!

### First Time Setup

Before you can work with Polygon, you need to register your API credentials once:

#### Get Your API Credentials

1. Go to [Polygon API Help](https://polygon.codeforces.com/api/help)
2. Log in with your Codeforces account
3. Click on "Generate API Key" or use your existing key
4. You'll see:
   - **API Key** (a long string like `abc123def456...`)
   - **API Secret** (another long string)
5. Copy both of these

#### Register Your Credentials with Polyman

Run:

```bash
polyman remote register
```

You'll be prompted to enter:

- **API Key**: Paste your API key
- **API Secret**: Paste your API secret

These credentials are securely stored in `~/.polyman/credentials.json` and you only need to do this once!

### Method 1: Create New Problem on Polygon

If you want to create a brand new problem on Polygon:

#### Step 1: Create the Problem on Polygon Website

Unfortunately, you need to create the problem shell on Polygon first (Polyman can't create new problems from scratch):

1. Go to [Polygon](https://polygon.codeforces.com/)
2. Click "Create New Problem"
3. Fill in basic details (name, etc.)
4. Note down the **Problem ID** (e.g., `123456`)

#### Step 2: Push Your Local Problem to Polygon

Now push your entire local problem to Polygon:

```bash
polyman remote push . --problem-id <YOUR_PROBLEM_ID>
```

Wait, there's no `--problem-id` option! Don't worry - you need to add the problem ID to your `Config.json` first:

**Option A: Add Problem ID to Config.json**

Open `Config.json` and add:

```json
{
  "name": "sum-problem",
  "polygonProblemId": 123456,
  "description": "Calculate the sum of two numbers",
  ...
}
```

Then push:

```bash
polyman remote push .
```

**Option B: Use an Existing Problem**

If you already created a problem on Polygon and noted its ID, you can work with it directly.

#### What Gets Uploaded?

When you run `polyman remote push .`, Polyman uploads:

- ✅ Problem settings (time limit, memory limit, I/O files)
- ✅ All solutions with their correct tags (MA, OK, WA, TL, etc.)
- ✅ Validator with validator tests
- ✅ Checker (or standard checker configuration)
- ✅ All generators
- ✅ All test files and test organization
- ✅ Problem statements (if you have them)

**What Happens After Pushing:**

After `polyman remote push`, your changes are uploaded to Polygon's **working copy** (like a staging area). They're not yet saved to the repository!

#### Step 3: Commit Your Changes

To save your changes to Polygon's repository, commit them:

```bash
polyman remote commit . -m "Initial problem setup"
```

This is like a git commit - it saves your changes with a descriptive message.

### Method 2: Pull Existing Problem, Modify, and Push Back

If you already have a problem on Polygon and want to work on it locally:

#### Step 1: Pull the Problem

```bash
polyman remote pull 123456 ./my-problem
cd my-problem
```

This downloads everything from Polygon:

- Solutions
- Validator and validator tests
- Checker and checker tests
- Generators
- Tests
- Statements
- Config.json with all settings

#### Step 2: Work Locally

Make your changes:

```bash
# Edit solutions
vim solutions/new-solution.cpp

# Modify generator
vim generators/gen.cpp

# Update Config.json
vim Config.json

# Test everything locally
polyman verify
```

#### Step 3: Push Changes Back

Once you're happy with your changes:

```bash
polyman remote push .
```

#### Step 4: Commit Changes

```bash
polyman remote commit . -m "Added new test cases and optimized solution"
```

### Selective Pushing

Sometimes you don't want to upload everything. Polyman gives you control:

```bash
# Push everything except tests (useful if tests are large)
polyman remote push . --skip-tests

# Push everything except statements
polyman remote push . --skip-statements

# Push only solutions (skip tests, statements, checker, validator, generators)
polyman remote push . --skip-tests --skip-statements --skip-checker --skip-validator --skip-generators
```

### Building Packages

After pushing and committing, you might want to build a package:

```bash
# Build standard package
polyman remote package .

# Build full package
polyman remote package . --full

# Build full package with verification
polyman remote package . --full --verify
```

Polyman will:

1. Request package build from Polygon
2. Poll every 60 seconds to check if it's ready
3. Wait up to 30 minutes
4. Download the package when ready

You'll see status updates like:

- `WAITING` - Package is in queue
- `RUNNING` - Package is being built
- `READY` - Package is ready to download
- `FAILED` - Package build failed

### Viewing Your Problems

Want to see all your problems on Polygon?

```bash
# List all problems with details
polyman remote list

# List only problem IDs
polyman remote list --id-only

# List problems by specific owner
polyman remote list --owner tourist
```

Want detailed info about a specific problem?

```bash
polyman remote view 123456
```

### Complete Workflow Example

Here's a real-world workflow:

```bash
# 1. One-time setup: Register API credentials
polyman remote register

# 2. Create problem locally
polyman new sum-problem
cd sum-problem
polyman download-testlib

# 3. Build your problem (write solutions, validators, generators)
# ... (Steps 3-10 from tutorial)

# 4. Verify everything works locally
polyman verify

# 5. Create problem shell on Polygon website (note the ID: 123456)

# 6. Add problem ID to Config.json
# Add: "polygonProblemId": 123456

# 7. Push to Polygon
polyman remote push .

# 8. Commit changes
polyman remote commit . -m "Initial problem: Sum of Two Numbers"

# 9. Build package
polyman remote package . --full --verify

# Done! Your problem is on Polygon, ready for contest use
```

### Alternative: Work on Existing Problem

```bash
# 1. Pull problem from Polygon
polyman remote pull 123456 ./sum-problem
cd sum-problem

# 2. Make changes locally
vim solutions/new-solution.cpp
vim generators/gen.cpp

# 3. Test locally
polyman verify

# 4. Push changes
polyman remote push .

# 5. Commit
polyman remote commit . -m "Added stress tests and alternative solution"

# 6. Build package
polyman remote package .
```

### Troubleshooting

**Q: "API authentication failed"**

- Make sure you registered credentials: `polyman remote register`
- Check your API key and secret are correct
- Try regenerating them on Polygon

**Q: "Problem not found"**

- Make sure the problem ID is correct
- Check that you have access to this problem on Polygon
- Verify you're using the correct Polygon account

**Q: "Push failed - invalid testset configuration"**

- Run `polyman verify` locally first
- Make sure all tests are valid
- Check that your Config.json matches Polygon's requirements

**Q: "Package build failed"**

- Check Polygon website for error details
- Make sure all solutions compile on Polygon's servers
- Verify validator and checker work correctly

**Q: "I don't want to upload all my tests (too many/too large)"**

- Use `--skip-tests` flag: `polyman remote push . --skip-tests`
- You can generate tests directly on Polygon instead

### Important Notes

**About Problem IDs:**

- You need to add `"polygonProblemId": 123456` to your `Config.json`
- Or create the problem on Polygon first and note the ID
- The ID is shown in the Polygon URL: `polygon.codeforces.com/p123456`

**About Commits:**

- Always commit after pushing: `polyman remote commit . -m "message"`
- Commits save your changes permanently to Polygon's repository
- Without committing, your changes are only in the working copy

**About Packages:**

- Packages are what you download and use in contests
- Building takes time (can be several minutes)
- Use `--full` for complete packages with all files
- Use `--verify` to run full verification on Polygon

### What's Next?

Now you know how to:

- ✅ Create problems locally
- ✅ Test them thoroughly with `polyman verify`
- ✅ Upload to Polygon
- ✅ Work with existing Polygon problems
- ✅ Build and download packages

You have the complete workflow! You can now create problems efficiently, test them locally, and seamlessly sync with Polygon.

---

## Step 12: Add More Solutions (Optional)

In real problem setting, you want to test that your problem is robust. Let's add a **wrong solution** to make sure it fails.

Create a new file `solutions/WrongSolution.cpp`:

```cpp
#include <iostream>
using namespace std;

int main() {
    int a, b;
    cin >> a >> b;
    // This is WRONG - we output the product instead of sum!
    cout << a * b << endl;
    return 0;
}
```

Update your `Config.json` to include this solution:

```json
"solutions": [
  {
    "name": "main",
    "source": "./solutions/Solution.cpp",
    "tag": "MA",
    "sourceType": "cpp.g++17"
  },
  {
    "name": "wrong",
    "source": "./solutions/WrongSolution.cpp",
    "tag": "WA",
    "sourceType": "cpp.g++17"
  }
]
```

Notice the `"tag": "WA"` - this means **Wrong Answer**. Polyman will verify that this solution fails on at least one test.

Run:

```bash
polyman verify
```

You should see:

- ✅ Main solution gets AC (Accepted) on all tests
- ✅ Wrong solution gets WA (Wrong Answer) on at least one test

This confirms your checker is working correctly!

### Solution Tags Explained

- **`MA`** (Main) - The main correct solution (required, exactly one)
- **`OK`** (Correct) - Alternative correct solutions
- **`WA`** (Wrong Answer) - Solutions with bugs
- **`TL`** (Time Limit) - Solutions that are too slow
- **`RE`** (Runtime Error) - Solutions that crash

---

## Next Steps

Congratulations! You've created your first competitive programming problem and learned how to upload it to Polygon! 🎉

Here's what you learned:

1. ✅ Creating a problem structure with `polyman new`
2. ✅ Writing a correct solution
3. ✅ Configuring problem settings in `Config.json`
4. ✅ Writing a validator to check input constraints
5. ✅ Writing a generator to create test cases automatically
6. ✅ Using standard checkers to verify outputs
7. ✅ Running complete verification with `polyman verify`
8. ✅ Uploading problems to Polygon and syncing changes
9. ✅ Adding wrong solutions to test your checker

### What to Try Next

1. **Create a harder problem** - Try something more complex than addition
2. **Add more test cases** - Change the range in `Config.json` to `[3, 52]` for 50 generated tests
3. **Try different generators** - Create a generator that makes edge cases (like `1 1` or `1000 1000`)
4. **Write more statements** - Add problem descriptions in other languages (Russian, etc.)
5. **Custom checker** - For a problem with multiple valid answers, write a custom checker
6. **Work with Polygon** - Use `polyman remote` commands to sync with Codeforces Polygon

### Remote Operations Quick Start

If you want to work with Polygon, here's a quick workflow:

```bash
# Register your API credentials (one-time)
polyman remote register <api-key> <secret>

# Pull a problem from Polygon
polyman remote pull 123456 ./my-problem

# Work on it locally...
# Then push changes back
polyman remote push ./my-problem

# Commit your changes
polyman remote commit ./my-problem -m "Updated solutions"

# Build a package
polyman remote package ./my-problem standard
```

### Learning Resources

- **Full Documentation**: Read `GUIDE.md` in this directory for detailed explanations
- **testlib.h Documentation**: [https://github.com/MikeMirzayanov/testlib](https://github.com/MikeMirzayanov/testlib)
- **Polygon Platform**: [https://polygon.codeforces.com/](https://polygon.codeforces.com/)
- **Polyman Commands**: Run `polyman --help` to see all available commands

### Common Issues and Solutions

**Q: "Validator failed - integer out of range"**

- Check your generator creates numbers within 1-1000
- Make sure validator limits match your problem constraints

**Q: "Solution gets TLE (Time Limit Exceeded)"**

- Increase `timeLimit` in Config.json
- Or optimize your solution

**Q: "Checker says Wrong Answer but output looks correct"**

- Make sure output format exactly matches (spaces, newlines)
- Use `polyman test checker` to test your checker

**Q: "Generator creates invalid tests"**

- Run `polyman validate -a` to see which tests fail
- Fix the generator to follow validator rules

**Q: "Can't find testlib.h"**

- Make sure you ran `polyman download-testlib` in your problem directory
- The file should be in your problem root folder

---

## Quick Reference

### Essential Commands

```bash
# Create new problem
polyman new <problem-name>

# Download testlib
polyman download-testlib

# Generate tests
polyman generate -a              # All testsets
polyman generate -t tests        # Specific testset
polyman generate -t tests -g samples  # Specific group
polyman generate -t tests -i 5   # Specific test

# Validate tests
polyman validate -a              # All tests
polyman validate -t tests        # Specific testset
polyman validate -t tests -i 5   # Specific test

# Run solution
polyman run <solution-name> -a    # All tests
polyman run main -t tests         # Specific testset
polyman run main -t tests -i 5    # Specific test

# Full verification
polyman verify

# List available checkers
polyman list checkers

# Test components
polyman test validator           # Test validator
polyman test checker            # Test checker
polyman test <solution-name>    # Test solution against main
```

### Command Options Summary

- `-a` or `--all` - All testsets
- `-t <name>` or `--testset <name>` - Specific testset
- `-g <name>` or `--group <name>` - Specific group
- `-i <number>` or `--index <number>` - Specific test index

---

Happy problem setting! If you have questions, check the full documentation or open an issue on GitHub.
