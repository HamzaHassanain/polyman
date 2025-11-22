/**
 * @fileoverview Polygon-compatible type definitions for problem management.
 * All types match Codeforces Polygon API v1 structures exactly.
 */

// ==================== Access & Problem Metadata ====================

/**
 * User's access level to a problem.
 * @typedef {'READ' | 'WRITE' | 'OWNER'} AccessType
 */
type AccessType = 'READ' | 'WRITE' | 'OWNER';

/**
 * Represents a Polygon problem with metadata and access information.
 * @interface Problem
 * @property {number} id - Unique problem identifier
 * @property {string} owner - Username of problem owner
 * @property {string} name - Problem name/title
 * @property {boolean} deleted - Whether problem is deleted
 * @property {boolean} favourite - Whether problem is in user's favorites
 * @property {AccessType} accessType - User's access level
 * @property {number} revision - Current problem revision number
 * @property {number} [latestPackage] - Latest revision with available package
 * @property {boolean} modified - Whether problem has uncommitted changes
 */
interface Problem {
  id: number;
  owner: string;
  name: string;
  deleted: boolean;
  favourite: boolean;
  accessType: AccessType;
  revision: number;
  latestPackage?: number;
  modified: boolean;
}

/**
 * Problem configuration and constraints information.
 * @interface ProblemInfo
 * @property {string} inputFile - Input file name (e.g., 'stdin' or custom file)
 * @property {string} outputFile - Output file name (e.g., 'stdout' or custom file)
 * @property {boolean} interactive - Whether problem is interactive
 * @property {number} timeLimit - Time limit in milliseconds
 * @property {number} memoryLimit - Memory limit in megabytes
 */
interface ProblemInfo {
  inputFile: string;
  outputFile: string;
  interactive: boolean;
  timeLimit: number;
  memoryLimit: number;
}

// ==================== Statements ====================

/**
 * Problem statement in a specific language.
 * @interface Statement
 * @property {string} encoding - Text encoding (e.g., 'UTF-8')
 * @property {string} name - Problem title in this language
 * @property {string} legend - Problem description/story
 * @property {string} input - Input format specification
 * @property {string} output - Output format specification
 * @property {string} [scoring] - Scoring details (for partial scoring problems)
 * @property {string} [interaction] - Interaction protocol (for interactive problems)
 * @property {string} [notes] - Additional notes or examples
 * @property {string} [tutorial] - Editorial/solution explanation
 */
interface Statement {
  encoding: string;
  name: string;
  legend: string;
  input: string;
  output: string;
  scoring?: string;
  interaction?: string;
  notes?: string;
  tutorial?: string;
}

/**
 * Statement configuration in Config.json (with file paths)
 * @interface StatementConfig
 * @property {string} encoding - Text encoding (e.g., 'UTF-8')
 * @property {string} name - Problem title in this language
 * @property {string} [legend] - Path to legend.tex file
 * @property {string} [input] - Path to input-format.tex file
 * @property {string} [output] - Path to output-format.tex file
 * @property {string} [scoring] - Path to scoring.tex file
 * @property {string} [interaction] - Path to interaction.tex file
 * @property {string} [notes] - Path to notes.tex file
 * @property {string} [tutorial] - Path to tutorial.tex file
 */
interface StatementConfig {
  encoding: string;
  name: string;
  legend?: string;
  input?: string;
  output?: string;
  scoring?: string;
  interaction?: string;
  notes?: string;
  tutorial?: string;
}

// ==================== Files ====================

/**
 * C++ compiler types supported by Polygon.
 * @typedef CppSourceType
 */
type CppSourceType =
  | 'cpp.g++11'
  | 'cpp.g++14'
  | 'cpp.g++17'
  | 'cpp.g++20'
  | 'cpp.ms2017'
  | 'cpp.ms2019'
  | 'cpp.clang++17'
  | 'cpp.clang++20';

