type SolutionLang = 'cpp' | 'python' | 'java';
type SolutionType =
  | 'main-correct'
  | 'correct'
  | 'incorrect'
  | 'tle'
  | 'tle-or-correct'
  | 'tle-or-mle'
  | 'mle'
  | 'failed'
  | 'pe';

type Solution = {
  name: string;
  source: string;
  type: SolutionType;
};

type Generator = {
  name: string;
  source?: string;
  'tests-range': [number, number];
};

type Checker = {
  custom: boolean;
  source: string;
  tests?: string;
};
type CheckerTest = {
  stdin: string;
  stdout: string;
  answer: string;
  verdict: 'OK' | 'WA' | 'ok' | 'wa' | 'PE' | 'pe';
};

type Validator = {
  source: string;
  tests?: string;
};

type ValidatorTest = {
  stdin: string;
  expectedVerdict: 'VALID' | 'INVALID' | 0 | 1 | 'valid' | 'invalid';
};

interface ConfigFile {
  name: string;
  tag: string;
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
};
export default ConfigFile;
