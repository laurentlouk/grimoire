import Foundation
protocol Shape { func area() -> Double }
class Circle: Base, Shape {
  func area() -> Double { return helper(r) }
}
struct Point { var x: Int }
enum Color { case red }
extension Circle { func grow() { self.area() } }
func run() { let c = Circle(); c.area(); print("x") }
