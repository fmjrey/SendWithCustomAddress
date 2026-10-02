/* options.js
 * ES module, options page validation.
 */
import { log } from "../log.js";
import { compilePattern } from "../pattern.js";
import { STORAGE_KEYS as fields } from "../alias.js";

function showError(id, msg) {
  document.getElementById(id + '-error').textContent = msg;
  document.getElementById(id).setAttribute("aria-invalid", "true");
}

function clearError(id) {
  document.getElementById(id + '-error').textContent = "";
  document.getElementById(id).removeAttribute("aria-invalid");
}

// Validate patterns
for (const id of fields) {
  const el = document.getElementById(id);
  const errEl = document.getElementById(id + '-error');
/*
  el.addEventListener("input", () => {
    if (el.getAttribute("aria-invalid") === "true") {
       const result = compilePattern(el.value);
      if (result.valid) clearError(id);
    }
  });

  el.addEventListener("blur", () => {
    const value = el.value.trim();
    if (!value) { clearError(id); return; }
    const { valid, error } = compilePattern(value);
    if (!valid) showError(id, error);
  });
*/
  el.addEventListener("focus", () => { el._dirty = false; });
  el.addEventListener("input", () => {
    el._dirty = true;
    if (el.getAttribute("aria-invalid") === "true") {
      const { valid } = compilePattern(el.value);
      if (valid) clearError(id);
    }
  });
  el.addEventListener("blur", () => {
    if (!el._dirty) return;  // ← skip if user never typed
    const value = el.value.trim();
    if (!value) { clearError(id); return; }
    const { valid, error } = compilePattern(value);
    if (!valid) {
      log.warn(`Invalid pattern in ${id}:`, error);
      showError(id, error);
    }
  });
    
}
