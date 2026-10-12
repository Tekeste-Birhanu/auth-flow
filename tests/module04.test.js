const { test } = require("node:test");
const assert = require("node:assert/strict");
const sessionHelpersPromise = import("../scripts/session-helpers.mjs");

function makeUser(providers = ["email"]) {
  return {
    id: "user-456",
    email: "member@example.test",
    email_confirmed_at: "2026-02-03T04:05:06.000Z",
    created_at: "2026-02-01T04:05:06.000Z",
    last_sign_in_at: "2026-03-01T04:05:06.000Z",
    app_metadata: { provider: providers[0], providers },
    identities: providers.map((provider) => ({ provider }))
  };
}

test("dashboard account values come from the authenticated user and session", async () => {
  const { accountValues } = await sessionHelpersPromise;
  const values = accountValues(makeUser(), { expires_at: 1770000000 });

  assert.equal(values.email, "member@example.test");
  assert.equal(values.id, "user-456");
  assert.equal(values.verification, "Verified");
  assert.equal(values.provider, "Email and password");
  assert.notEqual(values.created, "—");
  assert.notEqual(values.lastSignIn, "—");
  assert.notEqual(values.expires, "—");

  const empty = accountValues({}, null);
  assert.equal(empty.email, "—");
  assert.equal(empty.id, "—");
  assert.equal(empty.provider, "—");
  assert.equal(empty.created, "—");
  assert.equal(empty.lastSignIn, "—");
  assert.equal(empty.expires, "—");
});

test("password changes are restricted to email identities and verify the current password", async () => {
  const { changePassword, passwordChangeMessage, supportsPasswordChange } = await sessionHelpersPromise;
  assert.equal(supportsPasswordChange(makeUser()), true);
  assert.equal(supportsPasswordChange(makeUser(["github"])), false);

  const calls = [];
  const auth = {
    async updateUser(attributes) {
      calls.push(["update", attributes]);
      return { error: null };
    }
  };
  const result = await changePassword(auth, makeUser(), "Old-pass-123!", "New-pass-123!");

  assert.equal(result.error, null);
  assert.deepEqual(calls, [["update", { password: "New-pass-123!", current_password: "Old-pass-123!" }]]);

  const rejected = await changePassword({
    async updateUser() { return { error: { code: "current_password_invalid" } }; }
  }, makeUser(), "wrong", "New-pass-123!");
  assert.match(passwordChangeMessage(rejected.error), /current password is incorrect/i);
});

test("password requirement evaluator matches the signup and change-password checklist", async () => {
  const { evaluatePasswordRequirements } = await sessionHelpersPromise;
  const complete = evaluatePasswordRequirements("Valid-Pass1!");
  assert.deepEqual(complete, {
    length: true,
    lowercase: true,
    uppercase: true,
    digit: true,
    symbol: true
  });

  assert.equal(evaluatePasswordRequirements("Short1!").length, false);
  assert.equal(evaluatePasswordRequirements("VALIDPASS1!").lowercase, false);
  assert.equal(evaluatePasswordRequirements("validpass1!").uppercase, false);
  assert.equal(evaluatePasswordRequirements("ValidPass!!").digit, false);
  assert.equal(evaluatePasswordRequirements("ValidPass12").symbol, false);
  assert.equal(evaluatePasswordRequirements("ValidPass1' ").symbol, true);
  assert.equal(evaluatePasswordRequirements("ValidPass1\\").symbol, true);
});

test("auth state callbacks run after the SDK callback returns", async () => {
  const { listenForAuthChanges } = await sessionHelpersPromise;
  let authCallback;
  const received = [];
  const subscription = { unsubscribe() {} };
  const returned = listenForAuthChanges({
    onAuthStateChange(callback) {
      authCallback = callback;
      return { data: { subscription } };
    }
  }, async (event, session) => { received.push([event, session]); });

  assert.equal(returned, subscription);
  authCallback("TOKEN_REFRESHED", { access_token: "not-logged" });
  assert.deepEqual(received, [], "Auth work should be deferred out of the SDK callback");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(received.length, 1);
  assert.equal(received[0][0], "TOKEN_REFRESHED");
  assert.equal(received[0][1].access_token, "not-logged");
});

test("sign-out reports success only when the Supabase client clears the session", async () => {
  const { performSignOut } = await sessionHelpersPromise;
  let calls = 0;
  assert.deepEqual(await performSignOut({
    async signOut() { calls++; return { error: null }; }
  }), { success: true });
  assert.deepEqual(await performSignOut({
    async signOut() { return { error: new Error("private server detail") }; }
  }), { success: false });
  assert.deepEqual(await performSignOut({
    async signOut() { throw new Error("private server detail"); }
  }), { success: false });
  assert.equal(calls, 1);
});
