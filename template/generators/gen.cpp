

#include "testlib.h"

using namespace std;

int main(int argc, char *argv[])
{
    registerGen(argc, argv, 1);

    // generate array
    int n = rnd.next(1, 1000);
    cout << n << endl;
    for (int i = 0; i < n; i++)
    {
        cout << rnd.next(1, 10000);

        if (i < n - 1)
            cout << " ";
        // else
        //     cout << endl;
    }
}
