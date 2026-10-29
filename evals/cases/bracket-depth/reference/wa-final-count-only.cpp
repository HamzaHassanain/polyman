// expected: WA
// bracket-depth wrong: checks only that the final count is 0. It misses
// strings like )( where a prefix count goes below 0.
#include <bits/stdc++.h>
using namespace std;

int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  string s;
  cin >> s;
  int cur = 0, best = 0;
  for (char c : s) {
    cur += (c == '(') ? 1 : -1;
    best = max(best, cur);
  }
  cout << (cur == 0 ? best : -1) << "\n";
  return 0;
}
