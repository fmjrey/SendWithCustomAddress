// SPDX-License-Identifier: GPL-3.0-only
/* background.js
 * Thin orchestrator.
 * Wires storage → alias.js, routes messages from compose.js.
 */
import { log } from "./log.js";
import * as alias from "./alias.js";
import { ADDON_prefs } from "./options/th-addon-options.js";

/*
Logging flow
============
Thunderbird does not centralize all add-on log/console messages in one place.
To that end logging is defined in the log.js ES module for consumption by
high level ES modules that can afford the dependency.
A similarly shaped logging logic can be found in shared/log-classic.js for
consumption by classic scripts via Thunderbird script injection/registration.
That classic version forwards logging to background.js, by message passing, so
they can be printed on the add-on console, where all messages are centralized.
The verbosity level is defined in log.js and pushed by background.js
to the setVerbose message handler defined in log-classic.js.

background.js (high level ES module)
  import { log } from "./log.js"
  │
  │  log.info("..."), log.warn("..."), etc.
  │  output to the console visible when inspecting/debugging add-ons
  │
  │  pushVerbose() → tabs.sendMessage({ type: "setVerbose", 
  |                          |          verbose: log.getVerbose() })
  │                          │
  │                          ▼
  │                    shared/log-classic.js injected in compose window sets
  │                    window.__alias.Log.setVerbose(verbose)
  │                          │
  |                    the classic script compose.js can now call 
  │                    Log.info("..."), Log.debug("..."), etc.
  │                          │
  │                    sendMessage({ type: "log", cfn, args })
  │                          │
  │                          ▼
  │                    background.js onMessage
  │                    console[cfn]("[compose]", ...args)
  │                          │
  │                          ▼
  │                    Debug Add-ons console where you see everything
  │
alias.js (High level ES module)
  import { log } from "./log.js"
  │
  │  provides pattern.js (low level utility ES module that can't afford a
  |  dependency to log.js) with a reference to log.warn so that skipped
  |  patterns are logged as warnings
  │
options/options.js (ES module that can afford the log.js dependency)
  import { log } from "../log.js"
  │
  │  log.warn("Invalid pattern in ...") visible in add-on console
*/

// --- Alias aggregate ---
const source = () => ADDON_prefs.getPrefs(alias.STORAGE_KEYS);

async function init() {
  await alias.rebuild(source);
  pushVerbose();
}

init();

// --- Push verbose to all compose windows ---
function pushVerbose() {
  browser.tabs
    .query({ windowType: "messageCompose" })
    .then((tabs) =>
      tabs.forEach((tab) =>
        browser.tabs
          .sendMessage(tab.id, {
            type: "setVerbose",
            verbose: log.getVerbose(),
          })
          .catch(() => {}),
      ),
    );
}

// Live updates
messenger.storage.local.onChanged.addListener((changes) => {
  if (alias.STORAGE_KEYS.some((k) => changes[k])) {
    alias.rebuild(source);
  }
  if (changes.verbose) {
    verbose = changes.verbose.newValue;
    pushVerbose();
  }
});

// Message router
browser.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "validateFrom":
      return Promise.resolve(alias.validateFrom(msg.address));
    case "log":
      console[msg.cfn || "log"]("[compose]", ...msg.args);
      break;
    /* For later
    case "storeAssoc":
      return Promise.resolve((() => {
        // alias.store(msg.recipient, msg.alias);
      })());
    case "lookupAlias":
      return Promise.resolve((() => {
        // return alias.lookup(msg.recipient);
        })());
    */
  }
});

// Inject/register compose script
const existing = await messenger.scripting.compose.getRegisteredScripts({
  ids: ["compose-with-alias"],
});
if (existing.length === 0) {
  await messenger.scripting.compose.registerScripts([
    {
      id: "compose-with-alias",
      js: ["shared/log-classic.js", "compose/compose.js"],
      css: ["compose/compose.css"],
    },
  ]);
  log.info("compose script registered");
}

