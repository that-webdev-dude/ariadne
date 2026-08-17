export function helper(value: number): number {
  return value * 2;
}

export function calculate(value: number): number {
  return helper(value) + 1;
}

export class Greeter {
  greet(value: number): number {
    return helper(value);
  }
}
