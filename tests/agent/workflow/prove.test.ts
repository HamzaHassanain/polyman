import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  PROVE_FILES,
  PROVE_LIMITS,
  protoCheck,
  proveCheck,
  seconds,
} from '../../../src/agent/workflow/prove';
import { PROVE_DIR, proveIdeaPlan } from '../../../src/agent/workflow/recipes';
import type { PlanTask } from '../../../src/agent/workflow/types';

const FENCE = '```';

/** Count the pairs i < j with a_i + a_j = k. */
const spec = (sample2 = '1', limit = 'Time limit 0.5 seconds') => `# Idea
Count the pairs i < j with a_i + a_j = k.

# Constraints
- 1 <= n <= 200000

# Wrong approaches
- int overflow -> WA
- O(n^2) brute force -> TL
- too much memory -> ML

# Samples
## Input 1
${FENCE}
4 6
1 5 3 3
${FENCE}
## Output 1
${FENCE}
2
${FENCE}
## Input 2
${FENCE}
3 4
2 1 3
${FENCE}
## Output 2
${FENCE}
${sample2}
${FENCE}

# Decisions
- ${limit}, memory limit 256 MB.
`;

const BRUTE = `#include <iostream>
#include <vector>
int main() {
  long long n, k; std::cin >> n >> k;
  std::vector<long long> a(n);
  for (auto &x : a) std::cin >> x;
  long long ans = 0;
  for (int i = 0; i < n; i++)
    for (int j = i + 1; j < n; j++)
      if (a[i] + a[j] == k) ans++;
  std::cout << ans << "\\n";
}
`;

const MAIN = `#include <iostream>
#include <map>
int main() {
  long long n, k; std::cin >> n >> k;
  std::map<long long, long long> cnt; long long ans = 0;
  for (int i = 0; i < n; i++) { long long a; std::cin >> a; ans += cnt[k - a]; cnt[a]++; }
  std::cout << ans << "\\n";
}
`;

/** The answer in an int: wrong when there are more than 2^31 pairs. */
const OVERFLOW = MAIN.replace('long long ans = 0', 'int ans = 0').replace(
  'ans += cnt[k - a]',
  'ans += (int)cnt[k - a]'
);

/** Counts a value with itself too: wrong on the samples. */
const MAIN_SELF = MAIN.replace(
  'ans += cnt[k - a]; cnt[a]++;',
  'cnt[a]++; ans += cnt[k - a];'
);

/** Off by one when k is odd: right on the max test (k = 2). */
const ODD_K = MAIN.replace('std::cout << ans', 'std::cout << ans + k % 2');

const CRASH = 'int main() { return 3; }\n';

/** Small: n up to 6, values 1 to 5. Max: n = 200000 ones, k = 2. */
const GEN = `#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <random>
int main(int argc, char **argv) {
  std::mt19937_64 rng(atoll(argv[1]));
  if (strcmp(argv[2], "max") == 0) {
    int n = 200000; printf("%d 2\\n", n);
    for (int i = 0; i < n; i++) printf("1%c", i + 1 == n ? '\\n' : ' ');
    return 0;
  }
  int n = rng() % 6 + 1, k = rng() % 10 + 1; printf("%d %d\\n", n, k);
  for (int i = 0; i < n; i++) printf("%d%c", (int)(rng() % 5 + 1), i + 1 == n ? '\\n' : ' ');
}
`;

/** Prints the same test for every seed. */
const GEN_FIXED = `#include <cstdio>
int main() { printf("2 3\\n1 2\\n"); }
`;

const signal = new AbortController().signal;
const saved = { ...PROVE_LIMITS };
let dir: string;

const write = async (rel: string, text: string): Promise<void> => {
  await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await fs.writeFile(path.join(dir, rel), text);
};

const task = (
  kind: PlanTask['kind'],
  ownsFiles: string[] = [],
  params?: Record<string, string>
): PlanTask => ({
  id: kind,
  kind,
  title: kind,
  dependsOn: [],
  brief: '',
  ownsFiles,
  ...(params ? { params } : {}),
});

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'polyman-prove-'));
  // Fewer tests, so the suite stays fast.
  PROVE_LIMITS.smallTests = 60;
  PROVE_LIMITS.maxTests = 1;
  await write(PROVE_FILES.brute, BRUTE);
  await write(PROVE_FILES.main, MAIN);
  await write(PROVE_FILES.gen, GEN);
});

