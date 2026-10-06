// message.test.js
// run with `node --test`
// or
// `node --test --experimental-test-tag-filter="smoke"`
import { test, describe } from "node:test";
import assert from "node:assert";
import {
  defaultParse,
  extractMailboxes,
  normalizeRecipient,
  normalizeRecipients,
  addRaw,
  mailboxToString,
} from "../message.js";

describe("defaultParse", () => {
  test("bare address", () => {
    assert.deepStrictEqual(defaultParse("john@example.com"), [
      { email: "john@example.com", name: "", raw: "john@example.com" },
    ]);
  });

  test("unquoted name with address", () => {
    assert.deepStrictEqual(defaultParse("John Doe <john@example.com>"), [
      {
        email: "john@example.com",
        name: "John Doe",
        raw: "John Doe <john@example.com>",
      },
    ]);
  });

  test("quoted name with comma", () => {
    assert.deepStrictEqual(defaultParse('"Doe, John" <john@example.com>'), [
      {
        email: "john@example.com",
        name: "Doe, John",
        raw: '"Doe, John" <john@example.com>',
      },
    ]);
  });

  test("quoted name with escaped quote", () => {
    assert.deepStrictEqual(defaultParse('"She said \\"hi\\"" <x@y.com>'), [
      {
        email: "x@y.com",
        name: 'She said "hi"',
        raw: '"She said \\"hi\\"" <x@y.com>',
      },
    ]);
  });

  test("multiple addresses in one string", () => {
    assert.deepStrictEqual(
      defaultParse(
        'John <john@example.com>, jane@example.com, "Doe, Jane" <jane.d@example.com>',
      ),
      [
        {
          email: "john@example.com",
          name: "John",
          raw: "John <john@example.com>",
        },
        { email: "jane@example.com", name: "", raw: "jane@example.com" },
        {
          email: "jane.d@example.com",
          name: "Doe, Jane",
          raw: '"Doe, Jane" <jane.d@example.com>',
        },
      ],
    );
  });

  test("unparseable string returns empty", () => {
    assert.deepStrictEqual(defaultParse("this is not an email"), []);
  });

  test("empty string returns empty", () => {
    assert.deepStrictEqual(defaultParse(""), []);
  });

  test("address with plus (subaddressing)", () => {
    assert.deepStrictEqual(defaultParse("user+netflix@mydomain.com"), [
      {
        email: "user+netflix@mydomain.com",
        name: "",
        raw: "user+netflix@mydomain.com",
      },
    ]);
  });

  test("name with dots and spaces", () => {
    assert.deepStrictEqual(defaultParse("Dr. Jane O'Brien <jane@x.com>"), [
      {
        email: "jane@x.com",
        name: "Dr. Jane O'Brien",
        raw: "Dr. Jane O'Brien <jane@x.com>",
      },
    ]);
  });
});