/**
 * Java compiler types supported by Polygon.
 * @typedef JavaSourceType
 */
type JavaSourceType = 'java.8' | 'java.11' | 'java.17' | 'java.21';

/**
 * Python interpreter types supported by Polygon.
 * @typedef PythonSourceType
 */
type PythonSourceType =
  | 'python.2'
  | 'python.3'
  | 'python.pypy2'
  | 'python.pypy3';

/**
 * All supported source types for solutions.
 * Solutions can be written in C++, Java, or Python.
 * @typedef SolutionSourceType
 */
type SolutionSourceType = CppSourceType | JavaSourceType | PythonSourceType;

/**
 * Source types for generators, validators, and checkers.
 * These must be C++ only as they use testlib.h.
 * @typedef TestlibSourceType
 */
type TestlibSourceType = CppSourceType;

/**
 * Advanced properties for resource files (e.g., IOI-style graders).
 * @interface ResourceAdvancedProperties
 * @property {string} forTypes - File types pattern (e.g., 'cpp.*', 'java.11')
 * @property {boolean} main - Reserved field, currently always false
 * @property {('COMPILE' | 'RUN')[]} stages - When resource is used
 * @property {('VALIDATOR' | 'INTERACTOR' | 'CHECKER' | 'SOLUTION')[]} assets - What can use this resource
 */
interface ResourceAdvancedProperties {
  forTypes: string;
  main: boolean;
  stages: ('COMPILE' | 'RUN')[];
  assets: ('VALIDATOR' | 'INTERACTOR' | 'CHECKER' | 'SOLUTION')[];
}

/**
 * Represents a file in the problem package.
 * @interface File
 * @property {string} name - File name with extension
 * @property {number} modificationTimeSeconds - Last modification time (Unix timestamp)
 * @property {number} length - File size in bytes
 * @property {string} [sourceType] - Source language/compiler (e.g., 'cpp.g++17')
 * @property {ResourceAdvancedProperties} [resourceAdvancedProperties] - Advanced resource settings
 */
interface File {
  name: string;
  modificationTimeSeconds: number;
  length: number;
  sourceType?: string;
  resourceAdvancedProperties?: ResourceAdvancedProperties;
}

/**
 * Response containing all problem files organized by type.
 * @interface FilesResponse
 * @property {File[]} resourceFiles - Resource files (e.g., images, graders)
 * @property {File[]} sourceFiles - Source code files (generators, validators, etc.)
 * @property {File[]} auxFiles - Auxiliary files
 */
interface FilesResponse {
  resourceFiles: File[];
  sourceFiles: File[];
  auxFiles: File[];
}

// ==================== Solutions ====================

/**
 * Solution tag representing expected behavior (Polygon format).
 * - `MA`: Main correct solution (reference solution)
 * - `OK`: Alternative correct solution
 * - `RJ`: Should be rejected
 * - `TL`: Time Limit Exceeded
 * - `TO`: Time Limit or Accepted (may TLE but correct)
 * - `WA`: Wrong Answer
 * - `PE`: Presentation Error
 * - `ML`: Memory Limit Exceeded
 * - `RE`: Runtime Error
 * @typedef SolutionTag
 */
type SolutionTag = 'MA' | 'OK' | 'RJ' | 'TL' | 'TO' | 'WA' | 'PE' | 'ML' | 'RE';

/**
 * Represents a problem solution with its expected behavior tag.
 * @interface Solution
 * @property {string} name - Solution file name
 * @property {number} modificationTimeSeconds - Last modification time (Unix timestamp)
 * @property {number} length - File size in bytes
 * @property {string} sourceType - Language/compiler (e.g., 'cpp.g++17')
 * @property {SolutionTag} tag - Expected behavior
 */
interface Solution {
  name: string;
  modificationTimeSeconds: number;
  length: number;
  sourceType: string;
  tag: SolutionTag;
}

// ==================== Tests ====================

