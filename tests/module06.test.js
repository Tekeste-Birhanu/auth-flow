const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createClient } = require("@supabase/supabase-js");
const authHelpersPromise = import("../scripts/auth-helpers.mjs");

function verifiedUser() {
  return {
    id: "recovery-user-1",
    email: "member@example.test",
    email_confirmed_at: "2026-10-01T10:00:00.000Z"
  };
}

function makeAuth({ session = true, user = verifiedUser(), userError = null } = {}) {
  return {
    async getSession() {
      return { data: { session: session ? { access_token: "session-token" } : null }, error: null };
    },
    async getUser() {
      return { data: { user }, error: userError };
    }
  };
}

test("installed Supabase SDK processes a valid recovery token return and emits PASSWORD_RECOVERY", async () => {
  const previous = {
    window: global.window,
    document: global.document,
    BroadcastChannel: global.BroadcastChannel
  };
  const currentUrl = new URL("http://127.0.0.1:4173/index.html?flow=recovery#access_token=recovery-access&refresh_token=recovery-refresh&expires_in=3600&token_type=bearer&type=recovery");
  const location = {};
  for (const key of ["href", "origin", "pathname", "search"]) {
    Object.defineProperty(location, key, { get: () => currentUrl[key] });
  }
  Object.defineProperty(location, "hash", {
    get: () => currentUrl.hash,
    set: (value) => { currentUrl.hash = value; }
  });
  global.window = {
    location,
    history: { state: null, replaceState(_state, _title, href) { currentUrl.href = new URL(href, currentUrl).href; } },
    addEventListener() {},
    removeEventListener() {}
  };
  global.document = {};
  global.BroadcastChannel = undefined;

  const user = {
    id: "recovery-user-1",
    aud: "authenticated",
    role: "authenticated",
    email: "member@example.test",
    email_confirmed_at: "2026-10-01T10:00:00.000Z",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {}
  };
  const client = createClient("https://project.example.test", "test-publishable-key", {
    auth: {
      autoRefreshToken: false,
      persistSession: true,
      storage: {
        getItem() { return null; },
        setItem() {},
        removeItem() {}
      },
      storageKey: `auth-flow-recovery-test-${Math.random()}`
    },
    global: {
      fetch: async (input) => {
        const url = new URL(typeof input === "string" ? input : input.url);
        assert.equal(url.pathname, "/auth/v1/user");
        return new Response(JSON.stringify(user), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
  });

  try {
    const events = [];
    const { data: { subscription } } = client.auth.onAuthStateChange((event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(events.includes("PASSWORD_RECOVERY"), `Expected PASSWORD_RECOVERY; received ${events.join(", ")}`);
    assert.equal(location.hash, "", "the SDK removes the consumed callback tokens");
  } finally {
    client.auth.stopAutoRefresh();
    global.window = previous.window;
    global.document = previous.document;
    global.BroadcastChannel = previous.BroadcastChannel;
  }
});

test("recovery redirect is recognized but does not itself establish a recovery session", async () => {
  const { cleanAuthReturnUrl, hasPasswordRecoveryIntent, inspectAuthReturnUrl, markPasswordRecoveryIntent, clearPasswordRecoveryIntent, shouldHandleRecoveryReturn } = await authHelpersPromise;
  const callback = inspectAuthReturnUrl("http://127.0.0.1:4173/index.html?flow=recovery#new-password");
  const directView = inspectAuthReturnUrl("http://127.0.0.1:4173/index.html#new-password");
  const expired = inspectAuthReturnUrl("http://127.0.0.1:4173/index.html?flow=recovery&error=access_denied&error_code=otp_expired#new-password");

  assert.equal(callback.isRecoveryReturn, true);
  assert.equal(callback.isAuthReturn, false);
  assert.equal(directView.isRecoveryReturn, false);
  assert.equal(directView.hasAccessToken, false);
  assert.equal(expired.isRecoveryReturn, true);
  assert.equal(expired.hasError, true);
  assert.equal(expired.errorCode, "otp_expired");
  assert.equal(cleanAuthReturnUrl("http://127.0.0.1:4173/index.html?flow=recovery&code=private-code#access_token=private-token"), "/index.html");
  const unmarkedCodeReturn = inspectAuthReturnUrl("http://127.0.0.1:4173/index.html?code=private-code");
  assert.equal(shouldHandleRecoveryReturn(unmarkedCodeReturn, true), true);
  assert.equal(shouldHandleRecoveryReturn(unmarkedCodeReturn, false), false);
  assert.equal(shouldHandleRecoveryReturn(directView, false, "#new-password"), true);

  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }
  };
  assert.equal(markPasswordRecoveryIntent(storage, 10_000), true);
  assert.equal(hasPasswordRecoveryIntent(storage, 10_001), true);
  assert.equal(hasPasswordRecoveryIntent(storage, 3_610_001), false, "expired intent must not misclassify a later OAuth callback");
  markPasswordRecoveryIntent(storage, 10_000);
  clearPasswordRecoveryIntent(storage);
  assert.equal(hasPasswordRecoveryIntent(storage, 10_001), false);
});

test("recovery requests use Supabase resetPasswordForEmail and a return URL", async () => {
  const { passwordRecoveryMessage, requestPasswordRecovery } = await authHelpersPromise;
  const calls = [];
  const result = await requestPasswordRecovery({
    async resetPasswordForEmail(email, options) {
      calls.push({ email, options });
      return { error: null };
    }
  }, "member@example.test", "http://127.0.0.1:4173/index.html?flow=recovery");

  assert.equal(result.error, null);
  assert.deepEqual(calls, [{
    email: "member@example.test",
    options: { redirectTo: "http://127.0.0.1:4173/index.html?flow=recovery" }
  }]);
  const neutral = passwordRecoveryMessage(null, "request");
  assert.match(neutral, /if an account can be recovered/i);
  assert.doesNotMatch(neutral, /exists|not found/i);
});

test("only a valid PASSWORD_RECOVERY session unlocks the password form", async () => {
  const { handlePasswordRecoveryEvent } = await authHelpersPromise;
  let cleaned = false;
  let visible = false;
  let feedback = "";
  const valid = await handlePasswordRecoveryEvent({
    auth: makeAuth(),
    event: "PASSWORD_RECOVERY",
    cleanUrl() { cleaned = true; },
    showForm() { visible = true; },
    showFeedback(message) { feedback = message; }
  });

  assert.equal(valid.success, true);
  assert.equal(visible, true);
  assert.equal(cleaned, true);
  assert.equal(feedback, "");

  cleaned = false;
  visible = false;
  const ordinarySession = await handlePasswordRecoveryEvent({
    auth: makeAuth(),
    event: "SIGNED_IN",
    cleanUrl() { cleaned = true; },
    showForm() { visible = true; },
    showFeedback(message) { feedback = message; }
  });
  assert.equal(ordinarySession.reason, "not-recovery-event");
  assert.equal(visible, false);
  assert.equal(cleaned, false);

  const noSession = await handlePasswordRecoveryEvent({
    auth: makeAuth({ session: false }),
    event: "PASSWORD_RECOVERY",
    cleanUrl() { cleaned = true; },
    showForm() { visible = true; },
    showFeedback(message) { feedback = message; }
  });
  assert.equal(noSession.success, false);
  assert.equal(visible, false);
  assert.equal(cleaned, true);
  assert.match(feedback, /invalid or expired/i);

  const unconfirmed = await handlePasswordRecoveryEvent({
    auth: makeAuth({ user: { ...verifiedUser(), email_confirmed_at: null } }),
    event: "PASSWORD_RECOVERY",
    cleanUrl() {},
    showForm() { visible = true; },
    showFeedback(message) { feedback = message; }
  });
  assert.equal(unconfirmed.success, true, "a valid recovery session does not depend on dashboard email-verification policy");
  assert.equal(visible, true);
});

test("recovery password update changes only the authenticated user's password", async () => {
  const { passwordRecoveryMessage, updateRecoveredPassword } = await authHelpersPromise;
  const calls = [];
  const result = await updateRecoveredPassword({
    async updateUser(attributes) {
      calls.push(attributes);
      return { data: { user: verifiedUser() }, error: null };
    }
  }, "New-ValidPass1!");

  assert.equal(result.error, null);
  assert.deepEqual(calls, [{ password: "New-ValidPass1!" }]);
  assert.match(passwordRecoveryMessage({ code: "weak_password" }, "update"), /each listed requirement/i);
  assert.match(passwordRecoveryMessage({ code: "otp_expired" }, "update"), /invalid or expired/i);
});
