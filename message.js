/* message.js
 * Extracts structured data from message headers and compose details.
 * Pure, no Thunderbird dependencies.
 */

/**
 * @typedef {Record<string, string[]>} HeadersDictionary
 * A dictionary of message headers: lowercase header name → array of values.
 * As returned by `messenger.messages.getFull(id).headers`.
 */

/**
 * @typedef {object} Mailbox
 * A parsed mailbox: the email address and optional display name.
 * @property {string} email - The addr-spec (e.g. "user+netflix@mydomain.com")
 * @property {string} name - The display name (e.g. "Netflix"), or "" if absent.
 * @property {string} [raw] - The original mailbox string (set for string
 *   recipients, absent for recipient objects)
 * @property {boolean} [isList] - True for unexpanded mailing list, set by
 *   normalizeRecipients for recipient objects.
 * @property {string} [nodeId] - Address book nodeId, set by
 *   normalizeRecipients for recipient objects.
 */

/**
 * Extract mailboxes from specific headers.
 * Works with msg.getFull().headers (TB 66+), and msg.getHeaders() (TB 147+).
 *
 * @param {HeadersDictionary} headers
 * @param {string[]} headerNames - e.g. ["x-original-to", "delivered-to", "to"]
 * @param {(str: string) => Mailbox | Mailbox[] | Promise<Mailbox | Mailbox[]>} [parseFn]
 *   String to Mailbox parser function (may be async).
 *   Defaults to a regex-based parser.
 *   In Thunderbird use
 *   `messenger.messengerUtilities`
 *        `.parseMailboxString(str)`
 *        `.then((p) => addRaw(p, str))`.
 * @returns {Promise<Mailbox[]>}
 */
export async function extractMailboxes(headers, headerNames, parseFn = defaultParse) {
  const map = new Map();  // email (lowercase) → Mailbox

  for (const name of headerNames) {
    const values = headers[name];
    if (!values) continue;
    for (const value of values) {
      const parsed = await parseFn(value);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item.email) continue;
        const key = item.email.toLowerCase();
        const existing = map.get(key);
        if (!existing) {
          map.set(key, { email: item.email, name: item.name || "" });
        } else if (!existing.name && item.name) {
          // Merge: fill in the name if the existing entry doesn't have one
          existing.name = item.name;
        }
      }
    }
  }

  return [...map.values()];
}

/**
 * @typedef {string | { nodeId: string, type: "contact" | "mailingList" }} ComposeRecipient
 * A recipient as returned by getComposeDetails: either a mailbox string
 * or an object referencing an address book entry.
 * Note: uses MV3 `nodeId` instead of MV2 `id`.
 */

/**
 * Normalize a single ComposeRecipient into Mailbox[].
 * Handles both string form (mailbox format) and object form
 * (`{ nodeId, type }`).
 *
 * @param {ComposeRecipient} recipient - A single recipient (string or object form).
 * @param {(str: string) => Mailbox | Mailbox[] | Promise<Mailbox | Mailbox[]>} [parseFn]
 *   Parser for string recipients. Can be sync or async.
 *   Defaults to a regex-based parser (useful for testing).
 *   In Thunderbird use
 *   `messenger.messengerUtilities`
 *        `.parseMailboxString(str)`
 *        `.then((p) => addRaw(p, str))`.
 * @param {(nodeId: string, type: string) => Promise<Mailbox>} [resolveFn]
 *   Resolves an address book nodeId to a Mailbox.
 *   In Thunderbird the resolution can be:
 *     - for contacts: `async (id) => {
 *                        const c = await messenger.addressBooks.contacts.get(id);
 *                        return { email: c.properties.PrimaryEmail, name: ... };
 *                      }`
 *     - for mailing lists: `async (id) => {
 *                             const ml = await messenger.addressBooks.mailingLists.get(id);
 *                             return { email: ml.name, name: ml.name };
 *                           }`
 *   In tests: a mock that returns a fixed value.
 *   If omitted, object-form recipients are passed through with `email` set to the `nodeId` (unresolved).
 * @returns {Promise<Mailbox[]>}
 */
export async function normalizeRecipient(recipient, parseFn = defaultParse, resolveFn = null) {
  if (!recipient) return [];

  if (typeof recipient === "string") {
    const parsed = await parseFn(recipient);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const multi = items.length > 1;
    return items
      .filter((p) => p.email)
      .map((p) => ({
        email: p.email,
        name: p.name || "",
        raw: multi ? "" : recipient,
      }));
  }

  // Object form: { nodeId, type }
  if (resolveFn) {
    const resolved = await resolveFn(recipient.nodeId, recipient.type);
    return [{
      email: resolved.email,
      name: resolved.name || "",
      isList: recipient.type === "mailingList",
      nodeId: recipient.nodeId,
    }];
  }

  // No resolver — pass through unresolved:
  return [{
    email: recipient.nodeId,
    name: "",
    isList: recipient.type === "mailingList",
    nodeId: recipient.nodeId,
  }];
}

