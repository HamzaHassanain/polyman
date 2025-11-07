// Description: Example of a scored checker that returns points based on difference
#include "testlib.h"

using namespace std;

int main(int argc, char *argv[])
{
    setName("example of scored checker");
    registerTestlibCmd(argc, argv);

    double ja = ans.readDouble();
    double pa = ouf.readDouble();

    quitp(fabs(ja - pa), "ja=%.4f pa=%.4f", ja, pa);
}
