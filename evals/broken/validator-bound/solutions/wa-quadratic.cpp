// expected: TL
// pairs-sum wrong: the plain O(n^2) loop over all pairs. Correct answers,
// but too slow for n = 200000 (about 2e10 pair checks).
#include <bits/stdc++.h>
using namespace std;

int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  int n;
  long long k;
  cin >> n >> k;
  vector<long long> a(n);
  for (auto &x : a) cin >> x;
  long long ans = 0;
  for (int i = 0; i < n; i++)
    for (int j = i + 1; j < n; j++)
      if (a[i] + a[j] == k) ans++;
  cout << ans << "\n";
  return 0;
}
