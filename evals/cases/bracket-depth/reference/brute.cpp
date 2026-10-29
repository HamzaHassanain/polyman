// bracket-depth brute force: an explicit stack. Push on (, pop on ).
// A pop on an empty stack, or a non-empty stack at the end, means not
// balanced. The depth is the largest stack size.
#include <bits/stdc++.h>
using namespace std;

int main() {
  string s;
  cin >> s;
  vector<char> st;
  size_t best = 0;
  for (char c : s) {
    if (c == '(') {
      st.push_back(c);
      best = max(best, st.size());
    } else {
      if (st.empty()) {
        cout << -1 << "\n";
        return 0;
      }
      st.pop_back();
    }
  }
  if (!st.empty()) {
    cout << -1 << "\n";
    return 0;
  }
  cout << best << "\n";
  return 0;
}