/**
 * Represents a test case for the problem.
 * @interface Test
 * @property {number} index - Test number (1-indexed)
 * @property {boolean} manual - True if manually created, false if generated
 * @property {string} [input] - Test input data (absent for generated tests)
 * @property {string} [description] - Human-readable test description
 * @property {boolean} useInStatements - Whether test appears in problem statement
 * @property {string} [scriptLine] - Generator command (absent for manual tests)
 * @property {string} [group] - Test group name
 * @property {number} [points] - Points for this test (if points are enabled)
 * @property {string} [inputForStatement] - Input to show in statement
 * @property {string} [outputForStatement] - Output to show in statement
 * @property {boolean} [verifyInputOutputForStatements] - Verify statement I/O
 */
interface Test {
  index: number;
  manual: boolean;
  input?: string;
  description?: string;
  useInStatements: boolean;
  scriptLine?: string;
  group?: string;
  points?: number;
  inputForStatement?: string;
  outputForStatement?: string;
  verifyInputOutputForStatements?: boolean;
}

/**
 * Points policy for test groups.
 * @typedef PointsPolicy
 */
type PointsPolicy = 'COMPLETE_GROUP' | 'EACH_TEST';

/**
 * Feedback policy for test groups.
 * @typedef FeedbackPolicy
 */
type FeedbackPolicy = 'NONE' | 'POINTS' | 'ICPC' | 'COMPLETE';

/**
 * Configuration for a group of tests with scoring and feedback policies.
 * @interface TestGroup
 * @property {string} name - Test group identifier
 * @property {PointsPolicy} pointsPolicy - How points are awarded
 * @property {FeedbackPolicy} feedbackPolicy - Feedback level
 * @property {string[]} dependencies - Other groups that must pass first
 */
interface TestGroup {
  name: string;
  pointsPolicy: PointsPolicy;
  feedbackPolicy: FeedbackPolicy;
  dependencies: string[];
}

// ==================== Checker & Validator ====================

/**
 * Checker verdict.
 * @typedef CheckerVerdict
 */
type CheckerVerdict = 'OK' | 'WRONG_ANSWER' | 'PRESENTATION_ERROR' | 'CRASHED';

/**
 * Test case for checker self-testing.
 * @interface CheckerTest
 * @property {number} index - Test index
 * @property {string} input - Test input
 * @property {string} output - Contestant output to check
 * @property {string} answer - Correct answer
 * @property {CheckerVerdict} expectedVerdict - Expected checker verdict
 */
interface CheckerTest {
  index: number;
  input: string;
  output: string;
  answer: string;
  expectedVerdict: CheckerVerdict;
}

/**
 * Validator verdict.
 * @typedef ValidatorVerdict
 */
type ValidatorVerdict = 'VALID' | 'INVALID';

/**
 * Test case for validator self-testing.
 * @interface ValidatorTest
 * @property {number} index - Test index
 * @property {string} input - Input to validate
 * @property {ValidatorVerdict} expectedVerdict - Expected validation result
 * @property {string} [testset] - Testset name
 * @property {string} [group] - Test group name
 */
interface ValidatorTest {
  index: number;
  input: string;
  expectedVerdict: ValidatorVerdict;
  testset?: string;
  group?: string;
}

// ==================== Packages ====================

/**
 * Package build state.
 * @typedef PackageState
 */
type PackageState = 'PENDING' | 'RUNNING' | 'READY' | 'FAILED';

/**
 * Package type.
 * @typedef PackageType
 */
type PackageType = 'standard' | 'linux' | 'windows';

/**
 * Represents a downloadable problem package.
 * @interface Package
 * @property {number} id - Package identifier
 * @property {number} revision - Problem revision when package was built
 * @property {number} creationTimeSeconds - Package creation time (Unix timestamp)
 * @property {PackageState} state - Build status
 * @property {string} comment - Additional information about package
 * @property {PackageType} type - Package type
 */
