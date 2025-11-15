# Polygon SDK Documentation

A comprehensive TypeScript SDK for interacting with the Codeforces Polygon API.

## Installation

```bash
npm install polyman-cli
```

## Quick Start

```typescript
import { PolygonSDK } from 'polyman-cli/polygon';

// Initialize the SDK
const sdk = new PolygonSDK({
  apiKey: 'your-api-key',
  apiSecret: 'your-api-secret',
});

// Use the SDK
async function main() {
  // List all problems
  const problems = await sdk.listProblems();
  console.log(problems);

  // Get problem info
  const info = await sdk.getProblemInfo(12345);
  console.log(info);
}
```

## Authentication

To use the Polygon API, you need to generate an API key from your Polygon settings page. Each API key has two parameters:

- `apiKey`: Your public API key
- `apiSecret`: Your secret key (keep this private!)

```typescript
const sdk = new PolygonSDK({
  apiKey: process.env.POLYGON_API_KEY!,
  apiSecret: process.env.POLYGON_API_SECRET!,
});
```

## API Methods

### Problem Management

#### List Problems

```typescript
// List all problems
const problems = await sdk.listProblems();

// List with filters
const myProblems = await sdk.listProblems({
  owner: 'myusername',
  showDeleted: false,
});
```

#### Create Problem

```typescript
const newProblem = await sdk.createProblem('My New Problem');
console.log('Created problem ID:', newProblem.id);
```

#### Get Problem Info

```typescript
const info = await sdk.getProblemInfo(12345);
console.log('Time Limit:', info.timeLimit, 'ms');
console.log('Memory Limit:', info.memoryLimit, 'MB');
```

#### Update Problem Info

```typescript
await sdk.updateProblemInfo(12345, {
  timeLimit: 2000,
  memoryLimit: 256,
  interactive: false,
});
```

### Working Copy Management

```typescript
// Update working copy
await sdk.updateWorkingCopy(12345);

// Discard working copy
await sdk.discardWorkingCopy(12345);

// Commit changes
await sdk.commitChanges(12345, {
  minorChanges: false,
  message: 'Updated time limit',
});
```

### Statements

#### Get Statements

```typescript
const statements = await sdk.getStatements(12345);
console.log(statements['english']);
```

#### Save Statement

```typescript
await sdk.saveStatement(12345, 'english', {
  name: 'A+B Problem',
  legend: 'Calculate the sum of two integers.',
  input: 'Two integers a and b (1 ≤ a, b ≤ 10^9)',
  output: 'Print a single integer — the sum of a and b.',
  notes: 'This is a sample problem.',
});
```

#### Statement Resources

```typescript
// Get statement resources
const resources = await sdk.getStatementResources(12345);

// Save a statement resource (e.g., image)
import fs from 'fs';
const imageBuffer = fs.readFileSync('diagram.png');
await sdk.saveStatementResource(12345, 'diagram.png', imageBuffer);
```

### Checker, Validator, and Interactor

```typescript
// Get current checker
const checker = await sdk.getChecker(12345);

// Set checker (use standard checker)
await sdk.setChecker(12345, 'wcmp.cpp');

// Set validator
await sdk.setValidator(12345, 'validator.cpp');

// For interactive problems
await sdk.setInteractor(12345, 'interactor.cpp');
```

### Files

#### Get All Files

```typescript
const files = await sdk.getFiles(12345);
console.log('Resource files:', files.resourceFiles);
console.log('Source files:', files.sourceFiles);
console.log('Aux files:', files.auxFiles);
```

#### View File

```typescript
const fileContent = await sdk.viewFile(12345, 'source', 'checker.cpp');
console.log(fileContent);
```

#### Save File

```typescript
import fs from 'fs';

// Save a source file
const code = fs.readFileSync('generator.cpp', 'utf-8');
await sdk.saveFile(12345, 'source', 'gen.cpp', code, {
  sourceType: 'cpp.g++17',
});
```

### Solutions

#### Get Solutions

```typescript
const solutions = await sdk.getSolutions(12345);
solutions.forEach(sol => {
  console.log(`${sol.name}: ${sol.tag}`);
});
```

#### View Solution

```typescript
const solutionCode = await sdk.viewSolution(12345, 'main.cpp');
console.log(solutionCode);
```

#### Save Solution

```typescript
import fs from 'fs';

const code = fs.readFileSync('solution.cpp', 'utf-8');
await sdk.saveSolution(12345, 'main.cpp', code, 'MA', {
  sourceType: 'cpp.g++17',
});
```

### Tests

#### Get Tests

```typescript
const tests = await sdk.getTests(12345, 'tests');
tests.forEach(test => {
  console.log(`Test ${test.index}: ${test.description || 'No description'}`);
});
```

#### Get Test Input/Answer

```typescript
const input = await sdk.getTestInput(12345, 'tests', 1);
const answer = await sdk.getTestAnswer(12345, 'tests', 1);
console.log('Input:', input);
console.log('Expected output:', answer);
```

#### Save Test

```typescript
await sdk.saveTest(12345, 'tests', 1, '5 10', {
  testDescription: 'Sample test',
  testUseInStatements: true,
});
```

### Test Groups

