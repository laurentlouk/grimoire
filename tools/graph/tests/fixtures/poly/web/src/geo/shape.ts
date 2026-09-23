export interface Shape {
  area(): number
}

export abstract class Base {
  describe(): string {
    return 'shape of ' + this.area()
  }
  abstract area(): number
}