interface Package {
  id: number;
  revision: number;
  creationTimeSeconds: number;
  state: PackageState;
  comment: string;
  type: PackageType;
}

// ==================== Configuration File ====================

/**
 * Local configuration file structure for managing Polygon problems.
 * This extends Polygon API types with local workspace information.
 *
 * @interface ConfigFile
 * @property {number} [problemId] - Polygon problem ID (if already created)
 * @property {string} name - Problem name/identifier
 * @property {string} [owner] - Problem owner username
 * @property {number} [revision] - Current revision number
 * @property {number} timeLimit - Time limit in milliseconds
 * @property {number} memoryLimit - Memory limit in megabytes
 * @property {string} inputFile - Input file name
 * @property {string} outputFile - Output file name
 * @property {boolean} interactive - Whether problem is interactive
 * @property {string[]} [tags] - Problem tags/categories
 * @property {string} [description] - General problem description
 * @property {string} [tutorial] - General tutorial text
 * @property {Object} statements - Problem statements by language
 * @property {LocalSolution[]} solutions - Solution configurations
 * @property {LocalGenerator[]} [generators] - Generator configurations
 * @property {LocalChecker} checker - Checker configuration
 * @property {LocalValidator} validator - Validator configuration
 * @property {LocalTestset[]} [testsets] - Testset configurations
 */
interface ConfigFile {
  // Polygon metadata
  problemId?: number; // Must be set by the script whenever possible
  name: string;
  owner?: string;
  revision?: number;

  // Problem info
  timeLimit: number;
  memoryLimit: number;
  inputFile: string;
  outputFile: string;
  interactive: boolean;

  // Tags and descriptions
  tags?: string[];
  description?: string;
  tutorial?: string;

  // Statements
  statements: {
    [language: string]: StatementConfig;
  };

  // Solutions
  solutions: LocalSolution[];

  // Generators
  generators?: LocalGenerator[];

  // Checker
  checker: LocalChecker;

  // Validator
  validator: LocalValidator;

  // Testsets
  testsets?: LocalTestset[];
}

// ==================== Local Helper Types ====================

/**
 * Local solution configuration (references local files).
 * @interface LocalSolution
 * @property {string} name - Solution name/identifier
 * @property {string} source - Path to solution source file
 * @property {SolutionTag} tag - Expected behavior tag
 * @property {SolutionSourceType} [sourceType] - Language/compiler (C++, Java, or Python)
 */
interface LocalSolution {
  name: string;
  source: string;
  tag: SolutionTag;
  sourceType?: SolutionSourceType;
}

/**
 * Local generator configuration.
 * Generators are treated as source files that can be invoked by test generation scripts.
 *
 * @interface LocalGenerator
 * @property {string} name - Generator name/identifier
 * @property {string} source - Path to generator source file (must be C++)
 * @property {TestlibSourceType} [sourceType] - C++ compiler version (generators must use testlib.h)
 *
 * @example
 * {
 *   name: 'gen-random',
 *   source: './generators/random.cpp',
 *   sourceType: 'cpp.g++17'
 * }
 */
interface LocalGenerator {
  name: string;
  source: string;
  sourceType?: TestlibSourceType;
}

/**
 * Local checker configuration.
 * @interface LocalChecker
 * @property {string} name - Checker name
 * @property {string} source - Path to checker source or standard checker name (must be C++)
 * @property {boolean} [isStandard] - True if using standard testlib checker
 * @property {string} [testsFilePath] - Path to checker tests JSON file
 * @property {TestlibSourceType} [sourceType] - C++ compiler version (checkers must use testlib.h)
 */
interface LocalChecker {
  name: string;
  source: string;
  isStandard?: boolean;
  testsFilePath?: string;
  sourceType?: TestlibSourceType;
}

