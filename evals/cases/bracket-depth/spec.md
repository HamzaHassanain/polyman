# Idea
Given a string of ( and ), print the maximum nesting depth if it is balanced, else -1.

# Constraints
- 1 <= |s| <= 1000000
- s has only the characters ( and )

# Input
One line with the string s.

# Output
One integer: the maximum nesting depth of s if s is balanced, else -1.

# Intended solution
Scan once with a counter: +1 on (, -1 on ). The depth is the largest counter value. The string is balanced only if the counter never goes below 0 and ends at 0. O(|s|).

# Wrong approaches
- prints the max depth without any balance check -> WA
- only checks that the final count is 0, not that every prefix count is >= 0 -> WA

# Edge cases
- |s| = 1 (always -1)
- final count is 0 but a prefix goes below 0, like )(
- final count is not 0, like ((
- |s| = 1000000 and depth 500000 (all ( then all ))
- |s| = 1000000 and depth 1, like ()()()...

# Samples
## Input 1
```
(()())
```
## Output 1
```
2
```
## Input 2
```
())(
```
## Output 2
```
-1
```

# Decisions
- Time limit 1 second, memory limit 256 MB.
- Checker: wcmp.
