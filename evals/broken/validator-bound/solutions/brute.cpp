// pairs-sum brute force: check every pair i < j, O(n^2).
// a_j must equal k - a_i, and that fits in int, so the inner loop is a plain
// int compare that O3 vectorizes. This way the brute force finishes n = 70000
// (answer above 2^31) in the time limit and can check main there.
#pragma GCC optimize("O3")
#include <bits/stdc++.h>
using namespace std;

int main() {
  int n, k;
  cin >> n >> k;
  vector<int> a(n);
  for (auto &x : a) cin >> x;
  long long ans = 0;
  for (int i = 0; i < n; i++) {
    int need = k - a[i];
    int cnt = 0;
    for (int j = i + 1; j < n; j++) cnt += (a[j] == need);
    ans += cnt;
  }
  cout << ans << "\n";
  return 0;
}
