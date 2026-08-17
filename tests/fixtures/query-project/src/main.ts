import { b, d } from "./targets.js";

export function a(): number {
  return b() + d();
}

export function caller(): number {
  return a();
}

export function otherCaller(): number {
  return d();
}

export function greet(): string {
  return "main";
}