/**
 * Local validator configuration.
 * @interface LocalValidator
 * @property {string} name - Validator name
 * @property {string} source - Path to validator source file (must be C++)
 * @property {TestlibSourceType} [sourceType] - C++ compiler version (validators must use testlib.h)
 * @property {string} [testsFilePath] - Path to validator tests JSON file
 */
interface LocalValidator {
  name: string;
  source: string;
  sourceType?: TestlibSourceType;
  testsFilePath?: string;
}

/**
 * Test generation script command.
 * Represents a single command in a test generation script.
 *
 * @interface GeneratorScriptCommand
 * @property {'generator-single' | 'manual' | "generator-range"} type - Command type
 * @property {string} [generator] - Generator name (for type='generator')
 * @property {string[]} [args] - Arguments to pass to generator
 * @property {number} [number] - Test number (for type='generator-single' or 'manual')
 * @property {string} [manualFile] - Path to manual test file (for type='manual')
 * @property {string} [group] - Test group assignment
 * @property {number} [points] - Points for this test
 *
 * @example
 * // Generator command
 * {
 *   type: 'generator',
 *   generator: 'gen-random',
 *   args: ['10', '100']
 * }
 *
 * @example
 * // Manual test
 * {
 *   type: 'manual',
 *   manualFile: './tests/manual/sample1.txt',
 *   group: 'samples'
 * }
 */
interface GeneratorScriptCommand {
  type: 'generator-single' | 'manual' | 'generator-range';
  useInStatements?: boolean;
  generator?: string;
  number?: number;
  manualFile?: string;
  group?: string;
  points?: number;
  range?: [number, number];
}

/**
 * Test generation script configuration.
 * Defines how tests are generated using generators and manual test files.
 *
 * @interface GeneratorScript
 * @property {GeneratorScriptCommand[]} [commands] - Array of generation commands
 * @property {string} [script] - Inline script definition (Polygon format)
 * @property {string} [scriptFile] - Path to external script file
 * @example
 * // Using structured commands
 * {
 *   commands: [
 *     { type: 'manual', manualFile: './tests/sample1.txt', group: 'samples' },
 *     { type: 'manual', manualFile: './tests/sample2.txt', group: 'samples' },
 *     { type: 'generator', generator: 'gen-random', args: ['1'] },
 *     { type: 'generator', generator: 'gen-random', args: ['2'] },
 *     { type: 'generator', generator: 'gen-large', args: ['1000', '10000'] }
 *   ]
 * }
 *
 * @example
 * // Using Polygon-format script
 * {
 *   script: 'gen 1 > $\ngen 2 > $\ngen 10 20 > $'
 * }
 *
 * @example
 * // Using external script file
 * {
 *   scriptFile: './tests/generation-script.txt'
 * }
 */
interface GeneratorScript {
  commands?: GeneratorScriptCommand[];
  script?: string;
  scriptFile?: string;
}

/**
 * Local testset configuration.
 * Polygon-compatible testset with script-based test generation.
 *
 * @interface LocalTestset
 * @property {string} name - Testset name (usually 'tests')
 * @property {GeneratorScript} [generatorScript] - Test generation script configuration
 * @property {boolean} [groupsEnabled] - Whether test groups are enabled
 * @property {boolean} [pointsEnabled] - Whether point scoring is enabled
 * @property {LocalTestGroup[]} [groups] - Test group configurations
 *
 * @example
 * // Complete testset with generation script
 * {
 *   name: 'tests',
 *   generatorScript: {
 *     commands: [
 *       { type: 'manual', manualFile: './tests/sample.txt', group: 'samples' },
 *       { type: 'generator', generator: 'gen-random', args: ['10'] }
 *     ]
 *   },
 *   groupsEnabled: true,
 *   groups: [
 *     { name: 'samples', pointsPolicy: 'EACH_TEST', feedbackPolicy: 'COMPLETE' }
 *   ]
 * }
 *
 * @example
 * // Using Polygon-format script
 * {
 *   name: 'tests',
 *   generatorScript: {
 *     script: 'gen 1 > $\ngen 2 > $\ngen-large 100 1000 > $'
 *   }
 * }
 */
