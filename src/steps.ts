/**
 * @fileoverview Step functions for CLI actions.
 * Each step is an independent, reusable function that performs a specific task.
 * Steps return any data needed by subsequent steps or the calling action.
 */

import { fmt } from './formatter';
import { LimitExceededError, PolymanError } from './errors';
import { report } from './report';
import type { Interface as ReadlineInterface } from 'readline';
import type { PolygonSDK, Problem } from './polygon';
import { PolygonSDK as PolygonSDKClass } from './polygon';
import type {
  Statement,
  Solution,
  FilesResponse,
  Package,
  ProblemInfo,
  Test,
  File,
  RemoteAction,
  TestlibSourceType,
} from './types';
import {
  readCredentials,
  getProblemId,
  formatProblemInfo,
  isValidPackageType,
  fetchProblemInfo,
} from './helpers/remote/utils';
import {
  downloadSolutions,
  downloadChecker,
  downloadValidator,
  downloadGenerators,
  downloadStatements,
  fetchProblemMetadata,
  downloadTestsetAndBuildGenerationScripts,
  type PullFailure,
} from './helpers/remote/pulling';
import {
  updateProblemInfo,
  uploadSolutions,
  uploadChecker,
  uploadValidator,
  uploadGenerators,
  uploadStatements,
  uploadMetadata,
  uploadTestsets,
} from './helpers/remote/pushing';
import {
  compileValidator,
  ensureValidatorExists,
  testValidatorItself,
  validateAllTestsets,
  validateSingleTest,
  validateTestset,
  validateGroup,
} from './helpers/validator';
import {
  compileChecker,
  ensureCheckerExists,
  testCheckerItself,
} from './helpers/checker';
import {
  compileGeneratorsForTests,
  compileGeneratorsForTestsets,
} from './helpers/generator';
import {
  generateAllTestsets,
  generateSingleTest,
  generateTestsForGroup,
  generateTestsForTestset,
  getResolvedTests,
  ensureTestsetsExist,
} from './helpers/testset';
import {
  compileAllSolutions,
  validateSolutionsExist,
  ensureMainSolutionExists,
  getMainSolution,
  runSolutionOnAllTestsets,
  runSolutionOnSingleTest,
  runSolutionOnTestset,
  runSolutionOnGroup,
  testSolutionAgainstMainCorrect,
  startTheComparisonProcess,
  validateTimeLimitMultipliers,
} from './helpers/solution';
import { copyTemplate } from './helpers/create-template';
import { downloadFile } from './helpers/testlib-download';
import { printable } from './helpers/printable';
import { NonInteractiveError } from './helpers/errors';
import { logError, readConfigFile, stdinIsInteractive } from './helpers/utils';
import {
  fetchStatements,
  fetchSolutions,
  fetchFiles,
  fetchPackages,
  fetchChecker,
  fetchValidator,
  identifyGenerators,
  fetchSampleTests,
  displayProblemDetails,
  logStatementsFetch,
  logSolutionsFetch,
  logFilesFetch,
  logPackagesFetch,
  logCheckerFetch,
  logValidatorFetch,
  logGeneratorsIdentified,
  logSampleTestsFetch,
} from './helpers/remote/viewer';
import path from 'path';
import fs from 'fs';
import type ConfigFile from './types';
import type { LocalTestset, LocalSolution } from './types';

// ============================================================================
// CREATE TEMPLATE STEPS
// ============================================================================

export function stepCreateDirectoryStructure(
  stepNum: number,
  directory: string
): void {
  fmt.step(stepNum, 'Creating Directory Structure');
  const problemDir = path.resolve(process.cwd(), directory);
  fmt.info(`  ${fmt.infoIcon()} Target directory: ${fmt.highlight(directory)}`);
  fs.mkdirSync(problemDir, { recursive: true });
  fmt.stepComplete('Directory created');
}

export function stepCopyTemplateFiles(
  stepNum: number,
  directory: string
): void {
  fmt.step(stepNum, 'Copying Template Files');
  copyTemplate(
    path.resolve(__dirname, '../template'),
    path.resolve(process.cwd(), directory)
  );
  fmt.stepComplete('Template files copied');
}

// ============================================================================
// DOWNLOAD TESTLIB STEPS
// ============================================================================

export async function stepDownloadTestlib(stepNum: number): Promise<string> {
  fmt.step(stepNum, 'Downloading testlib.h');
  const testlibUrl =
    'https://raw.githubusercontent.com/MikeMirzayanov/testlib/master/testlib.h';
  fmt.info(
    `  ${fmt.infoIcon()} Source: ${fmt.dim('github.com/MikeMirzayanov/testlib')}`
  );
  const testlibContent = await downloadFile(testlibUrl);
  fmt.stepComplete('Downloaded successfully');
  return testlibContent;
}

/**
 * Step: Save the downloaded testlib.h to the current directory.
 *
 * An existing testlib.h with other contents is kept: it may be the one
 * `remote pull` downloaded from Polygon, which the problem is built with.
 * Line endings are ignored in the comparison.
 *
 * @throws {PolymanError} With exit code 2 if testlib.h exists and differs
 */
export function stepSaveTestlibToDirectory(
  stepNum: number,
  testlibContent: string
): void {
  fmt.step(stepNum, 'Saving to Current Directory');
  const targetPath = path.join(process.cwd(), 'testlib.h');
  if (fs.existsSync(targetPath)) {
    const lf = (text: string): string => text.replace(/\r\n/g, '\n');
    if (lf(fs.readFileSync(targetPath, 'utf-8')) !== lf(testlibContent)) {
      throw new PolymanError(
        `${targetPath} already exists and is not the upstream testlib.h, so it was not replaced. It may be the testlib.h that remote pull downloaded from Polygon`,
        2,
        'Keep it to build like Polygon does. Delete it first if you want the upstream testlib.h.'
      );
    }
  }
  fs.writeFileSync(targetPath, testlibContent, 'utf-8');
  fmt.stepComplete('File saved');
}

// ============================================================================
// VALIDATION STEPS
// ============================================================================

export function stepValidateConfigForValidator(
  stepNum: number,
  config: ConfigFile
): void {
  fmt.step(stepNum, 'Validating Configuration');
  ensureValidatorExists(config.validator);
  ensureTestsetsExist(config.testsets);
  fmt.info(
    `  ${fmt.infoIcon()} Validator: ${fmt.highlight(config.validator.source)} ${fmt.dim('(C++)')}`
  );
  fmt.info(
    `  ${fmt.infoIcon()} Testsets: ${fmt.highlight(config.testsets.length.toString())}`
  );
  fmt.stepComplete('Configuration validated');
}

export async function stepCompileValidator(
  stepNum: number,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Compiling Validator');
  await compileValidator(config.validator);
  fmt.stepComplete('Validator compiled');
}

export async function stepValidateAllTestsets(
  stepNum: number,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Validating All Testsets');
  await validateAllTestsets(config.validator, config.testsets!);
  fmt.stepComplete('All testsets validated');
}

export async function stepValidateSingleTest(
  stepNum: number,
  config: ConfigFile,
  testsetName: string,
  testIndex: number
): Promise<void> {
  fmt.step(stepNum, `Validating Test ${testIndex}`);
  await validateSingleTest(config.validator, testsetName, testIndex);
  fmt.stepComplete(`Test ${testIndex} validated`);
}

