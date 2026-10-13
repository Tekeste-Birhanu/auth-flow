const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createClient } = require("@supabase/supabase-js");
const authHelpersPromise = import("../scripts/auth-helpers.mjs");

function makeBrowser(href) {
  let currentUrl = new URL(href);
  const location = {};
  for (const key of ["href", "origin", "pathname", "search"]) {
    Object.defineProperty(location, key, { get: () => currentUrl[key] });
  }
  Object.defineProperty(location, "hash", {
    get: () => currentUrl.hash,
    set: (hash) => { currentUrl.hash = hash; }
  });

  const history = {
    state: null,
    replaceState(state, _title, nextUrl) {
      this.state = state;
      currentUrl = new URL(nextUrl, currentUrl);
    }
  };
  return {
    window: { location, history, addEventListener() {}, removeEventListener() {} },
    document: {},
    get href() { return currentUrl.href; }
  };
}

function makeStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }
  };
}

function makeUser(confirmed = true) {
  return {
    id: "user-123",
    aud: "authenticated",
    role: "authenticated",
    email: "learner@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    email_confirmed_at: confirmed ? "2026-01-01T00:01:00.000Z" : null
  };
}

async function withBrowserClient(href, fetchHandler, run) {
  const previous = {
    window: global.window,
    document: global.document,
    BroadcastChannel: global.BroadcastChannel
  };
  const browser = makeBrowser(href);
  global.window = browser.window;
  global.document = browser.document;
  global.BroadcastChannel = undefined;

  const client = createClient("https://project.example.test", "test-publishable-key", {
    auth: {
      autoRefreshToken: false,
      persistSession: true,
      storage: makeStorage(),
      storageKey: `auth-flow-test-${Math.random()}`
    },
    global: { fetch: fetchHandler }
  });

  try {
    await run(client, browser);
  } finally {
    client.auth.stopAutoRefresh();
    global.window = previous.window;
    global.document = previous.document;
    global.BroadcastChannel = previous.BroadcastChannel;
  }
}

test("signup confirmation return is consumed and user is checked by the installed Supabase SDK", async () => {
  const { inspectAuthReturnUrl, getVerifiedUser } = await authHelpersPromise;
  const initialUrl = "http://127.0.0.1:4173/#access_token=access-token&refresh_token=refresh-token&expires_in=3600&token_type=bearer&type=signup";
  const user = makeUser(true);
  const requests = [];

  await withBrowserClient(initialUrl, async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    requests.push({ url, init });
    assert.equal(url.pathname, "/auth/v1/user");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer access-token");
    return new Response(JSON.stringify(user), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }, async (client, browser) => {
    assert.deepEqual(inspectAuthReturnUrl(initialUrl), {
      isAuthReturn: true,
      isSignupConfirmation: true,
      isOAuthReturn: false,
      hasAccessToken: true,
      error: "",
      errorCode: "",
      hasError: false
    });

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    assert.equal(sessionError, null);
    assert.equal(sessionData.session.user.email_confirmed_at, user.email_confirmed_at);
    assert.equal(browser.window.location.hash, "", "SDK should remove successful auth tokens from the URL fragment");

    const confirmed = await getVerifiedUser(client.auth);
    assert.equal(confirmed.user.id, user.id);
    assert.equal(confirmed.reason, null);
    assert.ok(requests.length >= 2, "SDK should validate the callback token and getUser() should verify the saved session");
  });
});