interface LocalTestset {
  name: string;
  generatorScript?: GeneratorScript;
  groupsEnabled?: boolean;
  pointsEnabled?: boolean;
  groups?: LocalTestGroup[];
}

/**
 * Options for adding or updating a test via the Polygon API.
 * @interface TestOptions
 * @property {boolean} [checkExisting] - Whether to check if test already exists
 * @property {string} [testGroup] - Name of the test group
 * @property {number} [testPoints] - Points assigned to the test
 * @property {string} [testDescription] - Description of the test
 * @property {boolean} [testUseInStatements] - Whether to use test in statements
 * @property {string} [testInputForStatements] - Input to show in statements
 * @property {string} [testOutputForStatements] - Output to show in statements
 * @property {boolean} [verifyInputOutputForStatements] - Verify I/O for statements
 * @example
 * const options: TestOptions = {
 *   checkExisting: true,
 *   testGroup: 'samples',
 *   testPoints: 10,
 *   testDescription: 'Sample test case 1',
 *   testUseInStatements: true,
 *   testInputForStatements: '1 2 3',
 *   testOutputForStatements: '6',
 *   verifyInputOutputForStatements: true
 * };
 */

interface TestOptions {
  checkExisting?: boolean;
  testGroup?: string;
  testPoints?: number;
  testDescription?: string;
  testUseInStatements?: boolean;
  testInputForStatements?: string;
  testOutputForStatements?: string;
  verifyInputOutputForStatements?: boolean;
}

/**
 * Local test group configuration.
 * @interface LocalTestGroup
 * @property {string} name - Group name
 * @property {PointsPolicy} pointsPolicy - Points policy
 * @property {FeedbackPolicy} feedbackPolicy - Feedback policy
 * @property {string[]} [dependencies] - Dependent group names
 */
interface LocalTestGroup {
  name: string;
  pointsPolicy?: PointsPolicy;
  feedbackPolicy?: FeedbackPolicy;
  dependencies?: string[];
}

// ==================== Verdict Tracking ====================

/**
 * Tracks different types of verdicts encountered during solution testing.
 * @interface VerdictTracker
 * @property {boolean} didWA - Wrong Answer encountered
 * @property {boolean} didPE - Presentation Error encountered
 * @property {boolean} didTLE - Time Limit Exceeded encountered
 * @property {boolean} didMLE - Memory Limit Exceeded encountered
 * @property {boolean} didRTE - Runtime Error encountered
 */
interface VerdictTracker {
  didWA: boolean;
  didPE: boolean;
  didTLE: boolean;
  didMLE: boolean;
  didRTE: boolean;
}

// ==================== Exports ====================

export {
  // Access & Problems
  AccessType,
  Problem,
  ProblemInfo,
  // Statements
  Statement,
  StatementConfig,
  // Files
  ResourceAdvancedProperties,
  File,
  FilesResponse,
  // Source Types
  CppSourceType,
  JavaSourceType,
  PythonSourceType,
  SolutionSourceType,
  TestlibSourceType,
  // Solutions
  SolutionTag,
  Solution,
  // Tests
  Test,
  TestOptions,
  TestGroup,
  PointsPolicy,
  FeedbackPolicy,
  // Checker & Validator
  CheckerVerdict,
  CheckerTest,
  ValidatorVerdict,
  ValidatorTest,
  // Packages
  PackageState,
  PackageType,
  Package,
  // Local types
  LocalSolution,
  LocalGenerator,
  LocalChecker,
  LocalValidator,
  LocalTestset,
  LocalTestGroup,
  GeneratorScript,
  GeneratorScriptCommand,
  // Utilities
  VerdictTracker,
};

export default ConfigFile;
