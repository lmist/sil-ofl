<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Application contract

`INVARIANTS.md` is binding for every code, test, schema, documentation, and
configuration change in this repository.

- Read `INVARIANTS.md` before changing application behavior.
- Preserve every invariant unless the product contract is intentionally changed.
- An intentional contract change must update the invariant, its enforcement
  references, and its regression tests in the same commit.
- A missing test does not waive an invariant.
- Do not merge a change while a known invariant violation remains untracked.
