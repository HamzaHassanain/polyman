# Test Suite Documentation

## Overview

Polyman has a comprehensive test suite built with [Vitest](https://vitest.dev/) that covers core functionality including:

- API signature generation and Polygon SDK methods
- File operations and utilities
- Configuration parsing and validation
- Script parsing and command validation
- Generator, checker, and validator compilation and execution
- Solution management and testset operations

## Running Tests

### Run All Tests

```bash
npm test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Tests with Coverage Report

```bash
npm run test:coverage
```

### Run Tests with UI

```bash
npm run test:ui
```

## Test Structure

```
src/__tests__/
├── fixtures/          # Test configuration files and fixtures
│   ├── valid-config.json
│   ├── invalid-config-missing-name.json
│   └── invalid-config-wrong-types.json
├── mocks/            # Mock implementations (HTTP, filesystem, etc.)
├── unit/             # Unit tests for individual modules
│   ├── utils.test.ts          # 32 tests - File operations, config parsing
│   ├── polygon.test.ts        # 36 tests - API methods, signatures, requests
│   ├── script-parser.test.ts  # 21 tests - Command parsing, validation
│   ├── checker.test.ts        # 25 tests - Compilation, validation
│   ├── validator.test.ts      # 31 tests - Compilation, test structure
│   ├── generator.test.ts      # 31 tests - Compilation, multiple generators
│   ├── solution.test.ts       # 37 tests - Finding, tags, verdict tracking
│   └── testset.test.ts        # 32 tests - Validation, commands, groups
└── integration/      # Integration tests (coming soon)
```

## Coverage Report

Current coverage: **21.74%** overall

### High Coverage Modules
- `script-parser.ts`: 100% ✅
- `utils.ts`: 86.3% ✅
- `testset.ts`: 35.4% 🟡
- `executor.ts`: 33% 🟡

To view detailed coverage report:
```bash
npm run test:coverage
# Open coverage/index.html in your browser
```

## Writing Tests

### Unit Test Example

```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from '../../helpers/myModule.js';

describe('MyModule - Feature', () => {
  it('should do something correctly', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });

  it('should throw error on invalid input', () => {
    expect(() => myFunction(null)).toThrow('Invalid input');
  });
});
```

### Test Fixtures

Test fixtures are stored in `src/__tests__/fixtures/` and should represent realistic configurations:

```typescript
import validConfig from '../fixtures/valid-config.json';

it('should parse valid configuration', () => {
  const config = JSON.parse(JSON.stringify(validConfig));
  expect(config.name).toBe('test-problem');
});
```

## Test Guidelines

1. **Test Organization**: Group related tests using `describe` blocks
2. **Test Names**: Use descriptive names that explain what is being tested
3. **Assertions**: Use appropriate expect matchers (toBe, toEqual, toThrow, etc.)
4. **Isolation**: Each test should be independent and not rely on other tests
5. **Coverage**: Aim for 80%+ code coverage, especially for critical paths
6. **Performance**: Tests should run fast (entire suite < 10 seconds)

## Continuous Integration

Tests are automatically run on:
- Pull requests
- Pushes to main branch
- Manual workflow dispatch

## Troubleshooting

### Test Failures

If tests fail, check:
1. All dependencies are installed: `npm install`
2. TypeScript is compiled: `npm run build`
3. No conflicting processes using test ports/files

### Coverage Issues

If coverage reports are not generated:
1. Ensure `@vitest/coverage-v8` is installed
2. Check `vitest.config.ts` for correct coverage provider
3. Run `npm run test:coverage -- --reporter=verbose` for detailed output

## Contributing

When adding new features:
1. Write tests for new functionality
2. Ensure existing tests still pass
3. Maintain or improve code coverage
4. Document any new test utilities or patterns

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [TypeScript Testing](https://www.typescriptlang.org/docs/handbook/testing.html)
