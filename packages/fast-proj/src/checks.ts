/** `out` once its length is checked, or a new array of n when it is not given. */
export function output<T extends Float64Array>(out: T | undefined, n: number, name: string): T {
  if (!out) return new Float64Array(n) as T;
  if (out.length < n) throw new RangeError(`fast-proj: ${name} has length ${out.length}, needs at least ${n}`);
  return out;
}

export function checkEven(n: number): void {
  if (n % 2 !== 0) throw new RangeError(`fast-proj: interleaved input must have an even length, got ${n}`);
}

export function checkSame(n: number, m: number, names: string): void {
  if (m !== n) throw new RangeError(`fast-proj: ${names} must have the same length`);
}

export function checkNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number') throw new TypeError(`fast-proj: ${name} must be a number, got ${typeof value}`);
  if (!Number.isFinite(value)) throw new RangeError(`fast-proj: ${name} must be finite, got ${value}`);
}

/** Throws for a non-object and for own keys outside `allowed`, naming the replacement of renamed ones. */
export function checkOptions(
  options: unknown,
  fn: string,
  allowed: readonly string[],
  renamed: Readonly<Record<string, string>> = {},
): asserts options is object {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError(
      `fast-proj: ${fn}() options must be an object, got ${options === null ? 'null' : typeof options}`,
    );
  }
  for (const key of Object.keys(options)) {
    if (allowed.includes(key)) continue;
    const to = Object.hasOwn(renamed, key) ? renamed[key] : undefined;
    throw new TypeError(
      to ? `fast-proj: ${key} was renamed to ${to} in 0.3.0` : `fast-proj: unknown ${fn}() option '${key}'`,
    );
  }
}