describe("extractMailboxes", () => {
  test("extracts from x-original-to", async () => {
    const headers = {
      "x-original-to": ["user+netflix@mydomain.com"],
      to: ["user+netflix@mydomain.com"],
      from: ["Netflix <notifications@netflix.com>"],
    };
    const result = await extractMailboxes(headers, ["x-original-to"]);
    assert.deepStrictEqual(result, [
      { email: "user+netflix@mydomain.com", name: "" },
    ]);
  });

  test("parses display name format", async () => {
    const headers = {
      to: ["John Doe <john@example.com>, jane@example.com"],
    };
    const result = await extractMailboxes(headers, ["to"]);
    assert.deepStrictEqual(result, [
      { email: "john@example.com", name: "John Doe" },
      { email: "jane@example.com", name: "" },
    ]);
  });

  test("multiple headers, deduplicated", async () => {
    const headers = {
      "x-original-to": ["user+netflix@mydomain.com"],
      "delivered-to": ["user+netflix@mydomain.com"],
      to: ["user+netflix@mydomain.com"],
    };
    const result = await extractMailboxes(headers, [
      "x-original-to",
      "delivered-to",
      "to",
    ]);
    assert.deepStrictEqual(result, [
      { email: "user+netflix@mydomain.com", name: "" },
    ]);
  });

  test("missing header returns empty", async () => {
    const headers = { from: ["a@b.com"] };
    assert.deepStrictEqual(
      await extractMailboxes(headers, ["x-original-to"]),
      [],
    );
  });

  test("multiple values in one header (array)", async () => {
    const headers = {
      "delivered-to": ["first@x.com", "second@x.com"],
    };
    const result = await extractMailboxes(headers, ["delivered-to"]);
    assert.deepStrictEqual(result, [
      { email: "first@x.com", name: "" },
      { email: "second@x.com", name: "" },
    ]);
  });

  test("custom parseFn is used", async () => {
    const mockParse = (str) => ({ email: str.trim(), name: "Mock" });
    const headers = { to: ["test@x.com"] };
    const result = await extractMailboxes(headers, ["to"], mockParse);
    assert.deepStrictEqual(result, [{ email: "test@x.com", name: "Mock" }]);
  });
  describe("failed match contributes nothing", () => {
    test("unparseable header value is skipped, valid ones still extracted", async () => {
      const headers = {
        to: ["not an email at all", "valid@example.com"],
        from: ["Sender <sender@x.com>"],
      };
      const result = await extractMailboxes(headers, ["to", "from"]);
      assert.deepStrictEqual(result, [
        { email: "valid@example.com", name: "" },
        { email: "sender@x.com", name: "Sender" },
      ]);
    });

    test("all values unparseable returns empty", async () => {
      const headers = {
        to: ["garbage", "more garbage"],
      };
      const result = await extractMailboxes(headers, ["to"]);
      assert.deepStrictEqual(result, []);
    });

    test("unparseable value does not pollute dedup map", async () => {
      // "valid@example.com" appears once as parseable, once embedded in garbage.
      // The garbage should not create a phantom entry.
      const headers = {
        to: ["valid@example.com"],
        cc: ["prefix valid@example.com suffix"], // ambiguous — may or may not match
      };
      const result = await extractMailboxes(headers, ["to", "cc"]);
      // "valid@example.com" should appear exactly once (deduped):
      const matches = result.filter((m) => m.email === "valid@example.com");
      assert.strictEqual(matches.length, 1);
    });
  });
});

describe("normalizeRecipient", () => {
  describe("string form", () => {
    test("bare address", async () => {
      const result = await normalizeRecipient("a@x.com");
      assert.deepStrictEqual(result, [
        { email: "a@x.com", name: "", raw: "a@x.com" },
      ]);
    });

    test("name with address", async () => {
      const result = await normalizeRecipient("John <john@x.com>");
      assert.deepStrictEqual(result, [
        { email: "john@x.com", name: "John", raw: "John <john@x.com>" },
      ]);
    });

    test("multiple addresses in one string: raw is empty", async () => {
      const result = await normalizeRecipient("A <a@x.com>, B <b@x.com>");
      assert.deepStrictEqual(result, [
        { email: "a@x.com", name: "A", raw: "" },
        { email: "b@x.com", name: "B", raw: "" },
      ]);
    });

    test("quoted name with comma", async () => {
      const result = await normalizeRecipient('"Doe, John" <john@x.com>');
      assert.deepStrictEqual(result, [
        {
          email: "john@x.com",
          name: "Doe, John",
          raw: '"Doe, John" <john@x.com>',
        },
      ]);
    });

    test("unparseable string returns empty", async () => {
      const result = await normalizeRecipient("not an email");
      assert.deepStrictEqual(result, []);
    });
  });

  describe("object form", () => {
    test("contact with resolveFn", async () => {
      const resolveFn = async (id) => ({
        email: "resolved@x.com",
        name: "Resolved",
      });
      const result = await normalizeRecipient(
        { nodeId: "abc", type: "contact" },
        null,
        resolveFn,
      );
      assert.deepStrictEqual(result, [
        {
          email: "resolved@x.com",
          name: "Resolved",
          isList: false,
          nodeId: "abc",
        },
      ]);
    });

    test("mailingList with resolveFn", async () => {
      const resolveFn = async (id) => ({ email: "My Team", name: "My Team" });
      const result = await normalizeRecipient(
        { nodeId: "My Team", type: "mailingList" },
        null,
        resolveFn,
      );
      assert.deepStrictEqual(result, [
        { email: "My Team", name: "My Team", isList: true, nodeId: "My Team" },
      ]);
    });

    test("contact without resolveFn (passthrough)", async () => {
      const result = await normalizeRecipient({
        nodeId: "abc123",
        type: "contact",
      });
      assert.deepStrictEqual(result, [
        { email: "abc123", name: "", isList: false, nodeId: "abc123" },
      ]);
    });

    test("mailingList without resolveFn (passthrough)", async () => {
      const result = await normalizeRecipient({
        nodeId: "My Team",
        type: "mailingList",
      });
      assert.deepStrictEqual(result, [
        { email: "My Team", name: "", isList: true, nodeId: "My Team" },
      ]);
    });
  });
});

