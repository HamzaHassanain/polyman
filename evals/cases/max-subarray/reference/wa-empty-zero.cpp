// expected: WA
// max-subarray wrong: the textbook Kadane that resets to 0, so it allows
// the empty subarray. Prints 0 when all values are negative.
#include <bits/stdc++.h>
using namespace std;

int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  int n;
  cin >> n;
  long long best = 0, cur = 0;
  for (int i = 0; i < n; i++) {
    long long a;
    cin >> a;
    cur = max(0LL, cur + a);
    best = max(best, cur);
  }
  cout << best << "\n";
  return 0;
}
