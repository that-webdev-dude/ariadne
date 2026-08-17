export function b(): number {
  return c();
}

export function c(): number {
  return 1;
}

export function d(): number {
  return 2;
}

export function greet(): string {
  return "targets";
}

export class Greeter {
  greet(): string {
    return "method";
  }
}
