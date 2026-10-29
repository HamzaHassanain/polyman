// expected: WA
// pairs-sum wrong: correct O(n) idea, but the answer is kept in int.
// Overflows when the answer is above 2^31 - 1 (all values equal, n = 200000).
#include <bits/stdc++.h>
using namespace std;

int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  int n;
  long long k;
  cin >> n >> k;
  map<long long, int> cnt;
  int ans = 0;
  for (int i = 0; i < n; i++) {
    long long a;
    cin >> a;
    ans += cnt[k - a];
    cnt[a]++;
  }
  cout << ans << "\n";
  return 0;
}
