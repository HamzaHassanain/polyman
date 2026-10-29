// pairs-sum brute force: check every pair i < j, O(n^2).
#include <bits/stdc++.h>
using namespace std;

int main() {
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