afterEach(async () => {
  Object.assign(PROVE_LIMITS, saved);
  await fs.rm(dir, { recursive: true, force: true });
});

describe('proveIdeaPlan', () => {
  it('has the programs, the checks and one kill per wrong approach', () => {
    const plan = proveIdeaPlan(spec());
    expect(plan.recipe).toBe('prove_idea');
    expect(plan.tasks.map(t => t.id)).toEqual([
      'brute',
      'main',
      'gen',
      'wrong-1',
      'stress',
      'samples',
      'max-test',
      'kill-1',
      'kill-brute',
    ]);
    const byId = new Map(plan.tasks.map(t => [t.id, t]));
    expect(byId.get('wrong-1')?.ownsFiles).toEqual([
      `${PROVE_DIR}/wrong-1.cpp`,
    ]);
    expect(byId.get('wrong-1')?.title).toBe('Wrong: int overflow (WA)');
    expect(byId.get('kill-1')?.dependsOn).toEqual([
      'wrong-1',
      'main',
      'gen',
      'stress',
    ]);
    // The brute force line is checked on the brute force itself.
    expect(byId.get('kill-brute')?.params).toMatchObject({
      tag: 'TL',
      file: PROVE_FILES.brute,
    });
    // Memory is not measured: the ML line gets no task.
    expect(plan.tasks.some(t => t.params?.['tag'] === 'ML')).toBe(false);
  });
});

// Each test compiles up to 3 programs, and a TL run waits for its timeout.
describe('protoCheck (needs g++)', { timeout: 30_000 }, () => {
  it('a brute force must run on the samples, its output is not compared', async () => {
    const cp = await protoCheck(
      task('proto_brute', [PROVE_FILES.brute]),
      spec('99'),
      dir,
      signal
    );
    expect(cp).toEqual({
      name: 'samples',
      ok: true,
      digest: 'compiles, runs on 2 samples',
    });
  });

  it('a crash on a sample fails', async () => {
    await write(PROVE_FILES.main, CRASH);
    const cp = await protoCheck(
      task('proto_main', [PROVE_FILES.main]),
      spec(),
      dir,
      signal
    );
    expect(cp.ok).toBe(false);
    expect(cp.digest).toBe('sample 1: exit code 3');
  });

  it('the generator must give one test per seed', async () => {
    const good = await protoCheck(
      task('proto_gen', [PROVE_FILES.gen]),
      spec(),
      dir,
      signal
    );
    expect(good.ok).toBe(true);
    await write(PROVE_FILES.gen, GEN_FIXED);
    const fixed = await protoCheck(
      task('proto_gen', [PROVE_FILES.gen]),
      spec(),
      dir,
      signal
    );
    expect(fixed.ok).toBe(false);
    expect(fixed.digest).toMatch(/^seeds 1 to 5 gave the same test/);
  });

  it('a wrong solution must compile', async () => {
    await write(`${PROVE_DIR}/wrong-1.cpp`, 'int main( {');
    const cp = await protoCheck(
      task('proto_wrong', [`${PROVE_DIR}/wrong-1.cpp`]),
      spec(),
      dir,
      signal
    );
    expect(cp.ok).toBe(false);
    expect(cp.digest).toMatch(
      /^\.polyman\/agent\/prove\/wrong-1\.cpp: compile error/
    );
  });
});

