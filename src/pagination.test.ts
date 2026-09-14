import test from "node:test";
import assert from "node:assert/strict";
import { pageFromWindow, paginate } from "./pagination.js";

test("pagination returns a bounded page and opaque next cursor", () => {
  const page = paginate(["a", "b", "c"], { limit: 2 });
  assert.deepEqual(page.items, ["a", "b"]);
  assert.equal(typeof page.nextCursor, "string");
  const second = paginate(["a", "b", "c"], { limit: 2, cursor: page.nextCursor });
  assert.deepEqual(second.items, ["c"]);
  assert.equal(second.nextCursor, undefined);
});

test("pagination clamps excessive limits", () => {
  const page = paginate([1, 2, 3], { limit: 9999, max: 2 });
  assert.deepEqual(page.items, [1, 2]);
  assert.equal(typeof page.nextCursor, "string");
});

test("pageFromWindow uses a prefetched limit+1 window", () => {
  const first = pageFromWindow(["a", "b", "c"], 2, 0);
  assert.deepEqual(first.items, ["a", "b"]);
  assert.equal(typeof first.nextCursor, "string");
  const second = pageFromWindow(["c"], 2, 2);
  assert.deepEqual(second.items, ["c"]);
  assert.equal(second.nextCursor, undefined);
});
