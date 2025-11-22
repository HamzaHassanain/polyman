/**
 * @fileoverview Helper functions for Polygon remote operations.
 * Handles credential management, SDK initialization, and remote operations.
 */

import fs from 'fs';
import path from 'path';
import { PolygonSDK } from '../polygon';
import type ConfigFile from '../types';
import type {
  LocalChecker,
  LocalGenerator,
  LocalSolution,
  LocalValidator,
  LocalTestset,
  GeneratorScriptCommand,
  Problem,
  ProblemInfo,
  SolutionTag,
  StatementConfig,
} from '../types';
import { fmt } from '../formatter';

/**
 * Normalizes line endings in content from Polygon API.
 * Converts Windows-style (\r\n) line endings to Unix-style (\n).
 *
 * @param {string} content - Content with potentially mixed line endings
 * @returns {string} Content with normalized line endings
 */
function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Downloads all solutions from Polygon and returns metadata.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Target directory for solutions
 * @returns {Promise<{ data: Array<LocalSolution>; count: number }>}
 */
export async function downloadSolutions(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string
): Promise<{
  data: Array<{ name: string; source: string; tag: SolutionTag }>;
  count: number;
}> {
  const solutionsData: Array<LocalSolution> = [];
  let count = 0;

  try {
    const solutions = await sdk.getSolutions(problemId);
    for (const solution of solutions) {
      try {
        const code = await sdk.viewSolution(problemId, solution.name);
        const targetPath = path.join(problemDir, 'solutions', solution.name);
        fs.writeFileSync(targetPath, normalizeLineEndings(code), 'utf-8');
        count++;
        solutionsData.push({
          name: solution.name.replace(/\.[^.]+$/, ''),
          source: './solutions/' + solution.name,
          tag: solution.tag,
        });
      } catch {
        fmt.warning(`  ⚠️  Failed to download solution: ${solution.name}`);
      }
    }
  } catch {
    fmt.error(
      `  ${fmt.cross()} Could not download Solution, adding acc.cpp to be implemented`
    );
  }

  if (solutionsData.length === 0) {
    solutionsData.push({ name: 'main', source: 'acc.cpp', tag: 'MA' as const });
  }

  return { data: solutionsData, count };
}

/**
 * Downloads checker from Polygon and returns metadata.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Target directory for checker
 * @returns {Promise<{ data: LocalChecker; count: number }>}
 */
export async function downloadChecker(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string
): Promise<{
  data: LocalChecker;
  count: number;
}> {
  let count = 0;

  try {
    let checkerName = await sdk.getChecker(problemId);
    const isStandard = checkerName.includes('std::');
    checkerName = checkerName.replace(/std::/g, '');

    if (!isStandard) {
      const checkerCode = await sdk.viewFile(problemId, 'source', checkerName);
      const targetPath = path.join(problemDir, 'checker', checkerName);
      fs.writeFileSync(targetPath, normalizeLineEndings(checkerCode), 'utf-8');
      count++;

      // Download checker tests
      try {
        const checkerTests = await sdk.getCheckerTests(problemId);
        // Normalize line endings in test inputs
        const normalizedTests = checkerTests.map(test => ({
          ...test,
          input: test.input ? normalizeLineEndings(test.input) : test.input,
          output: test.output ? normalizeLineEndings(test.output) : test.output,
          answer: test.answer ? normalizeLineEndings(test.answer) : test.answer,
        }));
        const testsPath = path.join(
          problemDir,
          'checker',
          'checker_tests.json'
        );
        fs.writeFileSync(
          testsPath,
          JSON.stringify({ tests: normalizedTests }, null, 2),
          'utf-8'
        );
        count++;
      } catch {
        fmt.warning('  ⚠️  Could not fetch checker tests');
      }
    }

    return {
      data: {
        name: checkerName.replace(/\.[^.]+$/, ''),
        source: isStandard ? checkerName : './checker/' + checkerName,
        isStandard,
        ...(!isStandard && {
          testsFilePath: './checker/' + 'checker_tests.json',
        }),
      },
      count,
    };
  } catch {
    fmt.error(
      `  ${fmt.cross()} Could not download Checker, adding ncmp.cpp as default`
    );
    return {
      data: { name: 'ncmp', source: 'ncmp.cpp', isStandard: true },
      count: 0,
    };
  }
}

/**
 * Downloads validator from Polygon and returns metadata.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Target directory for validator
 * @returns {Promise<{ data: LocalValidator; count: number}>}
 */
