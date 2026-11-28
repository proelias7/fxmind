/**
 * User confirmation through MCP elicitation (2026-07-28 multi-round-trip
 * requests): the server answers tools/call with resultType "input_required",
 * the client asks the user and retries with inputResponses + requestState.
 *
 * Used for destructive SQL so approval comes from the user, not from the
 * model setting approvedByUser itself.
 *
 * requestState is HMAC-signed with a per-process secret and bound to the
 * tool, its exact arguments, a short expiry and a single-use nonce. A
 * restarted server cannot verify an old state and simply asks again.
 */
const crypto = require("crypto");

const CONFIRM_KEY = "confirm";
const STATE_TTL_MS = 5 * 60 * 1000;
const SECRET = crypto.randomBytes(32);
const usedNonces = new Map(); // nonce -> expiry ms

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function argsHash(toolName, args) {
  return crypto.createHash("sha256").update(`${toolName}\n${canonical(args)}`).digest("hex");
}

function sign(body) {
  return crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
}

function createState(toolName, args, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({
    h: argsHash(toolName, args),
    exp: now + STATE_TTL_MS,
    n: crypto.randomBytes(12).toString("base64url"),
  })).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Returns the verified payload for this exact call, or null. */
function verifyState(state, toolName, args, now = Date.now()) {
  if (typeof state !== "string") return null;
  const dot = state.indexOf(".");
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const mac = Buffer.from(state.slice(dot + 1));
  const expected = Buffer.from(sign(body));
  if (mac.length !== expected.length || !crypto.timingSafeEqual(mac, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || payload.exp < now || payload.h !== argsHash(toolName, args)) return null;
  return payload;
}

function consumeNonce(nonce, exp, now = Date.now()) {
  for (const [key, expiry] of usedNonces) if (expiry < now) usedNonces.delete(key);
  if (usedNonces.has(nonce)) return false;
  usedNonces.set(nonce, exp);
  return true;
}

/** Form-mode elicitation (empty elicitation capability means form). */
function clientSupportsFormElicitation(clientCaps) {
  const elicitation = clientCaps?.elicitation;
  if (!elicitation || typeof elicitation !== "object") return false;
  return Object.keys(elicitation).length === 0 || Boolean(elicitation.form);
}

function confirmationRequest(toolName, args, message) {
  return {
    resultType: "input_required",
    inputRequests: {
      [CONFIRM_KEY]: {
        method: "elicitation/create",
        params: {
          mode: "form",
          message,
          requestedSchema: {
            type: "object",
            properties: {
              [CONFIRM_KEY]: { type: "boolean", title: "Confirm", description: "Run it?" },
            },
            required: [CONFIRM_KEY],
          },
        },
      },
    },
    requestState: createState(toolName, args),
  };
}

/**
 * Decides a confirmation round.
 * @returns {{ kind: "ask" } | { kind: "confirmed" } | { kind: "declined", action: string }}
 */
function evaluateConfirmation(params, toolName, args) {
  const response = params?.inputResponses?.[CONFIRM_KEY];
  // A refusal never runs anything, so it needs no state check (and must not
  // loop back into another prompt).
  if (response?.action === "decline" || response?.action === "cancel") {
    return { kind: "declined", action: response.action };
  }
  const payload = verifyState(params?.requestState, toolName, args);
  // No (valid) state or no answer yet: ask (again) instead of erroring (spec).
  if (!payload || !response || typeof response !== "object") return { kind: "ask" };
  if (response.action === "accept") {
    if (response.content?.[CONFIRM_KEY] !== true) return { kind: "declined", action: "accept:false" };
    if (!consumeNonce(payload.n, payload.exp)) return { kind: "ask" };
    return { kind: "confirmed" };
  }
  if (response.action === "decline" || response.action === "cancel") {
    return { kind: "declined", action: response.action };
  }
  return { kind: "ask" };
}

module.exports = {
  CONFIRM_KEY,
  clientSupportsFormElicitation,
  confirmationRequest,
  evaluateConfirmation,
  createState,
  verifyState,
};
