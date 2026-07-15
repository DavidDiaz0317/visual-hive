import { createHash } from "node:crypto";

export type CanonicalJsonValue = null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeCanonicalJson(value, "$"));
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeCanonicalJson(value: unknown, location: string): CanonicalJsonValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    assertUnicodeScalarString(value, location);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Canonical JSON rejects a non-finite number at ${location}.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item, index) => normalizeCanonicalJson(item, `${location}[${index}]`));
  if (typeof value !== "object") throw new Error(`Canonical JSON rejects ${typeof value} at ${location}.`);

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`Canonical JSON requires an ordinary object at ${location}.`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`Canonical JSON rejects symbol keys at ${location}.`);

  const output = Object.create(null) as Record<string, CanonicalJsonValue>;
  const keys = Object.keys(value as Record<string, unknown>);
  for (const key of keys) assertUnicodeScalarString(key, `${location} key`);
  for (const key of keys.sort(stableTextCompare)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set) throw new Error(`Canonical JSON rejects accessor properties at ${location}.${key}.`);
    const child = descriptor.value;
    if (child === undefined) throw new Error(`Canonical JSON rejects undefined at ${location}.${key}.`);
    output[key] = normalizeCanonicalJson(child, `${location}.${key}`);
  }
  return output;
}

export function stableTextCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function assertUnicodeScalarString(value: string, location: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      throw new Error(`Canonical JSON rejects a lone high surrogate at ${location}.`);
    }
    if (code >= 0xdc00 && code <= 0xdfff) throw new Error(`Canonical JSON rejects a lone low surrogate at ${location}.`);
  }
}
