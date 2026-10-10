// SPDX-License-Identifier: GPL-3.0-only

/* background.js
 * Thin orchestrator.
 */
import { log } from "./log.js";
import * as alias from "./alias.js";
import { parsedRecipientToString, normalizeRecipient } from "./message.js";
import { ADDON_prefs } from "./options/th-addon-options.js";
import {
  ComposeStatus,
  MSG_VALIDATE_FROM,
  MSG_GET_VALIDATION_STATE,
  MSG_SEND_DECISION,
  sleep,
} from "./shared.js";

/** @type {any} */
const messenger = globalThis.messenger;

/**
 * @typedef {import("./message.js").NormalizedHeaders} NormalizedHeaders
 */

// --- Compose State ---
/**
 * The compose tab state worth saving in session storage.
 * @typedef {Object} ComposeTabState
 * @property {ComposeStatus} status - the current status as set by tabs
 *   `onCreated` and `onRemoved` event handlers.
 * @property {NormalizedHeaders} [relatedHeaders] - the headers of the
 *   mail being replied to, normalized with `normalizeHeaders()`.
 *   Set once when compose tab is created.
 */

/**
 * @typedef {number} TabId
 */

/**
 * The addon state stored in session storage.
 * This background script can be terminated if no external event keept it
 * going. Session storage is what can survive the restarts, but only the
 * more stable and costly to compute data should be stored in session.
 * @typedef {Record<TabId, ComposeTabState>} AddonState
 */

const ADDON_STATE_KEY = "addon_state";

/**
 * @param {TabId} tabId
 * @returns {Promise<ComposeTabState | null>}
 */
async function getTabState(tabId) {
  const { [ADDON_STATE_KEY]: states = {} } =
    await messenger.storage.session.get(ADDON_STATE_KEY);
  return states[tabId] ?? null;
}

/**
 * @param {TabId} tabId
 * @returns {Promise<void>}
 */
async function removeTabState(tabId) {
  const { [ADDON_STATE_KEY]: states = {} } =
    await messenger.storage.session.get(ADDON_STATE_KEY);
  delete states[tabId];
  await messenger.storage.session.set({ [ADDON_STATE_KEY]: states });
}

/**
 * @param {TabId} tabId
 * @param {ComposeStatus} status
 * @returns {Promise<{success: boolean, tabState: ComposeTabState}>}
 */
async function setTabStatus(tabId, status) {
  const { [ADDON_STATE_KEY]: states = {} } =
    await messenger.storage.session.get(ADDON_STATE_KEY);
  const tabState = states[tabId];
  let success = false;
  switch (status) {
    case ComposeStatus.COMPOSING:
      // either the compose window was just opened or user cancelled sending
      states[tabId] = { ...tabState, status: ComposeStatus.COMPOSING };
      await messenger.storage.session.set({ [ADDON_STATE_KEY]: states });
      success = true;
      break;
    case ComposeStatus.SENDING:
      if (tabState?.status != ComposeStatus.COMPOSING) {
        log.error(
          `setTabStatus(${tabId}, ${status}): tab status is not ${ComposeStatus.COMPOSING}`,
          tabState,
        );
        break;
      } else {
        states[tabId] = { ...tabState, status: ComposeStatus.SENDING };
        await messenger.storage.session.set({ [ADDON_STATE_KEY]: states });
        success = true;
        break;
      }
    default:
      // Exhaustiveness check: a new type not handled yields an error
      /** @type {never} */ (status); // dev time error
      throw new Error(`Unknown compose status: ${status}`); // runtime error
  }
  return { success, tabState };
}

/**
 * @param {TabId} tabId
 * @param {NormalizedHeaders} headers
 * @returns {Promise<boolean>} false if the tab is no longer composing
 */
