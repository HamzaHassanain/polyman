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
  | 'cpp.msys2-mingw64-9-g++17'
  | 'cpp.gcc13-64-winlibs-g++20'
  | 'cpp.gcc14-64-msys2-g++23'
  | 'cpp.ms2017'
  | 'cpp.ms2019'
  | 'cpp.clang++17'
  | 'cpp.clang++20';

/**
 * Java compiler types supported by Polygon.
 * @typedef JavaSourceType
 */
type JavaSourceType = 'java8' | 'java21';

/**
 * Python interpreter types supported by Polygon.
 * @typedef PythonSourceType
 */
type PythonSourceType =
  'python.2' | 'python.3' | 'python.pypy2' | 'python.pypy3';

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
 * @property {string} forTypes - File types pattern (e.g., 'cpp.*', 'java21')
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
 * Optional per-language scaling of the declared `timeLimit`, applied to local
 * runs only (`run`, `verify`, `test`). Polygon does not scale time limits, so
 * the value pushed to Polygon stays the plain `timeLimit`.
 *
 * A correct Java or Python solution can TLE locally against a C++ limit (JVM
 * startup, interpreter overhead); this gives it a bigger local budget without
 * touching the problem itself. A language that is not listed keeps a factor
 * of 1, so omitting the field entirely changes nothing.
 *
 * @interface TimeLimitMultipliers
 * @property {number} [cpp] - Factor for C++ solutions (default 1)
 * @property {number} [java] - Factor for Java solutions (default 1)
 * @property {number} [python] - Factor for Python solutions (default 1)
 *
 * @example
 * // With "timeLimit": 1000, a Java solution runs with 2000ms locally.
 * { "java": 2, "python": 3 }
 */
