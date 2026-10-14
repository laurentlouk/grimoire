import { Circle } from './geo/circle'
import * as math from './util/math'

export function main(): number {
  const c = new Circle(2)
  console.log(c.describe(), math.cube(3))
  return total([c])
}

function total(shapes: Circle[]): number {
  const seen = shapes.map((x) => x.area())
  return shapes.reduce((s, x) => s + x.area(), 0) + (seen.has(2) ? 1 : 0)
}