describe('proveCheck (needs g++)', { timeout: 30_000 }, () => {
  it('stress passes when brute and main agree', async () => {
    const cp = await proveCheck(task('stress'), spec(), dir, signal);
    expect(cp).toEqual({
      name: 'stress',
      ok: true,
      digest: '60 random small tests: brute = main',
    });
  });

  it('stress gives a counterexample when main is wrong', async () => {
    await write(PROVE_FILES.main, MAIN_SELF);
    const cp = await proveCheck(task('stress'), spec(), dir, signal);
    expect(cp.ok).toBe(false);
    const lines = cp.digest.split('\n');
    expect(lines[0]).toMatch(/^small test \d+: brute says \d+, main says \d+$/);
    expect(lines[1]).toBe('input:');
    expect(cp.digest).toMatch(/\nbrute: \d+\nmain: \d+$/);
  });

  it('samples pass when the spec, brute and main agree', async () => {
    const cp = await proveCheck(task('sample_check'), spec(), dir, signal);
    expect(cp).toEqual({
      name: 'samples',
      ok: true,
      digest: '2 samples: spec = brute = main',
    });
  });

  it('a sample brute and main both disagree with looks wrong', async () => {
    const cp = await proveCheck(task('sample_check'), spec('3'), dir, signal);
    expect(cp.ok).toBe(false);
    expect(cp.digest).toBe(
      'sample 2 looks wrong: the spec says 3, brute and main say 1'
    );
  });

  it('says which one disagrees when brute and main differ on a sample', async () => {
    await write(PROVE_FILES.main, MAIN_SELF);
    const cp = await proveCheck(task('sample_check'), spec(), dir, signal);
    expect(cp.ok).toBe(false);
    expect(cp.digest).toBe(
      [
        'sample 1: brute says 2, main says 4, the spec says 2',
        'sample 2: brute says 1, main says 2, the spec says 1',
      ].join('\n')
    );
  });

  it('the max test passes in the time limit', async () => {
    const cp = await proveCheck(task('max_test'), spec(), dir, signal);
    expect(cp.ok).toBe(true);
    expect(cp.digest).toMatch(/^slowest max test \d\.\d\d s of 0\.50 s$/);
  });

  it('the max test fails when main is too slow', async () => {
    await write(PROVE_FILES.main, BRUTE);
    const cp = await proveCheck(task('max_test'), spec(), dir, signal);
    expect(cp.ok).toBe(false);
    expect(cp.digest).toBe(
      'max test 1: main ran over 1.50 s, the time limit is 0.50 s'
    );
  });

  it('kills an overflow on the max test', async () => {
    await write(`${PROVE_DIR}/wrong-1.cpp`, OVERFLOW);
    const cp = await proveCheck(
      task('kill_wrong', [], {
        tag: 'WA',
        file: `${PROVE_DIR}/wrong-1.cpp`,
      }),
      spec(),
      dir,
      signal
    );
    expect(cp.ok).toBe(true);
    expect(cp.digest).toMatch(
      /^killed by max test 1: main says 19999900000, it says -?\d+$/
    );
  });

  it('kills a wrong answer on a small test and shows the input', async () => {
    await write(`${PROVE_DIR}/wrong-1.cpp`, ODD_K);
    const cp = await proveCheck(
      task('kill_wrong', [], { tag: 'WA', file: `${PROVE_DIR}/wrong-1.cpp` }),
      spec(),
      dir,
      signal
    );
    expect(cp.ok).toBe(true);
    expect(cp.digest).toMatch(/^killed by small test \d+: main says/);
    expect(cp.digest).toContain('\ninput:\n');
  });

  it('a wrong approach that passes everything is not killed', async () => {
    await write(`${PROVE_DIR}/wrong-1.cpp`, MAIN);
    const cp = await proveCheck(
      task('kill_wrong', [], { tag: 'WA', file: `${PROVE_DIR}/wrong-1.cpp` }),
      spec(),
      dir,
      signal
    );
    expect(cp.ok).toBe(false);
    expect(cp.digest.split('\n')[0]).toBe(
      'not killed: it passed 1 max and 60 small tests'
    );
  });

  it('kills the brute force with TL and a crash with RE', async () => {
    const tl = await proveCheck(
      task('kill_wrong', [], { tag: 'TL', file: PROVE_FILES.brute }),
      spec(),
      dir,
      signal
    );
    expect(tl.ok).toBe(true);
    expect(tl.digest).toMatch(/^killed: max test 1 (ran over|took)/);

    await write(`${PROVE_DIR}/wrong-1.cpp`, CRASH);
    const re = await proveCheck(
      task('kill_wrong', [], { tag: 'RE', file: `${PROVE_DIR}/wrong-1.cpp` }),
      spec(),
      dir,
      signal
    );
    expect(re).toMatchObject({
      ok: true,
      digest: 'killed: crashed on max test 1 (exit code 3)',
    });
  });

  it('a TL approach that is fast is not killed', async () => {
    const cp = await proveCheck(
      task('kill_wrong', [], { tag: 'TL', file: PROVE_FILES.main }),
      spec(),
      dir,
      signal
    );
    expect(cp.ok).toBe(false);
    expect(cp.digest).toMatch(
      /^not killed: it ran every max test in the time limit/
    );
  });
});

describe('seconds', () => {
  it('prints two decimals', () => {
    expect(seconds(410)).toBe('0.41 s');
    expect(seconds(1000)).toBe('1.00 s');
  });
});
