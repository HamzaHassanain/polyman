// expected: WA
// pairs-sum wrong: counts all values first, then for every a_i adds
// cnt[k - a_i] and divides by 2. When a_i = k / 2 it also pairs a_i with
// itself (same index), so the answer is too big.
#include <bits/stdc++.h>
using namespace std;

int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  int n;
  long long k;
  cin >> n >> k;
  vector<long long> a(n);
  map<long long, long long> cnt;
  for (auto &x : a) {
    cin >> x;
    cnt[x]++;
  }
  long long ans = 0;
  for (int i = 0; i < n; i++) {
    auto it = cnt.find(k - a[i]);
    if (it != cnt.end()) ans += it->second;
  }
  cout << ans / 2 << "\n";
  return 0;
}
