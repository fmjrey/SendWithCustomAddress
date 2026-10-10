// message.test.js
// run with `node --test`
// or
// `node --test --experimental-test-tag-filter="smoke"`

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  ParsedRecipientType,
  stringToParsedRecipient,
  extractMailboxes,
  normalizeHeaders,
  normalizeRecipient,
  normalizeRecipients,
  parsedRecipientToString,
} from "../message.js";

/**
 * @typedef {import("../message.js").AddressFieldsSource} AddressFieldsSource
 * @typedef {import("../message.js").ComposeRecipient} ComposeRecipient
 */

describe("stringToParsedRecipient", () => {
  test("bare address", () => {
    assert.deepStrictEqual(stringToParsedRecipient("john@example.com"), [
      {
        email: "john@example.com",
        name: "",
        type: ParsedRecipientType.EMAIL,
        raw: "john@example.com",
      },
    ]);
  });

  test("unquoted name with address", () => {
    assert.deepStrictEqual(
      stringToParsedRecipient("John Doe <john@example.com>"),
      [
        {
          email: "john@example.com",
          name: "John Doe",
          type: ParsedRecipientType.EMAIL,
          raw: "John Doe <john@example.com>",
        },
      ],
    );
  });

  test("quoted name with comma", () => {
    assert.deepStrictEqual(
      stringToParsedRecipient('"Doe, John" <john@example.com>'),
      [
        {
          email: "john@example.com",
          name: "Doe, John",
          type: ParsedRecipientType.EMAIL,
          raw: '"Doe, John" <john@example.com>',
        },
      ],
    );
  });

  test("quoted name with escaped quote", () => {
    assert.deepStrictEqual(
      stringToParsedRecipient('"She said \\"hi\\"" <x@y.com>'),
      [
        {
          email: "x@y.com",
          name: 'She said "hi"',
          type: ParsedRecipientType.EMAIL,
          raw: '"She said \\"hi\\"" <x@y.com>',
        },
      ],
    );
  });

  test("multiple addresses in one string", () => {
    const raw =
      'John <john@example.com>, jane@example.com, "Doe, Jane" <jane.d@example.com>';
    assert.deepStrictEqual(stringToParsedRecipient(raw), [
      {
        email: "john@example.com",
        name: "John",
        type: ParsedRecipientType.EMAIL,
        raw,
        wasMultiple: true,
      },
      {
        email: "jane@example.com",
        name: "",
        type: ParsedRecipientType.EMAIL,
        raw,
        wasMultiple: true,
      },
      {
        email: "jane.d@example.com",
        name: "Doe, Jane",
        type: ParsedRecipientType.EMAIL,
        raw,
        wasMultiple: true,
      },
    ]);
  });

  test("unparseable string returns undefined group and email", () => {
    assert.deepStrictEqual(stringToParsedRecipient("this is not an email"), [
      { name: "this is not an email", email: undefined },
    ]);
  });

  test("empty string returns empty", () => {
    assert.deepStrictEqual(stringToParsedRecipient(""), []);
  });

  test("address with plus (subaddressing)", () => {
    assert.deepStrictEqual(
      stringToParsedRecipient("user+netflix@mydomain.com"),
      [
        {
          email: "user+netflix@mydomain.com",
          name: "",
          type: ParsedRecipientType.EMAIL,
          raw: "user+netflix@mydomain.com",
        },
      ],
    );
  });

  test("name with dots and spaces", () => {
    assert.deepStrictEqual(
      stringToParsedRecipient("Dr. Jane O'Brien <jane@x.com>"),
      [
        {
          email: "jane@x.com",
          name: "Dr. Jane O'Brien",
          type: ParsedRecipientType.EMAIL,
          raw: "Dr. Jane O'Brien <jane@x.com>",
        },
      ],
    );
  });
});

