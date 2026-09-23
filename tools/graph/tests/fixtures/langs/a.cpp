#include "util.hpp"
namespace geo {
class Circle : public Base, public Shape {
 public:
  double area() override { return helper(r); }
};
double Circle::perimeter() { return util::twice(r); }
void run() { Circle c; c.area(); auto p = new Circle(); p->area(); }
}