export async function stepValidateGroup(
  stepNum: number,
  config: ConfigFile,
  testset: LocalTestset,
  groupName: string
): Promise<void> {
  fmt.step(stepNum, `Validating Group '${groupName}'`);
  await validateGroup(config.validator, testset, groupName);
  fmt.stepComplete(`Group '${groupName}' validated`);
}

export async function stepValidateTestset(
  stepNum: number,
  config: ConfigFile,
  testsetName: string
): Promise<void> {
  fmt.step(stepNum, 'Validating Tests');
  await validateTestset(config.validator, testsetName);
  fmt.stepComplete('Tests validated');
}

// ============================================================================
// GENERATION STEPS
// ============================================================================

export function stepValidateConfigForGeneration(
  stepNum: number,
  config: ConfigFile
): void {
  fmt.step(stepNum, 'Validating Configuration');
  ensureTestsetsExist(config.testsets);
  fmt.info(
    `  ${fmt.infoIcon()} Testsets: ${fmt.highlight(config.testsets.length.toString())}`
  );
  if (!config.generators || config.generators.length === 0) {
    fmt.warning('  No generators defined in configuration');
  } else {
    fmt.info(
      `  ${fmt.infoIcon()} Generators: ${fmt.highlight(config.generators.length.toString())}`
    );
  }
  fmt.stepComplete('Configuration validated');
}

export async function stepCompileGeneratorsForTestsets(
  stepNum: number,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Compiling Generators');
  await compileGeneratorsForTestsets(config.testsets!, config.generators!);
  fmt.stepComplete('Generators compiled');
}

export async function stepGenerateAllTestsets(
  stepNum: number,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Generating Tests for All Testsets');
  await generateAllTestsets(config.testsets!, config.generators!);
  fmt.stepComplete('All testsets generated');
}

export async function stepCompileGeneratorsForSingleTest(
  stepNum: number,
  config: ConfigFile,
  testset: LocalTestset,
  testIndex: number
): Promise<void> {
  fmt.step(stepNum, 'Compiling Generators');
  const tests = getResolvedTests(testset, config.generators ?? []);
  const target = tests.find(t => t.index === testIndex);
  if (!target) {
    const available = tests.map(t => t.index).join(', ');
    throw new Error(
      `Test ${testIndex} not found in testset "${testset.name}". ` +
        `Available indices: ${available || '(none)'}`
    );
  }
  await compileGeneratorsForTests([target], config.generators ?? []);
  fmt.stepComplete('Generators compiled');
}

export async function stepGenerateSingleTest(
  stepNum: number,
  config: ConfigFile,
  testset: LocalTestset,
  testIndex: number
): Promise<void> {
  fmt.step(stepNum, `Generating Test ${testIndex}`);
  await generateSingleTest(testset, testIndex, config.generators!);
  fmt.stepComplete(`Test ${testIndex} generated`);
}

export async function stepCompileGeneratorsForGroup(
  stepNum: number,
  config: ConfigFile,
  testset: LocalTestset,
  groupName: string
): Promise<void> {
  fmt.step(stepNum, 'Compiling Generators');
  const allTests = getResolvedTests(testset, config.generators ?? []);
  const groupTests = allTests.filter(
    t => groupName === 'all' || t.group === groupName
  );
  await compileGeneratorsForTests(groupTests, config.generators ?? []);
  fmt.stepComplete('Generators compiled');
}

export async function stepGenerateTestsForGroup(
  stepNum: number,
  config: ConfigFile,
  testset: LocalTestset,
  groupName: string
): Promise<void> {
  fmt.step(stepNum, `Generating Group '${groupName}'`);
  await generateTestsForGroup(testset, groupName, config.generators!);
  fmt.stepComplete(`Group '${groupName}' generated`);
}

export async function stepCompileGeneratorsForTestset(
  stepNum: number,
  config: ConfigFile,
  testset: LocalTestset
): Promise<void> {
  fmt.step(stepNum, 'Compiling Generators');
  const tests = getResolvedTests(testset, config.generators ?? []);
  await compileGeneratorsForTests(tests, config.generators ?? []);
  fmt.stepComplete('Generators compiled');
}

export async function stepGenerateTestsForTestset(
  stepNum: number,
  config: ConfigFile,
  testset: LocalTestset
): Promise<void> {
  fmt.step(stepNum, 'Generating Tests');
  await generateTestsForTestset(testset, config.generators!);
  fmt.stepComplete('Tests generated');
}

// ============================================================================
// SOLUTION STEPS
// ============================================================================

export function stepValidateConfigForSolutions(
  stepNum: number,
  config: ConfigFile,
  matchingSolutions: LocalSolution[]
): void {
  fmt.step(stepNum, 'Validating Configuration');
  validateSolutionsExist(config.solutions);
  ensureTestsetsExist(config.testsets);
  validateTimeLimitMultipliers(config);
  fmt.info(
    `  ${fmt.infoIcon()} Solutions: ${fmt.highlight(matchingSolutions.length.toString())}`
  );
  fmt.info(
    `  ${fmt.infoIcon()} Testsets: ${fmt.highlight(config.testsets.length.toString())}`
  );
  fmt.stepComplete('Configuration validated');
}

export async function stepCompileSolutions(
  stepNum: number,
  solutions: LocalSolution[]
): Promise<void> {
  fmt.step(stepNum, 'Compiling Solutions');
  await compileAllSolutions(solutions);
  fmt.stepComplete('Solutions compiled');
}

export async function stepRunSolutionsOnAllTestsets(
  stepNum: number,
  config: ConfigFile,
  solutions: LocalSolution[]
): Promise<void> {
  fmt.step(stepNum, 'Running Solutions on All Testsets');

  for (const solution of solutions) {
    try {
      await runSolutionOnAllTestsets(solution, config, config.testsets!);
    } catch {
      //
    }
  }
  fmt.stepComplete('All solutions completed');
}

export async function stepRunSolutionsOnTestset(
  stepNum: number,
  config: ConfigFile,
  solutions: LocalSolution[],
  testsetName: string
): Promise<void> {
  fmt.step(stepNum, `Running Solutions on Testset ${testsetName}`);
  for (const solution of solutions) {
    try {
      await runSolutionOnTestset(solution, config, testsetName);
    } catch {
      //
    }
  }
  fmt.stepComplete('Solutions completed');
}

export async function stepRunSolutionsOnTest(
  stepNum: number,
  config: ConfigFile,
  solutions: LocalSolution[],
  testsetName: string,
  testIndex: number
): Promise<void> {
  fmt.step(stepNum, `Running Solutions on Test ${testIndex}`);
  for (const solution of solutions) {
    await runSolutionOnSingleTest(solution, config, testsetName, testIndex);
  }
  fmt.stepComplete('Solutions completed');
}

export async function stepRunSolutionsOnGroup(
  stepNum: number,
  config: ConfigFile,
  solutions: LocalSolution[],
  testset: LocalTestset,
  groupName: string
): Promise<void> {
  fmt.step(stepNum, `Running Solutions on Group ${groupName}`);
  for (const solution of solutions) {
    await runSolutionOnGroup(solution, config, testset, groupName);
  }
  fmt.stepComplete('Solutions completed');
}

// ============================================================================
// CHECKER STEPS
// ============================================================================

