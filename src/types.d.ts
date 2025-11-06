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

type CheckerVerdict = 'OK' | 'WA' | 'ok' | 'wa' | 'PE' | 'pe';

type CheckerTest = {
  stdin: string;
  stdout: string;
  answer: string;
  verdict: CheckerVerdict;
};

type Validator = {
  source: string;
  tests?: string;
};

type ValidatorVerdict = 'VALID' | 'INVALID' | 'valid' | 'invalid';
type ValidatorTest = {
  stdin: string;
  expectedVerdict: ValidatorVerdict;
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
  ValidatorVerdict,
  CheckerVerdict,
};
export default ConfigFile;
