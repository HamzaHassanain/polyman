# The spec format (`.polyman/agent/notes.md`)

The spec is the single source of truth every worker reads (doc 10). The chat agent writes it in the Think step, the scheduler and checkpoints parse it, and the T1 test problems are written in it. Everyone uses exactly these headings.

```markdown
# Idea
Count pairs i < j with a_i + a_j = k.

# Constraints
- 1 <= n <= 200000
- 1 <= a_i <= 1000000000
- 1 <= k <= 1000000000

# Input
The first line has n and k. The second line has n integers a_1 .. a_n.

# Output
One integer: the number of pairs.

# Intended solution
Count values with a hash map while scanning, add cnt[k - a_i] before inserting a_i. O(n). The answer can be up to about 2e10, use 64-bit.

# Wrong approaches
- answer kept in int (overflow) -> WA
- a_i = k/2 counted wrong (counts pairs of the same index) -> WA
- O(n^2) brute force -> TL

# Edge cases
- n = 1
- all values equal and k = 2 * value, n = 200000 (max answer)
- no pair at all

# Samples
## Input 1
```
4 6
1 5 3 3
```
## Output 1
```
2
```

# Decisions
- Time limit 1 second, memory limit 256 MB.
- Checker: ncmp.
```

Parsing rules (W6 `checkpoints.ts`, W6 `recipes.ts`, W11):

- Sections are `# <Name>` lines, exact names above. Unknown sections are kept but ignored.
- `# Wrong approaches`: one approach per line starting with `- `. The text after `->` is the expected verdict (`WA`, `TL`, `ML`, `RE`). A `TL` approach that is the plain brute force is covered by the `brute_force` task (tag `TO`), so it does not get a `wrong_solution` task.
- `# Samples`: pairs of `## Input <n>` / `## Output <n>`, each followed by a fenced code block.
- `# Decisions`: `Time limit <x> second(s)` and `memory limit <y> MB` set the config. `Checker: <name>` overrides the automatic checker choice.
