/**
 * @fileoverview Remote problem viewer helper functions.
 * Contains functions for fetching and displaying problem information from Polygon.
 */

import type { PolygonSDK } from '../../polygon';
import type {
  Statement,
  Solution,
  FilesResponse,
  Package,
  ProblemInfo,
  Test,
  File,
} from '../../types';
import { fmt } from '../../formatter';

// ============================================================================
// FETCH FUNCTIONS
// ============================================================================

/**
 * Fetch statements from Polygon
 */
export async function fetchStatements(
  sdk: PolygonSDK,
  problemId: number
): Promise<Array<Statement & { language: string }>> {
  try {
    const statementsRecord = await sdk.getStatements(problemId);
    return Object.entries(statementsRecord).map(([lang, stmt]) => ({
      language: lang,
      ...stmt,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch solutions from Polygon
 */
export async function fetchSolutions(
  sdk: PolygonSDK,
  problemId: number
): Promise<Solution[]> {
  try {
    return await sdk.getSolutions(problemId);
  } catch {
    return [];
  }
}

/**
 * Fetch files from Polygon
 */
export async function fetchFiles(
  sdk: PolygonSDK,
  problemId: number
): Promise<FilesResponse> {
  try {
    return await sdk.getFiles(problemId);
  } catch {
    return { resourceFiles: [], sourceFiles: [], auxFiles: [] };
  }
}

/**
 * Fetch packages from Polygon
 */
export async function fetchPackages(
  sdk: PolygonSDK,
  problemId: number
): Promise<Package[]> {
  try {
    return await sdk.listPackages(problemId);
  } catch {
    return [];
  }
}

/**
 * Fetch checker information
 */
export async function fetchChecker(
  sdk: PolygonSDK,
  problemId: number
): Promise<string> {
  try {
    return await sdk.getChecker(problemId);
  } catch {
    return '';
  }
}

/**
 * Fetch validator information
 */
export async function fetchValidator(
  sdk: PolygonSDK,
  problemId: number
): Promise<string> {
  try {
    return await sdk.getValidator(problemId);
  } catch {
    return '';
  }
}

/**
 * Identify generators from source files
 */
export function identifyGenerators(
  files: FilesResponse,
  checker: string,
  validator: string
): File[] {
  const isNotCheckerOrValidator = (f: File) =>
    !f.sourceType?.includes('checker') &&
    !f.sourceType?.includes('validator') &&
    f.name !== validator &&
    f.name !== checker;

  const isNotSolution = (f: File) => !f.sourceType?.startsWith('solution.');

  return files.sourceFiles.filter(
    f => isNotCheckerOrValidator(f) && isNotSolution(f)
  );
}

/**
 * Fetch sample tests
 */
export async function fetchSampleTests(
  sdk: PolygonSDK,
  problemId: number
): Promise<Test[]> {
  try {
    const tests = await sdk.getTests(problemId, 'tests', true);
    return tests.filter(t => t.useInStatements);
  } catch {
    return [];
  }
}

// ============================================================================
// DISPLAY HELPER FUNCTIONS
// ============================================================================

/**
 * Display basic problem information
 */
function displayBasicInfo(info: ProblemInfo): void {
  fmt.info(`  ${fmt.highlight('Basic Information:')}`);
  fmt.info(`    • Input: ${fmt.highlight(info.inputFile)}`);
  fmt.info(`    • Output: ${fmt.highlight(info.outputFile)}`);
  fmt.info(
    `    • Interactive: ${fmt.highlight(info.interactive ? 'Yes' : 'No')}`
  );
  fmt.info(
    `    • Time Limit: ${fmt.highlight(info.timeLimit.toString() + 'ms')}`
  );
  fmt.info(
    `    • Memory Limit: ${fmt.highlight(info.memoryLimit.toString() + 'MB')}`
  );
  console.log();
}

/**
 * Display checker and validator information
 */
function displayCheckerValidator(checker: string, validator: string): void {
  fmt.info(`  ${fmt.highlight('Checker & Validator:')}`);
  if (checker) {
    fmt.info(`    • Checker: ${fmt.highlight(checker)}`);
  }
  if (validator) {
    fmt.info(`    • Validator: ${fmt.highlight(validator)}`);
  }
  console.log();
}

/**
 * Display statements information
 */
function displayStatements(
  statements: Array<Statement & { language: string }>
): void {
  if (statements.length === 0) return;

  fmt.info(`  ${fmt.highlight('Statements:')}`);
  for (const stmt of statements) {
    fmt.info(`    • ${stmt.language} (${stmt.encoding})`);
    if (stmt.legend) {
      const preview = stmt.legend.substring(0, 50);
      fmt.info(`      Legend: ${preview}...`);
    }
  }
  console.log();
}

/**
 * Display sample tests information
 */
function displaySampleTests(samples: Test[]): void {
  if (samples.length === 0) return;

  fmt.info(`  ${fmt.highlight('Sample Tests:')}`);
  fmt.info(`    • ${samples.length} sample(s) for problem statement`);
  console.log();
}

/**
 * Display generators information
 */
function displayGenerators(generators: File[]): void {
  if (generators.length === 0) return;

  fmt.info(`  ${fmt.highlight('Generators:')}`);
  for (const gen of generators) {
    fmt.info(`    • ${gen.name}`);
  }
  console.log();
}

/**
 * Display solutions information
 */
function displaySolutions(solutions: Solution[]): void {
  if (solutions.length === 0) return;

  fmt.info(`  ${fmt.highlight('Solutions:')}`);
  const grouped = solutions.reduce(
    (acc, s) => {
      if (!acc[s.tag]) acc[s.tag] = [];
      acc[s.tag].push(s.name);
      return acc;
    },
    {} as Record<string, string[]>
  );

  for (const [tag, names] of Object.entries(grouped)) {
    fmt.info(`    • ${tag}: ${names.join(', ')}`);
  }
  console.log();
}

/**
 * Display files information
 */
function displayFiles(files: FilesResponse): void {
  const totalFiles =
    files.resourceFiles.length +
    files.sourceFiles.length +
    files.auxFiles.length;

  if (totalFiles === 0) return;

  fmt.info(`  ${fmt.highlight('Files:')}`);
  if (files.resourceFiles.length > 0) {
    fmt.info(`    • Resource files: ${files.resourceFiles.length}`);
  }
  if (files.sourceFiles.length > 0) {
    fmt.info(`    • Source files: ${files.sourceFiles.length}`);
  }
  if (files.auxFiles.length > 0) {
    fmt.info(`    • Auxiliary files: ${files.auxFiles.length}`);
  }
  console.log();
}

/**
 * Display packages information
 */
function displayPackages(packages: Package[]): void {
  if (packages.length === 0) return;

  fmt.info(`  ${fmt.highlight('Packages:')}`);
  const ready = packages.filter(p => p.state === 'READY').length;
  fmt.info(`    • Total: ${packages.length} (${ready} ready)`);

  const latestReady = packages.find(p => p.state === 'READY');
  if (latestReady) {
    fmt.info(
      `    • Latest ready: ${latestReady.type} (revision ${latestReady.revision})`
    );
  }
  console.log();
}

/**
 * Display comprehensive problem details
 */
export function displayProblemDetails(
  info: ProblemInfo,
  statements: Array<Statement & { language: string }>,
  solutions: Solution[],
  files: FilesResponse,
  packages: Package[],
  checker: string,
  validator: string,
  generators: File[],
  samples: Test[]
): void {
  fmt.section('PROBLEM DETAILS');

  displayBasicInfo(info);
  displayCheckerValidator(checker, validator);
  displayStatements(statements);
  displaySampleTests(samples);
  displayGenerators(generators);
  displaySolutions(solutions);
  displayFiles(files);
  displayPackages(packages);
}

// ============================================================================
// LOGGING HELPER FUNCTIONS
// ============================================================================

/**
 * Log statements fetch result
 */
export function logStatementsFetch(statements: Statement[]): void {
  const count = statements.length;
  if (count > 0) {
    fmt.info(
      `  ${fmt.infoIcon()} Found ${fmt.highlight(count.toString())} statement(s)`
    );
    statements.forEach(stmt => {
      const s = stmt as Statement & { language: string };
      fmt.info(
        `  ${fmt.infoIcon()}   - ${fmt.highlight(s.language)} (${s.encoding})`
      );
    });
  } else {
    fmt.info(`  ${fmt.infoIcon()} No statements found`);
  }
}

/**
 * Log solutions fetch result
 */
export function logSolutionsFetch(solutions: Solution[]): void {
  const count = solutions.length;
  if (count > 0) {
    fmt.info(
      `  ${fmt.infoIcon()} Found ${fmt.highlight(count.toString())} solution(s)`
    );

    const tagCounts = solutions.reduce(
      (acc, s) => {
        acc[s.tag] = (acc[s.tag] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    Object.entries(tagCounts).forEach(([tag, tagCount]) => {
      fmt.info(`  ${fmt.infoIcon()}   - ${fmt.highlight(tag)}: ${tagCount}`);
    });
  } else {
    fmt.info(`  ${fmt.infoIcon()} No solutions found`);
  }
}

/**
 * Log files fetch result
 */
export function logFilesFetch(files: FilesResponse): void {
  const { resourceFiles, sourceFiles, auxFiles } = files;
  const totalFiles =
    resourceFiles.length + sourceFiles.length + auxFiles.length;

  if (totalFiles > 0) {
    fmt.info(
      `  ${fmt.infoIcon()} Found ${fmt.highlight(totalFiles.toString())} file(s)`
    );

    const fileCounts = [
      { label: 'Resource files', count: resourceFiles.length },
      { label: 'Source files', count: sourceFiles.length },
      { label: 'Aux files', count: auxFiles.length },
    ];

    fileCounts.forEach(({ label, count }) => {
      if (count > 0) {
        fmt.info(`  ${fmt.infoIcon()}   - ${label}: ${count}`);
      }
    });
  } else {
    fmt.info(`  ${fmt.infoIcon()} No files found`);
  }
}

/**
 * Log packages fetch result
 */
export function logPackagesFetch(packages: Package[]): void {
  const count = packages.length;
  if (count > 0) {
    fmt.info(
      `  ${fmt.infoIcon()} Found ${fmt.highlight(count.toString())} package(s)`
    );

    const displayLimit = 5;
    const packagesToShow = packages.slice(0, displayLimit);

    packagesToShow.forEach(pkg => {
      const status = pkg.state === 'READY' ? '✓' : '⏳';
      fmt.info(
        `  ${fmt.infoIcon()}   ${status} ${pkg.type} (v${pkg.revision}) - ${pkg.state}`
      );
    });

    if (count > displayLimit) {
      fmt.info(`  ${fmt.infoIcon()}   ... and ${count - displayLimit} more`);
    }
  } else {
    fmt.info(`  ${fmt.infoIcon()} No packages found`);
  }
}

/**
 * Log checker fetch result
 */
export function logCheckerFetch(checker: string): void {
  if (checker) {
    fmt.info(`  ${fmt.infoIcon()} Checker: ${fmt.highlight(checker)}`);
  } else {
    fmt.info(`  ${fmt.infoIcon()} No checker configured`);
  }
}

/**
 * Log validator fetch result
 */
export function logValidatorFetch(validator: string): void {
  if (validator) {
    fmt.info(`  ${fmt.infoIcon()} Validator: ${fmt.highlight(validator)}`);
  } else {
    fmt.info(`  ${fmt.infoIcon()} No validator configured`);
  }
}

/**
 * Log generators identification result
 */
export function logGeneratorsIdentified(generators: File[]): void {
  const count = generators.length;
  if (count > 0) {
    fmt.info(
      `  ${fmt.infoIcon()} Found ${fmt.highlight(count.toString())} generator(s)`
    );
    generators.forEach(gen => {
      fmt.info(`  ${fmt.infoIcon()}   - ${gen.name}`);
    });
  } else {
    fmt.info(`  ${fmt.infoIcon()} No generators found`);
  }
}

/**
 * Log sample tests fetch result
 */
export function logSampleTestsFetch(samples: Test[]): void {
  const count = samples.length;
  if (count > 0) {
    fmt.info(
      `  ${fmt.infoIcon()} Found ${fmt.highlight(count.toString())} sample test(s)`
    );
    samples.forEach(sample => {
      fmt.info(`  ${fmt.infoIcon()}   - Test #${sample.index}`);
    });
  } else {
    fmt.info(`  ${fmt.infoIcon()} No sample tests found`);
  }
}