describe("normalizeRecipients", () => {
  test("multiple string recipients", async () => {
    const result = await normalizeRecipients(["a@x.com", "John <b@x.com>"]);
    assert.deepStrictEqual(result, [
      { email: "a@x.com", name: "", raw: "a@x.com" },
      { email: "b@x.com", name: "John", raw: "John <b@x.com>" },
    ]);
  });

  test("string recipients, deduplicated with full name", async () => {
    const recipients = ["a@x.com", "John <a@x.com>"];
    const result = await normalizeRecipients(recipients);
    assert.deepStrictEqual(result, [
      { email: "a@x.com", name: "John", raw: "John <a@x.com>" },
    ]);
  });

  test("object recipients for a mailing list without resolveFn (passthrough)", async () => {
    const recipients = [{ nodeId: "My Team", type: "mailingList" }];
    const result = await normalizeRecipients(recipients);
    assert.deepStrictEqual(result, [
      { email: "My Team", name: "", isList: true, nodeId: "My Team" },
    ]);
  });

  test("object recipients for a contact without resolveFn (passthrough)", async () => {
    const recipients = [{ nodeId: "abc123", type: "contact" }];
    const result = await normalizeRecipients(recipients);
    assert.deepStrictEqual(result, [
      { email: "abc123", name: "", isList: false, nodeId: "abc123" },
    ]);
  });

  test("mixed string and object without resolveFn", async () => {
    const recipients = ["a@x.com", { nodeId: "My Team", type: "mailingList" }];
    const result = await normalizeRecipients(recipients);
    assert.deepStrictEqual(result, [
      { email: "a@x.com", name: "", raw: "a@x.com" },
      { email: "My Team", name: "", isList: true, nodeId: "My Team" },
    ]);
  });

  test("object recipients with resolveFn", async () => {
    const resolveFn = async (id) => ({
      email: "resolved@x.com",
      name: "Resolved",
    });
    const result = await normalizeRecipients(
      [{ nodeId: "abc123", type: "contact" }],
      null,
      resolveFn,
    );
    assert.deepStrictEqual(result, [
      {
        email: "resolved@x.com",
        name: "Resolved",
        isList: false,
        nodeId: "abc123",
      },
    ]);
  });

  test("mixed string and object with resolveFn", async () => {
    const resolveFn = async (id) => ({ email: "resolved@x.com", name: "R" });
    const result = await normalizeRecipients(
      ["a@x.com", { nodeId: "abc", type: "contact" }],
      undefined,
      resolveFn,
    );
    assert.deepStrictEqual(result, [
      { email: "a@x.com", name: "", raw: "a@x.com" },
      { email: "resolved@x.com", name: "R", isList: false, nodeId: "abc" },
    ]);
  });

  test("null/undefined returns empty", async () => {
    assert.deepStrictEqual(await normalizeRecipients(null), []);
    assert.deepStrictEqual(await normalizeRecipients(undefined), []);
  });

  test("empty array returns empty", async () => {
    assert.deepStrictEqual(await normalizeRecipients([]), []);
  });

  test("multi-address string + dedup with another recipient", async () => {
    const result = await normalizeRecipients([
      "A <a@x.com>, B <b@x.com>",
      "a@x.com",
    ]);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].email, "a@x.com");
    assert.strictEqual(result[1].email, "b@x.com");
  });
});

