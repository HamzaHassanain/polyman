// pairs-sum main: count values in a hash map while scanning, O(n).
#include <bits/stdc++.h>
using namespace std;

struct SplitMix {
  size_t operator()(uint64_t x) const {
    static const uint64_t seed =
        chrono::steady_clock::now().time_since_epoch().count();
    x += seed + 0x9e3779b97f4a7c15ULL;
    x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
    x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL;
    return x ^ (x >> 31);
  }
};

int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  int n;
  long long k;
  cin >> n >> k;
  unordered_map<long long, int, SplitMix> cnt;
  cnt.reserve(n * 2);
  long long ans = 0;
  for (int i = 0; i < n; i++) {
    long long a;
    cin >> a;
    auto it = cnt.find(k - a);
    if (it != cnt.end()) ans += it->second;
    cnt[a]++;
  }
  cout << ans << "\n";
  return 0;
}
