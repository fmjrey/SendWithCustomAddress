/* alias.js
 * Aggregate (in DDD speak) root for aliases and their association to recipients.
 * For now handle From address validation and search logic.
 * Likely to grow into explicitly stored associations.
 * No Thunderbird dependencies to facilitate testing.
 */

import { log } from "./log.js";
import { extractMailboxes, normalizeHeaders } from "./message.js";
import { compilePattern, createValidator } from "./pattern.js";

/**
 * @typedef {import("./message.js").AddressFieldsSource} AddressFieldsSource
 * @typedef {import("./message.js").ParsedRecipient} ParsedRecipient
 * @typedef {import("./message.js").NormalizedHeaders} NormalizedHeaders
 */

// --- Storage keys (match the HTML input ids in the options page) ---
export const STORAGE_KEYS = ["fromPattern", "notFromPattern"];

// --- List of all possible header fields containing addresses ---
export const SENDER_HEADERS = [
  "from",
  "sender",
  "reply-to",
  "return-path",
  "resent-from",
  "resent-sender",
  "x-envelope-from",
  "x-env-from",
  "x-sender",
];

export const RECIPIENT_HEADERS = [
  "to",
  "cc",
  "bcc",
  "delivered-to",
  "envelope-to",
  "x-original-to",
  "x-envelope-to",
  "resent-to",
  "resent-cc",
  "resent-bcc",
];

export const ALL_HEADERS = [...SENDER_HEADERS, ...RECIPIENT_HEADERS];

// --- State ---
let _initialized = false;
let _validateFrom = null;
//let _associations = {};  // recipient-alias (future)

// --- Guard ---
function assertInitialized() {
  if (!_initialized) {
    throw new Error(
      "alias.js: not initialized — call rebuild() before any operation.",
    );
  }
}

// --- Commands ---

/**
 * Rebuild the aggregate (in DDD speak) from a data source.
 * Must be called before any query/command operation.
 *
 * If a pattern is syntactically invalid, the error is swallowed:
 * the validation falls back to permissive (always valid) and a
 * warning is emitted via `log.js`.
 *
 * @param {() => Promise<{fromPattern: string, notFromPattern: string}>} source
 *        Async function returning the stored prefs object.
 */
export async function rebuild(source) {
  const prefs = await source();
  const fromPattern = prefs.fromPattern || "";
  const notFromPattern = prefs.notFromPattern || "";

  const descriptors = [];
  if (fromPattern.trim()) {
    descriptors.push({
      ...compilePattern(fromPattern),
      validWhenMatch: true,
      invalidMessage: `Does not match required pattern (${fromPattern}).`,
    });
  }
  if (notFromPattern.trim()) {
    descriptors.push({
      ...compilePattern(notFromPattern),
      validWhenMatch: false,
      invalidMessage: `Matches prohibited pattern (${notFromPattern}).`,
    });
  }

  _validateFrom = createValidator(descriptors, {
    satisfy: "all",
    skipInvalid: true,
    log: log.warn,
  });

  _initialized = true;
}

/**
 * Store a recipient→alias association.
 * @param {string} recipient
 * @param {string} alias
 export function store(recipient, alias) {
 assertInitialized();
 _associations[recipient] = alias;
 // Future: persist to storage
 }
*/

// --- Queries ---

/**
 * Validate a From address against the configured patterns.
 * @param {string} address
 * @returns {{ value: string, valid: boolean, message: string|null }}
 */
export function validateFrom(address) {
  assertInitialized();
  return _validateFrom(address);
}

/**
 * Return the best sender candidate found in the message being replied to.
 * @param {AddressFieldsSource} parent
 * @returns {Promise<{sender: ParsedRecipient | undefined,
 *                    relatedHeaders: NormalizedHeaders}>}
 */
export async function bestSenderFor(parent) {
  const relatedHeaders = await normalizeHeaders(parent, ALL_HEADERS);
  const mailboxes = extractMailboxes(relatedHeaders, ALL_HEADERS);
  log.debug("bestSenderFor: extracted mailboxes", mailboxes);

  // Find the first candidate that satisfies validation:
  const sender = mailboxes.find((m) => m.email && validateFrom(m.email).valid);
  return {sender: sender, relatedHeaders};
}

/**
 * Look up a stored alias for a recipient.
 * @param {string} recipient
 * @returns {string|null}
 export function lookup(recipient) {
 assertInitialized();
 return _associations[recipient] || null;
 }
*/