describe("normalizeHeaders", { tags: ["smoke"] }, () => {
  test("extracts mailboxes for each requested field (string[] values)", async () => {
    const source = {
      to: ["Alice <alice@example.com>", "bob@example.com"],
      cc: ["Charlie <charlie@example.com>", "not an email"],
    };
    const result = await normalizeHeaders(source, ["to", "cc"]);

    assert.deepStrictEqual(result, {
      to: [
        {
          name: "Alice",
          email: "alice@example.com",
          type: ParsedRecipientType.EMAIL,
          raw: "Alice <alice@example.com>",
        },
        {
          name: "",
          email: "bob@example.com",
          type: ParsedRecipientType.EMAIL,
          raw: "bob@example.com",
        },
      ],
      cc: [
        {
          name: "Charlie",
          email: "charlie@example.com",
          type: ParsedRecipientType.EMAIL,
          raw: "Charlie <charlie@example.com>",
        },
      ],
    });
  });

  test("handles single ComposeRecipient (non-array) value", async () => {
    const source = {
      from: "dave@example.com",
    };
    const result = await normalizeHeaders(source, ["from"]);

    assert.deepStrictEqual(result, {
      from: [
        {
          name: "",
          email: "dave@example.com",
          type: ParsedRecipientType.EMAIL,
          raw: "dave@example.com",
        },
      ],
    });
  });

  test("handles object-form ComposeRecipient without resolveFn", async () => {
    const source = /** @type {AddressFieldsSource} */ ({
      to: [{ nodeId: "node-123", type: "contact" }],
    });
    const result = await normalizeHeaders(source, ["to"]);

    assert.deepStrictEqual(result, {
      to: [
        {
          name: "",
          email: "",
          nodeId: "node-123",
          type: ParsedRecipientType.CONTACT,
        },
      ],
    });
  });

  test("handles object-form ComposeRecipient via resolveFn", async () => {
    const source = /** @type {AddressFieldsSource} */ ({
      to: [{ nodeId: "node-123", type: "contact" }],
    });
    const resolveFn = async (nodeId, type) => ({
      email: "resolved@example.com",
      name: "Resolved",
    });
    const result = await normalizeHeaders(source, ["to"], resolveFn);

    assert.deepStrictEqual(result, {
      to: [
        {
          name: "Resolved",
          email: "resolved@example.com",
          nodeId: "node-123",
          type: ParsedRecipientType.CONTACT,
        },
      ],
    });
  });

  test("skips fields not present in source", async () => {
    const source = { to: ["a@x.com"] };
    const result = await normalizeHeaders(source, ["to", "cc", "bcc"]);

    assert.deepStrictEqual(result, {
      to: [
        {
          name: "",
          email: "a@x.com",
          type: ParsedRecipientType.EMAIL,
          raw: "a@x.com",
        },
      ],
    });
  });

  test("skips null field values", async () => {
    const source = { to: null, cc: ["a@x.com"] };
    // @ts-expect-error -- null is a valid runtime input that the function handles
    const result = await normalizeHeaders(source, ["to", "cc"]);

    assert.deepStrictEqual(result, {
      cc: [
        {
          name: "",
          email: "a@x.com",
          type: ParsedRecipientType.EMAIL,
          raw: "a@x.com",
        },
      ],
    });
  });

  test("returns empty object when no fields match", async () => {
    const result = await normalizeHeaders({}, ["to", "cc"]);
    assert.deepEqual(result, {});
  });

  test("preserves order of mailboxes within a field", async () => {
    const source = {
      to: ["a@x.com", "b@x.com", "c@x.com"],
    };
    const result = await normalizeHeaders(source, ["to"]);

    assert.deepEqual(
      result.to.map((m) => m.email),
      ["a@x.com", "b@x.com", "c@x.com"],
    );
  });

  test("does not include fields not in fieldNames", async () => {
    const source = {
      to: ["a@x.com"],
      cc: ["b@x.com"],
      subject: "Hello",
    };
    const result = await normalizeHeaders(source, ["to"]);

    assert.equal("cc" in result, false);
    assert.equal("subject" in result, false);
  });
});