interface TimeLimitMultipliers {
  cpp?: number;
  java?: number;
  python?: number;
}

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
 * @property {TimeLimitMultipliers} [timeLimitMultipliers] - Local-only per-language scaling of timeLimit
 * @property {number} memoryLimit - Memory limit in megabytes
 * @property {string} inputFile - Input file name
 * @property {string} outputFile - Output file name
 * @property {boolean} interactive - Whether problem is interactive
 * @property {string} [cppStandard] - C++ standard for local compilation, passed as `-std=` (default: the standard in a C++ solution's `sourceType`, else `c++23`)
 * @property {string[]} [tags] - Problem tags/categories
 * @property {string} [description] - General problem description
 * @property {string} [tutorial] - General tutorial text
 * @property {Object} statements - Problem statements by language
 * @property {LocalSolution[]} solutions - Solution configurations
 * @property {LocalGenerator[]} [generators] - Generator configurations
 * @property {LocalChecker} checker - Checker configuration
 * @property {LocalValidator} validator - Validator configuration
 * @property {LocalTestset[]} [testsets] - Testset configurations
 * @property {CompilerConfig} [compiler] - Local compiler overrides
 */
interface ConfigFile {
  // Polygon metadata
  problemId?: number; // Must be set by the script whenever possible
  name: string;
  owner?: string;
  revision?: number;

  // Problem info
  timeLimit: number;
  // Local-only scaling of timeLimit per solution language; Polygon gets timeLimit as is.
  timeLimitMultipliers?: TimeLimitMultipliers;
  memoryLimit: number;
  inputFile: string;
  outputFile: string;
  interactive: boolean;

  // Local compilation: value for g++ `-std=` (e.g. 'c++17', 'c++20', 'c++23')
  cppStandard?: string;

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

  // Local compiler overrides (not synced to Polygon)
  compiler?: CompilerConfig;
}

/**
 * Local compiler overrides. Only affects how polyman compiles sources on
 * this machine; Polygon uses `sourceType` instead.
 *
 * Environment variables `POLYMAN_CXX` and `POLYMAN_JAVAC` take precedence
 * over these fields.
 *
 * @interface CompilerConfig
 * @property {string} [cpp] - C++ compiler executable (default: `g++`)
 * @property {string} [javac] - Java compiler executable (default: `javac`)
 * @property {string[]} [flags] - Extra flags for every C++ compile, one per
 *   item, added after `-O2 -std=<cppStandard>`. A `-std=` flag here replaces
 *   `cppStandard` and an `-O` flag replaces `-O2`.
 *
 * @example
 * {
 *   cpp: 'g++-15',
 *   flags: ['-Wall', '-std=gnu++20']
 * }
 */
interface CompilerConfig {
  cpp?: string;
  javac?: string;
  flags?: string[];
}

// ==================== Local Helper Types ====================

/**
 * Local solution configuration (references local files).
 * @interface LocalSolution
 * @property {string} name - Solution name/identifier
 * @property {string} source - Path to solution source file
 * @property {SolutionTag} tag - Expected behavior tag
 * @property {SolutionSourceType} [sourceType] - Language/compiler (C++, Java, or Python).
 *   For C++, the standard in it (`cpp.g++17` gives `c++17`) is also used
 *   locally when `Config.json` sets no `cppStandard`
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
 * Polygon-format test generation script.
 *
 * The script is plain text using the same syntax as Codeforces Polygon:
 *
 * ```
 * gen-name [args...] > N         # write to test N
 * gen-name [args...] > $         # write to smallest unused index
 * gen-name [args...] > {1-3,7}   # generator writes its own files at the listed indices
 * <#-- @group name -->           # all subsequent generator lines belong to this group
 * <#-- comment -->               # ignored
 * <#list 1..5 as i> gen ${i} > $ </#list>   # FreeMarker loop expansion
 * ```
 *
 * Manual tests are NOT in this script — they live in {@link LocalTestset.manualTests}.
 *
 * @interface GeneratorScript
 * @property {string} [script] - Inline Polygon-format script text
 * @property {string} [scriptFile] - Path to a file containing the script
 */
interface GeneratorScript {
  script?: string;
  scriptFile?: string;
}

/**
 * A manual (hand-authored) test in a testset.
 *
 * Manual tests pair an input file (and optionally a reference output) with an
 * explicit Polygon test index. The convention is to name files
 * `m-<NN>[-label].in` and `m-<NN>[-label].out` under `./manual/<testset>/`,
 * but {@link LocalManualTest.input} can point anywhere.
 *
 * @interface LocalManualTest
 * @property {string} input - Path to the test input file
 * @property {string} [output] - Optional path to the reference output
 * @property {number} index - 1-based Polygon test index this manual occupies
 * @property {string} [group] - Test group name
 * @property {number} [points] - Points for this test
 * @property {boolean} [useInStatements] - Whether to embed in problem statement
 */
interface LocalManualTest {
  input: string;
  output?: string;
  index: number;
  group?: string;
  points?: number;
  useInStatements?: boolean;
}

/**
 * Internal: a single parsed line of a Polygon-format generator script.
 * Produced by the parser; not part of `Config.json`.
 *
 * @interface ParsedScriptLine
 * @property {string} generator - Generator name (no extension)
 * @property {string[]} args - Raw arguments after FreeMarker expansion
 * @property {ScriptOutput} output - Output target(s) — single index or multi
 * @property {string} [group] - Active group from the most recent `@group` header
 * @property {string} raw - Original source line for diagnostics
 * @property {number} lineNumber - 1-based line number in the source script
 */
interface ParsedScriptLine {
  generator: string;
  args: string[];
  output: ScriptOutput;
  group?: string;
  raw: string;
  lineNumber: number;
}

/**
 * Internal: output target of a script line.
 *
 * - `single` — one test index. `index === null` means `$` (assign at resolve time).
 * - `multi` — generator writes the listed indices itself (no stdout redirect).
 */
type ScriptOutput =
  | { kind: 'single'; index: number | null }
  | { kind: 'multi'; indices: number[] };

/**
 * Internal: a fully resolved test (manual or generator-driven) with a
 * concrete Polygon index assigned. Produced after merging the parsed script
 * with the testset's manual tests.
 *
 * @interface ResolvedTest
 */
interface ResolvedTest {
  index: number;
  source: ResolvedTestSource;
  group?: string;
  points?: number;
  useInStatements?: boolean;
}

type ResolvedTestSource =
  | { kind: 'manual'; inputFile: string; outputFile?: string }
  | {
      kind: 'generator';
      generator: string;
      args: string[];
      multiOutputs: number[] | null;
    };

/**
 * Local testset configuration.
 *
 * The generator script is plain Polygon-format text (inline or in a file);
 * manual tests are listed separately so they can carry an explicit index and
 * per-test metadata (group, points, useInStatements).
 *
 * @interface LocalTestset
 * @property {string} name - Testset name (usually 'tests')
 * @property {GeneratorScript} [generatorScript] - Polygon-format script
 * @property {LocalManualTest[]} [manualTests] - Hand-authored test files
 * @property {boolean} [groupsEnabled] - Whether test groups are enabled
 * @property {boolean} [pointsEnabled] - Whether point scoring is enabled
 * @property {LocalTestGroup[]} [groups] - Test group configurations
 *
 * @example
 * {
 *   name: 'tests',
 *   generatorScript: {
 *     script: [
 *       '<#-- @group samples -->',
 *       '<#-- (samples are usually manual; generators only here for illustration) -->',
 *       '<#-- @group main -->',
 *       'gen-small 10 100 > $',
 *       'gen-big  1000000 > $',
 *     ].join('\n')
 *   },
 *   manualTests: [
 *     { input: './manual/tests/m-01-sample.in', index: 1,
 *       group: 'samples', useInStatements: true }
 *   ],
 *   groupsEnabled: true,
 *   groups: [{ name: 'samples' }, { name: 'main' }]
 * }
 */
interface LocalTestset {
  name: string;
  generatorScript?: GeneratorScript;
  manualTests?: LocalManualTest[];
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

// ==================== JSON Reports ====================

/**
 * Per-test verdict recorded while a solution runs (and, during comparison,
 * after the checker has judged its output).
 * @typedef TestVerdict
 */
type TestVerdict = 'OK' | 'WA' | 'PE' | 'TLE' | 'MLE' | 'RTE';

/**
 * One executed test inside a JSON report.
 * @interface TestResult
 * @property {string} testset - Testset the input came from
 * @property {string} [group] - Group name, only when the run targeted a group
 * @property {number} index - Polygon test index (the N in test<N>.txt)
 * @property {TestVerdict} verdict - Verdict for this test
 * @property {number} timeMs - Wall-clock time polyman observed for the process
 * @property {string} message - Failure detail (empty for OK)
 * @property {string} [solution] - Present only when a run covered several solutions
 */
interface TestResult {
  testset: string;
  group?: string;
  index: number;
  verdict: TestVerdict;
  timeMs: number;
  message: string;
  solution?: string;
}

/**
 * One pipeline step inside a verify report.
 * @interface StepResult
 */
interface StepResult {
  name: string;
  ok: boolean;
  errors: string[];
}

/**
 * One solution's outcome inside a verify report.
 * @interface SolutionResult
 * @property {boolean} matchesTag - Whether the observed verdicts satisfy the tag
 * @property {string} reason - Human explanation of matchesTag
 */
interface SolutionResult {
  name: string;
  tag: SolutionTag;
  matchesTag: boolean;
  reason: string;
  tests: TestResult[];
}

/**
 * Fields shared by every JSON report.
 * @interface ReportBase
 */
interface ReportBase {
  schemaVersion: 1;
  polymanVersion: string;
  ok: boolean;
}

/**
 * Report emitted by `polyman run <solution> --json`.
 * @interface RunReport
 */
interface RunReport extends ReportBase {
  command: 'run';
  solution: string;
  tag: SolutionTag | null;
  tests: TestResult[];
  summary: {
    total: number;
    byVerdict: Partial<Record<TestVerdict, number>>;
  };
  errors: string[];
}

/**
 * Report emitted by `polyman verify --json`.
 * @interface VerifyReport
 * @property {string[]} warnings - Non-fatal findings, empty when there are none
 */
interface VerifyReport extends ReportBase {
  command: 'verify';
  failedStep: string | null;
  steps: StepResult[];
  warnings: string[];
  solutions: SolutionResult[];
}

/**
 * Report emitted by `polyman new <dir> --json` and
 * `polyman download-testlib --json`.
 * @interface PathReport
 * @property {string} path - Absolute path of the created directory or file
 */
interface PathReport extends ReportBase {
  command: string;
  exitCode: number;
  durationMs: number;
  errors: string[];
  path: string;
}

/**
 * Report emitted by `polyman list <what> --json`.
 * @interface ListReport
 * @property {unknown[]} items - The listed entries as data
 */
interface ListReport extends ReportBase {
  command: string;
  exitCode: number;
  durationMs: number;
  errors: string[];
  items: unknown[];
}

/**
 * One test inside a generate report.
 * @interface GeneratedTestResult
 * @property {string} testset - Testset the test belongs to
 * @property {number} index - Polygon test index (the N in test<N>.txt)
 * @property {'manual' | 'generator'} source - Where the input came from
 * @property {string} [generator] - Generator name, only for generated tests
 * @property {string[]} [args] - Generator arguments, only for generated tests
 * @property {boolean} ok - Whether the input file was written
 * @property {string} [error] - Failure detail, only when ok is false
 */
interface GeneratedTestResult {
  testset: string;
  index: number;
  source: 'manual' | 'generator';
  generator?: string;
  args?: string[];
  ok: boolean;
  error?: string;
}

/**
 * Report emitted by `polyman generate --json`.
 * @interface GenerateReport
 */
interface GenerateReport extends ReportBase {
  command: 'generate';
  exitCode: number;
  durationMs: number;
  errors: string[];
  tests: GeneratedTestResult[];
}

/**
 * One test inside a validate report.
 * @interface ValidatedTestResult
 * @property {string} testset - Testset the test belongs to
 * @property {string} [group] - Group name, only when the run targeted a group
 * @property {number} index - Polygon test index (the N in test<N>.txt)
 * @property {boolean} valid - Whether the validator accepted the input
 * @property {string} message - Validator message (empty when valid)
 */
interface ValidatedTestResult {
  testset: string;
  group?: string;
  index: number;
  valid: boolean;
  message: string;
}

/**
 * Report emitted by `polyman validate --json`.
 * @interface ValidateReport
 */
interface ValidateReport extends ReportBase {
  command: 'validate';
  exitCode: number;
  durationMs: number;
  errors: string[];
  tests: ValidatedTestResult[];
}

/**
 * Which program a self-test report is about.
 * @typedef SelfTestTarget
 */
type SelfTestTarget = 'validator' | 'checker';

/**
 * One validator or checker self-test inside a {@link SelfTestReport}.
 * @interface SelfTestCase
 * @property {number} index - 1-based position of the case in the tests file
 * @property {string} expected - Verdict the tests file asks for (the checker
 *   short forms `WA` / `PE` are written as `WRONG_ANSWER` /
 *   `PRESENTATION_ERROR`)
 * @property {string | null} actual - Verdict the program gave, or `ERROR` when
 *   it could not run at all. `null` for a checker that exited with a code that
 *   is not OK, WA, PE or a crash (4, 5, 7, 8, 16 to 127): see `exitCode`
 * @property {number} [exitCode] - Exit code of the checker. Only set when
 *   `actual` is `null`
 * @property {boolean} ok - Whether polyman accepted the case
 * @property {string} message - What the program printed to stderr, or why the
 *   case failed
 */
interface SelfTestCase {
  index: number;
  expected: string;
  actual: string | null;
  exitCode?: number;
  ok: boolean;
  message: string;
}

/**
 * Report emitted by `polyman test validator --json` and
 * `polyman test checker --json`.
 * @interface SelfTestReport
 * @property {SelfTestCase[]} cases - Empty when the self-tests were skipped
 *   (standard checker, or no `testsFilePath`)
 */
interface SelfTestReport extends ReportBase {
  command: string;
  exitCode: number;
  durationMs: number;
  errors: string[];
  target: SelfTestTarget;
  cases: SelfTestCase[];
}

/**
 * Report emitted by `polyman test <solution> --json`: the run report of the
 * target solution, each test judged by the checker against the main
 * solution's output, plus whether the verdicts match the solution's tag.
 * @interface SolutionTestReport
 * @property {string | null} mainSolution - Name of the MA solution, null when
 *   the command stopped before finding it
 * @property {boolean} matchesTag - Whether the verdicts satisfy the tag
 * @property {string} reason - Human explanation of matchesTag
 */
interface SolutionTestReport extends Omit<RunReport, 'command'> {
  command: 'test';
  exitCode: number;
  durationMs: number;
  mainSolution: string | null;
  matchesTag: boolean;
  reason: string;
}

/**
 * One upload, download, fetch or change inside a remote report.
 * @interface RemoteAction
 * @property {string} component - What kind of thing it is (solution, checker, testset, ...)
 * @property {string} name - Which one (file name, language, testset name, ...)
 * @property {string} action - What polyman did (upload, download, fetch, create, commit, build, ...)
 * @property {boolean} ok - Whether it worked
 * @property {string} [error] - Plain-text reason, only when ok is false
 */
interface RemoteAction {
  component: string;
  name: string;
  action: string;
  ok: boolean;
  error?: string;
}

/**
 * Report emitted by `polyman remote pull|push|view|commit|package --json`.
 * @interface RemoteReport
 * @property {number | null} problemId - Polygon problem ID, also for a new
 *   problem; null only when the command failed before it knew the ID
 * @property {RemoteAction[]} actions - One entry per upload, download or change
 * @property {string[]} warnings - Things that did not fail the command but
 *   need a look, for example a placeholder `pull` put in Config.json
 *   instead of a file it could not download
 */
interface RemoteReport extends ReportBase {
  command: string;
  exitCode: number;
  durationMs: number;
  errors: string[];
  problemId: number | null;
  actions: RemoteAction[];
  warnings: string[];
}

/**
 * How one component differs between the local problem folder and Polygon.
 * - `same`: what a push would send equals what is on Polygon.
 * - `changed`: a push would overwrite different content on Polygon.
 * - `local-only`: the component is not on Polygon yet, a push would add it.
 * - `remote-only`: the component is on Polygon but the local problem does not
 *   have it, so a push cannot recreate it.
 * @typedef {DiffStatus}
 */
type DiffStatus = 'same' | 'changed' | 'local-only' | 'remote-only';

/**
 * One compared component inside a diff report.
 * @interface DiffComponent
 * @property {string} component - What kind of thing it is (solution, checker,
 *   validator, generator, generator-script, statement, manual-test)
 * @property {string} name - Which one: the Polygon file name for a source
 *   file, `<lang>/<section>` for a statement, `<testset>/<index>` for a test
 * @property {DiffStatus} status - How the two sides differ
 */
interface DiffComponent {
  component: string;
  name: string;
  status: DiffStatus;
}

/**
 * Report emitted by `polyman remote diff --json`, and by
 * `polyman remote push --dry-run --json`: what a push would change on Polygon,
 * compared by content. It lists every component polyman managed to compare,
 * including the ones that are `same`, so a caller can show a full table.
 * @interface DiffReport
 * @property {number | null} problemId - Polygon problem ID; null when the
 *   problem is not on Polygon yet, which is reported as an error
 * @property {DiffComponent[]} components - One entry per compared component,
 *   in a stable order (solutions, checker, validator, generators, statements,
 *   then each testset's script and manual tests)
 * @property {number} changes - How many components are not `same`
 * @property {string[]} warnings - Components polyman could not compare, and
 *   other things that did not fail the command but need a look
 */
interface DiffReport extends ReportBase {
  command: string;
  exitCode: number;
  durationMs: number;
  errors: string[];
  problemId: number | null;
  components: DiffComponent[];
  changes: number;
  warnings: string[];
}

type JsonReport =
  | RunReport
  | VerifyReport
  | PathReport
  | ListReport
  | GenerateReport
  | ValidateReport
  | SelfTestReport
  | SolutionTestReport
  | RemoteReport
  | DiffReport;

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
  // Configuration
  TimeLimitMultipliers,
  // Local types
  CompilerConfig,
  LocalSolution,
  LocalGenerator,
  LocalChecker,
  LocalValidator,
  LocalTestset,
  LocalTestGroup,
  LocalManualTest,
  GeneratorScript,
  ParsedScriptLine,
  ScriptOutput,
  ResolvedTest,
  ResolvedTestSource,
  // Utilities
  VerdictTracker,
  // JSON reports
  TestVerdict,
  TestResult,
  StepResult,
  SolutionResult,
  RunReport,
  VerifyReport,
  PathReport,
  ListReport,
  GeneratedTestResult,
  GenerateReport,
  ValidatedTestResult,
  ValidateReport,
  SelfTestTarget,
  SelfTestCase,
  SelfTestReport,
  SolutionTestReport,
  RemoteAction,
  RemoteReport,
  DiffStatus,
  DiffComponent,
  DiffReport,
  JsonReport,
};

export default ConfigFile;
