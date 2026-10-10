/* message.js
 * Extracts structured data from message headers and compose details.
 * No Thunderbird dependencies to facilitate testing.
 * See `docs/Address headers and fields.md`
 */

import { log } from "./log.js";

/** @typedef {'contact' | 'mailingList' | 'email' | undefined} ParsedRecipientType */
/** @type {Record<'CONTACT' | 'LIST' | 'EMAIL', ParsedRecipientType>} */
export const ParsedRecipientType = {
  CONTACT: "contact",
  LIST: "mailingList",
  EMAIL: "email",
};

/**
 * @typedef {object} ParsedRecipient
 * A mixtute of Thunderbird `ParsedMailbox` and `ComposeRecipient` (in its
 * object form), almost like a merging of their fields into one object.
 * @property {string} [email] - The addr-spec (e.g. "user+netflix@mydomain.com")
 * @property {string} [name] - The display name (e.g. "Netflix"), or "" if absent.
 * @property {object[]} [group] - members of the list as ParsedMailBox[].
 * @property {string | ComposeRecipient} [raw] - The original mailbox string
 *   or object.
 * @property {boolean} [wasMultiple] - `true` in case of an original raw
 *   string that contained multiple recipients, meaning `raw` does not just
 *   represent this instance but all of them.
 * @property {ParsedRecipientType} [type]
 * @property {string} [nodeId] - Address book nodeId, set by
 *   `normalizeRecipient` for recipient objects.
 * @see {@link https://webextension-api.thunderbird.net/en/esr-mv3/messengerUtilities.html#parsedmailbox | ParsedMailbox}
 * @see {@link https://webextension-api.thunderbird.net/en/esr-mv3/compose.html#composerecipient | ComposeRecipient }
 */

/** @typedef {'contact' | 'mailingList'} ComposeRecipientType */

/**
 * @typedef {string | { nodeId: string, type: ComposeRecipientType }} ComposeRecipient
 * A recipient as returned by getComposeDetails: either a mailbox string
 * or an object referencing an address book entry.
 * Note: uses MV3 `nodeId` instead of MV2 `id`.
 */

/**
 * @typedef {Object<string, ComposeRecipient | ComposeRecipient[] | undefined>} AddressFieldsSource
 * An object mapping address field names to their raw values.
 * Compatible with both:
 *   - `HeadersDictionary` (message headers — every value is `string[]`)
 *   - Address fields of `ComposeDetails` (values are `ComposeRecipient | ComposeRecipient[]`)
 */

/**
 * @typedef {(nodeId: string, type: string) => Promise<ParsedRecipient>} ComposeRecipientResolver
 * Resolves an address book nodeId to a MailboxRecipient.
 * In Thunderbird the logic may be implemented with:
 *   - contacts: `async (id) => {
 *       const c = await messenger.addressBooks.contacts.get(id);
 *       return { email: c.properties.PrimaryEmail, name: c.properties.FirstName + " " + c.properties.LastName };
 *     }`
 *   - mailing lists: `async (id) => {
 *       const ml = await messenger.addressBooks.mailingLists.get(id);
 *       return { email: ml.name, name: ml.name };
 *     }`
 */

/**
 * @typedef {Record<string, ParsedRecipient[]>} NormalizedHeaders
 */

/**
 * Normalize the values of the specified fields into `MailboxRecipient[]`,
 * returning an object with only the specified fields.
 * Works with both:
 *   - Message headers (`msg.getFull().headers` / `getHeaders()`) where values
 *     are string[]
 *   - Compose details (`getComposeDetails()`) where values are
 *     ComposeRecipient | ComposeRecipient[]
 *
 * @param {AddressFieldsSource} source
 * @param {string[]} fieldNames - Which fields to extract, in priority order.
 *   e.g. ["to", "cc", "bcc"] or ["from", "delivered-to", "envelope-to", "to"]
 * @param {ComposeRecipientResolver | null} [resolveFn]
 *   Passed through to `normalizeRecipients` for object-form recipients.
 *   Not needed for pure header inputs (all strings).
 * @returns {Promise<NormalizedHeaders>}
 */
export async function normalizeHeaders(source, fieldNames, resolveFn = null) {
  /** @type {Record<string, ParsedRecipient[]>} */
  const result = {};

  for (const name of fieldNames) {
    const value = source[name];
    if (value === undefined || value === null) continue;

    const mailboxes = [];
    const items = Array.isArray(value) ? value : [value];
    let mbs = await normalizeRecipients(items, resolveFn);
    for (const mb of mbs) {
      mailboxes.push({ ...mb });
    }

    result[name] = mailboxes;
  }

  return result;
}

/**
 * Flatten a normalized header object into a single ordered Mailbox[] array.
 * Order follows fieldNames. Duplicates: first occurrence is stored but the
 * name may be filled from any subsequent occurrence if it was't set before.
 *
 * @param {NormalizedHeaders} byField - Output of `normalizeHeaders()`.
 * @param {string[]} fieldNames - Same list passed to `normalizeHeaders()`,
 *   used here to drive ordering.
 * @returns {ParsedRecipient[]}
 * @see {@link normalizeHeaders}
 */
