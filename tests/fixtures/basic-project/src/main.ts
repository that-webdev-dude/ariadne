export function greet(name: string): string {
  return localHelper(name);
}

function localHelper(value: string): string {
  return value.trim();
}

export class Greeter {
  constructor(readonly prefix: string) {}

  greet(name: string): string {
    return `${this.prefix} ${name}`;
  }

  static create(prefix: string): Greeter {
    return new Greeter(prefix);
  }
}

export interface Formatter {
  readonly label: string;
  format(value: string): string;
}

export type FormatterFactory = (label: string) => Formatter;

export const uppercase = (value: string): string => value.toUpperCase();

const answer = 42;
const mapped = [1, 2, 3].map((value) => value * 2);

export default function (value: string): string {
  return value;
}
