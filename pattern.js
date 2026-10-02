/* patterns.js
 * Pattern strings as either glob or regex:
 *   - validate patterns strings
 *   - convert glob into regex
 *   - create a validation function by combining several patterns
 * No Thunderbird/DOM dependencies.
 */

/**
 * Converts a glob pattern to a compiled RegExp.
 *
 * Supported glob syntax:
 * - `**` — matches any sequence of characters, including `/`
 * - `**` followed by `/` — matches zero or more directory segments
 * - `*` — matches any sequence of characters, excluding `/`
 * - `?` — matches any single character, excluding `/`
 * - `[abc]`, `[a-z]` — character class
 * - `[!abc]` — negated character class
 * - `{a,b,c}` — alternation (literal comma-separated choices only)
 * - `\` — escapes the next character literally
 *
 * Not supported: nested braces, globs inside braces, brace ranges,
 * extglobs (`?(x)`, `+(x)`, `!(x)`, `*(x)`, `@(x)`).
 *
 * The resulting regex is anchored (`^...$`) and case-insensitive.
 *
 * @param {string} glob - The glob pattern string.
 * @returns {RegExp} A non-global, case-insensitive RegExp.
 *
 * @throws {Error} If the glob contains unbalanced brackets or braces,
 *   a dangling escape, an extglob pattern, or if the resulting regex
 *   is malformed.
 *
 * @example
 * globToRegex("*.txt");
 * // /^[^/]*\.txt$/i
 *
 * globToRegex("*.{com,org,net}");
 * // /^[^/]*\.(?:com|org|net)$/i
 */
export function globToRegex(glob) {
  if (/^[?*+!@]\(/.test(glob))
    throw new Error("Extglob patterns are not supported");

  let re = "^";
  let i = 0;

  while (i < glob.length) {
    const c = glob[i];

    if (c === "\\") {
      if (i + 1 >= glob.length) throw new Error("Dangling escape at end of glob");
      re += escapeLiteral(glob[i + 1]);
      i += 2;
    } else if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else if (c === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end === -1) throw new Error("Unbalanced [ in glob");
      let cls = glob.slice(i + 1, end);
      if (cls.startsWith("!")) cls = "^" + cls.slice(1);
      re += "[" + cls + "]";
      i = end + 1;
    } else if (c === "{") {
      const end = glob.indexOf("}", i + 1);
      if (end === -1) throw new Error("Unclosed { in glob");
      const parts = glob.slice(i + 1, end).split(",");
      if (parts.length < 2)
        throw new Error("Brace expansion needs at least 2 alternatives");
      re += "(?:" + parts.map(escapeLiteral).join("|") + ")";
      i = end + 1;
    } else {
      re += escapeLiteral(c);
      i += 1;
    }
  }

  re += "$";
  try {
    return new RegExp(re, "i");
  } catch (e) {
    throw new Error("Malformed regex from glob: " + e.message);
  }
}