export function extractMailboxes(byField, fieldNames) {
  const seen = new Map();
  const result = [];

  for (const name of fieldNames) {
    const mailboxes = byField[name];
    if (!mailboxes) continue;
    dedupMailboxes(mailboxes, seen, result);
  }

  return result;
}

/**
 * Normalize a single ComposeRecipient into Mailbox[].
 * Handles both string form (mailbox format) and object form
 * (`{ nodeId, type }`).
 *
 * @param {ComposeRecipient | undefined | null} recipient - A single recipient (string or object form).
 * @param {ComposeRecipientResolver | null} [resolveFn]
 * @returns {Promise<ParsedRecipient[]>}
 */
export async function normalizeRecipient(recipient, resolveFn = null) {
  if (!recipient) return [];

  if (typeof recipient === "string") {
    const parsed = await stringToParsedRecipient(recipient);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const wasMultiple = items.length > 1;
    return items
      .filter((p) => p.email)
      .map((p) => ({
        email: p.email,
        name: p.name || "",
        type: ParsedRecipientType.EMAIL,
        raw: recipient,
        ...(wasMultiple && { wasMultiple }),
      }));
  }

  // Object form: { nodeId, type }
  if (resolveFn) {
    const resolved = await resolveFn(recipient.nodeId, recipient.type);
    return [
      {
        email: resolved.email,
        name: resolved.name || "",
        type: recipient.type,
        nodeId: recipient.nodeId,
      },
    ];
  }

  // No resolver — pass through unresolved:
  return [
    {
      email: "",
      name: "",
      type: recipient.type,
      nodeId: recipient.nodeId,
    },
  ];
}

/**
 * Normalize a ComposeRecipientList into ParsedRecipient[].
 * Handles both string form (mailbox format) and object form
 * (`{ nodeId, type }`).
 *
 * @param {Array<ComposeRecipient> | undefined | null} recipients
 * @param {ComposeRecipientResolver | null} [resolveFn]
 * @returns {Promise<ParsedRecipient[]>}
 */
export async function normalizeRecipients(recipients, resolveFn = null) {
  if (!recipients) return [];

  const mailboxes = [];
  for (const r of recipients) {
    const items = await normalizeRecipient(r, resolveFn);
    mailboxes.push(...items);
  }

  // Deduplicate by email, merge name and raw:
  return dedupMailboxes(mailboxes);
}

/**
 * Remove duplicates from a list of `ParsedRecipients`, merging
 * `name` and `raw` when they weren' previously set.
 *
 * @param {ParsedRecipient[]} mailboxes
 * @param {Map} [seen]
 * @param {ParsedRecipient[]} [result]
 * @returns {ParsedRecipient[]}
 */
function dedupMailboxes(mailboxes, seen = new Map(), result = []) {
  for (const mb of mailboxes) {
    const key = (mb.email || mb.nodeId || mb.name || "").toLowerCase();
    if (!key) continue;
    const idx = seen.get(key);
    if (idx === undefined) {
      seen.set(key, result.length);
      result.push({ ...mb }); // copy because byField
    } else if (!result[idx].name && mb.name) {
      // entry is mutated
      result[idx].name = mb.name; // here
      if (mb.raw && !mb.wasMultiple) result[idx].raw = mb.raw;
    }
  }
  return result;
}

/**
 * Convert a string to a ParsedRecipient with regular expressions.
 * @param {string} str
 * @returns {ParsedRecipient[]} `[]` if `str` is empty, null, or undefined, and
 * `[{ name: str, email: undefined }]` if parsing fails.
 */
