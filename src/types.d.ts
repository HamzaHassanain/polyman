/**
 * Supported programming languages for solutions.
 * @typedef {'cpp' | 'python' | 'java'} SolutionLang
 */
type SolutionLang = 'cpp' | 'python' | 'java';

/**
 * Solution types representing expected behavior.
 * - `main-correct`: The reference solution that is always correct
 * - `correct`: An alternative correct solution
 * - `incorrect`: A solution that should fail
 * - `tle`: Time Limit Exceeded
 * - `tle-or-correct`: May exceed time limit but produces correct output
 * - `tle-or-mle`: May exceed time or memory limit
 * - `mle`: Memory Limit Exceeded
 * - `wa`: Wrong Answer
 * - `failed`: Solution that fails to compile or run
 * - `pe`: Presentation Error
 * @typedef SolutionType
 */
type SolutionType =
  | 'main-correct'
  | 'correct'
  | 'incorrect'
  | 'tle'
  | 'tle-or-correct'
  | 'tle-or-mle'
  | 'mle'
  | 'wa'
  | 'failed'
  | 'pe';

/**
 * Represents a solution program for the problem.
 * @typedef {Object} Solution
 * @property {string} name - Unique identifier for the solution
 * @property {string} source - Path to the solution source file
 * @property {SolutionType} type - Expected behavior of this solution
 * @example
 * {
 *   name: "main",
 *   source: "solutions/main.cpp",
 *   type: "main-correct"
 * }
 */
type Solution = {
  name: string;
  source: string;
  type: SolutionType;
};

/**
 * Test generator configuration.
 * @typedef {Object} Generator
 * @property {string} name - Name of the generator
 * @property {string} [source] - Path to generator source file (optional for script-based)
 * @property {[number, number]} tests-range - Range of test numbers [start, end] inclusive
 * @example
 * {
 *   name: "gen-random",
 *   source: "generators/random.cpp",
 *   "tests-range": [1, 10]
 * }
 */
type Generator = {
  name: string;
  source?: string;
  'tests-range': [number, number];
};

/**
 * Checker (output validator) configuration.
 * @typedef {Object} Checker
 * @property {boolean} custom - Whether this is a custom checker or a standard testlib checker
 * @property {string} source - Path to checker source or name of standard checker (e.g., "wcmp.cpp")
 * @property {string} [tests] - Path to checker self-test file (optional)
 * @example
 * // Standard checker
 * { custom: false, source: "wcmp.cpp" }
 * @example
 * // Custom checker
 * { custom: true, source: "Checker.cpp", tests: "checker_tests.json" }
 */
type Checker = {
  custom: boolean;
  source: string;
  tests?: string;
};

/**
 * Checker output verdict.
 * - `OK`/`ok`: Answer is correct
 * - `WA`/`wa`: Wrong Answer
 * - `PE`/`pe`: Presentation Error
 * @typedef {'OK' | 'WA' | 'ok' | 'wa' | 'PE' | 'pe'} CheckerVerdict
 */
type CheckerVerdict = 'OK' | 'WA' | 'ok' | 'wa' | 'PE' | 'pe';

/**
 * Tracks different types of verdicts encountered during solution testing.
 * Used to verify solutions behave as expected.
 * @typedef {Object} VerdictTracker
 * @property {boolean} didWA - Wrong Answer encountered
 * @property {boolean} didPE - Presentation Error encountered
 * @property {boolean} didTLE - Time Limit Exceeded encountered
 * @property {boolean} didMLE - Memory Limit Exceeded encountered
 * @property {boolean} didRTE - Runtime Error encountered
 */
type VerdictTracker = {
  didWA: boolean;
  didPE: boolean;
  didTLE: boolean;
  didMLE: boolean;
  didRTE: boolean;
};

/**
 * A single test case for checker self-testing.
 * @typedef {Object} CheckerTest
 * @property {string} stdin - Input data
 * @property {string} stdout - Program output to validate
 * @property {string} answer - Expected correct answer (jury's answer)
 * @property {CheckerVerdict} verdict - Expected verdict from checker
 * @example
 * {
 *   stdin: "5",
 *   stdout: "25",
 *   answer: "25",
 *   verdict: "OK"
 * }
 */
type CheckerTest = {
  stdin: string;
  stdout: string;
  answer: string;
  verdict: CheckerVerdict;
};

/**
 * Input validator configuration.
 * @typedef {Object} Validator
 * @property {string} source - Path to validator source file
 * @property {string} [tests] - Path to validator self-test file (optional)
 * @example
 * {
 *   source: "Validator.cpp",
 *   tests: "validator_tests.json"
 * }
 */
type Validator = {
  source: string;
  tests?: string;
};

/**
 * Validator verdict indicating input validity.
 * @typedef {'VALID' | 'INVALID' | 'valid' | 'invalid' | 0 | 1} ValidatorVerdict
 */
type ValidatorVerdict = 'VALID' | 'INVALID' | 'valid' | 'invalid' | 0 | 1;

/**
 * A single test case for validator self-testing.
 * @typedef {Object} ValidatorTest
 * @property {string} stdin - Test input to validate
 * @property {ValidatorVerdict} expectedVerdict - Expected validation result
 * @example
 * {
 *   stdin: "1 2 3",
 *   expectedVerdict: "VALID"
 * }
 */
type ValidatorTest = {
  stdin: string;
  expectedVerdict: ValidatorVerdict;
};

/**
 * Main configuration file structure for a Codeforces Polygon problem.
 * This interface defines the complete problem specification including metadata,
 * constraints, test generation, validation, and solution checking.
 *
 * @interface ConfigFile
 * @property {string} name - Problem name/identifier
 * @property {string} [version] - Version number (optional)
 * @property {string} [description] - Brief problem description (optional)
 * @property {number} time-limit - Time limit in milliseconds
 * @property {number} memory-limit - Memory limit in megabytes
 * @property {string[]} [tags] - Problem tags/categories (optional)
 * @property {Object} statements - Problem statements in different languages
 * @property {Solution[]} solutions - Array of solution programs
 * @property {Generator[]} [generators] - Test generators (optional)
 * @property {Checker} checker - Output validator/checker
 * @property {Validator} validator - Input validator
 *
 * @example
 * {
 *   "name": "A+B Problem",
 *   "tag": "aplusb",
 *   "time-limit": 1000,
 *   "memory-limit": 256,
 *   "statements": {
 *     "english": {
 *       "title": "A+B Problem",
 *       "legend": true
 *     }
 *   },
 *   "solutions": [
 *     { "name": "main", "source": "Solution.cpp", "type": "main-correct" }
 *   ],
 *   "checker": { "custom": false, "source": "ncmp.cpp" },
 *   "validator": { "source": "Validator.cpp" }
 * }
 */
interface ConfigFile {
  name: string;

  version?: string;
  description?: string;

  'time-limit': number;
  'memory-limit': number;

  tags?: string[];

  statements: {
    [language: string]: {
      title: string;
      legend: boolean;
      'input-format'?: boolean;
      'output-format'?: boolean;
      notes?: boolean;
    };
  };

  solutions: Solution[];

  generators?: Generator[];

  checker: Checker;

  validator: Validator;
}

export {
  Solution,
  Generator,
  Checker,
  Validator,
  SolutionLang,
  SolutionType,
  ValidatorTest,
  CheckerTest,
  ValidatorVerdict,
  CheckerVerdict,
  VerdictTracker,
};
export default ConfigFile;