export async function downloadValidator(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string
): Promise<{
  data: LocalValidator;
  count: number;
}> {
  let count = 0;

  try {
    const validatorName = await sdk.getValidator(problemId);
    const validatorCode = await sdk.viewFile(
      problemId,
      'source',
      validatorName
    );
    const targetPath = path.join(problemDir, 'validator', validatorName);
    fs.writeFileSync(targetPath, normalizeLineEndings(validatorCode), 'utf-8');
    count++;

    // Download validator tests
    try {
      const validatorTests = await sdk.getValidatorTests(problemId);
      // Normalize line endings in test inputs
      const normalizedTests = validatorTests.map(test => ({
        ...test,
        input: test.input ? normalizeLineEndings(test.input) : test.input,
      }));
      const testsPath = path.join(
        problemDir,
        'validator',
        'validator_tests.json'
      );
      fs.writeFileSync(
        testsPath,
        JSON.stringify({ tests: normalizedTests }, null, 2),
        'utf-8'
      );
      count++;
    } catch {
      fmt.warning('  ⚠️  Could not fetch validator tests');
    }

    return {
      data: {
        name: validatorName.replace(/\.[^.]+$/, ''),
        source: './validator/' + validatorName,
        testsFilePath: './validator/validator_tests.json',
      },
      count,
    };
  } catch {
    fmt.error(
      `  ${fmt.cross()} Could not download validator, adding val.cpp to be implemented`
    );
    return {
      data: { name: 'validator', source: 'val.cpp' },
      count: 0,
    };
  }
}

/**
 * Downloads generators and resource files from Polygon.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Target directory
 * @param {string} validatorName - Validator filename to skip
 * @returns {Promise<{ data: Array<LocalGenerator>; count: number }>}
 */
export async function downloadGenerators(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  validatorName: string
): Promise<{
  data: Array<LocalGenerator>;
  count: number;
}> {
  const generatorsData: Array<LocalGenerator> = [];
  let count = 0;

  try {
    const files = await sdk.getFiles(problemId);

    // Download generators (skip solutions, checker, validator)
    for (const file of files.sourceFiles) {
      if (
        file.sourceType?.includes('checker') ||
        file.sourceType?.includes('validator') ||
        file.sourceType?.startsWith('solution.') ||
        file.name === validatorName + '.cpp'
      ) {
        continue;
      }

      try {
        const content = await sdk.viewFile(problemId, 'source', file.name);
        const targetPath = path.join(problemDir, 'generators', file.name);
        fs.writeFileSync(targetPath, normalizeLineEndings(content), 'utf-8');
        count++;
        generatorsData.push({
          name: file.name.replace(/\.[^.]+$/, ''),
          source: './generators/' + file.name,
        });
      } catch {
        fmt.warning(`  ⚠️  Failed to download: ${file.name}`);
      }
    }
  } catch {
    fmt.warning('  ⚠️  Could not fetch files');
  }

  return { data: generatorsData, count };
}

/**
 * Downloads statements in all languages and saves as .tex files.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Target directory
 * @returns {Promise<{ config: Record<string, StatementConfig>; count: number; problemName: string }>}
 */
