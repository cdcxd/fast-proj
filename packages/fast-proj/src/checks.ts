export function checkOut(out: ArrayLike<number>, n: number, name: string): void {
  if (out.length < n) throw new RangeError(`${name} has length ${out.length}, needs at least ${n}`);
}

export function checkEven(n: number): void {
  if (n % 2 !== 0) throw new RangeError(`interleaved input must have an even length, got ${n}`);
}

export function checkNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number') throw new TypeError(`${name} must be a number, got ${typeof value}`);
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite, got ${value}`);
}
