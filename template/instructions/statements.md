# statements.md — `statements/<lang>/*.tex`

Polyman/Polygon split a problem statement into four LaTeX **fragments** per language. Fragments — **not** standalone documents. No `\documentclass`, no `\begin{document}`.

## Files per language

| File | Holds |
| --- | --- |
| `legend.tex` | Story / problem statement: what the function or solver must compute. |
| `input-format.tex` | Exact input layout (number of lines, order, types) **plus constraints**. |
| `output-format.tex` | Exact output layout. |
| `notes.tex` | Sample walkthroughs, edge-case explanations. |

## Config.json entry

```jsonc
"statements": {
  "english": {
    "encoding": "UTF-8",
    "name": "My Problem",
    "legend": "./statements/english/legend.tex",
    "input":  "./statements/english/input-format.tex",
    "output": "./statements/english/output-format.tex",
    "notes":  "./statements/english/notes.tex"
  }
}
```

Per-language additional optional fields: `scoring`, `interaction`, `tutorial`. Each maps to a sibling `.tex` fragment.

## Hard rules

1. **No sample I/O inside `.tex` files.** Sample inputs are declared as **manual tests** (`Config.json.testsets[].manualTests[]`) with `useInStatements: true`. Polygon renders them under the statement automatically. See `instructions/manual-tests.md`.
2. **No solution spoilers** in `legend.tex` or `notes.tex`. Describe **what** to compute, not **how**. No "use DP", "binary search on the answer", "greedy from the right".
3. **No constraints in `legend.tex`.** Constraints (e.g. `$1 \le n \le 10^5$`) live in `input-format.tex`, ideally as a bullet list right after the format description.
4. **LaTeX math syntax**: `$...$` inline, `$$...$$` display. Use `\le`, `\ge`, `\cdot`, `\ldots`, `\times`. Use `\bmod`, not `mod`.
5. **`notes.tex` walks the samples**: brief explanation of why each sample's output is what it is. Reference samples by index ("In the first sample, …").
6. **One file per concern.** Don't bundle the input format into `legend.tex`.
7. **Constraints in `input-format.tex` must match `validator/val.cpp`.** When you tighten one, tighten the other and add a `validator_tests.json` boundary case.

## Languages

- `english/` is **required**.
- `russian/` ships in the template as an empty placeholder.

### Russian statement: delete if not asked for

If the user did not explicitly ask for a Russian statement, on the first turn that touches statements:

1. Delete the `statements/russian/` directory.
2. Remove the `russian` key from `Config.json.statements`.

Both changes happen in the same edit. **Never** auto-translate or auto-fill from English. Only create or keep the Russian fragments when the user explicitly asks for them.

## What NOT to do

- Don't paste sample inputs/outputs into `legend.tex` or `notes.tex`. Use `manualTests[]` with `useInStatements: true`.
- Don't write solution hints in `legend.tex` ("This can be solved with DP" — no).
- Don't put constraints in `legend.tex`. They live in `input-format.tex`.
- Don't add `\documentclass` or `\begin{document}` — fragments only.
- Don't drift constraints between `input-format.tex` and `validator/val.cpp`.
- Don't auto-create or auto-translate `russian/` content.
- Don't reference numbers in prose without LaTeX math (`n` should be `$n$`; `n^2` should be `$n^2$`).

## Example skeletons

`legend.tex`:
```tex
You are given an array $a$ of $n$ integers. Compute the sum of the array.
```

`input-format.tex`:
```tex
The first line contains a single integer $n$.

The second line contains $n$ integers $a_1, a_2, \ldots, a_n$.

Constraints:
\begin{itemize}
    \item $1 \le n \le 10^5$
    \item $1 \le a_i \le 10^9$
\end{itemize}
```

`output-format.tex`:
```tex
Print a single integer — the sum of the array.
```

`notes.tex`:
```tex
In the first sample, $1 + 2 + 3 + 4 + 5 = 15$.
```
