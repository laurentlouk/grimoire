export class CatsService {
  private readonly cats: string[] = []
  findAll(): string[] {
    return this.cats
  }
  add(name: string): void {
    this.cats.push(name)
  }
}