describe("addRaw", () => {
  test("single result: raw is the input string", () => {
    const parsed = { email: "x@y.com", name: "X" };
    const result = addRaw(parsed, "X <x@y.com>");
    assert.deepStrictEqual(result, [
      { email: "x@y.com", name: "X", raw: "X <x@y.com>" },
    ]);
  });

  test("single result, no name: name is empty string", () => {
    const parsed = { email: "x@y.com" };
    const result = addRaw(parsed, "x@y.com");
    assert.deepStrictEqual(result, [
      { email: "x@y.com", name: "", raw: "x@y.com" },
    ]);
  });

  test("multiple results: raw is empty for all", () => {
    const parsed = [{ email: "a@x.com", name: "A" }, { email: "b@x.com" }];
    const result = addRaw(parsed, "A <a@x.com>, b@x.com");
    assert.deepStrictEqual(result, [
      { email: "a@x.com", name: "A", raw: "" },
      { email: "b@x.com", name: "", raw: "" },
    ]);
  });

  test("array with one element: treated as single", () => {
    const parsed = [{ email: "x@y.com", name: "X" }];
    const result = addRaw(parsed, "X <x@y.com>");
    assert.deepStrictEqual(result, [
      { email: "x@y.com", name: "X", raw: "X <x@y.com>" },
    ]);
  });
});

describe("mailboxToString", () => {
  test("raw present: returned as-is", () => {
    const m = { email: "x@y.com", name: "X", raw: "X <x@y.com>" };
    assert.strictEqual(mailboxToString(m), "X <x@y.com>");
  });

  test("no name: bare email", () => {
    const m = { email: "x@y.com", name: "", raw: "" };
    assert.strictEqual(mailboxToString(m), "x@y.com");
  });

  test("name without special chars: unquoted", () => {
    const m = { email: "x@y.com", name: "John Doe", raw: "" };
    assert.strictEqual(mailboxToString(m), "John Doe <x@y.com>");
  });

  test("name with comma: quoted", () => {
    const m = { email: "x@y.com", name: "Doe, John", raw: "" };
    assert.strictEqual(mailboxToString(m), '"Doe, John" <x@y.com>');
  });

  test("name with double quote: quoted and escaped", () => {
    const m = { email: "x@y.com", name: 'She said "hi"', raw: "" };
    assert.strictEqual(mailboxToString(m), '"She said \\"hi\\"" <x@y.com>');
  });

  test("name with angle bracket: quoted", () => {
    const m = { email: "x@y.com", name: "A <B>", raw: "" };
    assert.strictEqual(mailboxToString(m), '"A <B>" <x@y.com>');
  });

  test("name with semicolon: quoted", () => {
    const m = { email: "x@y.com", name: "Dr; Smith", raw: "" };
    assert.strictEqual(mailboxToString(m), '"Dr; Smith" <x@y.com>');
  });

  test("name with colon: quoted", () => {
    const m = { email: "x@y.com", name: "Smith: MD", raw: "" };
    assert.strictEqual(mailboxToString(m), '"Smith: MD" <x@y.com>');
  });

  test("name with only spaces and letters: not quoted", () => {
    const m = { email: "x@y.com", name: "Jean-Pierre Dupont", raw: "" };
    assert.strictEqual(mailboxToString(m), "Jean-Pierre Dupont <x@y.com>");
  });
});