async function setTabHeadersBeingRepliedTo(tabId, headers) {
  const { [ADDON_STATE_KEY]: states = {} } =
    await messenger.storage.session.get(ADDON_STATE_KEY);
  const tabState = states[tabId];
  if (!tabState) {
    log.error(
      `setTabHeadersBeingRepliedTo(${tabId}, headers): state undefined`,
    );
    return false;
  } else if (tabState.status !== ComposeStatus.COMPOSING) {
    log.warn(
      `setTabHeadersBeingRepliedTo(${tabId}, headers): status is '${tabState?.status}'`,
    );
    return false;
  } else {
    states[tabId].relatedHeaders = headers;
    await messenger.storage.session.set({ [ADDON_STATE_KEY]: states });
    return true;
  }
}

// --- Storage for alias aggregate ---

const source = () =>
  /** @type {Promise<{fromPattern: string, notFromPattern: string}>} */ (
    ADDON_prefs.getPrefs(alias.STORAGE_KEYS)
  );

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

// --- onCreated: prefill From on reply ---

messenger.tabs.onCreated.addListener(async (tab) => {
  if (tab.type !== "messageCompose" || tab.id == null) return;
  const { success } = await setTabStatus(tab.id, ComposeStatus.COMPOSING);
  if (!success) return;
  log.info(`[Tab ${tab.id}] onCreated: compose tab created:`);
  ensurePolling();

  let details;
  for (let i = 1; i < 5; i++) {
    try {
      details = await messenger.compose.getComposeDetails(tab.id);
      log.debug(`[Tab ${tab.id}] onCreated: getComposeDetails #${i}`, details);
      break;
    } catch (e) {
      if (i === 4) {
        log.debug(
          `[Tab ${tab.id}] onCreated: getComposeDetails failed after ${i} attempts`,
        );
        return;
      }
      await sleep(100);
    }
  }

  // Only act on replies with a related message:
  if (details.type !== "reply" || !details.relatedMessageId) {
    log.info(`[Tab ${tab.id}] onCreated: No related message`);
    return;
  }

  try {
    const full = await messenger.messages.getFull(details.relatedMessageId);
    log.debug(`[Tab ${tab.id}] onCreated: related message`, full);
    const { sender, relatedHeaders } = await alias.bestSenderFor(full.headers);
    if (relatedHeaders) {
      const ok = await setTabHeadersBeingRepliedTo(tab.id, relatedHeaders);
      if (!ok) return;
    }
    if (sender) {
      const from = parsedRecipientToString(sender);
      await messenger.compose.setComposeDetails(tab.id, { from });
      log.info(`[Tab ${tab.id}] onCreated: From set to ${from}`);
    } else {
      log.info(
        `[Tab ${tab.id}] onCreated: No sender derived from related headers`,
      );
    }
  } catch (e) {
    log.warn(
      `[Tab ${tab.id}] onCreated: error`,
      e instanceof Error ? e.message : String(e),
    );
  }
});
log.debug("onCreated listener registered");

messenger.tabs.onRemoved.addListener((tabId) => {
  if (!tabId) return;
  removeTabState(tabId);
});

// --- onBeforeSend: validate and optionally block ---