export async function stepCompileChecker(
  stepNum: number,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Compiling Checker');
  ensureCheckerExists(config.checker);
  await compileChecker(config.checker);
  fmt.stepComplete('Checker compiled');
}
export function stepValidateConfigForChecker(
  stepNum: number,
  config: ConfigFile
): void {
  fmt.step(stepNum, 'Validating Checker Configuration');
  ensureCheckerExists(config.checker);
  fmt.info(
    `  ${fmt.infoIcon()} Checker: ${fmt.highlight(config.checker.source)} ${fmt.dim('(C++)')}`
  );
  fmt.stepComplete('Checker configuration validated');
}

export async function stepTestChecker(stepNum: number): Promise<void> {
  fmt.step(stepNum, 'Testing Checker');
  await testCheckerItself();
  fmt.stepComplete('Checker tests passed');
}

// ============================================================================
// TEST SOLUTION STEPS
// ============================================================================

export function stepValidateConfigForSolutionTest(
  stepNum: number,
  what: string
): { mainSolution: LocalSolution; targetSolution: LocalSolution } {
  fmt.step(stepNum, 'Validating Configuration');
  const config = readConfigFile();
  validateSolutionsExist(config.solutions);
  ensureMainSolutionExists(config.solutions);
  validateTimeLimitMultipliers(config);

  const mainSolution = getMainSolution(config.solutions);
  const targetSolution = config.solutions.find(s => s.name === what);

  if (!targetSolution) {
    throw new PolymanError(`No solution named "${what}" found.`, 2);
  }

  fmt.info(
    `  ${fmt.infoIcon()} Main solution: ${fmt.primary(mainSolution.name)} ${fmt.dim(`(${mainSolution.tag})`)}`
  );
  fmt.info(
    `  ${fmt.infoIcon()} Target solution: ${fmt.highlight(targetSolution.name)} ${fmt.dim(`(${targetSolution.tag})`)}`
  );
  fmt.stepComplete('Configuration validated');

  return { mainSolution, targetSolution };
}

export async function stepTestSolutionBehavior(
  stepNum: number,
  solutionName: string
): Promise<void> {
  fmt.step(stepNum, 'Testing Solution Behavior');
  await testSolutionAgainstMainCorrect(solutionName);
  fmt.stepComplete('Solution verified');
}

// ============================================================================
// FULL VERIFICATION STEPS
// ============================================================================

export async function stepGenerateTestsForVerification(
  stepNum: number,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Generating Tests');
  fmt.info(
    `  ${fmt.infoIcon()} Found ${fmt.highlight(config.generators!.length.toString())} generator(s)`
  );
  fmt.info(
    `  ${fmt.infoIcon()} Found ${fmt.highlight(config.testsets!.length.toString())} testset(s)`
  );
  await generateAllTestsets(config.testsets!, config.generators!);
  fmt.stepComplete('All tests generated successfully');
}

export async function stepTestValidator(stepNum: number): Promise<void> {
  fmt.step(stepNum, 'Testing Validator');
  await testValidatorItself();
  fmt.stepComplete('Validator tests passed');
}

export async function stepValidateGeneratedTests(
  stepNum: number,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Validating Generated Tests');
  await validateAllTestsets(config.validator, config.testsets!);
  fmt.stepComplete('All generated tests are valid');
}

export async function stepCompileSolutionsForVerification(
  stepNum: number,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Compiling Solutions');
  validateSolutionsExist(config.solutions);
  ensureMainSolutionExists(config.solutions);
  fmt.info(
    `  ${fmt.infoIcon()} Found ${fmt.highlight(config.solutions.length.toString())} solution(s)`
  );
  await compileAllSolutions(config.solutions);
  fmt.stepComplete('Solutions compiled');
}

export async function stepRunSolutionsForVerification(
  stepNum: number,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Running Solutions');
  const mainSolution = getMainSolution(config.solutions);
  const otherSolutions = config.solutions.filter(
    s => s.name !== mainSolution.name
  );
  fmt.info(
    `  ${fmt.infoIcon()} Main solution: ${fmt.primary(mainSolution.name)} ${fmt.dim(`(${mainSolution.tag})`)}`
  );
  try {
    await runSolutionOnAllTestsets(mainSolution, config, config.testsets!);
    report.setSolutionOutcome(
      mainSolution,
      true,
      'Main solution ran on every test'
    );
  } catch (error) {
    report.setSolutionOutcome(mainSolution, false, error);
    throw error;
  }
  let someFailed = false;
  for (const solution of otherSolutions) {
    try {
      await runSolutionOnAllTestsets(solution, config, config.testsets!);
    } catch {
      someFailed = true;
    }
  }
  if (someFailed) {
    fmt.warning('  Some Solutions Failed, may be expected');
  }
  fmt.stepComplete('All solutions have run');
}

export async function stepVerifySolutionsAgainstMainCorrect(
  stepNum: number,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Verifying Solutions Against Main Correct');
  const mainSolution = getMainSolution(config.solutions);
  const otherSolutions = config.solutions.filter(
    s => s.name !== mainSolution.name
  );

  let didFail = false;
  for (const solution of otherSolutions) {
    fmt.log(
      `    ${fmt.dim('→')} Checking ${fmt.highlight(solution.name)} ${fmt.dim(`(${solution.tag})`)}`
    );
    try {
      await startTheComparisonProcess(
        config.checker,
        mainSolution,
        solution,
        config.testsets!
      );
      fmt.success(
        `    ${fmt.dim('→')} ${fmt.checkmark()} ${fmt.highlight(solution.name)} Behaves as expected`
      );
      report.setSolutionOutcome(solution, true, 'Behaves as expected');
    } catch (error) {
      if (error instanceof LimitExceededError) throw error;
      didFail = true;
      report.setSolutionOutcome(solution, false, error);
      logError(error, 4);
    }
  }
  if (didFail) {
    throw new Error('Some solutions did not behave as expected');
  }
  fmt.stepComplete('All solutions verified');
}

// ============================================================================
// POLYGON REMOTE STEPS
// ============================================================================

/**
 * Formats a thrown value as one line of plain text.
 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs one remote operation and records it in the `--json` report: `ok`
 * when it resolves, the error text when it throws (the error is rethrown).
 */
async function recordAction<T>(
  entry: Omit<RemoteAction, 'ok' | 'error'>,
  run: () => Promise<T>
): Promise<T> {
  try {
    const result = await run();
    report.addAction({ ...entry, ok: true });
    return result;
  } catch (error) {
    report.addAction({ ...entry, ok: false, error: errorText(error) });
    throw error;
  }
}

/**
 * Step: Read API credentials
 */
export function stepReadCredentials(stepNum: number): {
  apiKey: string;
  secret: string;
} {
  fmt.step(stepNum, 'Reading API Credentials');
  const credentials = readCredentials();
  report.setSecrets([credentials.apiKey, credentials.secret]);
  fmt.info(`  ${fmt.infoIcon()} Credentials loaded successfully`);
  fmt.stepComplete('Credentials verified');
  return credentials;
}

/**
 * Step: Initialize Polygon SDK
 */
export function stepInitializeSDK(
  stepNum: number,
  credentials: { apiKey: string; secret: string }
): PolygonSDK {
  fmt.step(stepNum, 'Initializing Polygon SDK');
  const sdk = new PolygonSDKClass({
    apiKey: credentials.apiKey,
    apiSecret: credentials.secret,
  });
  fmt.info(`  ${fmt.infoIcon()} Connected to Polygon API`);
  fmt.stepComplete('SDK initialized');
  return sdk;
}

/**
 * Step: List Polygon problems
 */
