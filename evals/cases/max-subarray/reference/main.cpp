// max-subarray main: Kadane with 64-bit sums, O(n).
#include <bits/stdc++.h>
using namespace std;

int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  int n;
  cin >> n;
  long long best = LLONG_MIN, cur = 0;
  for (int i = 0; i < n; i++) {
    long long a;
    cin >> a;
    cur = (i == 0) ? a : max(a, cur + a);
    best = max(best, cur);
  }
  cout << best << "\n";
  return 0;
}
