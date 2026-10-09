// SPDX-License-Identifier: GPL-3.0-only

/* background.js
 * Thin orchestrator.
 */
import { log } from "./log.js";
import * as alias from "./alias.js";
import {
  defaultParse,
  extractMailboxes,
  normalizeRecipient,
  normalizeRecipients,
  addRaw,
  mailboxToString,
} from "./message.js";
import { ADDON_prefs } from "./options/th-addon-options.js";

// --- Alias aggregate ---
const source = () => ADDON_prefs.getPrefs(alias.STORAGE_KEYS);

async function init() {
  await alias.rebuild(source);
  log.info("initialized");
}

init();

// Dispatch storage updates
messenger.storage.local.onChanged.addListener((changes) => {
  if (alias.STORAGE_KEYS.some((k) => changes[k])) {
    alias.rebuild(source);
  }
});

const stringToMailbox = messenger.messengerUtilities?.parseMailboxString
  ? (str) =>
      messenger.messengerUtilities
        .parseMailboxString(str)
        .then((p) => addRaw(p, str))
  : defaultParse;

// Track compose windows with a map from tabId to "compose" | "sending".
const stages = new Map();

// --- onCreated: prefill From on reply ---
messenger.tabs.onCreated.addListener(async (tab) => {
  if (tab.type !== "messageCompose") return;
  stages.set(tab.id, "compose");
  log.info("compose tab created:", tab.id);
  await setButtonState(tab.id, "reset");
  ensurePolling();

  let details;
  for (let i = 1; i < 5; i++) {
    try {
      details = await messenger.compose.getComposeDetails(tab.id);
      log.info(`getComposeDetails #${i}`, details);
      break;
    } catch (e) {
      if (i === 4) {
        log.debug(`getComposeDetails failed after ${i} attempts`);
        return;
      }
      await sleep(100);
    }
  }

  // Only act on replies with a related message:
  if (details.type !== "reply" || !details.relatedMessageId) return;

  try {
    const full = await messenger.messages.getFull(details.relatedMessageId);
    log.debug("related message", full);
    const mailboxes = await extractMailboxes(
      full.headers,
      ["from", "x-original-to", "delivered-to", "envelope-to", "to"],
      stringToMailbox,
    );
    log.debug("extracted mailboxes", mailboxes);

    // Find the first candidate that satisfies validation:
    const match = mailboxes.find((m) => alias.validateFrom(m.email).valid);
    if (match) {
      const from = mailboxToString(match);
      await messenger.compose.setComposeDetails(tab.id, { from });
      log.info("From set to:", from);
    } else {
      log.info("no matching address in headers");
    }
  } catch (e) {
    log.warn("onCreated error:", e.message);
  }
});
log.debug("onCreated listener registered");

messenger.tabs.onRemoved.addListener((tabId) => {
  stages.delete(tabId);
});

// --- onBeforeSend: validate and optionally block ---
messenger.compose.onBeforeSend.addListener(async (tab, details) => {
  stages.set(tab.id, "sending");
  log.debug("onBeforeSend details", details);
  const fromMailboxes = await normalizeRecipient(details.from, stringToMailbox);
  const from = fromMailboxes[0]?.email || "";
  log.debug("onBeforeSend from", from);

  if (!from) return;

  const result = alias.validateFrom(from);
  log.debug("onBeforeSend validateFrom", result);
  if (result.valid) return; // no issue, proceed

  // Show the popup:
  await messenger.composeAction.enable(tab.id);
  const opened = await messenger.composeAction.openPopup({
    windowId: tab.windowId,
  });
  if (!opened) {
    log.warn("compose popup could not be opened");
    return { cancel: true };
  }

  // Wait for the user's decision:
  const decision = await new Promise((resolve) => {
    const listener = (msg) => {
      if (msg.type === "sendDecision") {
        browser.runtime.onMessage.removeListener(listener);
        log.debug(`[Tab ${tab.id}] Send anyway: ${msg.send}`);
        resolve(msg.send);
      }
    };
    browser.runtime.onMessage.addListener(listener);

    // Timeout: if popup is closed without a decision, cancel:
    setTimeout(() => {
      browser.runtime.onMessage.removeListener(listener);
      log.debug(`[Tab ${tab.id}] send cancelled after timeout`);
      resolve(false);
    }, 60000);
  });

  stages.set(tab.id, "compose");
  if (!decision) return { cancel: true };
  // else: user chose "send anyway" — return nothing, send proceeds
});
log.debug("onBeforeSend listener registered");

// Message router
browser.runtime.onMessage.addListener(async (msg) => {
  switch (msg.type) {
    case "getValidationState":
      const response = await getValidationState(msg.tabId);
      log.debug("getValidationState", response);
      return response;
    case "validateFrom":
      return Promise.resolve(alias.validateFrom(msg.address));
  }
});

async function getValidationState(tabId) {
  if (!tabId || !stages.has(tabId)) {
    return { valid: true, message: "", from: "" };
  }
  try {
    const details = await messenger.compose.getComposeDetails(tabId);
    const fromMailboxes = await normalizeRecipient(
      details.from,
      stringToMailbox,
    );
    const from = fromMailboxes[0]?.email || "";
    const result = alias.validateFrom(from);
    const response = {
      stage: stages.get(tabId),
      valid: result.valid,
      message: result.message,
      from,
    };
    return response;
  } catch (e) {
    return { stage: stages.get(tabId), valid: true, message: "", from: "" };
  }
}

/*
The button icon needs to change according to the validation state.
The composeAction API event `onIdentityChanged` provides a hook to detect
identity change in the From field.
One caveat: manually changing the From adress overrides the header but does
not change the identity. So if a user manually edits the From field in the
compose window rather than switching identities, onIdentityChanged won't fire.
Regular polling of `getComposeDetails(tabId).from` is required.
*/

const ICONS = {
  valid:   { 32: "icons/alias-valid.svg",   48: "icons/alias-valid.svg" },
  invalid: { 32: "icons/alias-invalid.svg", 48: "icons/alias-invalid.svg" },
};

async function setButtonState(tabId, state) {
  if (state === "reset") return; // default_icon from manifest applies
  await messenger.composeAction.setIcon({ tabId, path: ICONS[state] });
}

messenger.compose.onIdentityChanged.addListener(async (tab, identityId) => {
  const identity = await messenger.identities.get(identityId);
  log.debug("onIdentityChanged", tab.id, identity);
  const { valid } = alias.validateFrom(identity.email);
  await setButtonState(tab.id, valid ? "valid" : "invalid");
});
log.debug("onIdentityChanged listener registered");

// same poll timer for all compose tabs
let pollTimer = null;

function ensurePolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    for (const [tabId, stage] of stages) {
      if (stage !== "compose") continue;
      const { valid } = await getValidationState(tabId);
      await setButtonState(tabId, valid ? "valid" : "invalid");
    }
    if (stages.size === 0) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }, 2000);
}

// -- utils --

const sleep = (ms) => new Promise((resolve) => setTimeout(() => resolve(), ms));