describe("extractMailboxes", { tags: ["smoke"] }, () => {
  test("flattens in fieldNames order", () => {
    const byField = {
      to: [{ email: "a@x.com", name: "A" }],
      cc: [{ email: "b@x.com", name: "B" }],
    };
    const result = extractMailboxes(byField, ["to", "cc"]);

    assert.deepEqual(
      result.map((m) => m.email),
      ["a@x.com", "b@x.com"],
    );
  });

  test("respects custom fieldNames order (not object key order)", () => {
    const byField = {
      to: [{ email: "a@x.com", name: "A" }],
      cc: [{ email: "b@x.com", name: "B" }],
    };
    const result = extractMailboxes(byField, ["cc", "to"]);

    assert.deepEqual(
      result.map((m) => m.email),
      ["b@x.com", "a@x.com"],
    );
  });

  test("deduplicates by lowercase email", () => {
    const byField = {
      to: [{ email: "Alice@Example.com", name: "Alice" }],
      cc: [{ email: "alice@example.com", name: "" }],
    };
    const result = extractMailboxes(byField, ["to", "cc"]);

    assert.equal(result.length, 1);
    assert.equal(result[0].email, "Alice@Example.com");
  });

  test("merges name from a later occurrence", () => {
    const byField = {
      to: [{ email: "alice@example.com", name: "" }],
      cc: [{ email: "alice@example.com", name: "Alice" }],
    };
    const result = extractMailboxes(byField, ["to", "cc"]);

    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Alice");
  });

  test("does not overwrite an existing name", () => {
    const byField = {
      to: [{ email: "alice@example.com", name: "Alice" }],
      cc: [{ email: "alice@example.com", name: "Alicia" }],
    };
    const result = extractMailboxes(byField, ["to", "cc"]);

    assert.equal(result[0].name, "Alice");
  });

  test("deduplicates by nodeId when email is absent", () => {
    const byField = {
      to: [{ email: "", name: "", nodeId: "node-123" }],
      cc: [{ email: "", name: "List", nodeId: "node-123" }],
    };
    const result = extractMailboxes(byField, ["to", "cc"]);

    assert.equal(result.length, 1);
    assert.equal(result[0].nodeId, "node-123");
    assert.equal(result[0].name, "List");
  });

  test("deduplicates by name when email and nodeId are absent", () => {
    const byField = {
      to: [{ email: "", name: "SomeList" }],
      cc: [{ email: "", name: "somelist" }],
    };
    const result = extractMailboxes(byField, ["to", "cc"]);

    assert.equal(result.length, 1);
  });

  test("skips entries with no email, nodeId, or name", () => {
    const byField = {
      to: [{ email: "", name: "" }],
    };
    const result = extractMailboxes(byField, ["to"]);

    assert.equal(result.length, 0);
  });

  test("does not mutate the source object", () => {
    const source = [{ email: "a@x.com", name: "" }];
    const byField = {
      to: source,
      cc: [{ email: "a@x.com", name: "A" }],
    };
    extractMailboxes(byField, ["to", "cc"]);

    assert.equal(source[0].name, "");
  });

  test("returns empty array for empty object", () => {
    assert.deepEqual(extractMailboxes({}, ["to", "cc"]), []);
  });

  test("skips fields not in the object", () => {
    const byField = {
      to: [{ email: "a@x.com", name: "" }],
    };
    const result = extractMailboxes(byField, ["to", "bcc"]);

    assert.equal(result.length, 1);
  });

  test("handles multiple mailboxes within a single field", () => {
    const byField = {
      to: [
        { email: "a@x.com", name: "A" },
        { email: "b@x.com", name: "B" },
        { email: "c@x.com", name: "C" },
      ],
    };
    const result = extractMailboxes(byField, ["to"]);

    assert.deepEqual(
      result.map((m) => m.email),
      ["a@x.com", "b@x.com", "c@x.com"],
    );
  });

  test("preserves extra Mailbox properties (raw, type, nodeId)", () => {
    const byField = {
      to: [
        {
          email: "a@x.com",
          name: "A",
          type: ParsedRecipientType.LIST,
          nodeId: "n1",
        },
      ],
    };
    const result = extractMailboxes(byField, ["to"]);

    assert.equal(result[0].type, ParsedRecipientType.LIST);
    assert.equal(result[0].nodeId, "n1");
  });
});

