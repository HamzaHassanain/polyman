/**
 * @fileoverview Step functions for CLI actions.
 * Each step is an independent, reusable function that performs a specific task.
 * Steps return any data needed by subsequent steps or the calling action.
 */

import { fmt } from './formatter';
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
  ensureGeneratorsExist,
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
  ensureGeneratorsExist(config.generators);
  fmt.info(
    `  ${fmt.infoIcon()} Testsets: ${fmt.highlight(config.testsets.length.toString())}`
  );
  fmt.info(
    `  ${fmt.infoIcon()} Generators: ${fmt.highlight(config.generators.length.toString())}`
  );
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
  } else {
    fmt.success(`      ${fmt.checkmark()} Behaves as expected`);
  }
  fmt.stepComplete('All solutions verified');
}
