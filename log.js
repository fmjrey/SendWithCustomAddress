/* log.js
 * ES module for a leveled logger.
 */

let _verbose = 3;

/**
 * Leveled logger for the background context.
 *
 * @function log
 * @param {object|string} [conf] - Log config, or a console method name (e.g. "warn").
 * @param {"error"|"warn"|"log"|"debug"} [conf.cfn] - Console method to use.
 * @param {number} [conf.verbose] - Minimum verbose level required.
 * @param {...*} args - Values to log.
 *
 * @property {(msg: string) => void} error - Log at error level.
 * @property {(msg: string) => void} warn - Log at warn level.
 * @property {(msg: string) => void} info - Log at info level (verbose ≥ 1).
 * @property {(msg: string) => void} debug - Log at debug level (verbose ≥ 2).
 * @property {(msg: string) => void} trace - Log at trace level (verbose ≥ 3).
 * @property {(v: number) => void} setVerbose - Set the current verbose level.
 * @property {() => number} getVerbose - Get the current verbose level.
 */
export const log = (conf, ...args) => {
  if (typeof conf === "string") conf = { cfn: conf };
  if (conf.verbose && _verbose < conf.verbose) return;
  console[conf.cfn || "log"](...args);
};
log.error = log.bind(log, { cfn: "error" });
log.warn  = log.bind(log, { cfn: "warn" });
log.info  = log.bind(log, { cfn: "log", verbose: 1 });
log.debug = log.bind(log, { cfn: "debug", verbose: 2 });
log.trace = log.bind(log, { cfn: "debug", verbose: 3 });
log.setVerbose = (v) => { _verbose = v; };
log.getVerbose = () => _verbose;