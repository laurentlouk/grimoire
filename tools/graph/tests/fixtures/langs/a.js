import { helper, Other as O } from './util'
import * as fs from 'node:fs'
export class Circle extends Base {
  area() { return helper(this.r) }
  static make = () => new Circle()
}
export function run(x) { const c = new Circle(); c.area(); fs.readFileSync('x') }
const arrow = async (y) => run(y)
const x = require("./lib"); module.exports = { x }
