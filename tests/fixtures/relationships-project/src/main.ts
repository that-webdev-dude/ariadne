import {
  calculate,
  calculate as calc,
  Greeter,
  helper,
} from "./math.js";
import * as math from "./math.js";
import "./side-effect.js";
import { readFileSync } from "node:fs";
import { missing } from "./missing.js";

export { helper as exportedHelper } from "./math.js";

helper(0);

export function localTarget(value: number): number {
  return value;
}

export function localCaller(): number {
  return localTarget(1);
}

export function runImported(): number {
  return calculate(1);
}

export function runAlias(): number {
  return calc(1);
}

export function runNamespace(): number {
  return math.calculate(1);
}

export function runMethod(greeter: Greeter): number {
  return greeter.greet(1);
}

export const execute = (): number => helper(1);

export function recursive(value: number): number {
  return value === 0 ? 0 : recursive(value - 1);
}

export function duplicate(): number {
  helper(1);
  return helper(2);
}

export function runCallback(callback: () => void): void {
  callback();
}

export function runAny(value: any): void {
  value();
}

void readFileSync;
void missing;