const on_compose_start = async (tab, win) => {
  // HACK: in some scenarios (draft, mailto, auto-bcc), calling
  // getComposeDetails immediately after tab is created causes some
  // message details to be lost, need to sleep to avoid this
  // TODO check if still needed as per
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1675012
  await sleep(10);

  let msg = await messenger.compose.getComposeDetails(tab.id);
  log.info(
    "on_compose_start",
    json2({
      tab: {
        id: tab.id,
        win_id: tab.windowId,
        url: tab.url,
        status: tab.status,
      },
      win: { id: win.id, type: win.type },
      details: msg,
    }),
  );

  // recipients are not always available right away, so need to wait
  // TODO check if this is still needed as per
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1785851
  // which seems to indicate that getComposeDetails() called from
  // onClicked / onBeforeSend may still return stale recipient data
  if (!is_new(msg)) {
    let waits = [1, 10, 25, 50, 100, 100, 100, 100]; // total: 486
    for (let i = 0; !msg.to.length && !msg.cc.length && i < waits.length; i++) {
      await sleep(waits[i]);
      msg = await messenger.compose.getComposeDetails(tab.id);
    }
    log.info("final details", json2(msg));
  }

  // Check if From field is set and valid
  let msgFrom = msg.from.trim();
  const v = alias.validateFrom(msgFrom);
  log.info("msgFrom", json2(v));
  if (v.valid) return;

  if (is_reply(msg)) {
    // Get the recipient of the original message being replied to
    let oriMsg = await messenger.messages.getFull(msg.relatedMessageId);
    // First look into the x-original-to header
    let originalTo = null;
    if (oriMsg) {
      log.info("orimessage", json2({ headers: oriMsg.headers }));
      originalTo = oriMsg.headers["x-original-to"]
        ? oriMsg.headers["x-original-to"][0]
        : null;
    }
    let identityName = splitAddr(msg.from);
    // Check also the to header, which may contain multiple recipients
    if (oriMsg && oriMsg.headers["to"].length == 1) {
      if (!originalTo) {
        //originalTo = oriMsg.headers['to'][0];
        // When more than one recipient, take the first one different from
        // the sender to cover the case of a sender sending to oneself
        // https://github.com/ThierryBZH/ReplyAsOriginalRecipient/pull/4/
        let split_recipients = oriMsg.headers["to"][0].split(", ");
        if (split_recipients.length > 1) {
          let addr;
          for (addr in split_recipients) {
            if (
              splitAddr(split_recipients[addr])[1] !=
              splitAddr(oriMsg.headers["from"][0])[1]
            ) {
              originalTo = split_recipients[addr];
              break;
            }
          }
        }
        if (!originalTo) originalTo = oriMsg.headers["to"][0];
      } else {
        // Take name from To if not found in OriginalTo
        const [toName, toAddr] = splitAddr(oriMsg.headers["to"][0]);
        if (!identityName[0] && toName !== null && toAddr == originalTo) {
          identityName[0] = toName;
        }
      }
    }

    if (originalTo) {
      let splitted = splitAddr(originalTo);
      if (splitted[0]) identityName[0] = splitted[0];
      if (splitted[1]) identityName[1] = splitted[1];
    }
    const name = (identityName[0] || "").trim();
    const email = (identityName[1] || "").trim();
    originalTo = (name ? name + " " : "") + "<" + email + ">";
    await messenger.compose.setComposeDetails(tab.id, { from: originalTo });
    msg = await messenger.compose.getComposeDetails(tab.id);
  }

  // HACK: editing CC causes focus to move to CC field, which is not useful.
  // Least bad solution is to fix focus manually to body/to.
  // Explanation: The address fields in the compose window (To, Cc, Bcc) are
  // <richlistbox> elements. When an addon modifies the CC field — whether
  // via compose.update({ cc: [...] }) or direct DOM manipulation — the CC
  // widget grabs keyboard focus as a side effect. The user's cursor jumps
  // from wherever they were into the CC input field.
  // See https://github.com/cyb3rmonk/reply-all-auto-cc/commit/82ea7f366c453fb6bd83eebd5fd175eefea8be73
  for (let delay of [0, 1, 10, 10]) {
    if (delay) await sleep(delay);
    await set_compose_focus(
      tab.id,
      (is_reply(msg) && "body") || (!msg.to.length && "to") || "body",
      { msg },
    );
  }
};

const set_compose_focus = async (tab_id, target, opt) => {
  log.info(`setting compose focus to '${target}'`);
  if (target == "to" || target == "cc" || target == "bcc") {
    let msg = opt && opt.msg;
    if (!msg) msg = await messenger.compose.getComposeDetails(tab_id);
    let orig_v = msg[target];
    await messenger.compose.setComposeDetails(tab_id, {
      [target]: [...orig_v, "x"],
    });
    await messenger.compose.setComposeDetails(tab_id, { [target]: orig_v });
  } else if (target == "body") {
    //await messenger.tabs.executeScript(tab_id, { code: "window.focus()" });
    await messenger.scripting.executeScript({
      target: { tabId: tab_id },
      func: () => window.focus(),
    });
  } else {
    throw new Error("Invalid focus target: " + target);
  }
};

// type field was added in thunderbird 88
// before, we check for "Re: " prefix in subject to detect
const is_reply = (msg) => {
  if (msg.type) return msg.type == "reply";
  return (msg.subject || "").startsWith("Re: ");
};

const is_new = (msg) => {
  if (msg.type) return msg.type == "new";
  return !msg.subject;
};

const splitAddr = (addr) => {
  var lIoLower = addr.lastIndexOf("<");
  var lIoGreater = addr.lastIndexOf(">");

  var fullName = null,
    emailAddr = null;
  if (lIoLower == -1) {
    if (addr.lastIndexOf("@") != -1) {
      emailAddr = addr.trim();
    }
  } else if (lIoLower < lIoGreater) {
    emailAddr = addr.substring(lIoLower + 1, lIoGreater);
    fullName = addr.substring(0, lIoLower).trim();
  }

  return [fullName, emailAddr];
};

messenger.tabs.onCreated.addListener((tab) => {
  log.trace("tabs.onCreated", tab);
  let win = messenger.windows.get(tab.windowId);
  if (win && win.type == "messageCompose") on_compose_start(tab, win);
});

messenger.tabs.onUpdated.addListener((tab_id, changes, tab) => {
  log.trace("tabs.onUpdated", { tab_id, changes, tab });
});

messenger.windows.onCreated.addListener(async (win) => {
  if (win.type != "messageCompose") return;
  let win_tabs = await messenger.tabs.query({ windowId: win.id });
  log.trace("win_tabs", win_tabs);
  if (win_tabs.length) {
    if (win_tabs.length > 1)
      log.warn("compose window has multiple tabs:", tabs);
    on_compose_start(win_tabs[win_tabs.length - 1], win);
  }
});

// -- utils --

const sleep = (ms) => new Promise((resolve) => setTimeout(() => resolve(), ms));

const json2 = (v) => JSON.stringify(v, null, 2);
const json0 = (v) => JSON.stringify(v);