export async function downloadStatements(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string
): Promise<{
  config: Record<string, StatementConfig>;
  count: number;
  problemName: string;
}> {
  const statementsConfig: Record<string, StatementConfig> = {};
  let count = 0;
  let problemName = 'problem';

  try {
    const statementsData = await sdk.getStatements(problemId);

    for (const [lang, statement] of Object.entries(statementsData)) {
      const langDir = path.join(problemDir, 'statements', lang);
      if (!fs.existsSync(langDir)) {
        fs.mkdirSync(langDir, { recursive: true });
      }

      // Extract problem name from first available statement
      if (!problemName || problemName === 'problem') {
        if (statement.name) {
          problemName = statement.name;
        }
      }

      const langConfig: Record<string, string> = {
        encoding: statement.encoding || 'UTF-8',
        name: statement.name || problemName,
      };

      // Save each statement component as .tex file
      if (statement.legend) {
        fs.writeFileSync(
          path.join(langDir, 'legend.tex'),
          normalizeLineEndings(statement.legend),
          'utf-8'
        );
        langConfig['legend'] = `./statements/${lang}/legend.tex`;
        count++;
      }

      if (statement.input) {
        fs.writeFileSync(
          path.join(langDir, 'input-format.tex'),
          normalizeLineEndings(statement.input),
          'utf-8'
        );
        langConfig['input'] = `./statements/${lang}/input-format.tex`;
        count++;
      }

      if (statement.output) {
        fs.writeFileSync(
          path.join(langDir, 'output-format.tex'),
          normalizeLineEndings(statement.output),
          'utf-8'
        );
        langConfig['output'] = `./statements/${lang}/output-format.tex`;
        count++;
      }

      if (statement.notes) {
        fs.writeFileSync(
          path.join(langDir, 'notes.tex'),
          normalizeLineEndings(statement.notes),
          'utf-8'
        );
        langConfig['notes'] = `./statements/${lang}/notes.tex`;
        count++;
      }

      if (statement.tutorial) {
        fs.writeFileSync(
          path.join(langDir, 'tutorial.tex'),
          normalizeLineEndings(statement.tutorial),
          'utf-8'
        );
        langConfig['tutorial'] = `./statements/${lang}/tutorial.tex`;
        count++;
      }

      if (statement.interaction) {
        fs.writeFileSync(
          path.join(langDir, 'interaction.tex'),
          normalizeLineEndings(statement.interaction),
          'utf-8'
        );
        langConfig['interaction'] = `./statements/${lang}/interaction.tex`;
        count++;
      }

      if (statement.scoring) {
        fs.writeFileSync(
          path.join(langDir, 'scoring.tex'),
          normalizeLineEndings(statement.scoring),
          'utf-8'
        );
        langConfig['scoring'] = `./statements/${lang}/scoring.tex`;
        count++;
      }

      statementsConfig[lang] = langConfig as unknown as StatementConfig;
    }
  } catch {
    fmt.warning('  ⚠️  Could not fetch statements');
  }

  return { config: statementsConfig, count, problemName };
}

/**
 * Fetches problem metadata (description and tags).
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @returns {Promise<{ description: string; tags: string[] }>}
 */
export async function fetchProblemMetadata(
  sdk: PolygonSDK,
  problemId: number
): Promise<{ description: string; tags: string[] }> {
  let description = '';
  let tags: string[] = [];

  try {
    description = await sdk.viewGeneralDescription(problemId);
  } catch {
    // Description is optional
  }

  try {
    tags = await sdk.viewTags(problemId);
  } catch {
    // Tags are optional
  }

  return { description, tags };
}

/**
 * Fetches combined problem information.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @returns {Promise<Problem & ProblemInfo>}
 */
export async function fetchProblemInfo(
  sdk: PolygonSDK,
  problemId: number
): Promise<Problem & ProblemInfo> {
  const problemInfo = await sdk.getProblemInfo(problemId);
  const problemFromList = (await sdk.listProblems()).find(
    p => p.id === problemId
  );

  if (!problemFromList) {
    throw new Error('Problem not found');
  }

  return {
    ...problemInfo,
    ...problemFromList,
  };
}

/**
 * Gets the path to the .polyman directory in user's home.
 *
 * @returns {string} Absolute path to .polyman directory
 *
 * @example
 * const dir = getPolymanDirectory();
 * // Returns: '/home/user/.polyman' or 'C:\Users\user\.polyman'
 */
export function getPolymanDirectory(): string {
  const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '';
  if (!homeDir) {
    throw new Error('Could not determine home directory');
  }
  return path.join(homeDir, '.polyman');
}

/**
 * Reads Polygon API credentials from ~/.polyman/ directory.
 *
 * @returns {{ apiKey: string; secret: string }} API credentials
 *
 * @throws {Error} If credentials files don't exist or are empty
 *
 * @example
 * const { apiKey, secret } = readCredentials();
 */
export function readCredentials(): { apiKey: string; secret: string } {
  const polymanDir = getPolymanDirectory();
  const apiKeyPath = path.join(polymanDir, 'api_key');
  const secretPath = path.join(polymanDir, 'secret_key');

  if (!fs.existsSync(apiKeyPath)) {
    throw new Error(
      'API key not found. Please run: polyman register <api-key> <secret>'
    );
  }

  if (!fs.existsSync(secretPath)) {
    throw new Error(
      'API secret not found. Please run: polyman register <api-key> <secret>'
    );
  }

  const apiKey = fs.readFileSync(apiKeyPath, 'utf-8').trim();
  const secret = fs.readFileSync(secretPath, 'utf-8').trim();

  if (!apiKey || !secret) {
    throw new Error('API credentials are empty. Please register again.');
  }

  return { apiKey, secret };
}

