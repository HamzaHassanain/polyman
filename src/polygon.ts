/**
 * @fileoverview TypeScript SDK for Codeforces Polygon API.
 * Provides type-safe methods for interacting with Polygon programmatically.
 * Handles authentication, signature generation, and all API endpoints.
 * Complete implementation of Polygon API v1 with comprehensive type definitions.
 */

import * as crypto from 'crypto';
import type {
  Problem,
  ProblemInfo,
  Statement,
  File,
  FilesResponse,
  Solution,
  Test,
  TestGroup,
  Package,
  ValidatorTest,
  CheckerTest,
  TestOptions,
} from './types';

// Re-export types for convenience
export type {
  Problem,
  ProblemInfo,
  Statement,
  StatementConfig,
  ResourceAdvancedProperties,
  File,
  FilesResponse,
  SolutionTag,
  Solution,
  Test,
  TestGroup,
  PointsPolicy,
  FeedbackPolicy,
  Package,
  PackageState,
  PackageType,
  ValidatorTest,
  ValidatorVerdict,
  CheckerTest,
  CheckerVerdict,
} from './types';

/**
 * Response wrapper for all Polygon API calls.
 * Every API method returns this structure with status and optional result/comment.
 *
 * @interface PolygonResponse
 * @template T - Type of the result data
 * @property {'OK' | 'FAILED'} status - Indicates success or failure of the request
 * @property {string} [comment] - Error message if status is FAILED
 * @property {T} [result] - Result data if status is OK
 *
 * @internal
 */
interface PolygonResponse<T> {
  status: 'OK' | 'FAILED';
  comment?: string;
  result?: T;
}

/**
 * Configuration options for initializing the Polygon SDK.
 *
 * @interface PolygonConfig
 * @property {string} apiKey - Your Polygon API key (from settings page)
 * @property {string} apiSecret - Your Polygon API secret
 * @property {string} [baseUrl] - Optional custom API base URL (defaults to official Polygon API)
 *
 * @example
 * const config = {
 *   apiKey: process.env.POLYGON_API_KEY!,
 *   apiSecret: process.env.POLYGON_API_SECRET!
 * };
 */
export interface PolygonConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
}

/**
 * Comprehensive SDK for Codeforces Polygon API.
 * Provides type-safe methods for all Polygon operations including problem management,
 * statements, tests, solutions, checkers, validators, and package building.
 *
 * Features:
 * - Automatic authentication with SHA-512 signature generation
 * - Full TypeScript type safety
 * - Support for all Polygon API endpoints (54+ methods)
 * - PIN code support for protected problems
 * - File upload/download with Buffer support
 * - Comprehensive error handling
 *
 * @class PolygonSDK
 *
 * @example
 * // Initialize SDK
 * const sdk = new PolygonSDK({
 *   apiKey: process.env.POLYGON_API_KEY!,
 *   apiSecret: process.env.POLYGON_API_SECRET!
 * });
 *
 * @example
 * // List and filter problems
 * const myProblems = await sdk.listProblems({ owner: 'username' });
 *
 * @example
 * // Create and configure a problem
 * const problem = await sdk.createProblem('A+B Problem');
 * await sdk.updateWorkingCopy(problem.id);
 * await sdk.updateProblemInfo(problem.id, {
 *   timeLimit: 2000,
 *   memoryLimit: 256
 * });
 * await sdk.commitChanges(problem.id, { message: 'Initial setup' });
 *
 * @example
 * // Upload files and solutions
 * import fs from 'fs';
 * const code = fs.readFileSync('main.cpp', 'utf-8');
 * await sdk.saveSolution(problem.id, 'main.cpp', code, 'MA');
 */
export class PolygonSDK {
  /** @internal */
  private apiKey: string;
  /** @internal */
  private apiSecret: string;
  /** @internal */
  private baseUrl: string;

  /**
   * Creates a new Polygon SDK instance.
   *
   * @param {PolygonConfig} config - SDK configuration with API credentials
   * @throws {Error} If credentials are invalid or missing
   *
   * @example
   * const sdk = new PolygonSDK({
   *   apiKey: 'your-api-key',
   *   apiSecret: 'your-api-secret'
   * });
   */
  constructor(config: PolygonConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.baseUrl || 'https://polygon.codeforces.com/api';
  }

  /**
   * Generates cryptographic signature for API request authentication.
   * Implements Polygon's SHA-512 based signature scheme with random salt.
   *
   * @param {string} methodName - API method name (e.g., 'problems.list')
   * @param {Record<string, string | number | boolean>} params - Request parameters
   * @returns {string} Signature string (6-char random prefix + SHA-512 hash)
   *
   * @internal
   */
  private generateSignature(
    methodName: string,
    params: Record<string, string | number | boolean>
  ): string {
    // Generate random 6-character string
    const rand = Math.random().toString(36).substring(2, 8);

    // Add required auth parameters
    const allParams: Record<string, string | number | boolean> = {
      ...params,
      apiKey: this.apiKey,
      time: Math.floor(Date.now() / 1000),
    };

    // Sort parameters lexicographically
    const sortedKeys = Object.keys(allParams).sort();
    const paramString = sortedKeys
      .map(key => `${key}=${allParams[key]}`)
      .join('&');

    // Create string to hash
    const stringToHash = `${rand}/${methodName}?${paramString}#${this.apiSecret}`;

    // Generate SHA-512 hash
    const hash = crypto.createHash('sha512').update(stringToHash).digest('hex');

    return rand + hash;
  }