```typescript
// Enable test groups
await sdk.enableGroups(12345, 'tests', true);

// Set test group for multiple tests
await sdk.setTestGroup(12345, 'tests', 'group1', [1, 2, 3, 4, 5]);

// View test groups
const groups = await sdk.viewTestGroup(12345, 'tests');

// Configure a test group
await sdk.saveTestGroup(12345, 'tests', 'group1', {
  pointsPolicy: 'COMPLETE_GROUP',
  feedbackPolicy: 'ICPC',
});
```

### Script (Test Generation)

```typescript
// Get generation script
const script = await sdk.getScript(12345, 'tests');
console.log(script);

// Save generation script
const newScript = `
gen 1 10 > $
gen 11 20 > $
`;
await sdk.saveScript(12345, 'tests', newScript);
```

### Validator Tests

```typescript
// Get validator tests
const validatorTests = await sdk.getValidatorTests(12345);

// Save validator test
await sdk.saveValidatorTest(12345, 1, '5 10', 'VALID');
await sdk.saveValidatorTest(12345, 2, '-1 5', 'INVALID');
```

### Checker Tests

```typescript
// Get checker tests
const checkerTests = await sdk.getCheckerTests(12345);

// Save checker test
await sdk.saveCheckerTest(
  12345,
  1,
  '5 10', // input
  '15', // output
  '15', // answer
  'OK' // expected verdict
);
```

### Tags and Descriptions

```typescript
// Get tags
const tags = await sdk.viewTags(12345);

// Save tags
await sdk.saveTags(12345, ['math', 'implementation', 'brute force']);

// Get/save general description
const desc = await sdk.viewGeneralDescription(12345);
await sdk.saveGeneralDescription(12345, 'This is a simple A+B problem');

// Get/save general tutorial
const tutorial = await sdk.viewGeneralTutorial(12345);
await sdk.saveGeneralTutorial(12345, 'Just add the numbers together');
```

### Packages

```typescript
// List all packages
const packages = await sdk.listPackages(12345);
packages.forEach(pkg => {
  console.log(`Package ${pkg.id}: ${pkg.state} (${pkg.type})`);
});

// Build a new package
await sdk.buildPackage(12345, true, true);

// Download a package
const packageData = await sdk.downloadPackage(12345, 456, 'linux');
fs.writeFileSync('problem-package.zip', packageData);
```

### Contest Methods

```typescript
// Get contest problems
const contestProblems = await sdk.getContestProblems(789);
```

## Using with PIN Codes

If your problem or contest has a PIN code, pass it as the last parameter:

```typescript
const info = await sdk.getProblemInfo(12345, '1234');
await sdk.updateProblemInfo(12345, { timeLimit: 2000 }, '1234');
```

## Error Handling

The SDK throws errors when API requests fail:

```typescript
try {
  await sdk.getProblemInfo(99999);
} catch (error) {
  console.error('API Error:', error.message);
}
```

## Complete Example

```typescript
import { PolygonSDK } from 'polyman-cli/polygon';
import fs from 'fs';

async function setupProblem() {
  const sdk = new PolygonSDK({
    apiKey: process.env.POLYGON_API_KEY!,
    apiSecret: process.env.POLYGON_API_SECRET!,
  });

  // Create a new problem
  const problem = await sdk.createProblem('Sum of Two Numbers');
  const problemId = problem.id;

  // Update working copy
  await sdk.updateWorkingCopy(problemId);

  // Set problem info
  await sdk.updateProblemInfo(problemId, {
    timeLimit: 1000,
    memoryLimit: 256,
    interactive: false,
  });

  // Upload validator
  const validator = fs.readFileSync('validator.cpp', 'utf-8');
  await sdk.saveFile(problemId, 'source', 'validator.cpp', validator);
  await sdk.setValidator(problemId, 'validator.cpp');

  // Set standard checker
  await sdk.setChecker(problemId, 'ncmp.cpp');

  // Upload main solution
  const solution = fs.readFileSync('main.cpp', 'utf-8');
  await sdk.saveSolution(problemId, 'main.cpp', solution, 'MA');

  // Add statement
  await sdk.saveStatement(problemId, 'english', {
    name: 'Sum of Two Numbers',
    legend: 'Calculate the sum of two integers.',
    input: 'Two integers a and b.',
    output: 'Print their sum.',
  });

  // Add tests
  await sdk.saveTest(problemId, 'tests', 1, '1 2');
  await sdk.saveTest(problemId, 'tests', 2, '100 200');

  // Commit changes
  await sdk.commitChanges(problemId, {
    message: 'Initial problem setup',
  });

  console.log('Problem created successfully! ID:', problemId);
}

setupProblem().catch(console.error);
```

## TypeScript Types

The SDK includes comprehensive TypeScript type definitions for all API objects:

- `Problem`
- `ProblemInfo`
- `Statement`
- `File`
- `Solution`
- `Test`
- `TestGroup`
- `Package`
- `ValidatorTest`
- `CheckerTest`

These types are exported and can be used in your code:

```typescript
import { PolygonSDK, Problem, ProblemInfo } from 'polyman-cli/polygon';
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.

## License

MIT License - see LICENSE file for details.