/**
 * Initializes and returns a configured PolygonSDK instance.
 *
 * @returns {PolygonSDK} Configured SDK instance
 *
 * @throws {Error} If credentials cannot be read
 *
 * @example
 * const sdk = initializeSDK();
 * const problems = await sdk.listProblems();
 */
export function initializeSDK(): PolygonSDK {
  const { apiKey, secret } = readCredentials();
  return new PolygonSDK({
    apiKey,
    apiSecret: secret,
  });
}

/**
 * Checks if credentials are registered.
 *
 * @returns {boolean} True if credentials exist
 *
 * @example
 * if (!areCredentialsRegistered()) {
 *   console.log('Please register your API credentials first');
 * }
 */
export function areCredentialsRegistered(): boolean {
  try {
    const polymanDir = getPolymanDirectory();
    const apiKeyPath = path.join(polymanDir, 'api_key');
    const secretPath = path.join(polymanDir, 'secret_key');
    return fs.existsSync(apiKeyPath) && fs.existsSync(secretPath);
  } catch {
    return false;
  }
}

/**
 * Determines problem ID from path or direct ID.
 * If path is provided, reads problem ID from Config.json.
 * If numeric string, returns as problem ID.
 *
 * @param {string} problemIdOrPath - Problem ID or path to directory
 * @returns {number} Problem ID
 *
 * @throws {Error} If Config.json doesn't exist or doesn't contain problem ID
 *
 * @example
 * const id = getProblemId('123456');  // Returns: 123456
 * const id = getProblemId('./my-problem');  // Reads from Config.json
 * const id = getProblemId('.');  // Reads from current directory's Config.json
 */
export function getProblemId(problemIdOrPath: string): number {
  // Check if it's a numeric ID
  const numericId = parseInt(problemIdOrPath, 10);
  if (!isNaN(numericId)) {
    return numericId;
  }

  // It's a path - read from Config.json
  const configPath = path.resolve(problemIdOrPath, 'Config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config.json not found at: ${configPath}\nProvide a valid problem ID or path to problem directory.`
    );
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ConfigFile;

  if (!config.problemId) {
    throw new Error(
      'Config.json does not contain problemId field.\n' +
        'Either provide a problem ID directly, or pull the problem from Polygon first.'
    );
  }

  return config.problemId;
}

/**
 * Formats problem information for display.
 *
 * @param {Problem} problem - Problem object from Polygon API
 * @returns {string} Formatted problem string
 *
 * @example
 * const formatted = formatProblemInfo(problem);
 * // Returns: "[123456] My Problem (owner: username, access: OWNER)"
 */
export function formatProblemInfo(problem: Problem): string {
  const status = problem.modified ? ' (modified)' : '';
  return `[${problem.id}] ${problem.name} (owner: ${problem.owner}, access: ${problem.accessType})${status}`;
}

/**
 * Saves problem ID to Config.json.
 *
 * @param {string} configPath - Path to Config.json
 * @param {number} problemId - Problem ID to save
 *
 * @throws {Error} If Config.json cannot be read or written
 *
 * @example
 * saveProblemIdToConfig('./my-problem/Config.json', 123456);
 */
export function saveProblemIdToConfig(
  configPath: string,
  problemId: number
): void {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ConfigFile;
  config.problemId = problemId;
  const str = JSON.stringify(config, null, 2).replace(/\r\n/g, '\n');
  fs.writeFileSync(configPath, str, 'utf-8');
}

/**
 * Validates package type.
 *
 * @param {string} packageType - Package type to validate
 * @returns {boolean} True if valid
 *
 * @example
 * if (!isValidPackageType('standard')) {
 *   throw new Error('Invalid package type');
 * }
 */
export function isValidPackageType(packageType: string): boolean {
  const validTypes = ['standard', 'full', 'linux', 'windows'];
  return validTypes.includes(packageType.toLowerCase());
}

/**
 * Downloads tests and builds testset configuration with generator scripts.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Target directory
 * @param {string} testsetName - Name of testset (usually 'tests')
 * @param {LocalGenerator[]} generators - Available generators
 * @returns {Promise<{ testset: LocalTestset; manualCount: number }>}
 */
