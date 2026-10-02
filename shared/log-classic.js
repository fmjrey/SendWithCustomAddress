/* log-classic.js
 * Classic script.
 * Sets window.__alias.Log for use in classic-script contexts like compose.
 * Must be loaded BEFORE the consuming script in the registerScripts js array.
 */
(function () {
  "use strict";

  let _verbose = 3;

  const log = (conf, ...args) => {
    if (typeof conf === "string") conf = { cfn: conf };
    if (conf.verbose && _verbose < conf.verbose) return;
    browser.runtime.sendMessage({ type: "log", cfn: conf.cfn || "log", args }).catch(() => {});
  };
  log.error = log.bind(log, { cfn: "error" });
  log.warn  = log.bind(log, { cfn: "warn" });
  log.info  = log.bind(log, { cfn: "log", verbose: 1 });
  log.debug = log.bind(log, { cfn: "debug", verbose: 2 });
  log.trace = log.bind(log, { cfn: "debug", verbose: 3 });
  log.setVerbose = (v) => { _verbose = v; };

  // Namespace with ownership guard:
  if (window.__alias && !window.__alias._owner) {
    console.warn("[alias] __alias namespace already in use");
  }
  window.__alias = window.__alias || {};
  window.__alias._owner = "from-validator";
  window.__alias.Log = log;

  // Listen for verbose pushes from background:
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "setVerbose") log.setVerbose(msg.verbose);
  });
})();   