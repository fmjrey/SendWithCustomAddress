/* alias.js
 * Aggregate (in DDD speak) root for aliases and their association to recipients.
 * For now handle From address validation and search logic.
 * Likely to grow into explicitly stored associations.
 * Pure, no Thunderbird/DOM dependencies.
 */

import { log } from "./log.js";
import { compilePattern, createValidator } from "./pattern.js";

// --- Storage keys (match the HTML input ids in the options page) ---
export const STORAGE_KEYS = ["fromPattern", "notFromPattern"];

// --- State ---
let _initialized = false;
let _validateFrom = null;
//let _associations = {};  // recipient-alias (future)

// --- Guard ---
function assertInitialized() {
  if (!_initialized) {
    throw new Error("alias.js: not initialized — call rebuild() before any operation.");
  }
}

// --- Commands ---

/**
 * Rebuild the aggregate (in DDD speak) from a data source.
 * Must be called before any query/command operation.
 *
 * If a pattern is syntactically invalid, the error is swallowed:
 * the validation falls back to permissive (always valid) and a
 * warning is emitted via the `log` function from options.
 *
 * @param {() => Promise<{fromPattern: string, notFromPattern: string}>} source
 *        Async function returning the stored prefs object.
 * @param {object} [options]
 * @param {(msg: string) => void} [options.log]
 *   Warning callback. Defaults to a no-op.
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

  _validateFrom = createValidator(descriptors, {satisfy: "all",
                                                skipInvalid: true,
                                                log: (msg) => log.warn(msg)});

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
 * Look up a stored alias for a recipient.
 * @param {string} recipient
 * @returns {string|null}
 export function lookup(recipient) {
 assertInitialized();
 return _associations[recipient] || null;
 }
*/
