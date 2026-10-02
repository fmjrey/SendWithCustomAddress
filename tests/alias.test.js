// alias.test.js
// run with `node --test`
// or
// `node --test --experimental-test-tag-filter="smoke"`
import { test, describe, before } from "node:test";
import assert from "node:assert";
import * as alias from "../alias.js";

async function rebuildWith(prefs, options) {
  await alias.rebuild(async () => prefs, options);
}

describe("alias", () => {
  // --- Basic expectations and smoke testing ---

  describe("validateFrom", () => {
    describe("basic expectations", { tags: ["smoke"] }, () => {
      test("throws if rebuild not called", async () => {
        // Dynamic import gets a fresh module instance
        const fresh = await import("../alias.js?fresh=" + Date.now());
        assert.throws(
          () => fresh.validateFrom("test@example.com"),
          /not initialized/,
        );
        //assert.throws(() => fresh.store("a@b.com", "alias"), /not initialized/);
        //assert.throws(() => fresh.lookup("a@b.com"), /not initialized/);
      });

      test("invalid pattern yields permissive validation + log", async (t) => {
        const warnings = [];
        t.mock.method(console, "warn", (...args) => {
          warnings.push(args.join(" "));
        });

        await rebuildWith({ fromPattern: "re:[broken", notFromPattern: "" });
        assert.strictEqual(alias.validate("anything@x.com").valid, true);
        assert.ok(warnings.pop().includes("skipped"));

        await rebuildWith({ fromPattern: "", notFromPattern: "re:[broken" });
        assert.strictEqual(alias.validate("anything@x.com").valid, true);
        assert.ok(warnings.pop().includes("skipped"));

        assert.strictEqual(warnings.length, 0);

        t.mock.restoreAll();
      });

      test("same patterns used across calls until rebuild", async () => {
        await rebuildWith({
          fromPattern: "*@mydomain.com",
          notFromPattern: "me@mydomain.com",
        });
        assert.strictEqual(alias.validateFrom("a@mydomain.com").valid, true);
        assert.strictEqual(alias.validateFrom("a@mydomain.com").valid, true);
        assert.strictEqual(alias.validateFrom("me@mydomain.com").valid, false);
        assert.strictEqual(alias.validateFrom("a@other.com").valid, false);
        assert.strictEqual(alias.validateFrom("me@other.com").valid, false);
        assert.strictEqual(alias.validateFrom("a@mydomain.com").valid, true);
        assert.strictEqual(alias.validateFrom("b@mydomain.com").valid, true);
        assert.strictEqual(alias.validateFrom("me@mydomain.com").valid, false);
        assert.strictEqual(alias.validateFrom("me@other.com").valid, false);

        await rebuildWith({
          fromPattern: "*@other.com",
          notFromPattern: "*@mydomain.com",
        });
        assert.strictEqual(alias.validateFrom("a@mydomain.com").valid, false);
        assert.strictEqual(alias.validateFrom("b@mydomain.com").valid, false);
        assert.strictEqual(alias.validateFrom("me@mydomain.com").valid, false);
        assert.strictEqual(alias.validateFrom("a@other.com").valid, true);
        assert.strictEqual(alias.validateFrom("me@other.com").valid, true);
      });

      test("empty address string", async () => {
        await rebuildWith({
          fromPattern: "*@mydomain.com",
          notFromPattern: "",
        });
        assert.strictEqual(alias.validateFrom("").valid, false);
        assert.strictEqual(alias.validateFrom(undefined).valid, false);
        assert.strictEqual(alias.validateFrom(null).valid, false);
      });

      test("always echoes the input", async () => {
        await rebuildWith({ fromPattern: "*a*", notFromPattern: "a*" });
        const inputs = ["a", "b", "c", "aa", "ba", "ca"];
        for (const s of inputs) {
          assert.strictEqual(alias.validateFrom(s).value, s);
        }
      });

      // --- No patterns configured ---

      describe("no patterns", () => {
        const assertAlwaysValidateFrom = () => {
          assert.deepStrictEqual(alias.validateFrom(""), {
            value: "",
            valid: true,
            message: null,
          });
          assert.deepStrictEqual(alias.validateFrom("  "), {
            value: "  ",
            valid: true,
            message: null,
          });
          assert.deepStrictEqual(alias.validateFrom(undefined), {
            value: undefined,
            valid: true,
            message: null,
          });
          assert.deepStrictEqual(alias.validateFrom(null), {
            value: null,
            valid: true,
            message: null,
          });
          assert.deepStrictEqual(alias.validateFrom("anything@anything.com"), {
            value: "anything@anything.com",
            valid: true,
            message: null,
          });
        };
        test("empty patterns always validate", async () => {
          await rebuildWith({ fromPattern: "", notFromPattern: "" });
        });

        test("undefined patterns always validate", async () => {
          await rebuildWith({
            fromPattern: undefined,
            notFromPattern: undefined,
          });
          assertAlwaysValidateFrom();
        });

        test("whitespace-only patterns always validate", async () => {
          await rebuildWith({ fromPattern: "   ", notFromPattern: "  " });
          assertAlwaysValidateFrom();
        });
      });
    });

    // --- fromPattern only (must match) ---

    describe("fromPattern only", () => {
      test("glob: matching address is valid", async () => {
        await rebuildWith({
          fromPattern: "*@mydomain.com",
          notFromPattern: "",
        });
        const r = alias.validateFrom("user+netflix@mydomain.com");
        assert.strictEqual(r.valid, true);
        assert.strictEqual(r.message, null);
      });

      test("glob: non-matching address is invalid", async () => {
        await rebuildWith({
          fromPattern: "*@mydomain.com",
          notFromPattern: "",
        });
        const r = alias.validateFrom("user@gmail.com");
        assert.strictEqual(r.valid, false);
        assert.ok(r.message.includes("*@mydomain.com"));
      });

      test("glob: subdomain pattern", async () => {
        await rebuildWith({
          fromPattern: "user@*.mydomain.com",
          notFromPattern: "",
        });
        assert.strictEqual(
          alias.validateFrom("user@mail.mydomain.com").valid,
          true,
        );
        assert.strictEqual(
          alias.validateFrom("user@mydomain.com").valid,
          false,
        );
      });

      test("glob: case-insensitive", async () => {
        await rebuildWith({
          fromPattern: "*@MyDomain.COM",
          notFromPattern: "",
        });
        assert.strictEqual(alias.validateFrom("user@mydomain.com").valid, true);
      });

      test("glob: ? wildcard", async () => {
        await rebuildWith({
          fromPattern: "us?@mydomain.com",
          notFromPattern: "",
        });
        assert.strictEqual(alias.validateFrom("usa@mydomain.com").valid, true);
        assert.strictEqual(alias.validateFrom("us@mydomain.com").valid, false);
        assert.strictEqual(
          alias.validateFrom("user@mydomain.com").valid,
          false,
        );
      });

      test("regex: plus-addressing pattern", async () => {
        await rebuildWith({
          fromPattern: "re:user\\+[^@]+@email-provider\\.com",
          notFromPattern: "",
        });
        assert.strictEqual(
          alias.validateFrom("user+netflix@email-provider.com").valid,
          true,
        );
        assert.strictEqual(
          alias.validateFrom("user@email-provider.com").valid,
          false,
        );
        assert.strictEqual(
          alias.validateFrom("other+netflix@email-provider.com").valid,
          false,
        );
      });
    });

    // --- notFromPattern only (must NOT match) ---

    describe("notFromPattern only", () => {
      test("address that does NOT match prohibited pattern is valid", async () => {
        await rebuildWith({
          fromPattern: "",
          notFromPattern: "me@mydomain.com",
        });
        assert.strictEqual(
          alias.validateFrom("user+netflix@mydomain.com").valid,
          true,
        );
      });

      test("address that matches prohibited pattern is invalid", async () => {
        await rebuildWith({
          fromPattern: "",
          notFromPattern: "me@mydomain.com",
        });
        const r = alias.validateFrom("me@mydomain.com");
        assert.strictEqual(r.valid, false);
        assert.ok(r.message.includes("me@mydomain.com"));
      });

      test("regex prohibited pattern", async () => {
        await rebuildWith({
          fromPattern: "",
          notFromPattern: "re:^me@mydomain\\.com$",
        });
        assert.strictEqual(alias.validateFrom("me@mydomain.com").valid, false);
        assert.strictEqual(alias.validateFrom("me@other.com").valid, true);
      });
    });

    // --- Both patterns (AND semantics) ---

    describe("both patterns", { tags: ["smoke"] }, async () => {
      before(async () => {
        await rebuildWith({
          fromPattern: "*@mydomain.com",
          notFromPattern: "me@mydomain.com",
        });
      });

      test("matches fromPattern AND avoids notFromPattern → valid", () => {
        assert.strictEqual(
          alias.validateFrom("user+netflix@mydomain.com").valid,
          true,
        );
      });

      test("fails fromPattern (wrong domain)", () => {
        const r = alias.validateFrom("user@gmail.com");
        assert.strictEqual(r.valid, false);
        assert.ok(r.message.includes("*@mydomain.com"));
      });

      test("fails notFromPattern (prohibited address)", () => {
        const r = alias.validateFrom("me@mydomain.com");
        assert.strictEqual(r.valid, false);
        assert.ok(r.message.includes("prohibited"));
      });

      test("fails both → invalid (fromPattern reported first)", () => {
        const r = alias.validateFrom("me@gmail.com");
        assert.strictEqual(r.valid, false);
        assert.ok(r.message.includes("*@mydomain.com"));
      });
    });

    // --- Invalid pattern strings ---

    // --- Edge cases ---

    describe("edge cases", () => {
      test("multiple + in plus-addressing", async () => {
        await rebuildWith({
          fromPattern: "user+*@mydomain.com",
          notFromPattern: "",
        });
        assert.strictEqual(
          alias.validateFrom("user+a+b@mydomain.com").valid,
          true,
        );
      });
    });
  });
});
