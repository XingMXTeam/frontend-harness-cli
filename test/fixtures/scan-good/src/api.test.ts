import { test } from "node:test";
import assert from "node:assert";
import { renderSummary } from "./api.ts";

test("renderSummary escapes nothing and joins fields", () => {
  assert.equal(renderSummary({ fields: ["a", "b"] }), "<div>a</div><div>b</div>");
});
