// expected: WA
// bracket-depth wrong: prints the max depth and never checks if the
// string is balanced, so it never prints -1.
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
  cout << best << "\n";
  return 0;
}
