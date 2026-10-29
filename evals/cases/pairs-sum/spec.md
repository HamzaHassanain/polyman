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
- a_i > k (k - a_i is negative, must not match)
- k = 1 (no pair is possible since a_i >= 1)

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
