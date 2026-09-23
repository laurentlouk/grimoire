import { helper, Other as O } from './util'
import * as fs from 'node:fs'
export interface Shape { area(): number }
export class Circle extends Base implements Shape {
  area(): number { return helper(this.r) }
  static make = () => new Circle()
}
export function run(x: number) { const c = new Circle(); c.area(); fs.readFileSync('x') }
const arrow = async (y) => run(y)
type Alias = { a: string }
enum Color { Red }
function f(a: Circle, b?: Foo<Bar>, c = 1) { let x: Circle = make(); const y = new Circle(); a.area() }