describe("normalizeRecipient", () => {
  describe("string form", () => {
    test("bare address", async () => {
      const result = await normalizeRecipient("a@x.com");
      assert.deepStrictEqual(result, [
        {
          email: "a@x.com",
          name: "",
          type: ParsedRecipientType.EMAIL,
          raw: "a@x.com",
        },
      ]);
    });

    test("name with address", async () => {
      const result = await normalizeRecipient("John <john@x.com>");
      assert.deepStrictEqual(result, [
        {
          email: "john@x.com",
          name: "John",
          type: ParsedRecipientType.EMAIL,
          raw: "John <john@x.com>",
        },
      ]);
    });

    test("multiple addresses in one string: raw is empty", async () => {
      const raw = "A <a@x.com>, B <b@x.com>";
      const result = await normalizeRecipient(raw);
      assert.deepStrictEqual(result, [
        {
          email: "a@x.com",
          name: "A",
          type: ParsedRecipientType.EMAIL,
          raw,
          wasMultiple: true,
        },
        {
          email: "b@x.com",
          name: "B",
          type: ParsedRecipientType.EMAIL,
          raw,
          wasMultiple: true,
        },
      ]);
    });

    test("quoted name with comma", async () => {
      const result = await normalizeRecipient('"Doe, John" <john@x.com>');
      assert.deepStrictEqual(result, [
        {
          email: "john@x.com",
          name: "Doe, John",
          type: ParsedRecipientType.EMAIL,
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
        resolveFn,
      );
      assert.deepStrictEqual(result, [
        {
          email: "resolved@x.com",
          name: "Resolved",
          type: ParsedRecipientType.CONTACT,
          nodeId: "abc",
        },
      ]);
    });

    test("mailingList with resolveFn", async () => {
      const resolveFn = async (id) => ({ email: "My Team", name: "My Team" });
      const result = await normalizeRecipient(
        { nodeId: "My Team", type: "mailingList" },
        resolveFn,
      );
      assert.deepStrictEqual(result, [
        {
          email: "My Team",
          name: "My Team",
          type: ParsedRecipientType.LIST,
          nodeId: "My Team",
        },
      ]);
    });

    test("contact without resolveFn (passthrough)", async () => {
      const result = await normalizeRecipient({
        nodeId: "abc123",
        type: "contact",
      });
      assert.deepStrictEqual(result, [
        {
          email: "",
          name: "",
          type: ParsedRecipientType.CONTACT,
          nodeId: "abc123",
        },
      ]);
    });

    test("mailingList without resolveFn (passthrough)", async () => {
      const result = await normalizeRecipient({
        nodeId: "My Team",
        type: "contact",
      });
      assert.deepStrictEqual(result, [
        {
          email: "",
          name: "",
          type: ParsedRecipientType.CONTACT,
          nodeId: "My Team",
        },
      ]);
    });
  });
});

describe("normalizeRecipients", () => {
  test("multiple string recipients", async () => {
    const result = await normalizeRecipients(["a@x.com", "John <b@x.com>"]);
    assert.deepStrictEqual(result, [
      {
        email: "a@x.com",
        name: "",
        type: ParsedRecipientType.EMAIL,
        raw: "a@x.com",
      },
      {
        email: "b@x.com",
        name: "John",
        type: ParsedRecipientType.EMAIL,
        raw: "John <b@x.com>",
      },
    ]);
  });

  test("string recipients, deduplicated with full name", async () => {
    const recipients = ["a@x.com", "John <a@x.com>"];
    const result = await normalizeRecipients(recipients);
    assert.deepStrictEqual(result, [
      {
        email: "a@x.com",
        name: "John",
        type: ParsedRecipientType.EMAIL,
        raw: "John <a@x.com>",
      },
    ]);
  });

  test("object recipients for a mailing list without resolveFn (passthrough)", async () => {
    const recipients = /** @type {ComposeRecipient[]} */ ([
      { nodeId: "My Team", type: "mailingList" },
    ]);
    const result = await normalizeRecipients(recipients);
    assert.deepStrictEqual(result, [
      {
        email: "",
        name: "",
        type: ParsedRecipientType.LIST,
        nodeId: "My Team",
      },
    ]);
  });

  test("object recipients for a contact without resolveFn (passthrough)", async () => {
    const recipients = /** @type {ComposeRecipient[]} */ ([
      { nodeId: "abc123", type: ParsedRecipientType.CONTACT },
    ]);
    const result = await normalizeRecipients(recipients);
    assert.deepStrictEqual(result, [
      {
        email: "",
        name: "",
        type: ParsedRecipientType.CONTACT,
        nodeId: "abc123",
      },
    ]);
  });

  test("mixed string and object without resolveFn", async () => {
    const recipients = /** @type {ComposeRecipient[]} */ ([
      "a@x.com",
      { nodeId: "My Team", type: ParsedRecipientType.LIST },
    ]);
    const result = await normalizeRecipients(recipients);
    assert.deepStrictEqual(result, [
      {
        email: "a@x.com",
        name: "",
        type: ParsedRecipientType.EMAIL,
        raw: "a@x.com",
      },
      {
        email: "",
        name: "",
        type: ParsedRecipientType.LIST,
        nodeId: "My Team",
      },
    ]);
  });

  test("object recipients with resolveFn", async () => {
    const resolveFn = async (id) => ({
      email: "resolved@x.com",
      name: "Resolved",
    });
    const result = await normalizeRecipients(
      [{ nodeId: "abc123", type: "contact" }],
      resolveFn,
    );
    assert.deepStrictEqual(result, [
      {
        email: "resolved@x.com",
        name: "Resolved",
        type: ParsedRecipientType.CONTACT,
        nodeId: "abc123",
      },
    ]);
  });

  test("mixed string and object with resolveFn", async () => {
    const resolveFn = async (id) => ({ email: "resolved@x.com", name: "R" });
    const result = await normalizeRecipients(
      ["a@x.com", { nodeId: "abc", type: "mailingList" }],
      resolveFn,
    );
    assert.deepStrictEqual(result, [
      {
        email: "a@x.com",
        name: "",
        type: ParsedRecipientType.EMAIL,
        raw: "a@x.com",
      },
      {
        email: "resolved@x.com",
        name: "R",
        type: ParsedRecipientType.LIST,
        nodeId: "abc",
      },
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

describe("parsedRecipientToString", () => {
  test("raw present: returned as-is", () => {
    const m = { email: "x@y.com", name: "X", raw: "X2 <x@y.com>" };
    assert.strictEqual(parsedRecipientToString(m), "X2 <x@y.com>");
  });

  test("no name: bare email", () => {
    const m = { email: "x@y.com", name: "", raw: "" };
    assert.strictEqual(parsedRecipientToString(m), "x@y.com");
  });

  test("name without special chars: unquoted", () => {
    const m = { email: "x@y.com", name: "John Doe", raw: "" };
    assert.strictEqual(parsedRecipientToString(m), "John Doe <x@y.com>");
  });

  test("name with comma: quoted", () => {
    const m = { email: "x@y.com", name: "Doe, John", raw: "" };
    assert.strictEqual(parsedRecipientToString(m), '"Doe, John" <x@y.com>');
  });

  test("name with double quote: quoted and escaped", () => {
    const m = { email: "x@y.com", name: 'She said "hi"', raw: "" };
    assert.strictEqual(parsedRecipientToString(m), '"She said \\"hi\\"" <x@y.com>');
  });

  test("name with angle bracket: quoted", () => {
    const m = { email: "x@y.com", name: "A <B>", raw: "" };
    assert.strictEqual(parsedRecipientToString(m), '"A <B>" <x@y.com>');
  });

  test("name with semicolon: quoted", () => {
    const m = { email: "x@y.com", name: "Dr; Smith", raw: "" };
    assert.strictEqual(parsedRecipientToString(m), '"Dr; Smith" <x@y.com>');
  });

  test("name with colon: quoted", () => {
    const m = { email: "x@y.com", name: "Smith: MD", raw: "" };
    assert.strictEqual(parsedRecipientToString(m), '"Smith: MD" <x@y.com>');
  });

  test("name with only spaces and letters: not quoted", () => {
    const m = { email: "x@y.com", name: "Jean-Pierre Dupont", raw: "" };
    assert.strictEqual(parsedRecipientToString(m), "Jean-Pierre Dupont <x@y.com>");
  });
});
