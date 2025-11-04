type SolutionLang = 'cpp' | 'python' | 'java';
type SolutionType =
  | 'main-correct'
  | 'correct'
  | 'tle'
  | 'wrong'
  | 'tle-or-wrong'
  | 'mle'
  | 'ole'
  | 'rte'
  | 'pe';

type Solution = {
  name: string;
  lang: SolutionLang;
  source: string;
  type: SolutionType;
};

type Generator = {
  name: string;
  source: string;
  'tests-range': [number, number];
};

type Checker = {
  custom: boolean;
  source: string;
  tests?: string;
};

type Validator = {
  source: string;
  tests?: string;
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

export { Solution, Generator, Checker, Validator, SolutionLang, SolutionType };
export default ConfigFile;