export async function stepListProblems(
  stepNum: number,
  sdk: PolygonSDK
): Promise<Problem[]> {
  fmt.step(stepNum, 'Fetching Problems from Polygon');
  const problems = await sdk.listProblems();
  fmt.info(
    `  ${fmt.infoIcon()} Found ${fmt.highlight(problems.length.toString())} problem(s)`
  );
  fmt.stepComplete(`${problems.length} problems retrieved`);
  return problems;
}

/**
 * Step: Display problems list
 */
export function stepDisplayProblems(stepNum: number, problems: Problem[]) {
  fmt.step(stepNum, 'Displaying Problems');

  fmt.newLine();
  for (const [index, problem] of problems.entries()) {
    const info = formatProblemInfo(problem);
    fmt.log(
      `  ${fmt.primary((index + 1).toString().padStart(3, ' ') + '.')} ${info}`
    );
  }
  fmt.newLine();
  fmt.stepComplete('Problems displayed');
}

/**
 * Step: Get problem ID from path or argument
 */
export function stepGetProblemId(
  stepNum: number,
  problemIdOrPath: string
): number {
  fmt.step(stepNum, 'Resolving Problem ID');
  const problemId = getProblemId(problemIdOrPath);
  report.setProblemId(problemId);
  fmt.info(
    `  ${fmt.infoIcon()} Problem ID: ${fmt.highlight(problemId.toString())}`
  );
  fmt.stepComplete('Problem ID resolved');
  return problemId;
}

/**
 * Step: Fetch problem info from Polygon
 */
export async function stepFetchProblemInfo(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number
) {
  fmt.step(stepNum, 'Fetching Problem Information');
  const info = await recordAction(
    { component: 'info', name: 'problem info', action: 'fetch' },
    () => sdk.getProblemInfo(problemId)
  );

  fmt.info(
    `  ${fmt.infoIcon()} Time Limit: ${fmt.highlight(info.timeLimit + 'ms')}`
  );
  fmt.info(
    `  ${fmt.infoIcon()} Memory Limit: ${fmt.highlight(info.memoryLimit + 'MB')}`
  );
  fmt.stepComplete('Problem info retrieved');
  return info;
}

/**
 * Step: Fetch statements from Polygon
 */
export async function stepFetchStatements(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number
): Promise<Array<Statement & { language: string }>> {
  fmt.step(stepNum, 'Fetching Problem Statements');
  const statements = await fetchStatements(sdk, problemId);
  for (const statement of statements) {
    report.addAction({
      component: 'statement',
      name: statement.language,
      action: 'fetch',
      ok: true,
    });
  }
  logStatementsFetch(statements);
  fmt.stepComplete(
    statements.length > 0 ? 'Statements retrieved' : 'Statements check complete'
  );
  return statements;
}

/**
 * Step: Fetch solutions from Polygon
 */
export async function stepFetchSolutions(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number
): Promise<Solution[]> {
  fmt.step(stepNum, 'Fetching Solutions');
  const solutions = await fetchSolutions(sdk, problemId);
  for (const solution of solutions) {
    report.addAction({
      component: 'solution',
      name: solution.name,
      action: 'fetch',
      ok: true,
    });
  }
  logSolutionsFetch(solutions);
  fmt.stepComplete(
    solutions.length > 0 ? 'Solutions retrieved' : 'Solutions check complete'
  );
  return solutions;
}

/**
 * Step: Fetch files from Polygon
 */
export async function stepFetchFiles(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number
): Promise<FilesResponse> {
  fmt.step(stepNum, 'Fetching Problem Files');
  const files = await fetchFiles(sdk, problemId);
  logFilesFetch(files);
  const totalFiles =
    files.resourceFiles.length +
    files.sourceFiles.length +
    files.auxFiles.length;
  fmt.stepComplete(totalFiles > 0 ? 'Files retrieved' : 'Files check complete');
  return files;
}

/**
 * Step: Fetch packages from Polygon
 */
export async function stepFetchPackages(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number
): Promise<Package[]> {
  fmt.step(stepNum, 'Fetching Problem Packages');
  const packages = await fetchPackages(sdk, problemId);
  logPackagesFetch(packages);
  fmt.stepComplete(
    packages.length > 0 ? 'Packages retrieved' : 'Packages check complete'
  );
  return packages;
}

/**
 * Step: Fetch checker information
 */
export async function stepFetchChecker(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number
): Promise<string> {
  fmt.step(stepNum, 'Fetching Checker');
  const checker = await fetchChecker(sdk, problemId);
  if (checker) {
    report.addAction({
      component: 'checker',
      name: checker,
      action: 'fetch',
      ok: true,
    });
  }
  logCheckerFetch(checker);
  fmt.stepComplete(checker ? 'Checker retrieved' : 'Checker check complete');
  return checker;
}

/**
 * Step: Fetch validator information
 */
export async function stepFetchValidator(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number
): Promise<string> {
  fmt.step(stepNum, 'Fetching Validator');
  const validator = await fetchValidator(sdk, problemId);
  if (validator) {
    report.addAction({
      component: 'validator',
      name: validator,
      action: 'fetch',
      ok: true,
    });
  }
  logValidatorFetch(validator);
  fmt.stepComplete(
    validator ? 'Validator retrieved' : 'Validator check complete'
  );
  return validator;
}

/**
 * Step: Fetch generators from source files
 */
export function stepFetchGenerators(
  stepNum: number,
  files: FilesResponse,
  checker: string,
  validator: string
): File[] {
  fmt.step(stepNum, 'Identifying Generators');
  const generators = identifyGenerators(files, checker, validator);
  for (const generator of generators) {
    report.addAction({
      component: 'generator',
      name: generator.name,
      action: 'fetch',
      ok: true,
    });
  }
  logGeneratorsIdentified(generators);
  fmt.stepComplete('Generators identified');
  return generators;
}

/**
 * Step: Fetch sample tests
 */
export async function stepFetchSampleTests(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number
): Promise<Test[]> {
  fmt.step(stepNum, 'Fetching Sample Tests');
  const samples = await fetchSampleTests(sdk, problemId);
  logSampleTestsFetch(samples);
  fmt.stepComplete(
    samples.length > 0
      ? 'Sample tests retrieved'
      : 'Sample tests check complete'
  );
  return samples;
}

/**
 * Step: Display comprehensive problem view
 */
export function stepDisplayProblemView(
  stepNum: number,
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
  fmt.step(stepNum, 'Displaying Problem Details');
  displayProblemDetails(
    info,
    statements,
    solutions,
    files,
    packages,
    checker,
    validator,
    generators,
    samples
  );
  fmt.stepComplete('Problem details displayed');
}

/**
 * Step: Commit changes to Polygon
 */
export async function stepCommitChanges(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  message: string
): Promise<void> {
  fmt.step(stepNum, 'Committing Changes to Polygon');
  fmt.info(`  ${fmt.infoIcon()} Message: "${message}"`);
  await recordAction(
    { component: 'problem', name: problemId.toString(), action: 'commit' },
    () => sdk.commitChanges(problemId, { message })
  );
  fmt.stepComplete('Changes committed');
}

/**
 * Step: Validate package type
 */
export function stepValidatePackageType(stepNum: number, packageType: string) {
  fmt.step(stepNum, 'Validating Package Type');

  if (!isValidPackageType(packageType)) {
    throw new PolymanError(
      `Invalid package type: ${packageType}\n` +
        'Valid types: standard, full, linux, windows',
      2
    );
  }

  fmt.info(`  ${fmt.infoIcon()} Package type: ${fmt.highlight(packageType)}`);
  fmt.stepComplete('Package type validated');
}

