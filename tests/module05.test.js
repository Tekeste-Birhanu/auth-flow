const { test } = require("node:test");
const assert = require("node:assert/strict");
const authHelpersPromise = import("../scripts/auth-helpers.mjs");

function makeUser({ email = "oauth@example.test", confirmed = true } = {}) {
  return {
    id: "oauth-user-1",
    email,
    email_confirmed_at: confirmed ? "2026-10-01T10:00:00.000Z" : null,
    app_metadata: { provider: "google", providers: ["google"] },
    identities: [{ provider: "google", identity_data: { email } }]
  };
}

function makeAuth(user = makeUser()) {
  return {
    async getSession() {
      return { data: { session: { access_token: "verified-session-token" } }, error: null };
    },
    async getUser() {
      return { data: { user }, error: null };
    }
  };
}

test("OAuth buttons start only supported providers and use the current app root", async () => {
  const { signInWithOAuth } = await authHelpersPromise;
  const calls = [];
  const auth = {
    async signInWithOAuth(options) {
      calls.push(options);
      return { data: { provider: options.provider }, error: null };
    }
  };

  for (const provider of ["google", "github"]) {
    const result = await signInWithOAuth(auth, provider, "http://127.0.0.1:4173/");
    assert.equal(result.error, null);
  }
  assert.deepEqual(calls, [
    { provider: "google", options: { redirectTo: "http://127.0.0.1:4173/" } },
    { provider: "github", options: { redirectTo: "http://127.0.0.1:4173/" } }
  ]);

  const unsupported = await signInWithOAuth(auth, "facebook", "http://127.0.0.1:4173/");
  assert.equal(unsupported.error.code, "oauth_provider_not_supported");
  assert.equal(calls.length, 2);
});

test("OAuth returns are distinguished from signup confirmation returns", async () => {
  const { inspectAuthReturnUrl } = await authHelpersPromise;
  const success = inspectAuthReturnUrl("http://127.0.0.1:4173/#access_token=callback-token&refresh_token=refresh-token");
  const failure = inspectAuthReturnUrl("http://127.0.0.1:4173/?error=access_denied&error_code=access_denied");
  const signup = inspectAuthReturnUrl("http://127.0.0.1:4173/#access_token=callback-token&type=signup");
  const recovery = inspectAuthReturnUrl("http://127.0.0.1:4173/#access_token=callback-token&type=recovery");

  assert.equal(success.isOAuthReturn, true);
  assert.equal(failure.isOAuthReturn, true);
  assert.equal(signup.isSignupConfirmation, true);
  assert.equal(signup.isOAuthReturn, false);
  assert.equal(recovery.isOAuthReturn, false);
});

test("OAuth callback grants dashboard only to Supabase users with a confirmed email", async () => {
  const { cleanAuthReturnUrl, handleOAuthReturn, inspectAuthReturnUrl } = await authHelpersPromise;
  const cases = [
    { name: "confirmed email", user: makeUser(), succeeds: true },
    { name: "missing email", user: makeUser({ email: "" }), succeeds: false, feedback: /didn't provide an email address/i },
    { name: "unconfirmed email", user: makeUser({ confirmed: false }), succeeds: false, feedback: /verify your email/i }
  ];

  for (const scenario of cases) {
    const href = "http://127.0.0.1:4173/#access_token=callback-token&refresh_token=refresh-token";
    let cleaned = false;
    let visible = false;
    let feedback = "";
    const result = await handleOAuthReturn({
      auth: makeAuth(scenario.user),
      authReturn: inspectAuthReturnUrl(href),
      cleanUrl() { cleaned = cleanAuthReturnUrl(href) === "/"; },
      showFeedback(message) { feedback = message; },
      showDashboard() { visible = true; }
    });

    assert.equal(result.success, scenario.succeeds, scenario.name);
    assert.equal(visible, scenario.succeeds, scenario.name);
    assert.equal(cleaned, true, scenario.name);
    if (scenario.feedback) assert.match(feedback, scenario.feedback, scenario.name);
  }
});

test("OAuth error returns show safe cancellation/provider messages and never reveal dashboard", async () => {
  const { handleOAuthReturn, inspectAuthReturnUrl, oauthErrorMessage } = await authHelpersPromise;
  const cases = [
    {
      href: "http://127.0.0.1:4173/?error=access_denied&error_code=access_denied&error_description=private-provider-detail",
      expected: /sign-in was cancelled/i
    },
    {
      href: "http://127.0.0.1:4173/?error=access_denied&error_description=private-provider-detail",
      expected: /sign-in was cancelled/i
    },
    {
      href: "http://127.0.0.1:4173/?error=server_error&error_code=provider_email_needs_verification&error_description=private-provider-detail",
      expected: /verify your email/i
    }
  ];

  for (const scenario of cases) {
    let visible = false;
    let feedback = "";
    let cleaned = false;
    const authReturn = inspectAuthReturnUrl(scenario.href);
    const result = await handleOAuthReturn({
      auth: { async getSession() { assert.fail("provider errors must be handled before session checks"); } },
      authReturn,
      cleanUrl() { cleaned = true; },
      showFeedback(message) { feedback = message; },
      showDashboard() { visible = true; }
    });

    assert.equal(result.reason, "provider-error");
    assert.equal(visible, false);
    assert.equal(cleaned, true);
    assert.match(feedback, scenario.expected);
    assert.doesNotMatch(feedback, /private-provider-detail/);
  }

  assert.match(oauthErrorMessage("flow_state_expired"), /attempt expired/i);
  assert.match(oauthErrorMessage("provider_disabled"), /currently unavailable/i);
  assert.match(oauthErrorMessage("unknown-private-error"), /couldn't complete sign-in/i);
});
