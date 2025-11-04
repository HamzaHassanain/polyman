#include <bits/stdc++.h>

using namespace std;

int main()
{
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n;
    cin >> n;
    vector<int> a(n);
    for (int i = 0; i < n; i++)
    {
        cin >> a[i];
    }

    long long sum = 0;
    for (int x : a)
    {
        sum += x;
    }
    if (sum % 2 == 0)
    {
        cout << "YES\n";
    }
    else
    {
        cout << "NO\n";
    }

    return 0;
}