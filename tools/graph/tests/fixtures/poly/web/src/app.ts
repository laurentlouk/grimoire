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

export function formatAll(): string {
  return new Intl.NumberFormat('en').describe()
}

export function hasRadius(): boolean {
  return new Circle(3).has(1)
}

export function geoUnit(): string {
  return Geo.Circle.unit().describe()
}
