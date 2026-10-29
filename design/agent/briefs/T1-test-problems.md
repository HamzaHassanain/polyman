# T1: test problems, by hand

- Lane: C (Mazen). Claude Code can help write them, but **Mazen reads and checks every file**: these are the ground truth we measure Gemma against. Branch: `hack/t1-problems`.
- Time: 2:45 to 5:50 PM, while Claude Code runs W8 in the background. pairs-sum pushed by 4:15 (W10 and W11 need it), the rest by 5:50. Building pairs-sum by hand is also how Tester learns polyman, so start with the "Start here" hands-on in the run sheet.
- Read first: `design/agent/briefs/SPEC-FORMAT.md`, `template/` (how a polyman problem looks), `README.md` quick start.

## Goal

Three small, classic problems with a spec and a correct reference, so we can run the agent on them, check its work against a known good answer, and pick the demo problem.

## You own

`evals/cases/<id>/` for each problem:

```
evals/cases/pairs-sum/
  spec.md            the spec, exactly in SPEC-FORMAT.md format
  case.json          { "id", "title", "difficulty": "easy|medium", "demo": true|false }
  reference/
    main.cpp         correct, efficient
    brute.cpp        simple and obviously correct
    wa-*.cpp         one file per wrong approach in the spec
    tests/           6 to 10 test inputs (01.txt ...) incl. every edge case in the spec
    answers/         the main.cpp output for each test (01.txt ...)
```

## The problems

| id | Idea | Wrong approaches | Why |
| --- | --- | --- | --- |
| `pairs-sum` | count pairs i < j with a_i + a_j = k, n up to 2e5, values up to 1e9 | int overflow (WA), equal halves counted wrong (WA), O(n²) (TL) | the demo problem, it is in the sample screens |
| `max-subarray` | maximum subarray sum, n up to 2e5, values in [-1e9, 1e9] | int overflow (WA), answer 0 when all negative (WA), O(n²) (TL) | classic edge case (all negative) that weak tests miss |
| `bracket-depth` | given a string of `(` and `)`, print the maximum nesting depth if it is balanced, else `-1`. Length up to 1e6 | ignores the balance check (WA), only checks the final count, not prefix never below 0 (WA) | a non-number output: tests the checker choice (`wcmp`) |

## Rules

- `main.cpp` and `brute.cpp` must agree on every test in `reference/tests/` (check with a quick script or by hand).
- Each `wa-*.cpp` must fail at least one of your tests. That proves your tests are strong.
- Edge cases in the spec are real: each one has a test.
- Keep statements short. The agent writes its own statement; yours is only the spec.

## Done when

- Three folders, pushed to `origin hack/t1-problems` (commit `evals: test problems`).
- Tell Hamza which one is the most reliable for the demo after W11's first runs.