test("expired, malformed, and unconfirmed returns fail closed and callback URLs can be cleaned", async () => {
  const { inspectAuthReturnUrl, cleanAuthReturnUrl, getVerifiedUser, verificationLinkMessage } = await authHelpersPromise;
  const expired = "http://127.0.0.1:4173/?error=access_denied&error_code=otp_expired&error_description=private-server-message";
  const malformed = "http://127.0.0.1:4173/#access_token=bad-token&type=signup";

  assert.equal(inspectAuthReturnUrl(expired).errorCode, "otp_expired");
  assert.match(verificationLinkMessage("otp_expired"), /expired or was already used/i);
  assert.doesNotMatch(verificationLinkMessage("otp_expired"), /private-server-message/);
  assert.equal(cleanAuthReturnUrl(expired), "/");
  assert.equal(cleanAuthReturnUrl(malformed), "/");

  for (const callbackUrl of [expired, malformed]) {
    await withBrowserClient(callbackUrl, async () => {
      assert.fail("invalid callbacks must not call the Auth user endpoint");
    }, async (client) => {
      const { data } = await client.auth.getSession();
      assert.equal(data.session, null);
      const result = await getVerifiedUser(client.auth);
      assert.deepEqual(result, { user: null, reason: "no-session" });
    });
  }

  const unverified = await getVerifiedUser({
    async getSession() { return { data: { session: { access_token: "token" } }, error: null }; },
    async getUser() { return { data: { user: makeUser(false) }, error: null }; }
  });
  assert.deepEqual(unverified, { user: null, reason: "email-unverified" });

  const anonymous = await getVerifiedUser({
    async getSession() { return { data: { session: null }, error: null }; },
    async getUser() { assert.fail("getUser must not run without a session"); }
  });
  assert.deepEqual(anonymous, { user: null, reason: "no-session" });
});

