# Idea
Find the maximum sum of a non-empty contiguous subarray.

# Constraints
- 1 <= n <= 200000
- -1000000000 <= a_i <= 1000000000

# Input
The first line has n. The second line has n integers a_1 .. a_n.

# Output
One integer: the maximum sum of a non-empty contiguous subarray.

# Intended solution
Kadane: keep the best sum of a subarray that ends at i, cur = max(a_i, cur + a_i), and the best over all i. O(n). The answer can be up to 2e14 in absolute value, use 64-bit.

# Wrong approaches
- sums kept in int (overflow) -> WA
- empty subarray allowed, so the answer is 0 when all values are negative -> WA
- O(n^2) over all subarrays with prefix sums -> TL

# Edge cases
- n = 1 with a negative value
- n = 1 with a_1 = 1000000000
- all values negative (answer is the largest value, not 0)
- answer above 2^31 - 1 with a small n
- all values 1000000000, n = 200000 (max answer 2e14)
- zeros and negatives only (answer is 0)

# Samples
## Input 1
```
9
-2 1 -3 4 -1 2 1 -5 4
```
## Output 1
```
6
```

# Decisions
- Time limit 1 second, memory limit 256 MB.
- Checker: ncmp.
