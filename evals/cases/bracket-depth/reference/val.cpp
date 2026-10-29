// bracket-depth validator (testlib).
#include "testlib.h"

int main(int argc, char *argv[]) {
  registerValidation(argc, argv);
  inf.readToken("[()]{1,1000000}", "s");
  inf.readEoln();
  inf.readEof();
  return 0;
}