export function stringToParsedRecipientRegex(str) {
  if (!str?.trim()) return [];
  const re =
    /"((?:[^"\\]|\\.)*)"\s*<([^>]+)>|([^<,]+?)\s*<([^>]+)>|([^\s,<>]+@[\w.-]+\.\w+)/g;
  /*
  stringToMailboxRegex: 3 matching alternatives, the first one swallowing
  commas inside double quotes, the other excluding commas from their groups
    /"((?:[^"\\]|\\.)*)"\s*<([^>]+)>|([^<,]+?)\s*<([^>]+)>|([^\s,<>]+@[\w.-]+\.\w+)/g
    Matching alternative 1: "name" <email>
     "((?:[^"\\]|\\.)*)"\s*<([^>]+)>|([^<,]+?)\s*<([^>]+)>|([^\s,<>]+@[\w.-]+\.\w+)
       --------------- Group 1: name in between double quotes
     "((?:[^"\\]|\\.)*)"\s*<([^>]+)>|([^<,]+?)\s*<([^>]+)>|([^\s,<>]+@[\w.-]+\.\w+)
         ------------ Non capturing Group
     "((?:[^"\\]|\\.)*)"\s*<([^>]+)>|([^<,]+?)\s*<([^>]+)>|([^\s,<>]+@[\w.-]+\.\w+)
                             ----- Group 2: the email address within <> after a double
                             quoted name
    Matching alternative 2: name <email>
     "((?:[^"\\]|\\.)*)"\s*<([^>]+)>|([^<,]+?)\s*<([^>]+)>|([^\s,<>]+@[\w.-]+\.\w+)
                                       ------- Group 3: unquoted name which may contain
                                       the leading space after a comma, or is just that
                                       space if no name is provided
     "((?:[^"\\]|\\.)*)"\s*<([^>]+)>|([^<,]+?)\s*<([^>]+)>|([^\s,<>]+@[\w.-]+\.\w+)
                                                   ----- Group 4: the email address
                                                   within <> after an unquoted name
    Matching alternative 3: whatever email@somewhere
     "((?:[^"\\]|\\.)*)"\s*<([^>]+)>|([^<,]+?)\s*<([^>]+)>|([^\s,<>]+@[\w.-]+\.\w+)
                                                            ----------------------
                                                            Group 5: an email address
                                                            by itself
  */
  const matches = [...str.matchAll(re)];
  const wasMultiple = matches.length > 1;
  if (matches.length === 0)
    return [{ name: str, email: undefined }];
  const results = [];
  for (const m of matches) {
    let name = (m[1] ?? m[3] ?? "").trim();
    if (m[1] !== undefined) name = name.replace(/\\(.)/g, "$1"); // unescape
    const email = (m[2] || m[4] || m[5] || "").trim();
    if (email)
      results.push({
        email,
        name: name || "",
        type: ParsedRecipientType.EMAIL,
        raw: str,
        ...(wasMultiple && { wasMultiple }),
      });
  }
  return results;
}

/**
 * Convert a string to a ParsedRecipient. Uses Thunderbird `parseMailboxString`
 * if available, otherwise falls back to a regex implementation.
 * @param {string} str
 * @returns {ParsedRecipient[]}
 * @see {@link https://webextension-api.thunderbird.net/en/esr-mv3/messengerUtilities.html#parsemailboxstring-mailboxstring-options}
 */
export const stringToParsedRecipient = (function () {
  const parseMailboxString =
    // @ts-ignore
    typeof messenger !== "undefined" && // @ts-ignore
    messenger.messengerUtilities?.parseMailboxString;
  if (parseMailboxString) {
    log.info("using messengerUtilities.parseMailboxString.");
    return (str) => parseMailboxString(str).then((p) => addRawType(p, str));
  } else {
    log.warn(
      "messengerUtilities.parseMailboxString is not available, using regex implementation.",
    );
    return stringToParsedRecipientRegex;
  }
})();

/**
 * Add the `raw: str` and `type: ParsedRecipientType.RECIPIENT` to the
 * result of `messengerUtilities.parseMailboxString` as per the
 * `ParsedRecipient` typdef.
 * Use only on the results of `messengerUtilities.parseMailboxString`!
 *
 * @param {object|object[]} parsed - Result from parseMailboxString
 * @param {string} str - The original input string
 * @returns {ParsedRecipient[]}
 */
function addRawType(parsed, str) {
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const wasMultiple = items.length > 1;
  // @ts-ignore
  return items.map((p) => ({
    email: p.email,
    name: p.name || "",
    type: ParsedRecipientType.EMAIL,
    raw: str,
    ...(wasMultiple && { wasMultiple }),
  }));
}

/**
 * Convert a `ParsedRecipient` to a `ComposeRecipient` string.
 * Uses `raw` if possible; otherwise rebuilds from name + email,
 * quoting the name per RFC 5322 if it contains special characters.
 * Avoid using on `ParsedRecitpient` of type other than
 * `ParsedRecipientType.ADDRESS`.
 *
 * @param {ParsedRecipient} m
 * @returns {string}
 */
export function parsedRecipientToString(m) {
  if (typeof m.raw === "string" && m.raw && !m.wasMultiple) return m.raw;
  switch (m.type) {
    case ParsedRecipientType.LIST:
    case ParsedRecipientType.EMAIL:
    case ParsedRecipientType.CONTACT:
      return escapedMailboxString(m.name, m.email);
    case undefined:
      if (typeof m.raw === "string" && m.raw)
        return m.raw;
      else
        return escapedMailboxString(m.name, m.email);
    default:
      // Exhaustiveness check: a new type not handled yields an error
      /** @type {never} */ (m.type); // dev time error
      throw new Error(`Unknown recipient type: ${m.type}`); // runtime error
  }
}

/**
 * Return a mailbox string (`name <email@address>`) quoting the name as per
 * RFC 5322 if it contains special characters.
 *
 * @param {string | undefined} name
 * @param {string | undefined} email
 * @returns {string}
 */
function escapedMailboxString(name, email) {
  if (!name) return email || "";
  if (/[",<>;:]/.test(name)) return `"${name.replace(/"/g, '\\"')}" <${email}>`;
  else return `${name} <${email}>`;
}