function escapeLiteral(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validates a pattern string and compiles it to a RegExp inside a descriptor.
 *
 * A pattern is either:
 * - A **glob** (e.g. `*.txt`, `foo[0-9]bar`) — always case-insensitive.
 * - A **glob** (e.g. `*.txt`, `foo[0-9]bar`) — always case-insensitive.
 * - A **regex**, prefixed with `re:` (e.g. `re:\d{3}`).
 *   Flags may be appended after a `/` (e.g. `re:\d{3}/im`).
 *   Allowed flags: `i`, `m`, `s`, `u`. No default flags.
 * - Empty (after trimming), treated as a no-op.
 *
 * @param {string} str - The raw pattern string to validate.
 * @returns {{valid: boolean, type: "none"|"regex"|"glob", pattern: string, regex: RegExp|null, error?: string}}
 *   - `valid` — whether the pattern is syntactically correct.
 *   - `type` — `"none"`, `"regex"`, or `"glob"`.
 *   - `pattern` — the trimmed original string.
 *   - `regex` — the compiled RegExp, or `null` for type `"none"` or invalid patterns.
 *   - `error` — a human-readable error message (for invalid patterns).
 *
 * @example
 * compilePattern("re:^\\d{3}$");
 * // { valid: true, type: "regex", pattern: "re:^\\d{3}$", regex: /^\d{3}$/ }
 *
 * compilePattern("re:invoice/im");
 * // { valid: true, type: "regex", pattern: "re:invoice/im", regex: /invoice/im }
 *
 * compilePattern("*.txt");
 * // { valid: true, type: "glob", pattern: "*.txt", regex: /^[^/]*\.txt$/i }
 *
 * compilePattern("   ");
 * // { valid: true, type: "none", pattern: "", regex: null }
 */
export function compilePattern(str) {
  str = str.trim();
  if (!str) return { valid: true, type: "none", pattern: "", regex: null };

  if (str.startsWith("re:")) {
    let body = str.slice(3);
    let flags = "";

    const slashIdx = body.lastIndexOf("/");
    if (slashIdx !== -1) {
      const possibleFlags = body.slice(slashIdx + 1);
      if (/^[imsu]*$/.test(possibleFlags)) {
        flags = possibleFlags;
        body = body.slice(0, slashIdx);
      }
    }

    if (!body)
      return { valid: false, type: "regex", pattern: str, regex: null, error: "Empty regex after re:" };

    try {
      return { valid: true, type: "regex", pattern: str, regex: new RegExp(body, flags) };
    } catch (e) {
      return { valid: false, type: "regex", pattern: str, regex: null, error: "Invalid regex: " + e.message };
    }
  }

  try {
    return { valid: true, type: "glob", pattern: str, regex: globToRegex(str) };
  } catch (e) {
    return { valid: false, type: "glob", pattern: str, regex: null, error: "Invalid glob: " + e.message };
  }
}

const ALWAYS_VALIDATE = (s) => ({ value: s, valid: true, message: null });

/**
 * Create a validation function from a set of compiled pattern descriptors.
 * Patterns of type `none` are ignored and skipped.
 * Invalid patterns may be skipped according to `options.skipInvalid`.
 * If the resulting set of patterns to use for validation is empty,
 * the validator function returned validates any input as if no constraints
 * need to be applied.
 *
 * @param {object[]} descriptors - Array of descriptor objects. Each is the
 *   return value of {@link compilePattern} extended with:
 *   - `validWhenMatch: boolean`
 *   - `invalidMessage?: string`
 * @param {object} [options]
 * @param {"all"|"any"} [options.satisfy="all"] - How multiple patterns combine.
 * @param {boolean} [options.skipInvalid=false] - If true, descriptors with
 *   `valid: false` are silently skipped instead of throwing.
 * @param {(msg: string) => void} [options.log] - Called for each skipped pattern.
 * @returns {(str: string) => {value: string, valid: boolean, message: string|null}}
 * @throws {Error} If a descriptor is invalid and `skipInvalid` is false.
 */
export function createValidator(descriptors, { satisfy = "all",
                                               skipInvalid = false,
                                               log = () => {} } = {}) {
  const compiled = [];

  for (const d of descriptors) {
    if (!d.valid) {
      if (skipInvalid) {
        log(`Pattern "${d.pattern}" skipped: ${d.error}`);
        continue;
      }
      throw new Error(`Invalid pattern "${d.pattern}": ${d.error}`);
    }
    if (d.regex) { // skip patterns of type none
      compiled.push({regex: d.regex,
                     validWhenMatch: d.validWhenMatch,
                     invalidMessage: d.invalidMessage || `Failed on pattern "${d.pattern}"`,
    });
    }
  }

  // If no patterns or all are of type "none", there are no real constraints
  if (compiled.length === 0) {
    return ALWAYS_VALIDATE;
  }

  return function validateFrom(str) {
    for (const { regex, validWhenMatch, invalidMessage } of compiled) {
      const matched = regex.test(str);
      const valid = validWhenMatch ? matched : !matched;

      if (satisfy === "all" && !valid) {
        return { value: str, valid: false, message: invalidMessage || null };
      }
      if (satisfy === "any" && valid) {
        return { value: str, valid: true, message: null };
      }
    }

    if (satisfy === "all") return { value: str, valid: true, message: null };

    // "any" mode but none passed so join all messages
    const messages = compiled.map((p) => p.invalidMessage).filter(Boolean);
    return { value: str, valid: false,
             message: messages.length ? messages.join("\n") : null };
  };
}
