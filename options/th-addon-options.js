/*
 *  Copyright  Mic  (email: m@micz.it)
 *
 *  This Source Code Form is subject to the terms of the Mozilla Public
 *  License, v. 2.0. If a copy of the MPL was not distributed with this
 *  file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * 
 *  This file is avalable in the original repo: https://github.com/micz/Thunderbird-Addon-Options-Manager
 * 
 */


import { prefs_default } from './th-addon-options-default.js';

export const ADDON_prefs = {

  logger: console,

  // Preferences matching this predicate are never logged: their value is
  // replaced by a mask. Override it to widen or narrow the rule.
  isSecretPref: (pref_id) => /(_api_key|_token|_secret|password)$/i.test(pref_id),

  // Ids of the selects that have a legitimate empty <option> (a placeholder, or
  // an "inherit"/"none" entry with value=""). For those the empty value is
  // selected instead of blanking the control.
  selectsWithEmptyOption: [],

  // Override this outright for cases selectsWithEmptyOption cannot express.
  hasEmptyValueOption(element_id = '') {
    // Matches exact ids and suffixes, so per-feature pages that prefix every
    // field id (e.g. "summarize_connection_type") work with a single entry.
    return ADDON_prefs.selectsWithEmptyOption.some(
      (suffix) => element_id === suffix || element_id.endsWith(`_${suffix}`)
    );
  },

  // Called once per element after restoreOptions() has set its value. This is
  // the extension point for third-party widgets wrapping an input (see README).
  afterRestoreElement: (element, value) => {},

  // Returns the value to write in a log message, masked if the pref is secret.
  _logValue(pref_id, value) {
    return ADDON_prefs.isSecretPref(pref_id) ? '********' : value;
  },

  // The custom logger is only required to implement log(), so fall back to it.
  _logWarning(message) {
    if (typeof ADDON_prefs.logger.warn === 'function') {
      ADDON_prefs.logger.warn(message);
    } else {
      ADDON_prefs.logger.log(message);
    }
  },

  saveOptions(e) {
    e.preventDefault();
    let options = {};
    let element = e.target;
      switch (element.type) {
        case 'checkbox':
          options[element.id] = element.checked;
          ADDON_prefs.logger.log('Saving option: ' + element.id + ' = ' + ADDON_prefs._logValue(element.id, element.checked));
          break;
        case 'number':
          // An empty number input yields NaN, which storage.sync.set() would
          // serialize to null. A null is a *present* key, so storage.sync.get()
          // stops substituting the default for it and later comparisons against
          // numbers silently fail. Store the default instead: a deliberate
          // deviation from the raw DOM value.
          options[element.id] = Number.isNaN(element.valueAsNumber) ? prefs_default[element.id] : element.valueAsNumber;
          ADDON_prefs.logger.log('Saving option: ' + element.id + ' = ' + ADDON_prefs._logValue(element.id, options[element.id]));
          break;
        case 'text':
        case 'password':
          options[element.id] = element.value.trim();
          ADDON_prefs.logger.log('Saving option: ' + element.id + ' = ' + ADDON_prefs._logValue(element.id, options[element.id]));
          break;
        case 'select-one':
          options[element.id] = element.value;
          ADDON_prefs.logger.log('Saving option: ' + element.id + ' = ' + ADDON_prefs._logValue(element.id, element.value));
          break;
        case 'textarea':
          options[element.id] = element.value.trim();
          ADDON_prefs.logger.log('Saving option: ' + element.id + ' = ' + ADDON_prefs._logValue(element.id, element.value.trim()));
          break;
        default:
          ADDON_prefs.logger.log('Unhandled input type:', element.type);
      }
    browser.storage.sync.set(options);
  },

  async setPref(pref_id, value){
    let obj = {};
    obj[pref_id] = value;
    ADDON_prefs.logger.log('Saving option: ' + pref_id + ' = ' + ADDON_prefs._logValue(pref_id, JSON.stringify(value)));
    browser.storage.sync.set(obj)
  },

  async getPref(pref_id){
    if (!(pref_id in prefs_default)) {
      ADDON_prefs._logWarning('getPref: unknown preference id "' + pref_id + '", it has no entry in prefs_default.');
    }
    let obj = {};
    obj[pref_id] = prefs_default[pref_id];
    let prefs = await browser.storage.sync.get(obj)
    ADDON_prefs.logger.log("getPref: " + pref_id + " = " + ADDON_prefs._logValue(pref_id, JSON.stringify(prefs[pref_id])));
    return prefs[pref_id];
  },

  
  async getPrefs(pref_ids){
    let obj = {};
    pref_ids.forEach(pref_id => {
      if (!(pref_id in prefs_default)) {
        ADDON_prefs._logWarning('getPrefs: unknown preference id "' + pref_id + '", it has no entry in prefs_default.');
      }
      obj[pref_id] = prefs_default[pref_id];
    });
    let prefs = await browser.storage.sync.get(obj)
    let result = {};
    let log_parts = [];
    // The mask must be applied per key while building the log string: testing
    // the whole payload could not hide a single secret value inside it.
    pref_ids.forEach(pref_id => {
      result[pref_id] = prefs[pref_id];
      log_parts.push(pref_id + ': ' + ADDON_prefs._logValue(pref_id, JSON.stringify(prefs[pref_id])));
    });
    ADDON_prefs.logger.log("getPrefs: {" + log_parts.join(', ') + "}");
    return result;
  },


  // Every preference declared in prefs_default, merged with the stored values.
  async getAllPrefs(){
    return await browser.storage.sync.get(prefs_default);
  },


  restoreOptions() {
    function setCurrentChoice(result) {
      document.querySelectorAll(".option-input").forEach(element => {
        const defaultValue = prefs_default[element.id];
        switch (element.type) {
          case 'checkbox':
            let default_checkbox_value = defaultValue !== undefined ? defaultValue : false;
            element.checked = result[element.id] !== undefined ? result[element.id] : default_checkbox_value;
            ADDON_prefs.afterRestoreElement(element, element.checked);
            break;
          case 'number':
            let default_number_value = defaultValue !== undefined ? defaultValue : 0;
            element.value = result[element.id] !== undefined ? result[element.id] : default_number_value;
            ADDON_prefs.afterRestoreElement(element, element.value);
            break;
          case 'text':
          case 'password':
            let default_text_value = defaultValue !== undefined ? defaultValue : '';
            element.value = result[element.id] !== undefined ? result[element.id] : default_text_value;
            ADDON_prefs.afterRestoreElement(element, element.value);
            break;
           case 'textarea':
            element.value = result[element.id];
            ADDON_prefs.afterRestoreElement(element, element.value);
            break;
          default:
          if (element.tagName === 'SELECT') {
            let default_select_value = defaultValue !== undefined ? defaultValue : '';
            element.value = result[element.id] !== undefined ? result[element.id] : default_select_value;
            // Blank the control only when the empty value is not one of its
            // options: a select declaring an empty <option> wants it selected.
            if (element.value === '' && !ADDON_prefs.hasEmptyValueOption(element.id)) {
              element.selectedIndex = -1;
            }
            ADDON_prefs.afterRestoreElement(element, element.value);
          }else{
            ADDON_prefs.logger.log('Unhandled input type:', element.type);
          }
        }
      });
    }

    function onError(error) {
      ADDON_prefs.logger.log(`Error: ${error}`);
    }

    let getting = browser.storage.sync.get(null);
    getting.then(setCurrentChoice, onError);
  }
};