test("signup, sign-in, and resend error messages avoid account enumeration and raw server text", async () => {
  const { authErrorMessage } = await authHelpersPromise;
  const duplicate = authErrorMessage({ code: "user_already_exists", message: "sensitive backend detail" }, "signup");
  const invalid = authErrorMessage({ code: "invalid_credentials", message: "sensitive backend detail" }, "signin");
  const resend = authErrorMessage({ code: "user_not_found", message: "sensitive backend detail" }, "resend");

  assert.equal(duplicate.kind, "neutral");
  assert.match(duplicate.message, /if registration can be completed/i);
  assert.match(invalid.message, /couldn't sign you in/i);
  assert.match(resend.message, /if this address has a pending signup/i);
  for (const feedback of [duplicate, invalid, resend]) {
    assert.doesNotMatch(feedback.message, /sensitive backend detail/);
  }
});

test("signup response handling sends pending and obfuscated results to Verify with identical neutral feedback", async () => {
  const { handleSignupResponse } = await authHelpersPromise;
  const outcomes = [];
  const cases = [
    {
      name: "ordinary pending registration",
      data: { user: { email: "learner@example.test", identities: [{ provider: "email" }] }, session: null }
    },
    {
      name: "obfuscated no-session response",
      data: { user: { email: "learner@example.test", identities: [] }, session: null }
    },
    {
      name: "duplicate response error",
      data: { user: null, session: null },
      error: { code: "user_already_exists", message: "private account detail" }
    }
  ];

  for (const scenario of cases) {
    let verificationMessage = "";
    let verificationShown = false;
    let dashboardShown = false;
    let errorMessage = "";
    const result = await handleSignupResponse({
      auth: {},
      ...scenario,
      showDashboard() { dashboardShown = true; },
      showVerification(message) { verificationShown = true; verificationMessage = message; },
      showErrorFeedback(feedback) { errorMessage = feedback.message; }
    });
    outcomes.push({ result, verificationMessage, verificationShown, dashboardShown, errorMessage });
    assert.equal(result.outcome, "ambiguous", scenario.name);
    assert.equal(verificationShown, true, scenario.name);
    assert.equal(dashboardShown, false, scenario.name);
    assert.equal(errorMessage, "", scenario.name);
    assert.match(verificationMessage, /if registration can be completed/i, scenario.name);
    assert.match(verificationMessage, /if you don't receive one, try signing in or request another link/i, scenario.name);
    assert.doesNotMatch(verificationMessage, /private account detail|already registered|already exists/i, scenario.name);
  }

  assert.equal(outcomes[0].verificationMessage, outcomes[1].verificationMessage);
  assert.equal(outcomes[0].verificationMessage, outcomes[2].verificationMessage);

  const html = require("node:fs").readFileSync("index.html", "utf8");
  const signupView = html.match(/<section class="auth-view" id="view-signup"[\s\S]*?<\/section>/)?.[0] || "";
  const verifyView = html.match(/<section class="auth-view" id="view-verify"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(signupView, /<h1[^>]*>Create your account<\/h1>/);
  assert.match(signupView, /Enter your email and create a password\./);
  assert.match(signupView, /Password must include:/);
  assert.equal((signupView.match(/data-password-rule="(?:length|lowercase|uppercase|digit|symbol)"/g) || []).length, 5);
  assert.match(signupView, /<div class="divider"><span>Or continue with<\/span><\/div>/);
  assert.match(signupView, /href="#signin" data-view-link="signin">Sign in<\/a>/);
  assert.equal((signupView.match(/class="switch-copy(?:\s|"|')/g) || []).length, 1);
  assert.match(verifyView, /id="resend-verification-form"/);
  assert.match(verifyView, /href="#signin" data-view-link="signin"/);
  assert.doesNotMatch(html, /Email and password authentication is provided by Supabase\./);
});

test("actual signup errors stay on the signup view with safe actionable feedback", async () => {
  const { handleSignupResponse } = await authHelpersPromise;
  let errorMessage = "";
  let verificationShown = false;
  let dashboardShown = false;
  const result = await handleSignupResponse({
    auth: {},
    data: { user: null, session: null },
    error: { code: "weak_password", message: "private validation detail" },
    showDashboard() { dashboardShown = true; },
    showVerification() { verificationShown = true; },
    showErrorFeedback(feedback) { errorMessage = feedback.message; }
  });

  assert.equal(result.outcome, "error");
  assert.equal(dashboardShown, false);
  assert.equal(verificationShown, false);
  assert.match(errorMessage, /password requirements/i);
  assert.doesNotMatch(errorMessage, /private validation detail/i);
});

test("dashboard protection stays hidden and redirects on Auth failures and unverified states", async () => {
  const { protectDashboard } = await authHelpersPromise;
  const cases = [
    {
      name: "getUser returns an error",
      auth: {
        async getSession() { return { data: { session: {} }, error: null }; },
        async getUser() { return { data: { user: null }, error: new Error("request failed") }; }
      },
      notice: "session-check-failed"
    },
    {
      name: "getUser throws",
      auth: {
        async getSession() { return { data: { session: {} }, error: null }; },
        async getUser() { throw new Error("request failed"); }
      },
      notice: "session-check-failed"
    },
    {
      name: "no valid session exists",
      auth: { async getSession() { return { data: { session: null }, error: null }; } },
      notice: "verified-email-required"
    },
    {
      name: "user email is unconfirmed",
      auth: {
        async getSession() { return { data: { session: {} }, error: null }; },
        async getUser() { return { data: { user: makeUser(false) }, error: null }; }
      },
      notice: "verified-email-required"
    }
  ];

  for (const scenario of cases) {
    let dashboardHidden = true;
    let redirectNotice = null;
    const authorized = await protectDashboard({
      auth: scenario.auth,
      showDashboard() { dashboardHidden = false; },
      redirectToSignIn(notice) { redirectNotice = notice; }
    });

    assert.equal(authorized, false, scenario.name);
    assert.equal(dashboardHidden, true, scenario.name);
    assert.equal(redirectNotice, scenario.notice, scenario.name);
  }
});

test("application callback handler rejects malformed, expired, reused, and invalid links and cleans URLs", async () => {
  const { cleanAuthReturnUrl, handleSignupConfirmationReturn, inspectAuthReturnUrl } = await authHelpersPromise;
  const cases = [
    {
      name: "type-only malformed callback",
      href: "http://127.0.0.1:4173/?type=signup&token_hash=private-token",
      message: /invalid, expired, or already used/i,
      auth: { async getSession() { assert.fail("type alone must not initialize or reuse a session"); } }
    },
    {
      name: "expired link",
      href: "http://127.0.0.1:4173/?error=access_denied&error_code=otp_expired&error_description=private-server-message",
      message: /expired or was already used/i,
      auth: { async getSession() { assert.fail("failed links must not be treated as sessions"); } }
    },
    {
      name: "reused or otherwise invalid link",
      href: "http://127.0.0.1:4173/?error=access_denied&error_code=otp_expired",
      message: /expired or was already used/i,
      auth: { async getSession() { assert.fail("failed links must not be treated as sessions"); } }
    },
    {
      name: "malformed token callback",
      href: "http://127.0.0.1:4173/#access_token=invalid-token&type=signup",
      message: /invalid, expired, or already used/i,
      auth: { async getSession() { return { data: { session: null }, error: null }; } }
    }
  ];

  for (const scenario of cases) {
    const browser = makeBrowser(scenario.href);
    let feedback = "";
    let dashboardVisible = false;
    const result = await handleSignupConfirmationReturn({
      auth: scenario.auth,
      authReturn: inspectAuthReturnUrl(scenario.href),
      href: scenario.href,
      cleanUrl() { browser.window.history.replaceState(null, "", cleanAuthReturnUrl(browser.href)); },
      showFeedback(message) { feedback = message; },
      showDashboard() { dashboardVisible = true; }
    });

    assert.equal(result.success, false, scenario.name);
    assert.match(feedback, scenario.message, scenario.name);
    assert.equal(dashboardVisible, false, scenario.name);
    assert.equal(browser.href, "http://127.0.0.1:4173/", scenario.name);
    assert.doesNotMatch(feedback, /private-server-message|private-token/i, scenario.name);
  }
});

test("application callback handler reveals dashboard only after SDK session and verified-user checks", async () => {
  const { cleanAuthReturnUrl, handleSignupConfirmationReturn, inspectAuthReturnUrl } = await authHelpersPromise;
  const href = "http://127.0.0.1:4173/#access_token=callback-token&refresh_token=refresh-token&expires_in=3600&token_type=bearer&type=signup";
  const browser = makeBrowser(href);
  let feedback = "";
  let dashboardVisible = false;
  let userChecks = 0;
  const auth = {
    async getSession() {
      return { data: { session: { access_token: "callback-token" } }, error: null };
    },
    async getUser() {
      userChecks++;
      return { data: { user: makeUser(true) }, error: null };
    }
  };

  const result = await handleSignupConfirmationReturn({
    auth,
    authReturn: inspectAuthReturnUrl(href),
    href,
    cleanUrl() { browser.window.history.replaceState(null, "", cleanAuthReturnUrl(browser.href)); },
    showFeedback(message) { feedback = message; },
    showDashboard() { dashboardVisible = true; }
  });

  assert.deepEqual(result, { success: true });
  assert.equal(userChecks, 1);
  assert.equal(dashboardVisible, true);
  assert.equal(browser.href, "http://127.0.0.1:4173/");
  assert.equal(feedback, "");
});

test("installed SDK sends registration redirect to the existing application root", async () => {
  const signupUser = { ...makeUser(false), identities: [{ provider: "email" }] };
  let signupRequest;

  await withBrowserClient("http://127.0.0.1:4173/", async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname.endsWith("/signup")) {
      signupRequest = { url, init };
      return new Response(JSON.stringify({ user: signupUser, session: null }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`Unexpected SDK request: ${url.pathname}`);
  }, async (client) => {
    const { data, error } = await client.auth.signUp({
      email: signupUser.email,
      password: "Example-Password-123!",
      options: { emailRedirectTo: "http://127.0.0.1:4173/" }
    });
    assert.equal(error, null);
    assert.equal(data.user.email_confirmed_at, null);
    assert.equal(data.session, null, "confirmation-required signup should not create a signed-in session");
  });

  assert.equal(signupRequest.url.searchParams.get("redirect_to"), "http://127.0.0.1:4173/");
});
