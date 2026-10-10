/* popup.js
 * Compose action popup logic to validate sender in case of problem.
 * Retrieves validation reason from background, and sends back user's decision.
 */

// @ts-nocheck

import {
  ComposeStatus,
  MSG_GET_VALIDATION_STATE,
  MSG_SEND_DECISION,
} from "../shared.js";

// Handle user decision
let _decided = false;

function decide(send) {
  if (_decided) return;
  _decided = true;
  browser.runtime.sendMessage({ type: MSG_SEND_DECISION, send });
}

document.getElementById("sendAnyway").addEventListener("click", () => {
  decide(true);
  window.close();
});

document.getElementById("goBack").addEventListener("click", () => {
  decide(false);
  window.close();
});

// On load: identify our compose window, then pull state:
(async () => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (!tabId) return;

  const state = await browser.runtime.sendMessage({
    type: MSG_GET_VALIDATION_STATE,
    tabId,
  });
  render(state);
})();

function render({ status, valid, message, from }) {
  const statusEl = document.getElementById("status");
  const prefixEl = document.getElementById("prefix");
  const fromEl = document.getElementById("from");
  const buttonsEl = document.getElementById("buttons");

  prefixEl.textContent = from && valid ? "✓ " : "✗ ";
  prefixEl.className = from && valid ? "valid" : "invalid";
  fromEl.textContent = from || "no sender";

  if (from) {
    if (valid) {
      statusEl.textContent = "Valid";
      statusEl.className = "valid";
    } else {
      statusEl.textContent = message || "Invalid";
      statusEl.className = "invalid";
    }
  } else {
    statusEl.textContent = "Please specify a sender";
    statusEl.className = "invalid";
  }

  buttonsEl.style.display = status === "sending" ? "flex" : "none";

  // Make the go back action the default, send requires explicit click
  if (status === ComposeStatus.SENDING) {
    document.getElementById("goBack").focus();
  }
  // Fallback when popup dismissed without a button click
  window.addEventListener("pagehide", () => {
    decide(false);
  });
}
