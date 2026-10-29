// expected: TL
// max-subarray wrong: prefix sums and a check of every pair (l, r), O(n^2).
// Correct answers, but too slow for n = 200000.
#include <bits/stdc++.h>
using namespace std;

int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  int n;
  cin >> n;
  vector<long long> pre(n + 1, 0);
  for (int i = 0; i < n; i++) {
    long long a;
    cin >> a;
    pre[i + 1] = pre[i] + a;
  }
  long long best = LLONG_MIN;
  for (int l = 0; l < n; l++)
    for (int r = l + 1; r <= n; r++) best = max(best, pre[r] - pre[l]);
  cout << best << "\n";
  return 0;
}
