#include "testlib.h"
using namespace std;

// inf - stream with the testdata.

int main(int argc, char *argv[])
{
    registerValidation(argc, argv);
    int testCaseCount = 1;

    for (int testCase = 1; testCase <= testCaseCount; testCase++)
    {
        setTestCase(testCase);

        int n = inf.readInt(1, 1000, "n");
        inf.readEoln();
        for (int i = 0; i < n; i++)
        {
            inf.readInt(1, 10000, "a_i");
            if (i < n - 1)
                inf.readSpace();
        }
        inf.readEoln();
    }
    inf.readEof();
    return 0;
}