/**
 * Step: Build package on Polygon and wait for completion
 */
export async function stepBuildPackage(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  packageType: string
): Promise<{ id: number; state: string; comment: string }> {
  return recordAction(
    { component: 'package', name: packageType, action: 'build' },
    () => buildPackageAndWait(stepNum, sdk, problemId, packageType)
  );
}

/**
 * Starts a package build and polls Polygon until it is READY or FAILED.
 */
async function buildPackageAndWait(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  packageType: string
): Promise<{ id: number; state: string; comment: string }> {
  fmt.step(stepNum, 'Building Package on Polygon');

  // Get initial package count
  const initialPackages = await sdk.listPackages(problemId);
  const initialCount = initialPackages.length;

  fmt.info(`  ${fmt.infoIcon()} Current packages: ${initialCount}`);
  fmt.info(
    `  ${fmt.infoIcon()} Starting build (this may take several minutes)...`
  );

  // Polygon builds the linux and windows packages only as part of a full
  // package. Every build is verified.
  const full = ['linux', 'windows', 'full'].includes(packageType);
  const verify = true;

  // Trigger the build
  await sdk.buildPackage(problemId, full, verify);
  fmt.info(`  ${fmt.infoIcon()} Build job queued, waiting for completion...`);

  // Poll once a minute, 30 times: 30 minutes max wait time
  let latestPackage = null;
  let attempts = 0;
  const maxAttempts = 30;

  while (attempts < maxAttempts) {
    attempts++;

    // Wait 60 seconds before checking
    await new Promise(resolve => setTimeout(resolve, 60000));

    // Check packages
    const currentPackages = await sdk.listPackages(problemId);

    if (currentPackages.length > initialCount) {
      // New package detected, get the latest one
      latestPackage = currentPackages.reduce(
        (latest, pkg) => (pkg.id > latest.id ? pkg : latest),
        currentPackages[0]
      );

      fmt.info(
        `  ${fmt.infoIcon()} Package detected (ID: ${latestPackage.id}, State: ${latestPackage.state})`
      );

      // If package is still running, continue waiting
      if (
        latestPackage.state === 'RUNNING' ||
        latestPackage.state === 'PENDING'
      ) {
        fmt.info(`  ${fmt.infoIcon()} Package still building, waiting...`);
        continue;
      }

      // Package is complete (READY or FAILED)
      break;
    }

    fmt.info(
      `  ${fmt.infoIcon()} Waiting... (${attempts} minute${attempts > 1 ? 's' : ''} elapsed)`
    );
  }

  if (!latestPackage) {
    throw new PolymanError('Package build timed out after 30 minutes', 4);
  }

  if (latestPackage.state !== 'READY' && latestPackage.state !== 'FAILED') {
    throw new PolymanError(
      `Package build did not finish within the polling limit of 30 minutes (package ${latestPackage.id} is still ${latestPackage.state})`,
      4
    );
  }

  if (latestPackage.state === 'READY') {
    fmt.stepComplete(`Package built successfully (ID: ${latestPackage.id})`);
  } else if (latestPackage.state === 'FAILED') {
    fmt.error(
      `  ${fmt.cross()} Package build failed: ${latestPackage.comment}`
    );
    throw new Error(`Package build failed: ${latestPackage.comment}`);
  }

  return {
    id: latestPackage.id,
    state: latestPackage.state,
    comment: latestPackage.comment,
  };
}

/**
 * Step: Create directory structure for pulled problem
 */