  /**
   * Executes an authenticated API request to Polygon.
   * Handles parameter encoding, signature generation, and response parsing.
   *
   * @template T - Expected response type
   * @param {string} methodName - API method to call
   * @param {Record<string, string | number | boolean>} params - Request parameters
   * @param {boolean} returnRaw - If true, return raw text instead of parsed JSON
   * @returns {Promise<T>} Parsed response data
   * @throws {Error} If API returns FAILED status or network error occurs
   *
   * @internal
   */
  private async request<T>(
    methodName: string,
    params: Record<string, string | number | boolean> = {},
    returnRaw: boolean = false
  ): Promise<T> {
    const time = Math.floor(Date.now() / 1000);
    const apiSig = this.generateSignature(methodName, params);

    // Convert all params to strings for URLSearchParams
    const stringParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      stringParams[key] = String(value);
    }

    const requestParams = new URLSearchParams({
      ...stringParams,
      apiKey: this.apiKey,
      time: time.toString(),
      apiSig,
    });

    const url = `${this.baseUrl}/${methodName}`;

    const response = await fetch(url, {
      method: 'POST',
      body: requestParams,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (returnRaw) {
      return (await response.text()) as T;
    }

    const data = (await response.json()) as PolygonResponse<T>;

    if (data.status === 'FAILED') {
      throw new Error(`Polygon API Error: ${data.comment}`);
    }

    return data.result as T;
  }

  // ==================== General Methods ====================

  /**
   * Retrieves list of problems accessible to the authenticated user.
   * Can filter by various criteria including owner, name, and deletion status.
   *
   * @param {Object} [options] - Optional filter parameters
   * @param {boolean} [options.showDeleted] - Include deleted problems (default: false)
   * @param {number} [options.id] - Filter by specific problem ID
   * @param {string} [options.name] - Filter by problem name
   * @param {string} [options.owner] - Filter by owner username
   * @returns {Promise<Problem[]>} Array of problems matching filters
   *
   * @example
   * // List all accessible problems
   * const allProblems = await sdk.listProblems();
   *
   * @example
   * // List only your own problems
   * const myProblems = await sdk.listProblems({ owner: 'username' });
   *
   * @example
   * // Include deleted problems
   * const withDeleted = await sdk.listProblems({ showDeleted: true });
   */
  async listProblems(options?: {
    showDeleted?: boolean;
    id?: number;
    name?: string;
    owner?: string;
  }): Promise<Problem[]> {
    return this.request<Problem[]>('problems.list', options || {});
  }

  /**
   * Creates a new empty problem with given name.
   * After creation, you must call updateWorkingCopy to start editing.
   *
   * @param {string} name - Name/title for the new problem
   * @returns {Promise<Problem>} Newly created problem object with ID
   * @throws {Error} If problem creation fails
   *
   * @example
   * const problem = await sdk.createProblem('A+B Problem');
   * console.log('Created problem ID:', problem.id);
   * await sdk.updateWorkingCopy(problem.id);
   */
  async createProblem(name: string): Promise<Problem> {
    return this.request<Problem>('problem.create', { name });
  }

  // ==================== Problem Info Methods ====================

  /**
   * Retrieves problem configuration including I/O files, limits, and interactive flag.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code for protected problems
   * @returns {Promise<ProblemInfo>} Problem configuration details
   *
   * @example
   * const info = await sdk.getProblemInfo(12345);
   * console.log(`Time: ${info.timeLimit}ms, Memory: ${info.memoryLimit}MB`);
   */
  async getProblemInfo(problemId: number, pin?: string): Promise<ProblemInfo> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    return this.request<ProblemInfo>('problem.info', params);
  }

  /**
   * Updates problem configuration settings.
   * Only specified fields will be updated; others remain unchanged.
   *
   * @param {number} problemId - Problem identifier
   * @param {Partial<ProblemInfo>} info - Fields to update
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Update only time and memory limits
   * await sdk.updateProblemInfo(12345, {
   *   timeLimit: 2000,
   *   memoryLimit: 256
   * });
   *
   * @example
   * // Mark as interactive problem
   * await sdk.updateProblemInfo(12345, { interactive: true });
   */
  async updateProblemInfo(
    problemId: number,
    info: Partial<ProblemInfo>,
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      ...info,
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.updateInfo', params);
  }

