/**
 * @fileoverview Step functions for CLI actions.
 * Each step is an independent, reusable function that performs a specific task.
 * Steps return any data needed by subsequent steps or the calling action.
 */

import { fmt } from './formatter';
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
  compileAllGenerators,
  compileGeneratorsForTestsets,
} from './helpers/generator';
import {
  generateAllTestsets,
  generateSingleTest,
  generateTestsForGroup,
  generateTestsForTestset,
  getGeneratorCommands,
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
} from './helpers/solution';
import { copyTemplate } from './helpers/create-template';
import { downloadFile } from './helpers/testlib-download';
import { logError, readConfigFile } from './helpers/utils';
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

export function stepSaveTestlibToDirectory(
  stepNum: number,
  testlibContent: string
): void {
  fmt.step(stepNum, 'Saving to Current Directory');
  const targetPath = path.join(process.cwd(), 'testlib.h');
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
  const commands = getGeneratorCommands(testset);
  const command = commands[testIndex - 1];
  await compileAllGenerators([command], config.generators!);
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
  const allCommands = getGeneratorCommands(testset);
  const groupCommands = allCommands.filter(
    cmd => groupName === 'all' || cmd.group === groupName
  );
  await compileAllGenerators(groupCommands, config.generators!);
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
  const commands = getGeneratorCommands(testset);
  await compileAllGenerators(commands, config.generators!);
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

  const mainSolution = getMainSolution(config.solutions);
  const targetSolution = config.solutions.find(s => s.name === what);

  if (!targetSolution) {
    throw new Error(`No solution named "${what}" found.`);
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
  await runSolutionOnAllTestsets(mainSolution, config, config.testsets!);
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
    } catch (error) {
      didFail = true;
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
 * Step: Read API credentials
 */
export function stepReadCredentials(stepNum: number): {
  apiKey: string;
  secret: string;
} {
  fmt.step(stepNum, 'Reading API Credentials');
  const credentials = readCredentials();
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

  console.log();
  for (const [index, problem] of problems.entries()) {
    const info = formatProblemInfo(problem);
    fmt.log(
      `  ${fmt.primary((index + 1).toString().padStart(3, ' ') + '.')} ${info}`
    );
  }
  console.log();
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
  const info = await sdk.getProblemInfo(problemId);

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
  await sdk.commitChanges(problemId, { message });
  fmt.stepComplete('Changes committed');
}

/**
 * Step: Validate package type
 */
export function stepValidatePackageType(stepNum: number, packageType: string) {
  fmt.step(stepNum, 'Validating Package Type');

  if (!isValidPackageType(packageType)) {
    throw new Error(
      `Invalid package type: ${packageType}\n` +
        'Valid types: standard, full, linux, windows'
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
  fmt.step(stepNum, 'Building Package on Polygon');

  // Get initial package count
  const initialPackages = await sdk.listPackages(problemId);
  const initialCount = initialPackages.length;

  fmt.info(`  ${fmt.infoIcon()} Current packages: ${initialCount}`);
  fmt.info(
    `  ${fmt.infoIcon()} Starting build (this may take several minutes)...`
  );

  const isFullVerify = packageType === 'full';
  const isLinux = packageType === 'linux' || packageType === 'standard';

  // Trigger the build
  await sdk.buildPackage(problemId, isFullVerify, isLinux);
  fmt.info(`  ${fmt.infoIcon()} Build job queued, waiting for completion...`);

  // Poll every 30 seconds to check if new package is created
  let latestPackage = null;
  let attempts = 0;
  const maxAttempts = 30; // 30 minutes max wait time

  while (attempts < maxAttempts) {
    attempts++;

    // Wait 60 seconds before checking
    await new Promise(resolve => setTimeout(resolve, 30000));

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
    throw new Error('Package build timed out after 30 minutes');
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
 */
export async function stepDownloadProblemFilesAndSetUpConfig(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  savePath: string
): Promise<void> {
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
    validatorResult.data.name
  );
  downloadCount += generatorsResult.count;

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
    description: metadata.description,
    tags: metadata.tags,
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
): Promise<void> {
  fmt.step(stepNum, 'Downloading Test Files');
  const problemDir = path.resolve(process.cwd(), savePath);
  const configPath = path.join(problemDir, 'Config.json');

  // Read current config to get generators
  if (!fs.existsSync(configPath)) {
    fmt.error('Config.json not found. Run download command first.');
    throw new Error('Config.json not found');
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ConfigFile;
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

    const totalTests = testsetConfig.generatorScript?.commands?.length || 0;
    fmt.info(
      `  ${fmt.infoIcon()} Downloaded ${fmt.highlight(manualCount.toString())} manual test(s) out of ${totalTests} total`
    );
    fmt.stepComplete('Tests downloaded and testset configured');
  } catch {
    fmt.warning('  ⚠️  Could not fetch tests information');
    fmt.stepComplete('No tests to download');
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
    throw new Error(`Config.json not found in ${problemDir}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ConfigFile;

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

  await updateProblemInfo(sdk, problemId, config);

  fmt.info(
    `  ${fmt.infoIcon()} Time Limit: ${fmt.highlight(config.timeLimit + 'ms')}`
  );
  fmt.info(
    `  ${fmt.infoIcon()} Memory Limit: ${fmt.highlight(config.memoryLimit + 'MB')}`
  );
  fmt.stepComplete('Problem info updated');
}

/**
 * Step: Upload solutions to Polygon
 */
export async function stepUploadSolutions(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Uploading Solutions');

  const count = await uploadSolutions(sdk, problemId, problemDir, config);

  fmt.info(
    `  ${fmt.infoIcon()} Uploaded ${fmt.highlight(count.toString())} solution(s)`
  );
  fmt.stepComplete('Solutions uploaded');
}

/**
 * Step: Upload checker to Polygon
 */
export async function stepUploadChecker(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Uploading Checker');

  const count = await uploadChecker(sdk, problemId, problemDir, config);

  if (count > 0) {
    fmt.info(
      `  ${fmt.infoIcon()} Checker: ${fmt.highlight(config.checker?.name || 'N/A')}`
    );
  }
  fmt.stepComplete(
    config.checker.isStandard ? 'Standard Checker Updated' : 'Checker uploaded'
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
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Uploading Validator');

  const count = await uploadValidator(sdk, problemId, problemDir, config);

  if (count > 0) {
    fmt.info(
      `  ${fmt.infoIcon()} Validator: ${fmt.highlight(config.validator?.name || 'N/A')}`
    );
  }
  fmt.stepComplete(count > 0 ? 'Validator uploaded' : 'No validator to upload');
}

/**
 * Step: Upload generators to Polygon
 */
export async function stepUploadGenerators(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Uploading Generators');

  const count = await uploadGenerators(sdk, problemId, problemDir, config);

  fmt.info(
    `  ${fmt.infoIcon()} Uploaded ${fmt.highlight(count.toString())} generator(s)`
  );
  fmt.stepComplete('Generators uploaded');
}

/**
 * Step: Upload statements to Polygon
 */
export async function stepUploadStatements(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Uploading Statements');

  const count = await uploadStatements(sdk, problemId, problemDir, config);

  fmt.info(
    `  ${fmt.infoIcon()} Uploaded ${fmt.highlight(count.toString())} statement(s)`
  );
  fmt.stepComplete('Statements uploaded');
}

/**
 * Step: Upload metadata (description and tags)
 */
export async function stepUploadMetadata(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Uploading Metadata');

  await uploadMetadata(sdk, problemId, config);

  if (config.description) {
    const preview = config.description.substring(0, 50);
    fmt.info(`  ${fmt.infoIcon()} Description: ${preview}...`);
  }
  if (config.tags && config.tags.length > 0) {
    fmt.info(`  ${fmt.infoIcon()} Tags: ${config.tags.join(', ')}`);
  }
  fmt.stepComplete('Metadata uploaded');
}

/**
 * Step: Upload testsets and tests
 */
export async function stepUploadTestsets(
  stepNum: number,
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile
): Promise<void> {
  fmt.step(stepNum, 'Uploading Testsets and Tests');

  const { testsCount, manualsCount } = await uploadTestsets(
    sdk,
    problemId,
    problemDir,
    config
  );

  fmt.info(
    `  ${fmt.infoIcon()} Uploaded ${fmt.highlight(manualsCount.toString())} manual test(s)`
  );
  fmt.info(
    `  ${fmt.infoIcon()} Total tests configured: ${fmt.highlight(testsCount.toString())}`
  );
  fmt.stepComplete('Testsets uploaded');
}

/**
 * Step: Prompt user to create new problem on Polygon
 */
export async function stepPromptCreateProblem(
  stepNum: number
): Promise<boolean> {
  fmt.step(stepNum, 'Confirm Problem Creation');

  fmt.warning(
    '  No problem ID found in Config.json. This appears to be a new problem.'
  );
  console.log();
  fmt.info(
    `  ${fmt.infoIcon()} A new problem will be created on Polygon if you continue.`
  );

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
 */
export async function stepGetValidProblemName(
  stepNum: number,
  sdk: PolygonSDK,
  initialName?: string
): Promise<string> {
  fmt.step(stepNum, 'Validate Problem Name');

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
  };

  let problemName = initialName;
  let isValidName = false;

  while (!isValidName) {
    // Validate name format: lowercase, no spaces, only dashes
    if (
      problemName &&
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(problemName) &&
      problemName === problemName.toLowerCase()
    ) {
      // Check if name conflicts with existing problems
      try {
        const existingProblems = await sdk.listProblems();
        const nameConflict = existingProblems.some(
          p => problemName && p.name.toLowerCase() === problemName.toLowerCase()
        );

        if (nameConflict) {
          fmt.error(
            `  Problem name "${problemName}" already exists on Polygon.`
          );
          problemName = '';
        } else {
          isValidName = true;
        }
      } catch {
        // If we can't check, assume it's okay
        isValidName = true;
      }
    } else {
      if (problemName) {
        fmt.error(
          `  Invalid problem name "${problemName}". Name must be lowercase, no spaces, only dashes allowed.`
        );
      }
      problemName = '';
    }

    if (!isValidName) {
      problemName = await question(
        '\n  Enter a valid problem name (e.g., two-sum, maximum-flow): '
      );
      problemName = problemName.trim();
    }
  }

  rl.close();

  if (!problemName) {
    throw new Error('Problem name is required');
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
    const createdProblem = await sdk.createProblem(problemName);
    const problemId = createdProblem.id;

    fmt.success(
      `  ${fmt.checkmark()} Problem created successfully (ID: ${problemId})`
    );
    fmt.info(`  ${fmt.infoIcon()} Problem Name: ${problemName}`);
    fmt.stepComplete('Problem created on Polygon');

    return problemId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create problem on Polygon: ${message}`);
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

  fmt.info(`  ${fmt.infoIcon()} Updated Config.json with problem ID and name`);
  fmt.stepComplete('Config.json updated');
}
