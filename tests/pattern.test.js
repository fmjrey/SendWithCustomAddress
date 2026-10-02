// pattern.test.js
// run with `node --test`
// or
// `node --test --experimental-test-tag-filter="smoke"`
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { globToRegex, compilePattern, createValidator } from "../pattern.js";

describe("pattern", () => {
  // ─── globToRegex ──────────────────────────────────────────────────────────────

  describe("globToRegex", () => {
    test("* matches anything except /", () => {
      const re = globToRegex("*.txt");
      assert.ok(re.test("foo.txt"));
      assert.ok(re.test("a.txt"));
      assert.ok(!re.test("foo/bar.txt"));
      assert.ok(!re.test("foo"));
    });

    test("** matches anything including /", () => {
      const re = globToRegex("**.txt");
      assert.ok(re.test("foo.txt"));
      assert.ok(re.test("a/b/c.txt"));
    });

    test("**/ matches zero or more leading path segments", () => {
      const re = globToRegex("**/foo.txt");
      assert.ok(re.test("foo.txt"));
      assert.ok(re.test("a/foo.txt"));
      assert.ok(re.test("a/b/c/foo.txt"));
      assert.ok(!re.test("bar.txt"));
    });

    test("? matches exactly one non-/ character", () => {
      const re = globToRegex("f?o");
      assert.ok(re.test("foo"));
      assert.ok(re.test("fao"));
      assert.ok(!re.test("fo"));
      assert.ok(!re.test("f/o"));
    });

    test("character class [abc]", () => {
      const re = globToRegex("[abc]at");
      assert.ok(re.test("cat"));
      assert.ok(re.test("bat"));
      assert.ok(!re.test("dat"));
    });

    test("character class range [a-z]", () => {
      const re = globToRegex("[a-z]oo");
      assert.ok(re.test("boo"));
      assert.ok(re.test("Boo"));
      assert.ok(!re.test("1oo"));
    });

    test("negated character class [!abc]", () => {
      const re = globToRegex("[!abc]at");
      assert.ok(re.test("dat"));
      assert.ok(!re.test("cat"));
    });

    test("brace expansion {a,b,c}", () => {
      const re = globToRegex("*.{com,org,net}");
      assert.ok(re.test("x.com"));
      assert.ok(re.test("x.org"));
      assert.ok(re.test("x.net"));
      assert.ok(!re.test("x.edu"));
    });

    test("brace expansion with single part throws", () => {
      assert.throws(() => globToRegex("{a}"), /at least 2 alternatives/);
    });

    test("escape with backslash", () => {
      const re = globToRegex("a\\.txt");
      assert.ok(re.test("a.txt"));
      assert.ok(!re.test("aXtxt"));
    });

    test("dangling escape throws", () => {
      assert.throws(() => globToRegex("foo\\"), /Dangling escape/);
    });

    test("unbalanced [ throws", () => {
      assert.throws(() => globToRegex("a[unclosed"), /Unbalanced/);
    });

    test("unbalanced { throws", () => {
      assert.throws(() => globToRegex("{a,b"), /Unclosed/);
    });

    test("extglob at start throws", () => {
      assert.throws(() => globToRegex("?(foo)"), /Extglob/);
      assert.throws(() => globToRegex("+(foo)"), /Extglob/);
      assert.throws(() => globToRegex("!(foo)"), /Extglob/);
      assert.throws(() => globToRegex("*(foo)"), /Extglob/);
      assert.throws(() => globToRegex("@(foo)"), /Extglob/);
    });

    test("result is case-insensitive", () => {
      const re = globToRegex("*.TXT");
      assert.ok(re.test("foo.txt"));
      assert.ok(re.test("FOO.TXT"));
    });

    test("result is not global (no lastIndex state)", () => {
      const re = globToRegex("abc");
      assert.equal(re.flags.includes("g"), false);
      // Repeated .test() should always give same result
      assert.ok(re.test("abc"));
      assert.ok(re.test("abc"));
    });

    test("literal regex metacharacters are escaped", () => {
      const re = globToRegex("a.b");
      assert.ok(re.test("a.b"));
      assert.ok(!re.test("axb"));
    });

    test("empty glob matches empty string", () => {
      const re = globToRegex("");
      assert.ok(re.test(""));
      assert.ok(!re.test("a"));
    });
  });

  // ─── compilePattern ──────────────────────────────────────────────────────────

  describe("compilePattern", () => {
    test("empty string → none", () => {
      const r = compilePattern("");
      assert.deepEqual(r, {
        valid: true,
        type: "none",
        ...compilePattern(""),
        regex: null,
      });
    });

    test("whitespace only → none", () => {
      const r = compilePattern("   ");
      assert.equal(r.valid, true);
      assert.equal(r.type, "none");
    });

    test("valid glob", () => {
      const r = compilePattern("*.txt");
      assert.equal(r.valid, true);
      assert.equal(r.type, "glob");
      assert.equal(r.pattern, "*.txt");
      assert.ok(r.regex instanceof RegExp);
    });

    test("valid regex with re: prefix", () => {
      const r = compilePattern("re:^\\d{3}$");
      assert.equal(r.valid, true);
      assert.equal(r.type, "regex");
      assert.equal(r.pattern, "re:^\\d{3}$");
      assert.ok(r.regex.test("123"));
      assert.ok(!r.regex.test("12"));
    });

    test("re: with empty body", () => {
      const r = compilePattern("re:");
      assert.equal(r.valid, false);
      assert.match(r.error, /Empty regex/);
    });

    test("re: with invalid regex", () => {
      const r = compilePattern("re:[unclosed");
      assert.equal(r.valid, false);
      assert.match(r.error, /Invalid regex/);
    });

    test("re: with slash in body (lastIndexOf)", () => {
      const r = compilePattern("re:a/b");
      assert.equal(r.valid, true);
      assert.ok(r.regex.test("a/b"));
    });

    test("re: with flags", () => {
      const r = compilePattern("re:abc/m");
      assert.equal(r.valid, true);
      assert.equal(r.regex.flags, "m");
    });

    test("re: with g flag treated as body (not a flag)", () => {
      const r = compilePattern("re:abc/g");
      assert.equal(r.valid, true);
      assert.ok(r.regex.test("abc/g"));
      assert.ok(!r.regex.test("abc"));
    });

    test("re: with y flag treated as body (not a flag)", () => {
      const r = compilePattern("re:abc/y");
      assert.equal(r.valid, true);
      assert.ok(r.regex.test("abc/y"));
      assert.ok(!r.regex.test("abc"));
    });

    test("re: with unknown flag treated as body (not a flag)", () => {
      const r = compilePattern("re:abc/x");
      assert.equal(r.valid, true);
      assert.ok(r.regex.test("abc/x"));
      assert.ok(!r.regex.test("abc"));
    });

    test("glob with invalid syntax", () => {
      const r = compilePattern("a[unclosed");
      assert.equal(r.valid, false);
      assert.match(r.error, /Invalid glob/);
    });
  });

  // ─── createValidator ──────────────────────────────────────────────────────────

  describe("createValidator", { tags: ["smoke"] }, () => {
    test("single pattern, validWhenMatch=true, match", () => {
      const v = createValidator([
        {
          ...compilePattern("re:^\\d+$"),
          validWhenMatch: true,
          invalidMessage: "Not a number",
        },
      ]);
      const r = v("123");
      assert.deepEqual(r, { value: "123", valid: true, message: null });
    });

    test("single pattern, validWhenMatch=true, no match", () => {
      const v = createValidator([
        {
          ...compilePattern("re:^\\d+$"),
          validWhenMatch: true,
          invalidMessage: "Not a number",
        },
      ]);
      const r = v("abc");
      assert.deepEqual(r, {
        value: "abc",
        valid: false,
        message: "Not a number",
      });
    });

    test("single pattern, validWhenMatch=false, no match → valid", () => {
      const v = createValidator([
        {
          ...compilePattern("re:.*bad.*"),
          validWhenMatch: false,
          invalidMessage: "Contains 'bad'",
        },
      ]);
      const r = v("hello");
      assert.equal(r.valid, true);
    });

    test("single pattern, validWhenMatch=false, match → invalid", () => {
      const v = createValidator([
        {
          ...compilePattern("re:.*bad.*"),
          validWhenMatch: false,
          invalidMessage: "Contains 'bad'",
        },
      ]);
      const r = v("this is bad");
      assert.deepEqual(r, {
        value: "this is bad",
        valid: false,
        message: "Contains 'bad'",
      });
    });

    test("AND mode: default, all pass", () => {
      const descriptors = [
        {
          ...compilePattern("re:.{8,}"),
          validWhenMatch: true,
          invalidMessage: "Too short",
        },
        {
          ...compilePattern("re:[0-9]"),
          validWhenMatch: true,
          invalidMessage: "No digit",
        },
      ];
      const v1 = createValidator(descriptors);
      assert.equal(v1("abcdefgh1").valid, true);
      assert.equal(v1("abcdefghi").valid, false);
      assert.equal(v1("abcdefg").valid, false);
      assert.equal(v1("abcdef1").valid, false);
      const v2 = createValidator(descriptors, { satisfy: "all" });
      assert.equal(v2("abcdefgh1").valid, true);
      assert.equal(v2("abcdefghi").valid, false);
      assert.equal(v2("abcdefg").valid, false);
      assert.equal(v2("abcdef1").valid, false);
    });

    test("AND mode: first failure short-circuits", () => {
      const v = createValidator(
        [
          {
            ...compilePattern("re:.{8,}"),
            validWhenMatch: true,
            invalidMessage: "Too short",
          },
          {
            ...compilePattern("re:[0-9]"),
            validWhenMatch: true,
            invalidMessage: "No digit",
          },
        ],
        { satisfy: "all" },
      );
      const r = v("abc");
      assert.equal(r.valid, false);
      assert.equal(r.message, "Too short"); // first failure, not "No digit"
    });

    test("OR mode: one passes", () => {
      const v = createValidator(
        [
          {
            ...compilePattern("re:[0-9]"),
            validWhenMatch: true,
            invalidMessage: "No digit",
          },
          {
            ...compilePattern("re:[!@#$]"),
            validWhenMatch: true,
            invalidMessage: "No special",
          },
        ],
        { satisfy: "any" },
      );
      assert.equal(v("abc1").valid, true);
    });

    test("OR mode: none pass yields multiline message", () => {
      const v = createValidator(
        [
          {
            ...compilePattern("re:[0-9]"),
            validWhenMatch: true,
            invalidMessage: "No digit",
          },
          {
            ...compilePattern("re:[!@#$]"),
            validWhenMatch: true,
            invalidMessage: "No special",
          },
        ],
        { satisfy: "any" },
      );
      const r = v("abc");
      assert.equal(r.valid, false);
      assert.equal(r.message, "No digit\nNo special");
    });

    test("null/empty invalidMessage is handled", () => {
      const v = createValidator(
        [
          {
            ...compilePattern("re:[0-9]"),
            validWhenMatch: true,
            invalidMessage: null,
          },
          {
            ...compilePattern("re:[!@#$]"),
            validWhenMatch: true,
            invalidMessage: "No special",
          },
        ],
        { satisfy: "any" },
      );
      const r = v("abc");
      assert.equal(r.valid, false);
      assert.ok(r.message.endsWith("No special"));
    });

    test("messages all null yields default messages", () => {
      const p1 = "re:[0-9]";
      const p2 = "re:[!@#$]";
      const v = createValidator(
        [
          { ...compilePattern(p1), validWhenMatch: true, invalidMessage: null },
          { ...compilePattern(p2), validWhenMatch: true, invalidMessage: "" },
        ],
        { satisfy: "any" },
      );
      const r = v("abc");
      assert.equal(r.valid, false);
      const i1 = r.message.indexOf(p1);
      const i2 = r.message.indexOf(p2);
      assert.ok(
        i1 >= 0 && i2 > i1,
        `Expected "${p1}" before "${p2}" in "${r}"`,
      );
    });

    describe("skipInvalid", () => {
      test("true skips bad patterns and logs", () => {
        const logs = [];
        const v = createValidator(
          [
            {
              ...compilePattern("re:[broken"),
              validWhenMatch: true,
              invalidMessage: "Bad",
            },
            {
              ...compilePattern("*@ok.com"),
              validWhenMatch: true,
              invalidMessage: "No match",
            },
          ],
          { skipInvalid: true, log: (msg) => logs.push(msg) },
        );
        // Valid pattern still enforced:
        assert.strictEqual(v("a@ok.com").valid, true);
        assert.strictEqual(v("a@bad.com").valid, false);
        assert.strictEqual(v("a@bad.com").message, "No match");
        // Invalid pattern was skipped and logged:
        assert.strictEqual(logs.length, 1);
        assert.ok(logs[0].includes("skipped"));
        assert.ok(logs[0].includes("re:[broken"));
      });

      test("true, all patterns invalid → permissive", () => {
        const logs = [];
        const v = createValidator(
          [
            {
              ...compilePattern("re:[broken"),
              validWhenMatch: true,
              invalidMessage: "x",
            },
            {
              ...compilePattern("re:(bad"),
              validWhenMatch: false,
              invalidMessage: "y",
            },
          ],
          { skipInvalid: true, log: (msg) => logs.push(msg) },
        );
        // Nothing left → always valid:
        assert.strictEqual(v("anything@x.com").valid, true);
        assert.strictEqual(logs.length, 2);
      });

      test("false (default) throws on invalid pattern", () => {
        assert.throws(
          () =>
            createValidator([
              {
                ...compilePattern("re:[broken"),
                validWhenMatch: true,
                invalidMessage: "x",
              },
            ]),
          /Invalid pattern/,
        );
      });
    });

    test("invalid pattern string throws at factory time", () => {
      assert.throws(
        () =>
          createValidator([
            {
              ...compilePattern("re:[unclosed"),
              validWhenMatch: true,
              invalidMessage: "err",
            },
          ]),
        /Invalid regex/,
      );
    });

    test("invalid pattern ignored with skipInvalid", () => {
      const descriptors = [
        {
          ...compilePattern("re:.{8,7}"),
          validWhenMatch: true,
          invalidMessage: "Too short",
        },
        {
          ...compilePattern("re:[0-9]"),
          validWhenMatch: true,
          invalidMessage: "No digit",
        },
      ];
      const v1 = createValidator(descriptors, { skipInvalid: true });
      assert.equal(v1("abcdefgh1").valid, true);
      assert.equal(v1("abcdefghi").valid, false);
      assert.equal(v1("abcdef").valid, false);
      assert.equal(v1("abcde1").valid, true);
      const v2 = createValidator(descriptors, {
        satisfy: "any",
        skipInvalid: true,
      });
      assert.equal(v2("abcdefgh1").valid, true);
      assert.equal(v2("abcdefghi").valid, false);
      assert.equal(v2("abcdef").valid, false);
      assert.equal(v2("abcde1").valid, true);
    });

    test("when all patterns are none or invalid and ignored it validates all input", () => {
      const descriptors = [
        {
          ...compilePattern("re:.{8,2}"),
          validWhenMatch: true,
          invalidMessage: "Too short",
        },
        {
          ...compilePattern("re:[0-9"),
          validWhenMatch: true,
          invalidMessage: "No digit",
        },
        {
          ...compilePattern(""),
          validWhenMatch: true,
          invalidMessage: "",
        },
      ];
      const v1 = createValidator(descriptors, { skipInvalid: true });
      assert.equal(v1("abcdefgh1").valid, true);
      assert.equal(v1("abcdefghi").valid, true);
      assert.equal(v1("abcdefg").valid, true);
      assert.equal(v1("abcdef1").valid, true);
      assert.equal(v1("").valid, true);
      assert.equal(v1(undefined).valid, true);
      assert.equal(v1(null).valid, true);
      const v2 = createValidator(descriptors, {
        satisfy: "any",
        skipInvalid: true,
      });
      assert.equal(v2("abcdefgh1").valid, true);
      assert.equal(v2("abcdefghi").valid, true);
      assert.equal(v2("abcdefg").valid, true);
      assert.equal(v2("abcdef1").valid, true);
      assert.equal(v2("").valid, true);
      assert.equal(v2(undefined).valid, true);
      assert.equal(v2(null).valid, true);
    });

    test("glob pattern works in validator", () => {
      const v = createValidator([
        {
          ...compilePattern("*@gmail.com"),
          validWhenMatch: true,
          invalidMessage: "Not a gmail address",
        },
      ]);
      assert.equal(v("foo@gmail.com").valid, true);
      assert.equal(v("foo@other.com").valid, false);
    });
  });
});