messenger.compose.onBeforeSend.addListener(async (tab, details) => {
  const { success, tabState } = await setTabStatus(
    tab.id,
    ComposeStatus.SENDING,
  );
  if (!success) return;

  log.debug(`[Tab ${tab.id}] onBeforeSend: details`, details);
  const fromMailboxes = await normalizeRecipient(details.from);
  const from = fromMailboxes[0]?.email || "";
  log.debug(`[Tab ${tab.id}] onBeforeSend: from`, from);

  if (!from) return;

  const result = alias.validateFrom(from);
  log.debug(`[Tab ${tab.id}] onBeforeSend: validateFrom`, result);
  if (result.valid) return; // no issue, proceed

  // Show the popup:
  await messenger.composeAction.enable(tab.id);
  const opened = await messenger.composeAction.openPopup({
    windowId: tab.windowId,
  });
  if (!opened) {
    log.warn(`[Tab ${tab.id}] onBeforeSend: compose popup could not be opened`);
    await setTabStatus(tab.id, ComposeStatus.COMPOSING);
    return { cancel: true };
  }

  // Wait for the user's decision:
  const send = await new Promise((resolve) => {
    const listener = (msg) => {
      if (msg.type === MSG_SEND_DECISION) {
        messenger.runtime.onMessage.removeListener(listener);
        log.debug(`[Tab ${tab.id}] Send anyway: ${msg.send}`);
        resolve(msg.send);
      }
    };
    messenger.runtime.onMessage.addListener(listener);

    // Timeout: if popup is closed without a decision, cancel:
    setTimeout(() => {
      messenger.runtime.onMessage.removeListener(listener);
      log.debug(`[Tab ${tab.id}] Send cancelled after timeout`);
      resolve(false);
    }, 60000);
  });

  if (!send) {
    await setTabStatus(tab.id, ComposeStatus.COMPOSING);
    return { cancel: true };
  } // else return nothing, send proceeds
});
log.debug("onBeforeSend listener registered");

// --- Messaging ---

messenger.runtime.onMessage.addListener(async (msg) => {
  switch (msg.type) {
    case MSG_GET_VALIDATION_STATE:
      const response = await getValidationState(msg.tabId);
      log.debug(`[Tab ${msg.tabId}] ${MSG_GET_VALIDATION_STATE}`, response);
      return response;
    case MSG_VALIDATE_FROM:
      return Promise.resolve(alias.validateFrom(msg.address));
  }
});

const VALID_DEFAULT = { valid: true, message: "", from: "" };
async function getValidationState(tabId) {
  if (!tabId) return VALID_DEFAULT;
  const tabState = await getTabState(tabId);
  if (!tabState) return VALID_DEFAULT;
  try {
    const details = await messenger.compose.getComposeDetails(tabId);
    const fromMailboxes = await normalizeRecipient(details.from);
    const from = fromMailboxes[0]?.email || "";
    const result = alias.validateFrom(from);
    const response = {
      status: tabState.status,
      valid: result.valid,
      message: result.message,
      from,
    };
    return response;
  } catch (e) {
    return { status: tabState.status, valid: true, message: "", from: "" };
  }
}

// --- Compose Popup button ---

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
  default: { 32: "icons/icon.svg", 48: "icons/icon.svg" },
  valid: { 32: "icons/alias-valid.svg", 48: "icons/alias-valid.svg" },
  invalid: { 32: "icons/alias-invalid.svg", 48: "icons/alias-invalid.svg" },
};

/** @typedef {'default' | 'valid' | 'invalid' } IconType */
/** @type {Record<'DEFAULT' | 'VALID' | 'INVALID', IconType>} */
export const IconType = {
  DEFAULT: "default",
  VALID: "valid",
  INVALID: "invalid",
};

async function setButtonState(tabId, type) {
  await messenger.composeAction.setIcon({ tabId, path: ICONS[type] });
}

messenger.compose.onIdentityChanged.addListener(async (tab, identityId) => {
  const identity = await messenger.identities.get(identityId);
  log.debug(`[Tab ${tab.id}] onIdentityChanged`, identity);
  const { valid } = alias.validateFrom(identity.email);
  await setButtonState(tab.id, valid ? IconType.VALID : IconType.INVALID);
});
log.debug("onIdentityChanged listener registered");

// same poll timer for all compose tabs
let pollTimer = null;

function ensurePolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const { [ADDON_STATE_KEY]: state = {} } =
      await messenger.storage.session.get(ADDON_STATE_KEY);
    for (const [tabIdStr, { status }] of Object.entries(state)) {
      const tabId = Number(tabIdStr);
      if (status === ComposeStatus.COMPOSING) {
        const { valid } = await getValidationState(tabId);
        await setButtonState(tabId, valid ? IconType.VALID : IconType.INVALID);
      }
    }
    if (Object.keys(state).length === 0) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }, 2000);
}
