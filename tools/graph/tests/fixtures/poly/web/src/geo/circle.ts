import { Base, Shape } from './shape'
import { square } from '../util/math'

export class Circle extends Base implements Shape {
  constructor(private r: number) {
    super()
  }
  area(): number {
    return Math.PI * square(this.r)
  }
}
