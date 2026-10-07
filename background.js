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

// --- onCreated: prefill From on reply ---
messenger.tabs.onCreated.addListener(async (tab) => {
  if (tab.type !== "messageCompose") return;
  log.info("compose tab created:", tab.id);

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
    log.debug("mailboxes", mailboxes);

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

// Track compose windows with a map from tabId to "compose" | "sending".
const stages = new Map();
messenger.tabs.onCreated.addListener((tab) => {
  if (tab.type === "messageCompose") {
    stages.set(tab.id, "compose");
  }
});
messenger.tabs.onRemoved.addListener((tabId) => {
  stages.delete(tabId);
});

// --- onBeforeSend: validate and optionally block ---
messenger.compose.onBeforeSend.addListener(async (tab, details) => {
  log.debug("onBeforeSend details", details);
  const fromMailboxes = await normalizeRecipient(details.from, stringToMailbox);
  const from = fromMailboxes[0]?.email || "";
  log.debug("onBeforeSend from", from);

  if (!from) return;

  const result = alias.validateFrom(from);
  log.debug("onBeforeSend validateFrom", result);
  if (result.valid) return; // no issue, proceed

  // Show the popup:
  stages.set(tab.id, "sending");
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
      log.debug("getValidationState", msg);
      if (!msg.tabId) {
        return { stage: stages.get(msg.tabId), valid: true, message: "", from: "" };
      }
      try {
        const details = await messenger.compose.getComposeDetails(msg.tabId);
        const fromMailboxes = await normalizeRecipient(
          details.from,
          stringToMailbox,
        );
        const from = fromMailboxes[0]?.email || "";
        const result = alias.validateFrom(from);
        const response = {
          stage: stages.get(msg.tabId),
          valid: result.valid,
          message: result.message,
          from
        };
        log.debug("getValidationState response", response);
        return response;
      } catch (e) {
        return { stage: stages.get(msg.tabId), valid: true, message: "", from: "" };
      }
    case "validateFrom":
      return Promise.resolve(alias.validateFrom(msg.address));
  }
});

// -- utils --

const sleep = (ms) => new Promise((resolve) => setTimeout(() => resolve(), ms));