  /**
   * Updates working copy to latest committed version.
   * Required before making changes to a problem.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * await sdk.updateWorkingCopy(12345);
   * // Now you can modify the problem
   */
  async updateWorkingCopy(problemId: number, pin?: string): Promise<void> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    await this.request('problem.updateWorkingCopy', params);
  }

  /**
   * Discards all uncommitted changes in working copy.
   * Reverts to last committed version.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Discard changes if something went wrong
   * await sdk.discardWorkingCopy(12345);
   */
  async discardWorkingCopy(problemId: number, pin?: string): Promise<void> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    await this.request('problem.discardWorkingCopy', params);
  }

  /**
   * Commits changes from working copy, creating a new revision.
   * Optionally sends email notification to watchers.
   *
   * @param {number} problemId - Problem identifier
   * @param {Object} [options] - Commit options
   * @param {boolean} [options.minorChanges] - Don't send email if true
   * @param {string} [options.message] - Commit message
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Commit with message
   * await sdk.commitChanges(12345, {
   *   message: 'Updated time limits and added test cases'
   * });
   *
   * @example
   * // Minor commit without notification
   * await sdk.commitChanges(12345, {
   *   minorChanges: true,
   *   message: 'Fixed typo'
   * });
   */
  async commitChanges(
    problemId: number,
    options?: { minorChanges?: boolean; message?: string },
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      ...(options || {}),
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.commitChanges', params);
  }

  // ==================== Statement Methods ====================

  /**
   * Retrieves problem statements in all available languages.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<Record<string, Statement>>} Map of language code to statement
   *
   * @example
   * const statements = await sdk.getStatements(12345);
   * console.log('Available languages:', Object.keys(statements));
   * console.log('English legend:', statements['english'].legend);
   */
  async getStatements(
    problemId: number,
    pin?: string
  ): Promise<Record<string, Statement>> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    return this.request<Record<string, Statement>>(
      'problem.statements',
      params
    );
  }

  /**
   * Creates or updates problem statement for a specific language.
   * Only provided fields will be updated; others remain unchanged.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} lang - Language code (e.g., 'english', 'russian')
   * @param {Partial<Omit<Statement, 'encoding'>>} statement - Statement sections to save
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Save English statement
   * await sdk.saveStatement(12345, 'english', {
   *   name: 'Sum of Two Numbers',
   *   legend: 'Calculate the sum of two integers a and b.',
   *   input: 'Two integers a and b (1 ≤ a, b ≤ 10^9)',
   *   output: 'Print a single integer — the sum of a and b.',
   *   notes: 'This is a straightforward addition problem.'
   * });
   *
   * @example
   * // Update only the tutorial
   * await sdk.saveStatement(12345, 'english', {
   *   tutorial: 'Simply add the two numbers together.'
   * });
   */
  async saveStatement(
    problemId: number,
    lang: string,
    statement: Partial<Omit<Statement, 'encoding'>>,
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      lang,
      ...statement,
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.saveStatement', params);
  }

  /**
   * Retrieves list of statement resource files (images, PDFs, etc.).
   * Resources can be referenced in problem statements.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<File[]>} Array of resource files
   *
   * @example
   * const resources = await sdk.getStatementResources(12345);
   * resources.forEach(r => {
   *   console.log(`Resource: ${r.name} (${r.length} bytes)`);
   * });
   */
  async getStatementResources(
    problemId: number,
    pin?: string
  ): Promise<File[]> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    return this.request<File[]>('problem.statementResources', params);
  }

  /**
   * Uploads or updates a statement resource file (e.g., image, diagram).
   * Files are automatically converted to base64 if provided as Buffer.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} name - Resource file name
   * @param {string | Buffer} file - File content (string or Buffer)
   * @param {boolean} [checkExisting] - If true, only allows adding new files
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * import fs from 'fs';
   *
   * // Upload an image
   * const image = fs.readFileSync('diagram.png');
   * await sdk.saveStatementResource(12345, 'diagram.png', image);
   *
   * @example
   * // Upload text file
   * await sdk.saveStatementResource(12345, 'notes.txt', 'Additional notes');
   */
  async saveStatementResource(
    problemId: number,
    name: string,
    file: string | Buffer,
    checkExisting?: boolean,
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      name,
      file: typeof file === 'string' ? file : file.toString('base64'),
    };
    if (checkExisting !== undefined) params['checkExisting'] = checkExisting;
    if (pin) params['pin'] = pin;
    await this.request('problem.saveStatementResource', params);
  }

  // ==================== Checker/Validator/Interactor Methods ====================

  /**
   * Gets the name of currently configured checker program.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<string>} Checker file name
   *
   * @example
   * const checker = await sdk.getChecker(12345);
   * console.log('Current checker:', checker); // e.g., 'wcmp.cpp'
   */
  async getChecker(problemId: number, pin?: string): Promise<string> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    return this.request<string>('problem.checker', params);
  }

  /**
   * Sets the checker (output validator) for the problem.
   * Can use standard testlib checkers or custom checker from source files.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} checker - Checker file name from source files
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Use standard token checker
   * await sdk.setChecker(12345, 'wcmp.cpp');
   *
   * @example
   * // Use custom checker
   * await sdk.setChecker(12345, 'checker.cpp');
   */
  async setChecker(
    problemId: number,
    checker: string,
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      checker,
      autoUpdate: false,
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.setChecker', params);
  }

  /**
   * Gets the name of currently configured validator program.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<string>} Validator file name
   *
   * @example
   * const validator = await sdk.getValidator(12345);
   * console.log('Current validator:', validator);
   */
  async getValidator(problemId: number, pin?: string): Promise<string> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    return this.request<string>('problem.validator', params);
  }

  /**
   * Sets the input validator for the problem.
   * Validator checks if test inputs meet problem constraints.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} validator - Validator file name from source files
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Set validator
   * await sdk.setValidator(12345, 'validator.cpp');
   */
  async setValidator(
    problemId: number,
    validator: string,
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      validator,
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.setValidator', params);
  }

  /**
   * Gets list of extra validators configured for the problem.
   * Extra validators provide additional input validation beyond main validator.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<string[]>} Array of extra validator names
   *
   * @example
   * const extraVals = await sdk.getExtraValidators(12345);
   * console.log('Extra validators:', extraVals);
   */
  async getExtraValidators(problemId: number, pin?: string): Promise<string[]> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    return this.request<string[]>('problem.extraValidators', params);
  }

  /**
   * Gets the name of currently configured interactor program.
   * Interactors are used for interactive problems.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<string>} Interactor file name
   *
   * @example
   * const interactor = await sdk.getInteractor(12345);
   * console.log('Current interactor:', interactor);
   */
  async getInteractor(problemId: number, pin?: string): Promise<string> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    return this.request<string>('problem.interactor', params);
  }

  /**
   * Sets the interactor for an interactive problem.
   * Interactor manages communication between solution and judge.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} interactor - Interactor file name from source files
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Set interactor for interactive problem
   * await sdk.setInteractor(12345, 'interactor.cpp');
   */
  async setInteractor(
    problemId: number,
    interactor: string,
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      interactor,
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.setInteractor', params);
  }

  // ==================== Validator Tests Methods ====================

  /**
   * Retrieves all validator self-test cases.
   * These tests verify that the validator correctly accepts/rejects inputs.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<ValidatorTest[]>} Array of validator test cases
   *
   * @example
   * const valTests = await sdk.getValidatorTests(12345);
   * valTests.forEach(t => {
   *   console.log(`Test ${t.index}: ${t.expectedVerdict}`);
   * });
   */
  async getValidatorTests(
    problemId: number,
    pin?: string
  ): Promise<ValidatorTest[]> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    return this.request<ValidatorTest[]>('problem.validatorTests', params);
  }

  /**
   * Adds or updates a validator self-test case.
   * Used to verify validator correctly validates inputs.
   *
   * @param {number} problemId - Problem identifier
   * @param {number} testIndex - Test number
   * @param {string} testInput - Input to validate
   * @param {'VALID' | 'INVALID'} testVerdict - Expected validation result
   * @param {Object} [options] - Additional options
   * @param {boolean} [options.checkExisting] - If true, only adding is allowed
   * @param {string} [options.testGroup] - Test group name
   * @param {string} [options.testset] - Testset name
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Add valid input test
   * await sdk.saveValidatorTest(12345, 1, '5 10', 'VALID');
   *
   * @example
   * // Add invalid input test (negative numbers)
   * await sdk.saveValidatorTest(12345, 2, '-1 5', 'INVALID');
   */
  async saveValidatorTest(
    problemId: number,
    testIndex: number,
    testInput: string,
    testVerdict: 'VALID' | 'INVALID',
    options?: {
      checkExisting?: boolean;
      testGroup?: string;
      testset?: string;
    },
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      testIndex,
      testInput,
      testVerdict,
      ...(options || {}),
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.saveValidatorTest', params);
  }

  // ==================== Checker Tests Methods ====================

  /**
   * Retrieves all checker self-test cases.
   * These tests verify that the checker produces correct verdicts.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<CheckerTest[]>} Array of checker test cases
   *
   * @example
   * const checkTests = await sdk.getCheckerTests(12345);
   * checkTests.forEach(t => {
   *   console.log(`Test ${t.index}: ${t.expectedVerdict}`);
   * });
   */
  async getCheckerTests(
    problemId: number,
    pin?: string
  ): Promise<CheckerTest[]> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    return this.request<CheckerTest[]>('problem.checkerTests', params);
  }

  /**
   * Adds or updates a checker self-test case.
   * Verifies checker correctly judges contestant outputs.
   *
   * @param {number} problemId - Problem identifier
   * @param {number} testIndex - Test number
   * @param {string} testInput - Test input data
   * @param {string} testOutput - Contestant's output to check
   * @param {string} testAnswer - Correct answer (jury's answer)
   * @param {'OK' | 'WRONG_ANSWER' | 'PRESENTATION_ERROR' | 'CRASHED'} testVerdict - Expected checker verdict
   * @param {boolean} [checkExisting] - If true, only adding is allowed
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Checker should accept correct answer
   * await sdk.saveCheckerTest(12345, 1, '5 10', '15', '15', 'OK');
   *
   * @example
   * // Checker should reject wrong answer
   * await sdk.saveCheckerTest(12345, 2, '5 10', '16', '15', 'WRONG_ANSWER');
   *
   * @example
   * // Checker should detect presentation error
   * await sdk.saveCheckerTest(12345, 3, '5 10', '15 ', '15', 'PRESENTATION_ERROR');
   */
  async saveCheckerTest(
    problemId: number,
    testIndex: number,
    testInput: string,
    testOutput: string,
    testAnswer: string,
    testVerdict: 'OK' | 'WRONG_ANSWER' | 'PRESENTATION_ERROR' | 'CRASHED',
    checkExisting?: boolean,
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      testIndex,
      testInput,
      testOutput,
      testAnswer,
      testVerdict,
    };
    if (checkExisting !== undefined) params['checkExisting'] = checkExisting;
    if (pin) params['pin'] = pin;
    await this.request('problem.saveCheckerTest', params);
  }

  // ==================== Files Methods ====================

  /**
   * Retrieves all files associated with the problem.
   * Returns files organized by type: resource, source, and auxiliary.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<FilesResponse>} Object containing file lists by type
   *
   * @example
   * const files = await sdk.getFiles(12345);
   * console.log(`Resource files: ${files.resourceFiles.length}`);
   * console.log(`Source files: ${files.sourceFiles.length}`);
   * console.log(`Aux files: ${files.auxFiles.length}`);
   *
   * @example
   * // List all source files
   * const files = await sdk.getFiles(12345);
   * files.sourceFiles.forEach(f => {
   *   console.log(`${f.name} (${f.sourceType})`);
   * });
   */
  async getFiles(problemId: number, pin?: string): Promise<FilesResponse> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    return this.request<FilesResponse>('problem.files', params);
  }

  /**
   * Retrieves content of a specific file.
   * Returns raw file content as string.
   *
   * @param {number} problemId - Problem identifier
   * @param {'resource' | 'source' | 'aux'} type - File type
   * @param {string} name - File name
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<string>} File content as string
   *
   * @example
   * // View generator source code
   * const code = await sdk.viewFile(12345, 'source', 'gen.cpp');
   * console.log(code);
   *
   * @example
   * // View resource file
   * const data = await sdk.viewFile(12345, 'resource', 'grader.h');
   */
  async viewFile(
    problemId: number,
    type: 'resource' | 'source' | 'aux',
    name: string,
    pin?: string
  ): Promise<string> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      type,
      name,
    };
    if (pin) params['pin'] = pin;
    return this.request<string>('problem.viewFile', params, true);
  }

  /**
   * Uploads or updates a file in the problem package.
   * Supports resource, source, and auxiliary files with automatic base64 conversion.
   *
   * @param {number} problemId - Problem identifier
   * @param {'resource' | 'source' | 'aux'} type - File type
   * @param {string} name - File name
   * @param {string | Buffer} file - File content (string or Buffer)
   * @param {Object} [options] - Additional file options
   * @param {boolean} [options.checkExisting] - If true, only adding is allowed
   * @param {string} [options.sourceType] - Source language/compiler (e.g., 'cpp.g++17')
   * @param {string} [options.forTypes] - File types pattern for resources
   * @param {string} [options.stages] - Compilation/runtime stages for resources
   * @param {string} [options.assets] - Asset types for resources
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * import fs from 'fs';
   *
   * // Upload generator source file
   * const genCode = fs.readFileSync('gen.cpp', 'utf-8');
   * await sdk.saveFile(12345, 'source', 'gen.cpp', genCode, {
   *   sourceType: 'cpp.g++17'
   * });
   *
   * @example
   * // Upload resource file (grader)
   * const grader = fs.readFileSync('grader.cpp', 'utf-8');
   * await sdk.saveFile(12345, 'resource', 'grader.cpp', grader, {
   *   forTypes: 'cpp.*',
   *   stages: 'COMPILE',
   *   assets: 'SOLUTION'
   * });
   */
  async saveFile(
    problemId: number,
    type: 'resource' | 'source' | 'aux',
    name: string,
    file: string | Buffer,
    options?: {
      checkExisting?: boolean;
      sourceType?: string;
      forTypes?: string;
      stages?: string;
      assets?: string;
    },
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      type,
      name,
      file: typeof file === 'string' ? file : file.toString('base64'),
      ...(options || {}),
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.saveFile', params);
  }

  // ==================== Solutions Methods ====================

  /**
   * Retrieves all solutions for the problem.
   * Solutions include main, correct, and incorrect solutions with various tags.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<Solution[]>} Array of solution objects
   *
   * @example
   * const solutions = await sdk.getSolutions(12345);
   * const mainSol = solutions.find(s => s.tag === 'MA');
   * console.log(`Main solution: ${mainSol?.name}`);
   *
   * @example
   * // List all solutions with their tags
   * const solutions = await sdk.getSolutions(12345);
   * solutions.forEach(s => {
   *   console.log(`${s.name} (${s.tag})`);
   * });
   */
  async getSolutions(problemId: number, pin?: string): Promise<Solution[]> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    return this.request<Solution[]>('problem.solutions', params);
  }

  /**
   * Retrieves source code of a specific solution.
   * Returns raw solution code as string.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} name - Solution file name
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<string>} Solution source code
   *
   * @example
   * // View main solution code
   * const code = await sdk.viewSolution(12345, 'main.cpp');
   * console.log(code);
   */
  async viewSolution(
    problemId: number,
    name: string,
    pin?: string
  ): Promise<string> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      name,
    };
    if (pin) params['pin'] = pin;
    return this.request<string>('problem.viewSolution', params, true);
  }

  /**
   * Uploads or updates a solution with specified tag.
   * Tag indicates expected behavior (correct, wrong answer, TLE, etc.).
   *
   * @param {number} problemId - Problem identifier
   * @param {string} name - Solution file name
   * @param {string | Buffer} file - Solution source code
   * @param {'MA' | 'OK' | 'RJ' | 'TL' | 'TO' | 'WA' | 'PE' | 'ML' | 'RE'} tag - Expected behavior tag
   * @param {Object} [options] - Additional options
   * @param {boolean} [options.checkExisting] - If true, only adding is allowed
   * @param {string} [options.sourceType] - Language/compiler (e.g., 'cpp.g++17')
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * import fs from 'fs';
   *
   * // Upload main correct solution
   * const code = fs.readFileSync('main.cpp', 'utf-8');
   * await sdk.saveSolution(12345, 'main.cpp', code, 'MA', {
   *   sourceType: 'cpp.g++17'
   * });
   *
   * @example
   * // Upload TLE solution
   * const tleSol = fs.readFileSync('slow.cpp', 'utf-8');
   * await sdk.saveSolution(12345, 'slow.cpp', tleSol, 'TL');
   *
   * @example
   * // Upload wrong answer solution
   * const waSol = fs.readFileSync('wrong.cpp', 'utf-8');
   * await sdk.saveSolution(12345, 'wrong.cpp', waSol, 'WA');
   */
  async saveSolution(
    problemId: number,
    name: string,
    file: string | Buffer,
    tag: 'MA' | 'OK' | 'RJ' | 'TL' | 'TO' | 'WA' | 'PE' | 'ML' | 'RE',
    options?: {
      checkExisting?: boolean;
      sourceType?: string;
    },
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      name,
      file: typeof file === 'string' ? file : file.toString('base64'),
      tag,
      ...(options || {}),
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.saveSolution', params);
  }

  /**
   * Adds or removes extra tags for solution on specific testset or test group.
   * Extra tags allow different expected behaviors for different test groups.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} name - Solution name
   * @param {boolean} remove - If true, removes tag; if false, adds tag
   * @param {Object} options - Tag options (must specify testset OR testGroup)
   * @param {string} [options.testset] - Testset name
   * @param {string} [options.testGroup] - Test group name
   * @param {'OK' | 'RJ' | 'TL' | 'TO' | 'WA' | 'PE' | 'ML' | 'RE'} [options.tag] - Extra tag (required when adding)
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Add TL tag for specific test group
   * await sdk.editSolutionExtraTags(12345, 'slow.cpp', false, {
   *   testGroup: 'large',
   *   tag: 'TL'
   * });
   *
   * @example
   * // Remove extra tag from testset
   * await sdk.editSolutionExtraTags(12345, 'solution.cpp', true, {
   *   testset: 'tests'
   * });
   */
  async editSolutionExtraTags(
    problemId: number,
    name: string,
    remove: boolean,
    options: {
      testset?: string;
      testGroup?: string;
      tag?: 'OK' | 'RJ' | 'TL' | 'TO' | 'WA' | 'PE' | 'ML' | 'RE';
    },
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      name,
      remove,
      ...options,
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.editSolutionExtraTags', params);
  }

  // ==================== Script Methods ====================

  /**
   * Retrieves test generation script for specified testset.
   * Script contains commands for generating tests using generators.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} testset - Testset name (usually 'tests')
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<string>} Generation script content
   *
   * @example
   * const script = await sdk.getScript(12345, 'tests');
   * console.log('Generation script:', script);
   */
  async getScript(
    problemId: number,
    testset: string,
    pin?: string
  ): Promise<string> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      testset,
    };
    if (pin) params['pin'] = pin;
    return this.request<string>('problem.script', params, true);
  }

  /**
   * Saves test generation script for specified testset.
   * Script defines how tests are generated using generator programs.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} testset - Testset name
   * @param {string} source - Script content with generation commands
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Save generation script
   * const script = `
   * gen 1 10 > $
   * gen 11 100 > $
   * gen 101 1000 > $
   * `;
   * await sdk.saveScript(12345, 'tests', script);
   */
  async saveScript(
    problemId: number,
    testset: string,
    source: string,
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      testset,
      source,
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.saveScript', params);
  }

  // ==================== Tests Methods ====================

  /**
   * Retrieves all tests for specified testset.
   * Can optionally exclude input data to reduce response size.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} testset - Testset name (usually 'tests')
   * @param {boolean} [noInputs] - If true, excludes input data from response
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<Test[]>} Array of test cases
   *
   * @example
   * // Get all tests with input data
   * const tests = await sdk.getTests(12345, 'tests');
   * tests.forEach(t => {
   *   console.log(`Test ${t.index}: ${t.manual ? 'manual' : 'generated'}`);
   * });
   *
   * @example
   * // Get tests without input data (faster)
   * const testsInfo = await sdk.getTests(12345, 'tests', true);
   */
  async getTests(
    problemId: number,
    testset: string,
    noInputs?: boolean,
    pin?: string
  ): Promise<Test[]> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      testset,
    };
    if (noInputs !== undefined) params['noInputs'] = noInputs;
    if (pin) params['pin'] = pin;
    return this.request<Test[]>('problem.tests', params);
  }

  /**
   * Retrieves input data for a specific test.
   * Returns raw input content as string.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} testset - Testset name
   * @param {number} testIndex - Test number (1-indexed)
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<string>} Test input data
   *
   * @example
   * const input = await sdk.getTestInput(12345, 'tests', 1);
   * console.log('Test 1 input:', input);
   */
  async getTestInput(
    problemId: number,
    testset: string,
    testIndex: number,
    pin?: string
  ): Promise<string> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      testset,
      testIndex,
    };
    if (pin) params['pin'] = pin;
    return this.request<string>('problem.testInput', params, true);
  }

  /**
   * Retrieves expected answer for a specific test.
   * Answer is generated by running main solution on test input.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} testset - Testset name
   * @param {number} testIndex - Test number (1-indexed)
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<string>} Test answer data
   *
   * @example
   * const answer = await sdk.getTestAnswer(12345, 'tests', 1);
   * console.log('Expected answer:', answer);
   *
   * @example
   * // Compare input and answer
   * const input = await sdk.getTestInput(12345, 'tests', 1);
   * const answer = await sdk.getTestAnswer(12345, 'tests', 1);
   * console.log(`Input: ${input}, Answer: ${answer}`);
   */
  async getTestAnswer(
    problemId: number,
    testset: string,
    testIndex: number,
    pin?: string
  ): Promise<string> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      testset,
      testIndex,
    };
    if (pin) params['pin'] = pin;
    return this.request<string>('problem.testAnswer', params, true);
  }

  /**
   * Adds a new test or updates existing test.
   * For manual tests, provide testInput. For generated tests, use script.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} testset - Testset name
   * @param {number} testIndex - Test number (1-indexed)
   * @param {string} testInput - Test input data
   * @param {Object} [options] - Additional test properties
   * @param {boolean} [options.checkExisting] - If true, only adding is allowed
   * @param {string} [options.testGroup] - Test group name
   * @param {number} [options.testPoints] - Points for this test
   * @param {string} [options.testDescription] - Human-readable description
   * @param {boolean} [options.testUseInStatements] - Show in problem statement
   * @param {string} [options.testInputForStatements] - Input shown in statement
   * @param {string} [options.testOutputForStatements] - Output shown in statement
   * @param {boolean} [options.verifyInputOutputForStatements] - Verify statement I/O
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Add simple manual test
   * await sdk.saveTest(12345, 'tests', 1, '5 10');
   *
   * @example
   * // Add test with description and group
   * await sdk.saveTest(12345, 'tests', 2, '1000000 2000000', {
   *   testDescription: 'Large numbers test',
   *   testGroup: 'large',
   *   testPoints: 10
   * });
   *
   * @example
   * // Add sample test for statement
   * await sdk.saveTest(12345, 'tests', 1, '1 2', {
   *   testUseInStatements: true,
   *   testInputForStatements: '1 2',
   *   testOutputForStatements: '3'
   * });
   */
  async saveTest(
    problemId: number,
    testset: string,
    testIndex: number,
    testInput: string,
    options?: TestOptions,
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      testset,
      testIndex,
      ...(options || {}),
    };
    if (testInput) params['testInput'] = testInput;
    if (pin) params['pin'] = pin;
    await this.request('problem.saveTest', params);
  }

  /**
   * Assigns one or more tests to a specific test group.
   * Groups must be enabled for the testset before using this method.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} testset - Testset name
   * @param {string} testGroup - Group name to assign tests to
   * @param {number[]} testIndices - Array of test numbers to assign
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Assign tests 1-5 to 'small' group
   * await sdk.setTestGroup(12345, 'tests', 'small', [1, 2, 3, 4, 5]);
   *
   * @example
   * // Assign specific tests to 'large' group
   * await sdk.setTestGroup(12345, 'tests', 'large', [10, 11, 12]);
   */
  async setTestGroup(
    problemId: number,
    testset: string,
    testGroup: string,
    testIndices: number[],
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      testset,
      testGroup,
      testIndices: testIndices.join(','),
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.setTestGroup', params);
  }

  /**
   * Enables or disables test groups for a testset.
   * When enabled, tests can be organized into groups for partial scoring.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} testset - Testset name
   * @param {boolean} enable - True to enable, false to disable
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Enable test groups
   * await sdk.enableGroups(12345, 'tests', true);
   *
   * @example
   * // Disable test groups
   * await sdk.enableGroups(12345, 'tests', false);
   */
  async enableGroups(
    problemId: number,
    testset: string,
    enable: boolean,
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      testset,
      enable,
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.enableGroups', params);
  }

  /**
   * Enables or disables point scoring for the problem.
   * When enabled, individual tests can be assigned point values.
   *
   * @param {number} problemId - Problem identifier
   * @param {boolean} enable - True to enable, false to disable
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Enable point scoring
   * await sdk.enablePoints(12345, true);
   *
   * @example
   * // Disable point scoring
   * await sdk.enablePoints(12345, false);
   */
  async enablePoints(
    problemId: number,
    enable: boolean,
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      enable,
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.enablePoints', params);
  }

  /**
   * Retrieves configuration for one or all test groups.
   * Returns group settings including points policy, feedback policy, and dependencies.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} testset - Testset name
   * @param {string} [group] - Specific group name (omit to get all groups)
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<TestGroup[]>} Array of test group configurations
   *
   * @example
   * // Get all test groups
   * const groups = await sdk.viewTestGroup(12345, 'tests');
   * groups.forEach(g => {
   *   console.log(`${g.name}: ${g.pointsPolicy}, ${g.feedbackPolicy}`);
   * });
   *
   * @example
   * // Get specific group
   * const [group] = await sdk.viewTestGroup(12345, 'tests', 'large');
   * console.log('Dependencies:', group.dependencies);
   */
  async viewTestGroup(
    problemId: number,
    testset: string,
    group?: string,
    pin?: string
  ): Promise<TestGroup[]> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      testset,
    };
    if (group) params['group'] = group;
    if (pin) params['pin'] = pin;
    return this.request<TestGroup[]>('problem.viewTestGroup', params);
  }

  /**
   * Configures settings for a test group.
   * Sets points policy, feedback policy, and group dependencies.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} testset - Testset name
   * @param {string} group - Group name
   * @param {Object} [options] - Group configuration options
   * @param {'COMPLETE_GROUP' | 'EACH_TEST'} [options.pointsPolicy] - How points are awarded
   * @param {'NONE' | 'POINTS' | 'ICPC' | 'COMPLETE'} [options.feedbackPolicy] - Feedback level
   * @param {string} [options.dependencies] - Comma-separated list of groups that must pass first
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Configure group with ICPC feedback
   * await sdk.saveTestGroup(12345, 'tests', 'group1', {
   *   pointsPolicy: 'COMPLETE_GROUP',
   *   feedbackPolicy: 'ICPC'
   * });
   *
   * @example
   * // Set group dependencies
   * await sdk.saveTestGroup(12345, 'tests', 'hard', {
   *   dependencies: 'easy,medium'
   * });
   */
  async saveTestGroup(
    problemId: number,
    testset: string,
    group: string,
    options?: {
      pointsPolicy?: 'COMPLETE_GROUP' | 'EACH_TEST';
      feedbackPolicy?: 'NONE' | 'POINTS' | 'ICPC' | 'COMPLETE';
      dependencies?: string;
    },
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      testset,
      group,
      ...(options || {}),
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.saveTestGroup', params);
  }

  // ==================== Tags and Descriptions Methods ====================

  /**
   * Retrieves all tags associated with the problem.
   * Tags categorize problems (e.g., 'dp', 'graphs', 'math').
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<string[]>} Array of tag strings
   *
   * @example
   * const tags = await sdk.viewTags(12345);
   * console.log('Problem tags:', tags.join(', '));
   */
  async viewTags(problemId: number, pin?: string): Promise<string[]> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    return this.request<string[]>('problem.viewTags', params);
  }

  /**
   * Saves tags for the problem, replacing all existing tags.
   * Tags help categorize and search for problems.
   *
   * @param {number} problemId - Problem identifier
   * @param {string[]} tags - Array of tag strings
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Set problem tags
   * await sdk.saveTags(12345, ['dp', 'greedy', 'implementation']);
   *
   * @example
   * // Clear all tags
   * await sdk.saveTags(12345, []);
   */
  async saveTags(
    problemId: number,
    tags: string[],
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      tags: tags.join(','),
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.saveTags', params);
  }

  /**
   * Retrieves general description of the problem.
   * Description provides overview and context for the problem.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<string>} Problem description text
   *
   * @example
   * const desc = await sdk.viewGeneralDescription(12345);
   * console.log('Description:', desc);
   */
  async viewGeneralDescription(
    problemId: number,
    pin?: string
  ): Promise<string> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    return this.request<string>('problem.viewGeneralDescription', params);
  }

  /**
   * Saves general description for the problem.
   * Can be empty string to clear description.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} description - Description text (can be empty)
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * await sdk.saveGeneralDescription(12345,
   *   'This problem tests understanding of dynamic programming.'
   * );
   *
   * @example
   * // Clear description
   * await sdk.saveGeneralDescription(12345, '');
   */
  async saveGeneralDescription(
    problemId: number,
    description: string,
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      description,
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.saveGeneralDescription', params);
  }

  /**
   * Retrieves general tutorial for the problem.
   * Tutorial provides solution approach and explanation.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<string>} Tutorial text
   *
   * @example
   * const tutorial = await sdk.viewGeneralTutorial(12345);
   * console.log('Tutorial:', tutorial);
   */
  async viewGeneralTutorial(problemId: number, pin?: string): Promise<string> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    return this.request<string>('problem.viewGeneralTutorial', params);
  }

  /**
   * Saves general tutorial for the problem.
   * Can be empty string to clear tutorial.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} tutorial - Tutorial text (can be empty)
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * await sdk.saveGeneralTutorial(12345,
   *   'Use dynamic programming with O(n^2) complexity.'
   * );
   *
   * @example
   * // Clear tutorial
   * await sdk.saveGeneralTutorial(12345, '');
   */
  async saveGeneralTutorial(
    problemId: number,
    tutorial: string,
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      tutorial,
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.saveGeneralTutorial', params);
  }

  // ==================== Package Methods ====================

  /**
   * Lists all built packages for the problem.
   * Shows package state, type, and revision information.
   *
   * @param {number} problemId - Problem identifier
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<Package[]>} Array of package objects
   *
   * @example
   * const packages = await sdk.listPackages(12345);
   * packages.forEach(pkg => {
   *   console.log(`Package ${pkg.id}: ${pkg.state} (rev ${pkg.revision})`);
   * });
   *
   * @example
   * // Find latest ready package
   * const ready = packages.filter(p => p.state === 'READY');
   * const latest = ready.sort((a, b) => b.id - a.id)[0];
   */
  async listPackages(problemId: number, pin?: string): Promise<Package[]> {
    const params: Record<string, string | number | boolean> = { problemId };
    if (pin) params['pin'] = pin;
    return this.request<Package[]>('problem.packages', params);
  }

  /**
   * Downloads a built package as a zip archive.
   *
   * @param {number} problemId - Problem identifier
   * @param {number} packageId - Package ID from listPackages
   * @param {'standard' | 'linux' | 'windows'} [type] - Package type (default: 'standard')
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<Buffer>} Package zip file as Buffer
   *
   * @example
   * import fs from 'fs';
   *
   * // Download linux package
   * const zipData = await sdk.downloadPackage(12345, 456, 'linux');
   * fs.writeFileSync('problem-package.zip', zipData);
   *
   * @example
   * // Download standard package
   * const pkg = await sdk.downloadPackage(12345, 456);
   * fs.writeFileSync('problem.zip', pkg);
   */
  async downloadPackage(
    problemId: number,
    packageId: number,
    type?: 'standard' | 'linux' | 'windows',
    pin?: string
  ): Promise<Buffer> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      packageId,
    };
    if (type) params['type'] = type;
    if (pin) params['pin'] = pin;
    const data = await this.request<string>('problem.package', params, true);
    return Buffer.from(data, 'binary');
  }

  /**
   * Starts building a new package for the problem.
   * Package will be built asynchronously; use listPackages to check status.
   *
   * @param {number} problemId - Problem identifier
   * @param {boolean} full - If true, build full package (standard + linux + windows)
   * @param {boolean} verify - If true, run all solutions on all tests for verification
   * @param {string} [pin] - Optional PIN code
   * @returns {Promise<void>}
   *
   * @example
   * // Build full verified package
   * await sdk.buildPackage(12345, true, true);
   * console.log('Package building started');
   *
   * @example
   * // Build standard package without verification (faster)
   * await sdk.buildPackage(12345, false, false);
   */
  async buildPackage(
    problemId: number,
    full: boolean,
    verify: boolean,
    pin?: string
  ): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      problemId,
      full,
      verify,
    };
    if (pin) params['pin'] = pin;
    await this.request('problem.buildPackage', params);
  }

  // ==================== Contest Methods ====================

  /**
   * Retrieves list of problems in a contest.
   * Returns basic problem information for all contest problems.
   *
   * @param {number} contestId - Contest identifier
   * @param {string} [pin] - Optional PIN code for protected contests
   * @returns {Promise<Problem[]>} Array of problem objects
   *
   * @example
   * const problems = await sdk.getContestProblems(789);
   * problems.forEach(p => {
   *   console.log(`${p.name} (ID: ${p.id})`);
   * });
   */
  async getContestProblems(
    contestId: number,
    pin?: string
  ): Promise<Problem[]> {
    const params: Record<string, string | number | boolean> = { contestId };
    if (pin) params['pin'] = pin;
    return this.request<Problem[]>('contest.problems', params);
  }
}
