// max-subarray brute force: try every subarray [l, r], O(n^2).
#include <bits/stdc++.h>
using namespace std;

int main() {
  int n;
  cin >> n;
  vector<long long> a(n);
  for (auto &x : a) cin >> x;
  long long best = LLONG_MIN;
  for (int l = 0; l < n; l++) {
    long long sum = 0;
    for (int r = l; r < n; r++) {
      sum += a[r];
      best = max(best, sum);
    }
  }
  cout << best << "\n";
  return 0;
}