/**
 * Normalize a ComposeRecipientList into Mailbox[].
 * Handles both string form (mailbox format) and object form
 * (`{ nodeId, type }`).
 *
 * @param {ComposeRecipient[]} recipients
 * @param {(str: string) => Mailbox | Mailbox[] | Promise<Mailbox | Mailbox[]>} [parseFn]
 *   Parser for string recipients. Can be sync or async.
 *   Defaults to a regex-based parser (useful for testing).
 *   In Thunderbird use
 *   `messenger.messengerUtilities`
 *        `.parseMailboxString(str)`
 *        `.then((p) => addRaw(p, str))`.
 * @param {(nodeId: string, type: string) => Promise<Mailbox>} [resolveFn]
 *   Resolves an address book nodeId to a Mailbox.
 *   In Thunderbird the resolution can be:
 *     - for contacts: `async (id) => {
 *                        const c = await messenger.addressBooks.contacts.get(id);
 *                        return { email: c.properties.PrimaryEmail, name: ... };
 *                      }`
 *     - for mailing lists: `async (id) => {
 *                             const ml = await messenger.addressBooks.mailingLists.get(id);
 *                             return { email: ml.name, name: ml.name };
 *                           }`
 *   In tests: a mock that returns a fixed value.
 *   If omitted, object-form recipients are passed through with `email` set to the `nodeId` (unresolved).
 * @returns {Promise<Mailbox[]>}
 */
export async function normalizeRecipients(recipients, parseFn = defaultParse, resolveFn = null) {
  if (!recipients) return [];

  const all = [];
  for (const r of recipients) {
    const items = await normalizeRecipient(r, parseFn, resolveFn);
    all.push(...items);
  }

  // Deduplicate by email, merge name and raw:
  const map = new Map();
  for (const item of all) {
    const key = item.email.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
    } else if (!existing.name && item.name) {
      existing.name = item.name;
      if (item.raw) existing.raw = item.raw;
    }
  }

  /* Old code before normalizeRecipient (singular)
  const map = new Map();

  for (const r of recipients) {
    let items;

    if (typeof r === "string") {
      const parsed = await parseFn(r);
      items = Array.isArray(parsed) ? parsed : [parsed];
    } else if (resolveFn) {
      const resolved = await resolveFn(r.nodeId, r.type);
      items = [{
        email: resolved.email,
        name: resolved.name || "",
        isList: r.type === "mailingList",
        nodeId: r.nodeId,
      }];
    } else {
      // No resolver — pass through unresolved:
      items = [{
        email: r.nodeId,
        name: "",
        isList: r.type === "mailingList",
        nodeId: r.nodeId,
      }];
    }

    for (const item of items) {
      if (!item.email) continue;
      const key = item.email.toLowerCase();
      const existing = map.get(key);
      if (!existing) {
        map.set(key, item);
      } else if (!existing.name && item.name) {
        existing.name = item.name;
        if (item.raw) existing.raw = item.raw;
      }
    }
  }
  */

  return [...map.values()];
}

/**
 * Default regex-based mailbox parser (fallback / test default).
 * @param {string} str
 * @returns {Mailbox[]}
 */
export function defaultParse(str) {
  const results = [];
  const re = /"((?:[^"\\]|\\.)*)"\s*<([^>]+)>|([^<,]+?)\s*<([^>]+)>|([^\s,<>]+@[\w.-]+\.\w+)/g;
  for (const m of str.matchAll(re)) {
    let name = (m[1] ?? m[3] ?? "").trim();
    if (m[1] !== undefined) name = name.replace(/\\(.)/g, "$1");  // unescape
    const email = (m[2] || m[4] || m[5] || "").trim();
    if (email) results.push({ email, name: name || "", raw: m[0].trim() });
  }
  return results;
}

/**
 * Adds the `raw` entry to the result of messengerUtilities.parseMailboxString
 * as per the Mailbox typdef.
 * Sets `raw` to the original string for single-address results,
 * or "" for multi-address results (raw for each item is ambiguous).
 *
 * @param {object|object[]} parsed - Result from parseMailboxString
 * @param {string} str - The original input string
 * @returns {Mailbox[]}
 */
export function addRaw(parsed, str) {
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const multi = items.length > 1;
  return items.map((p) => ({
    email: p.email,
    name: p.name || "",
    raw: multi ? "" : str,
  }));
}

/**
 * Convert a Mailbox to a ComposeRecipient string for setComposeDetails.
 * Uses `raw` if available; otherwise rebuilds from name + email,
 * quoting the name per RFC 5322 if it contains special characters.
 *
 * @param {Mailbox} m
 * @returns {string}
 */
export function mailboxToString(m) {
  if (m.raw) return m.raw;
  if (!m.name) return m.email;
  if (/[",<>;:]/.test(m.name)) {
    return `"${m.name.replace(/"/g, '\\"')}" <${m.email}>`;
  }
  return `${m.name} <${m.email}>`;
}