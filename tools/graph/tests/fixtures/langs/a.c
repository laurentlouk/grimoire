#include "util.h"
#include <stdio.h>
struct point { int x; };
typedef struct point point_t;
static int helper(int x) { return x; }
int run(void) { helper(1); printf("x"); return 0; }
