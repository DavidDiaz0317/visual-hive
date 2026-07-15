# Canonical repair JSON

Visual Hive repair artifacts use `visual-hive.canonical-json.sha256.v1` for identities that Hive must verify independently.

The algorithm accepts JSON values plus in-memory finite IEEE-754 numbers. It produces UTF-8 JSON with these rules:

1. Object keys are sorted by unsigned UTF-8 byte order. This is intentionally not RFC 8785 key ordering.
2. Array order is preserved.
3. Finite numbers use ECMAScript `JSON.stringify` number spelling. Negative zero becomes `0`. Non-finite numbers are rejected.
4. Strings use ECMAScript JSON escaping. `<`, `>`, and `&` are not HTML-escaped. Lone UTF-16 surrogates are rejected; valid astral characters remain valid Unicode scalar values.
5. `null` and booleans use their JSON literals. Undefined values, symbol keys, accessors, cyclic values, and non-ordinary objects are rejected by the TypeScript implementation.
6. The identity is lowercase hexadecimal SHA-256 of the exact canonical UTF-8 bytes.

Both repositories must pass the immutable vectors in [`schemas/fixtures/visual-hive.canonical-json.sha256.v1.json`](../schemas/fixtures/visual-hive.canonical-json.sha256.v1.json). A contract change requires a new algorithm identifier and new vectors; it must never reinterpret existing digests.
