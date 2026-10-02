/* compose.js
 * Classic script, thin DOM forwarder with no business logic.
 * Listens for events, messages background, paints result.
 */
(function () {
  "use strict";
  
  const Log = window.__alias.Log; // must be injected/registered beforehand

  console.log("compose script running");

  let pollCount = 0;
  function init() {
    // The compose script runs in the editor's document.
    // #msgIdentity is in the main compose window (parent frame).
    const mainDoc = window.top.document;
    const fromField = mainDoc.getElementById("msgIdentity");
    if (!fromField) {
      if (++pollCount <= 20) {  // log first 20 polls (~1 second)
        Log.debug("polling msgIdentity...", pollCount);
        setTimeout(init, 50);
      } else {
        Log.warn("msgIdentity element not found",
          [window.top.document.body?.children || []].map(c => c.id || c.tagName).join(", ")
        );
      }
      return;
    }
    Log.debug("msgIdentity found after", pollCount, "polls");
    let attempts = 0;
    const handler = () => {
      const email = getFromAddress(fromField);
      Log.debug("validateFrom:", email);
      browser.runtime.sendMessage({ type: "validateFrom", address: email })
        .then(({ valid, message }) => {
          Log.debug("result:", valid, message);
          fromField.classList.toggle("from-invalid", !valid);
          fromField.title = valid ? "" : (message || "");
        })
        .catch((err) => {
          if (++attempts < 3) setTimeout(handler, 50);
          else Log.warn("background unreachable after 3 attempts:", err);
        });
    };
    fromField.addEventListener("valuechanged", handler);
    fromField.addEventListener("blur", handler);
  }

  /*
  // --- Recipients (future: store association on blur) ---
  const recipients = document.getElementById("recipients");
  if (recipients) {
    recipients.addEventListener("blur", () => {
      const to = getAddresses(recipients, "to");
      browser.runtime.sendMessage({ type: "storeAssoc", recipient: to[0], alias: // ...
      });
    });
  }
 */

  if (document.readyState === "loading") {
    Log.warn("compose window still loading");
    document.addEventListener("DOMContentLoaded", init);
  } else {
    Log.info("compose window loaded");
    init();
  }

  // --- Helpers ---
  function getFromAddress(el) {
    const selected = el.selectedItem;
    if (selected && selected.email) return selected.email;
    return el.value || "";
  }

  /*
  function getAddresses(container, field) {
    const row = container.querySelector(`[type="${field}"]`);
    if (!row) return [];
    return [...row.querySelectorAll("address")].map((a) => a.value);
  }
  */
})();
