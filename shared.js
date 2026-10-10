// --- Compose Status ---

/** @typedef {'composing' | 'sending' } ComposeStatus */
/** @type {Record<'COMPOSING' | 'SENDING', ComposeStatus>} */

export const ComposeStatus = {
  COMPOSING: "composing",
  SENDING: "sending",
};

// --- Messages ---

export const MSG_VALIDATE_FROM = "validateFrom";
export const MSG_GET_VALIDATION_STATE = "getValidationState";
export const MSG_SEND_DECISION = "sendDecision";

// --- Utility functions ---

export const sleep = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));