export async function downloadTestsetAndBuildGenerationScripts(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  testsetName: string,
  generators: LocalGenerator[]
): Promise<{
  testset: LocalTestset;
  manualCount: number;
}> {
  const testsDir = path.join(problemDir, 'testsets', testsetName);
  const manualTestsDir = path.join(problemDir, 'manual', testsetName);
  if (!fs.existsSync(testsDir)) {
    fs.mkdirSync(testsDir, { recursive: true });
  }

  // Get tests from Polygon
  const tests = await sdk.getTests(problemId, testsetName, false);

  // Get Generation Script
  const generationScript = await sdk.getScript(problemId, testsetName);

  const commands: GeneratorScriptCommand[] = [];
  let manualCount = 0;
  const generatorNameMap = new Map<string, string>();
  for (const g of generators) {
    const filename = g.source
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '');
    if (filename) {
      generatorNameMap.set(filename, g.name);
    }
  }

  // Process each test
  for (const test of tests) {
    if (test.manual && test.input) {
      // Manual test - save to file
      if (!fs.existsSync(manualTestsDir)) {
        fs.mkdirSync(manualTestsDir, { recursive: true });
      }

      const filename = `test${test.index}.txt`;
      const filePath = path.join(manualTestsDir, filename);
      const content = test.input.replace(/\r\n/g, '\n');
      fs.writeFileSync(filePath, content, 'utf-8');
      manualCount++;

      const command: GeneratorScriptCommand = {
        index: test.index,
        type: 'manual',
        manualFile: `./manual/${testsetName}/${filename}`,
        useInStatements: test.useInStatements,
      };
      if (test.group) command.group = test.group;
      if (test.points !== undefined) command.points = test.points;
      commands.push(command);
    }
  }

  // Parse generation script and merge commands
  const scriptCommands = parseGenerationScript(
    generationScript,
    generatorNameMap
  );

  // Build testset configuration
  const testset: LocalTestset = {
    name: testsetName,
    generatorScript: {
      commands: [...commands, ...scriptCommands],
    },
  };

  // Check if groups are used
  const hasGroups = tests.some(t => t.group);
  if (hasGroups) {
    testset.groupsEnabled = true;
    // Extract unique groups
    const groupNames = [
      ...new Set(tests.filter(t => t.group).map(t => t.group!)),
    ];
    testset.groups = groupNames.map(name => ({
      name,
    }));
  }

  // Check if points are used
  const hasPoints = tests.some(t => t.points !== undefined);
  if (hasPoints) {
    testset.pointsEnabled = true;
  }

  return { testset, manualCount };
}

/**
 * Parses FreeMarker template generation script to extract generator commands.
 * Handles patterns like: <#list from..to as s> GeneratorName ${s} > $ </#list>
 *
 * @param {string} script - Generation script with FreeMarker syntax
 * @param {Map<string, string>} generatorNameMap - Map of generator filenames to names
 * @returns {GeneratorScriptCommand[]} Array of generator commands
 */
function parseGenerationScript(
  script: string,
  generatorNameMap: Map<string, string>
): GeneratorScriptCommand[] {
  const commands: GeneratorScriptCommand[] = [];

  // Pattern to match: <#list from..to as var> GeneratorName ${var} args > $ </#list>
  const listPattern =
    /<#list\s+(\d+|[a-zA-Z_]\w*)\.\.(\d+|[a-zA-Z_]\w*)\s+as\s+\w+>\s*([^<]+?)\s*<\/#list>/gs;

  let match;
  while ((match = listPattern.exec(script)) !== null) {
    const fromStr = match[1];
    const toStr = match[2];
    const commandLine = match[3].trim();

    // Parse the command line to extract generator name and arguments
    // Remove "> $" output redirection
    const cleanedLine = commandLine.replace(/\s*>\s*\$\s*$/, '').trim();

    // Extract generator name (first token) and check for ${var} placeholder
    const parts = cleanedLine.split(/\s+/);
    if (parts.length === 0) continue;

    const generatorFile = parts[0];

    // Try to find the generator name in our map
    let generatorName = generatorNameMap.get(generatorFile) || generatorFile;

    // If not found, try case-insensitive match
    if (!generatorNameMap.has(generatorFile)) {
      const lowerFile = generatorFile.toLowerCase();
      for (const [file, name] of generatorNameMap.entries()) {
        if (file.toLowerCase() === lowerFile) {
          generatorName = name;
          break;
        }
      }
    }

    // Check if from and to are numeric literals or variables
    const fromNum = parseInt(fromStr, 10);
    const toNum = parseInt(toStr, 10);

    if (!isNaN(fromNum) && !isNaN(toNum)) {
      // Numeric range - create generator-range command
      commands.push({
        type: 'generator-range',
        generator: generatorName,
        range: [fromNum, toNum],
        useInStatements: false,
      });
    }
  }

  return commands;
}
