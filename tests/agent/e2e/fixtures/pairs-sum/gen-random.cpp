// pairs-sum generator (testlib).
// Usage: gen-random <n> <k> <v1> [v2 ...]
// Prints n values, each one picked at random from v1, v2, ...
// With one value every a_i is equal.
#include "testlib.h"

#include <cstdio>
#include <vector>

int main(int argc, char *argv[]) {
  registerGen(argc, argv, 1);
  int n = opt<int>(1);
  int k = opt<int>(2);
  std::vector<int> values;
  for (int i = 3; i < argc; i++) values.push_back(opt<int>(i));
  ensuref(!values.empty(), "need at least one value");
  std::printf("%d %d\n", n, k);
  for (int i = 0; i < n; i++) {
    int v = values[rnd.next(static_cast<int>(values.size()))];
    std::printf(i + 1 < n ? "%d " : "%d\n", v);
  }
  return 0;
}
