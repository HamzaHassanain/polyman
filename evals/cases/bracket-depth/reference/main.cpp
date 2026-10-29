// bracket-depth main: one scan with a counter, O(|s|).
#include <bits/stdc++.h>
using namespace std;

int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  string s;
  cin >> s;
  int cur = 0, best = 0;
  bool ok = true;
  for (char c : s) {
    cur += (c == '(') ? 1 : -1;
    if (cur < 0) ok = false;
    best = max(best, cur);
  }
  if (cur != 0) ok = false;
  cout << (ok ? best : -1) << "\n";
  return 0;
}
