// FP-2
import { test } from "node:test";
import assert from "node:assert";
import { formatPrice } from "./format.ts";

test("formatPrice prefixes the symbol", () => {
  assert.equal(formatPrice(3.5), "$3.50");
});
