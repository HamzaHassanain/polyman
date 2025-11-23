import fs from 'fs';
import path from 'path';
import { PolygonSDK } from '../../polygon';
import type ConfigFile from '../../types';
import type { Problem, ProblemInfo } from '../../types';

/**
 * Normalizes line endings in content from Polygon API.
 * Converts Windows-style (\r\n) line endings to Unix-style (\n).
 *
 * @param {string} content - Content with potentially mixed line endings
 * @returns {string} Content with normalized line endings
 */
export function normalizeLineEndingsFromWinToUnix(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Normalizes line endings in content for Windows systems.
 * Converts Unix-style (\n) line endings to Windows-style (\r\n).
 *
 * @param {string} content - Content with potentially mixed line endings
 * @returns {string} Content with normalized line endings
 */
export function normalizeLineEndingsFromUnixToWin(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
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
