export function square(x: number): number {
  return x * x
}

export const cube = (x: number): number => x * square(x)
