// expected: WA
// max-subarray wrong: correct Kadane, but the sums are kept in int.
// Overflows when the answer is above 2^31 - 1.
#include <bits/stdc++.h>
using namespace std;

int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  int n;
  cin >> n;
  int best = INT_MIN, cur = 0;
  for (int i = 0; i < n; i++) {
    int a;
    cin >> a;
    cur = (i == 0) ? a : max(a, cur + a);
    best = max(best, cur);
  }
  cout << best << "\n";
  return 0;
}