export function stepCreatePulledProblemDirectory(
  stepNum: number,
  savePath: string
): void {
  fmt.step(stepNum, 'Creating Directory Structure');
  const problemDir = path.resolve(process.cwd(), savePath);

  // Create main directories
  const dirs = [
    problemDir,
    path.join(problemDir, 'solutions'),
    path.join(problemDir, 'generators'),
    path.join(problemDir, 'checker'),
    path.join(problemDir, 'validator'),
    path.join(problemDir, 'testsets'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  fmt.stepComplete('Directory structure created');
}

/**
 * Step: Download all problem files from Polygon and create Config.json
 *
 * @returns {Promise<{ warnings: string[]; failures: PullFailure[]; resources: string[] }>}
 *   `resources` are the resource files (testlib.h, headers, ...) written next
 *   to Config.json, for the caller's summary.
 *   `warnings` are the placeholders the caller should repeat in its summary:
 *   no validator on Polygon, and each placeholder (solution, checker,
 *   validator, generators) put in Config.json instead of a downloaded file.
 *   They are also added to the `--json` report's `warnings`; they do not fail
 *   the pull. `failures` has each file (solution, generator, resource file,
 *   checker or validator tests, statement, description, tags) that could not
 *   be downloaded and is left out of Config.json or the problem folder. Each
 *   one is recorded as a failed `download` action; the caller fails the pull
 *   for them after the other files are written.
 */
export async function stepDownloadProblemFilesAndSetUpConfig(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  savePath: string
): Promise<{
  warnings: string[];
  failures: PullFailure[];
  resources: string[];
}> {
  fmt.step(stepNum, 'Downloading Problem Files & Creating Config');
  const problemDir = path.resolve(process.cwd(), savePath);
  let downloadCount = 0;

  // Get problem info
  const info = await fetchProblemInfo(sdk, problemId);

  // Download solutions
  const solutionsResult = await downloadSolutions(sdk, problemId, problemDir);
  downloadCount += solutionsResult.count;

  // Download checker
  const checkerResult = await downloadChecker(sdk, problemId, problemDir);
  downloadCount += checkerResult.count;

  // Download validator
  const validatorResult = await downloadValidator(sdk, problemId, problemDir);
  downloadCount += validatorResult.count;

  // Download generators and resources
  const generatorsResult = await downloadGenerators(
    sdk,
    problemId,
    problemDir,
    checkerResult.data.isStandard
      ? [validatorResult.data.name]
      : [validatorResult.data.name, checkerResult.data.name]
  );
  downloadCount += generatorsResult.count;

  // Keep the Polygon compiler of the checker and the validator
  for (const result of [checkerResult, validatorResult]) {
    const sourceType =
      generatorsResult.sourceTypes[path.basename(result.data.source)];
    if (result.count > 0 && typeof sourceType === 'string' && sourceType) {
      result.data.sourceType = sourceType as TestlibSourceType;
    }
  }

  // Download statements
  const statementsResult = await downloadStatements(sdk, problemId, problemDir);
  downloadCount += statementsResult.count;

  // Fetch metadata
  const metadata = await fetchProblemMetadata(sdk, problemId);

  // Create Config.json
  const config: ConfigFile = {
    problemId: problemId,
    name: info.name,
    owner: info.owner,
    ...(metadata.description !== undefined && {
      description: metadata.description,
    }),
    ...(metadata.tags !== undefined && { tags: metadata.tags }),
    timeLimit: info.timeLimit,
    memoryLimit: info.memoryLimit,
    inputFile: info.inputFile,
    outputFile: info.outputFile,
    interactive: info.interactive,
    statements: statementsResult.config,
    solutions: solutionsResult.data,
    checker: checkerResult.data,
    validator: validatorResult.data,
    generators: generatorsResult.data,
  };

  const configPath = path.join(problemDir, 'Config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  const downloaded = (component: string, name: string): void =>
    report.addAction({ component, name, action: 'download', ok: true });
  const failed = (failures: PullFailure[]): void => {
    for (const failure of failures) {
      report.addAction({
        component: failure.component,
        name: failure.name,
        action: 'download',
        ok: false,
        error: failure.error,
      });
    }
  };
  // With no solution downloaded, `data` holds only a placeholder entry.
  if (solutionsResult.count > 0) {
    for (const solution of solutionsResult.data) {
      downloaded('solution', solution.name);
    }
  }
  failed(solutionsResult.failures);
  if (checkerResult.count > 0) downloaded('checker', checkerResult.data.name);
  failed(checkerResult.failures);
  if (validatorResult.count > 0) {
    downloaded('validator', validatorResult.data.name);
  }
  failed(validatorResult.failures);
  for (const generator of generatorsResult.data) {
    downloaded('generator', generator.name);
  }
  for (const resource of generatorsResult.resources) {
    downloaded('resource', resource);
  }
  failed(generatorsResult.failures);
  for (const language of Object.keys(statementsResult.config)) {
    downloaded('statement', language);
  }
  failed(statementsResult.failures);
  failed(metadata.failures);
  if (validatorResult.missing) {
    report.addAction({
      component: 'validator',
      name: validatorResult.data.name,
      action: 'download',
      ok: false,
      error: 'Polygon has no validator set for this problem',
    });
  }
  report.addAction({
    component: 'config',
    name: 'Config.json',
    action: 'write',
    ok: true,
  });

  fmt.info(
    `  ${fmt.infoIcon()} Downloaded ${fmt.highlight(downloadCount.toString())} file(s)`
  );
  fmt.info(
    `  ${fmt.infoIcon()} Problem ID: ${fmt.highlight(problemId.toString())}`
  );
  fmt.info(
    `  ${fmt.infoIcon()} Time Limit: ${fmt.highlight(info.timeLimit + 'ms')}`
  );
  fmt.info(
    `  ${fmt.infoIcon()} Memory Limit: ${fmt.highlight(info.memoryLimit + 'MB')}`
  );
  fmt.stepComplete('Files downloaded & Config.json created');

  const warnings: string[] = [];
  if (solutionsResult.placeholder) warnings.push(solutionsResult.placeholder);
  if (checkerResult.placeholder) warnings.push(checkerResult.placeholder);
  if (validatorResult.missing) {
    warnings.push(
      `Polygon has no validator set for problem ${problemId}: val.cpp is listed in Config.json but not created, so verify will fail until you add it`
    );
  } else if (validatorResult.placeholder) {
    warnings.push(validatorResult.placeholder);
  }
  if (generatorsResult.placeholder) {
    warnings.push(generatorsResult.placeholder);
  }
  for (const warning of warnings) report.addWarning(warning);
  return {
    warnings,
    resources: generatorsResult.resources,
    failures: [
      ...solutionsResult.failures,
      ...checkerResult.failures,
      ...validatorResult.failures,
      ...generatorsResult.failures,
      ...statementsResult.failures,
      ...metadata.failures,
    ],
  };
}

/**
 * Reads and parses the Config.json at `configPath`.
 *
 * @throws {PolymanError} With exit code 2 if the file is unreadable or is not
 *   valid JSON (a usage error: the setter has to fix the file).
 */
function parseConfigAt(configPath: string): ConfigFile {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ConfigFile;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new PolymanError(
      `Could not read ${configPath}: ${why}`,
      2,
      'Fix the JSON in Config.json, then run the command again.',
      { cause: error }
    );
  }
}

/**
 * Step: Download test files from Polygon
 */
export async function stepDownloadTests(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  testset: string,
  savePath: string
): Promise<boolean> {
  fmt.step(stepNum, 'Downloading Test Files');
  const problemDir = path.resolve(process.cwd(), savePath);
  const configPath = path.join(problemDir, 'Config.json');

  // Read current config to get generators
  if (!fs.existsSync(configPath)) {
    fmt.error('Config.json not found. Run download command first.');
    throw new PolymanError('Config.json not found', 2);
  }

  const config = parseConfigAt(configPath);
  const generators = config.generators || [];

  try {
    const { testset: testsetConfig, manualCount } =
      await downloadTestsetAndBuildGenerationScripts(
        sdk,
        problemId,
        problemDir,
        testset,
        generators
      );

    // Update or add testset to config
    if (!config.testsets) {
      config.testsets = [];
    }

    const existingIndex = config.testsets.findIndex(
      (t: LocalTestset) => t.name === testset
    );
    if (existingIndex >= 0) {
      config.testsets[existingIndex] = testsetConfig;
    } else {
      config.testsets.push(testsetConfig);
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    report.addAction({
      component: 'testset',
      name: testset,
      action: 'download',
      ok: true,
    });
    const totalTests = testsetConfig.manualTests?.length ?? manualCount;
    fmt.info(
      `  ${fmt.infoIcon()} Downloaded ${fmt.highlight(manualCount.toString())} manual test(s); ${totalTests} configured`
    );
    fmt.stepComplete('Tests downloaded and testset configured');
    return true;
  } catch (error) {
    // The message can carry text from Polygon (its `comment`), so escape it.
    const why = printable(
      error instanceof Error ? error.message : String(error)
    );
    report.addAction({
      component: 'testset',
      name: testset,
      action: 'download',
      ok: false,
      error: why,
    });
    fmt.warning(`  ⚠️  Could not fetch tests information: ${why}`);
    fmt.stepComplete('No tests to download');
    return false;
  }
}

// ============================================================================
// POLYGON PUSH STEPS
// ============================================================================

/**
 * Step: Read Config.json from problem directory
 */
export function stepReadConfig(
  stepNum: number,
  problemDir: string
): ConfigFile {
  fmt.step(stepNum, 'Reading Problem Configuration');
  const configPath = path.join(problemDir, 'Config.json');

  if (!fs.existsSync(configPath)) {
    throw new PolymanError(`Config.json not found in ${problemDir}`, 2);
  }

  const config = parseConfigAt(configPath);
  // Config.json is user input: only a positive integer is a Polygon ID.
  const configId: unknown = config.problemId;
  if (
    typeof configId === 'number' &&
    Number.isInteger(configId) &&
    configId > 0
  ) {
    report.setProblemId(configId);
  }

  fmt.info(
    `  ${fmt.infoIcon()} Problem: ${fmt.highlight(config.name || 'Unnamed')}`
  );
  fmt.info(
    `  ${fmt.infoIcon()} Problem ID: ${fmt.highlight(config.problemId?.toString() || 'New Problem')}`
  );
  fmt.stepComplete('Configuration loaded');
  return config;
}

/**
 * Step: Update problem information
 */
export async function stepUpdateProblemInfo(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Updating Problem Information');

  await recordAction(
    { component: 'info', name: 'problem info', action: 'update' },
    () => updateProblemInfo(sdk, problemId, config)
  );

  fmt.info(
    `  ${fmt.infoIcon()} Time Limit: ${fmt.highlight(config.timeLimit + 'ms')}`
  );
  fmt.info(
    `  ${fmt.infoIcon()} Memory Limit: ${fmt.highlight(config.memoryLimit + 'MB')}`
  );
  fmt.stepComplete('Problem info updated');
}

/**
 * Turns the failures one upload step added into `--json` report actions.
 *
 * Each failure line has the form `<label>: <message>`. A failure belongs to
 * exactly one item: the longest item name for which the line starts with
 * `<component> <name>: `; for testsets, `<component> <name> ` followed by a
 * sub-label (`script`, `group g1`); else `<name>: `; else `<component>: `
 * (given to the first item).
 * Every item gets one `upload` entry, failed when a failure belongs to it.
 * Failures that belong to no item (e.g. `checker test #2`) get their own
 * entry, named by their label.
 *
 * @param component - Component name used in the labels (`solution`, ...)
 * @param names - The items the step tried to upload
 * @param newFailures - Failure lines added during the step
 * @returns The actions to record, in the order of `names`
 */
export function uploadActions(
  component: string,
  names: string[],
  newFailures: string[]
): RemoteAction[] {
  // Longest name first, so `main 2` is tried before `main`.
  const byLength = names
    .map((name, index) => ({ name, index }))
    .sort((a, b) => b.name.length - a.name.length);
  const errors: string[][] = names.map(() => []);
  const unmatched: { label: string; message: string }[] = [];
  for (const line of newFailures) {
    // Each failure goes to exactly one item, tried from the most specific
    // form to the least specific one.
    let owner: { index: number; message: string } | undefined;
    for (const { name, index } of byLength) {
      const prefix = `${component} ${name}: `;
      if (line.startsWith(prefix)) {
        owner = { index, message: line.slice(prefix.length) };
        break;
      }
    }
    // Only testsets have sub-labels (`testset tests script: ...`).
    if (!owner && component === 'testset') {
      for (const { name, index } of byLength) {
        if (line.startsWith(`${component} ${name} `)) {
          owner = { index, message: line };
          break;
        }
      }
    }
    if (!owner) {
      for (const { name, index } of byLength) {
        const prefix = `${name}: `;
        if (line.startsWith(prefix)) {
          owner = { index, message: line.slice(prefix.length) };
          break;
        }
      }
    }
    if (!owner && line.startsWith(`${component}: `) && names.length > 0) {
      owner = { index: 0, message: line.slice(component.length + 2) };
    }
    if (owner) {
      errors[owner.index]?.push(owner.message);
      continue;
    }
    const split = line.indexOf(': ');
    unmatched.push(
      split < 0
        ? { label: line, message: line }
        : { label: line.slice(0, split), message: line.slice(split + 2) }
    );
  }
  const actions: RemoteAction[] = names.map((name, index) => {
    const own = errors[index] ?? [];
    const action: RemoteAction = {
      component,
      name,
      action: 'upload',
      ok: own.length === 0,
    };
    if (own.length > 0) action.error = own.join('; ');
    return action;
  });
  for (const failure of unmatched) {
    actions.push({
      component,
      name: failure.label,
      action: 'upload',
      ok: false,
      error: failure.message,
    });
  }
  return actions;
}

/**
 * Ends an upload step. A step that added entries to `failures` ends with a
 * warning instead of the "uploaded" check mark. The step's items and
 * failures are recorded as `--json` report actions.
 */
function completeUploadStep(
  label: string,
  failures: string[],
  failuresBefore: number,
  component: string,
  names: string[]
): void {
  for (const action of uploadActions(
    component,
    names,
    failures.slice(failuresBefore)
  )) {
    report.addAction(action);
  }
  const failed = failures.length - failuresBefore;
  if (failed > 0) {
    fmt.warning(`  ${label} with ${failed} failure(s)`);
    return;
  }
  fmt.stepComplete(label);
}

/**
 * Step: Upload solutions to Polygon
 */
export async function stepUploadSolutions(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  failures: string[] = []
): Promise<void> {
  fmt.step(stepNum, 'Uploading Solutions');
  const failuresBefore = failures.length;

  const count = await uploadSolutions(
    sdk,
    problemId,
    problemDir,
    config,
    failures
  );

  fmt.info(
    `  ${fmt.infoIcon()} Uploaded ${fmt.highlight(count.toString())} solution(s)`
  );
  completeUploadStep(
    'Solutions uploaded',
    failures,
    failuresBefore,
    'solution',
    (config.solutions ?? []).map(solution => solution.name)
  );
}

/**
 * Step: Upload checker to Polygon
 */
export async function stepUploadChecker(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  failures: string[] = []
): Promise<void> {
  fmt.step(stepNum, 'Uploading Checker');
  const failuresBefore = failures.length;

  const count = await uploadChecker(
    sdk,
    problemId,
    problemDir,
    config,
    failures
  ).catch((error: unknown) => {
    report.addAction({
      component: 'checker',
      name: config.checker.name,
      action: 'upload',
      ok: false,
      error: errorText(error),
    });
    throw error;
  });

  if (count > 0) {
    fmt.info(
      `  ${fmt.infoIcon()} Checker: ${fmt.highlight(config.checker?.name || 'N/A')}`
    );
  }
  completeUploadStep(
    config.checker.isStandard ? 'Standard Checker Updated' : 'Checker uploaded',
    failures,
    failuresBefore,
    'checker',
    [config.checker.name]
  );
}

/**
 * Step: Upload validator to Polygon
 */
export async function stepUploadValidator(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  failures: string[] = []
): Promise<void> {
  fmt.step(stepNum, 'Uploading Validator');
  const failuresBefore = failures.length;

  const count = await uploadValidator(
    sdk,
    problemId,
    problemDir,
    config,
    failures
  );

  if (count > 0) {
    fmt.info(
      `  ${fmt.infoIcon()} Validator: ${fmt.highlight(config.validator?.name || 'N/A')}`
    );
  }
  completeUploadStep(
    count > 0 ? 'Validator uploaded' : 'No validator to upload',
    failures,
    failuresBefore,
    'validator',
    config.validator ? [config.validator.name] : []
  );
}

/**
 * Step: Upload generators to Polygon
 */
export async function stepUploadGenerators(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  failures: string[] = []
): Promise<void> {
  fmt.step(stepNum, 'Uploading Generators');
  const failuresBefore = failures.length;

  const count = await uploadGenerators(
    sdk,
    problemId,
    problemDir,
    config,
    failures
  );

  fmt.info(
    `  ${fmt.infoIcon()} Uploaded ${fmt.highlight(count.toString())} generator(s)`
  );
  completeUploadStep(
    'Generators uploaded',
    failures,
    failuresBefore,
    'generator',
    (config.generators ?? []).map(generator => generator.name)
  );
}

/**
 * Step: Upload statements to Polygon
 */
export async function stepUploadStatements(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  failures: string[] = []
): Promise<void> {
  fmt.step(stepNum, 'Uploading Statements');
  const failuresBefore = failures.length;

  const count = await uploadStatements(
    sdk,
    problemId,
    problemDir,
    config,
    failures
  );

  fmt.info(
    `  ${fmt.infoIcon()} Uploaded ${fmt.highlight(count.toString())} statement(s)`
  );
  completeUploadStep(
    'Statements uploaded',
    failures,
    failuresBefore,
    'statement',
    Object.keys(config.statements ?? {})
  );
}

/**
 * Step: Upload metadata (description and tags)
 */
export async function stepUploadMetadata(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  config: ConfigFile,
  failures: string[] = []
): Promise<void> {
  fmt.step(stepNum, 'Uploading Metadata');
  const failuresBefore = failures.length;

  await uploadMetadata(sdk, problemId, config, failures);

  if (config.description) {
    const preview = config.description.substring(0, 50);
    fmt.info(`  ${fmt.infoIcon()} Description: ${preview}...`);
  }
  if (config.tags && config.tags.length > 0) {
    fmt.info(`  ${fmt.infoIcon()} Tags: ${config.tags.join(', ')}`);
  }
  const metadataNames: string[] = [];
  if (config.description !== undefined) metadataNames.push('description');
  if (config.tags) metadataNames.push('tags');
  completeUploadStep(
    'Metadata uploaded',
    failures,
    failuresBefore,
    'metadata',
    metadataNames
  );
}

/**
 * Step: Upload testsets and tests
 */
export async function stepUploadTestsets(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  failures: string[] = []
): Promise<void> {
  fmt.step(stepNum, 'Uploading Testsets and Tests');
  const failuresBefore = failures.length;

  const { testsCount, manualsCount } = await uploadTestsets(
    sdk,
    problemId,
    problemDir,
    config,
    failures
  );

  fmt.info(
    `  ${fmt.infoIcon()} Uploaded ${fmt.highlight(manualsCount.toString())} manual test(s)`
  );
  fmt.info(
    `  ${fmt.infoIcon()} Total tests configured: ${fmt.highlight(testsCount.toString())}`
  );
  completeUploadStep(
    'Testsets uploaded',
    failures,
    failuresBefore,
    'testset',
    (config.testsets ?? []).map(testset => testset.name)
  );
}

/**
 * Pattern a Polygon problem name (slug) must match.
 */
const PROBLEM_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const PROBLEM_NAME_RULE =
  'Name must be lowercase, no spaces, only dashes allowed.';

/**
 * Says why polyman cannot prompt, or null when it can. A prompt needs a
 * terminal on stdin, and with `--json` stdout carries only the report.
 */
function promptBlockedReason(): string | null {
  if (!stdinIsInteractive()) return 'stdin is not a terminal';
  if (report.isActive()) return '--json is set, so polyman does not prompt';
  return null;
}

/**
 * Step: Prompt user to create new problem on Polygon
 *
 * With `yes` the confirmation is skipped. Without a terminal on stdin the
 * step fails immediately instead of blocking on a prompt nobody can answer.
 */
export async function stepPromptCreateProblem(
  stepNum: number,
  options: { yes?: boolean | undefined } = {}
): Promise<boolean> {
  fmt.step(stepNum, 'Confirm Problem Creation');

  fmt.warning(
    '  No problem ID found in Config.json. This appears to be a new problem.'
  );
  fmt.newLine();
  fmt.info(
    `  ${fmt.infoIcon()} A new problem will be created on Polygon if you continue.`
  );

  if (options.yes) {
    fmt.info(`  ${fmt.infoIcon()} --yes given, skipping confirmation`);
    fmt.stepComplete('Confirmed via --yes');
    return true;
  }

  const blocked = promptBlockedReason();
  if (blocked) {
    throw new NonInteractiveError(
      `${blocked}; pass --yes (and --name <name>) to create a new Polygon problem non-interactively`
    );
  }

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
  };

  const proceed = await question(
    '\n  Do you want to create a new problem on Polygon? (yes/no): '
  );

  rl.close();

  const shouldProceed =
    proceed.toLowerCase() === 'yes' || proceed.toLowerCase() === 'y';

  if (!shouldProceed) {
    fmt.stepComplete('User cancelled');
  }

  return shouldProceed;
}

/**
 * Step: Validate and get problem name from user
 *
 * Resolution order: `options.explicitName` (the --name flag), then
 * `initialName` (Config.json), then an interactive prompt. An explicit name
 * that is invalid or already taken fails the step. Without a terminal on
 * stdin the step fails instead of prompting.
 */
export async function stepGetValidProblemName(
  stepNum: number,
  sdk: PolygonSDK,
  initialName?: string,
  options: { explicitName?: string | undefined } = {}
): Promise<string> {
  fmt.step(stepNum, 'Validate Problem Name');

  const blocked = promptBlockedReason();
  const interactive = blocked === null;
  const strict = options.explicitName !== undefined || !interactive;
  let problemName: string | undefined = options.explicitName ?? initialName;
  const prompt: { rl: ReadlineInterface | null } = { rl: null };

  const question = async (query: string): Promise<string> => {
    if (!prompt.rl) {
      const readline = await import('readline');
      prompt.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }
    const active = prompt.rl;
    return new Promise(resolve => active.question(query, resolve));
  };

  try {
    let isValidName = false;

    while (!isValidName) {
      if (problemName && PROBLEM_NAME_PATTERN.test(problemName)) {
        const candidate = problemName;
        // Check if name conflicts with existing problems
        let nameConflict = false;
        try {
          const existingProblems = await sdk.listProblems();
          nameConflict = existingProblems.some(
            p => p.name.toLowerCase() === candidate.toLowerCase()
          );
        } catch {
          // If we can't check, assume it's okay
          nameConflict = false;
        }

        if (nameConflict) {
          const message = `Problem name "${candidate}" already exists on Polygon.`;
          if (strict) {
            throw new Error(message);
          }
          fmt.error(`  ${message}`);
          problemName = '';
        } else {
          isValidName = true;
        }
      } else {
        if (problemName) {
          const message = `Invalid problem name "${problemName}". ${PROBLEM_NAME_RULE}`;
          if (strict) {
            throw new PolymanError(message, 2);
          }
          fmt.error(`  ${message}`);
        }
        problemName = '';
      }

      if (!isValidName) {
        if (!interactive) {
          throw new NonInteractiveError(
            `${blocked ?? 'cannot prompt'}; pass --name <name> to create a new Polygon problem non-interactively. ${PROBLEM_NAME_RULE}`
          );
        }
        problemName = await question(
          '\n  Enter a valid problem name (e.g., two-sum, maximum-flow): '
        );
        problemName = problemName.trim();
      }
    }
  } finally {
    prompt.rl?.close();
  }

  if (!problemName) {
    throw new PolymanError('Problem name is required', 2);
  }

  fmt.info(`  ${fmt.infoIcon()} Problem name: ${fmt.highlight(problemName)}`);
  fmt.stepComplete('Problem name validated');

  return problemName;
}

/**
 * Step: Create new problem on Polygon
 */
export async function stepCreateProblemOnPolygon(
  stepNum: number,
  sdk: PolygonSDK,
  problemName: string
): Promise<number> {
  fmt.step(stepNum, 'Creating New Problem on Polygon');

  try {
    const createdProblem = await recordAction(
      { component: 'problem', name: problemName, action: 'create' },
      () => sdk.createProblem(problemName)
    );
    const problemId = createdProblem.id;
    report.setProblemId(problemId);

    fmt.success(
      `  ${fmt.checkmark()} Problem created successfully (ID: ${problemId})`
    );
    fmt.info(`  ${fmt.infoIcon()} Problem Name: ${problemName}`);
    fmt.stepComplete('Problem created on Polygon');

    return problemId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PolymanError(
      `Failed to create problem on Polygon: ${message}`,
      4,
      undefined,
      {
        cause: error,
      }
    );
  }
}

/**
 * Step: Update Config.json with problem ID and name
 */
export function stepUpdateConfigWithProblemId(
  stepNum: number,
  problemDir: string,
  config: ConfigFile,
  problemId: number,
  problemName: string
): void {
  fmt.step(stepNum, 'Updating Config.json');

  config.problemId = problemId;
  config.name = problemName;

  const configPath = path.join(problemDir, 'Config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  report.addAction({
    component: 'config',
    name: 'Config.json',
    action: 'update',
    ok: true,
  });
  fmt.info(`  ${fmt.infoIcon()} Updated Config.json with problem ID and name`);
  fmt.stepComplete('Config.json updated');
}
