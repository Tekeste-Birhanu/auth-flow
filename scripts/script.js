import { supabase } from "./supabase.js";
import {
  authErrorMessage,
  clearPasswordRecoveryIntent,
  cleanAuthReturnUrl,
  hasPasswordRecoveryIntent,
  handlePasswordRecoveryEvent,
  getVerifiedUser,
  handleSignupResponse,
  handleSignupConfirmationReturn as processSignupConfirmationReturn,
  handleOAuthReturn as processOAuthReturn,
  inspectAuthReturnUrl,
  oauthErrorMessage,
  markPasswordRecoveryIntent,
  passwordRecoveryMessage,
  protectDashboard as checkDashboardAccess,
  redirectVerifiedUser,
  shouldDisableResendButton,
  shouldHandleRecoveryReturn,
  signInWithOAuth,
  requestPasswordRecovery,
  updateRecoveredPassword
} from "./auth-helpers.mjs";
import {
  accountValues,
  changePassword,
  evaluatePasswordRequirements,
  listenForAuthChanges,
  performSignOut,
  passwordChangeMessage,
  setPassword,
  supportsPasswordChange
} from "./session-helpers.mjs";

const views = [...document.querySelectorAll("[data-view]")];
const signupEmailInput = document.querySelector("#verify-email");
let signupEmail = "";
let currentDashboardUser = null;
let navigationStarted = false;
// Supabase's SDK consumes successful callback parameters during initialization.
// Keep the original URL in memory so confirmation handling can validate the
// callback token against the session after the SDK has cleaned the address bar.
const initialAuthReturnUrl = window.location.href;
const initialAuthReturn = inspectAuthReturnUrl(initialAuthReturnUrl);
let recoveryIntentStorage;
try { recoveryIntentStorage = window.localStorage; } catch { recoveryIntentStorage = null; }
const pendingRecoveryIntent = hasPasswordRecoveryIntent(recoveryIntentStorage);
const isRecoveryReturn = shouldHandleRecoveryReturn(initialAuthReturn, pendingRecoveryIntent, location.hash);
let handlingAuthReturn = initialAuthReturn.isAuthReturn || isRecoveryReturn;
let recoveryFlowActive = false;
let recoveryEventHandled = false;
let initialAuthEventSeen = false;
let resolveInitialAuthEvent;
const initialAuthEvent = new Promise((resolve) => { resolveInitialAuthEvent = resolve; });
let resolveRecoveryEvent;
const recoveryEvent = new Promise((resolve) => { resolveRecoveryEvent = resolve; });

function setMessage(container, message, kind = "info") {
  if (!container) return;
  container.textContent = message;
  if (message) container.dataset.kind = kind;
  else delete container.dataset.kind;
}

function clearMessages() {
  document.querySelectorAll("[data-message], [data-global-message]").forEach((message) => {
    message.textContent = "";
    delete message.dataset.kind;
  });
}

function clearViewPasswords(container) {
  container.querySelectorAll("[data-password-toggle]").forEach((toggle) => {
    const input = toggle.closest(".password-field")?.querySelector("input");
    if (!input) return;

    input.value = "";
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
    input.type = "password";
    toggle.textContent = "Show";
    toggle.setAttribute("aria-label", `Show ${input.labels[0]?.textContent.toLowerCase() ?? "password"}`);
  });
}

function showView(name, updateHistory = true, moveFocus = true) {
  const selected = views.find((view) => view.dataset.view === name) ?? views[0];
  if (!selected) return;

  const previous = views.find((view) => !view.hidden);
  if (previous && previous !== selected) clearViewPasswords(previous);

  clearMessages();
  views.forEach((view) => {
    view.hidden = view !== selected;
  });

  if (selected.dataset.view === "verify" && signupEmailInput) {
    if (signupEmail && !signupEmailInput.value) signupEmailInput.value = signupEmail;
    if (signupEmailInput.value) signupEmail = signupEmailInput.value.trim();
    const resendButton = selected.querySelector('#resend-verification-form button[type="submit"]');
    if (resendButton) {
      resendButton.disabled = shouldDisableResendButton(signupEmailInput.value);
    }
    if (!signupEmailInput.value) {
      setMessage(
        selected.querySelector("[data-message]"),
        "No signup email is available. Return to signup to enter your email address first."
      );
    }
  }

  if (previous !== selected && moveFocus) selected.querySelector("h1")?.focus();

  const title = selected.querySelector("h1")?.textContent;
  document.title = title ? `Auth-Flow | ${title}` : "Auth-Flow";
  if (updateHistory) {
    const hash = `#${selected.dataset.view}`;
    if (location.hash !== hash) history.pushState({ view: selected.dataset.view }, "", hash);
  }
}

function setFormBusy(form, busy, message = "") {
  const submit = form.querySelector('button[type="submit"]');
  if (submit) {
    submit.disabled = form.id === "resend-verification-form"
      ? shouldDisableResendButton(signupEmailInput?.value, busy)
      : busy;
  }
  form.setAttribute("aria-busy", String(busy));
  if (message) setMessage(form.querySelector("[data-message]"), message, "loading");
}

function redirectToDashboard(notice = "") {
  if (navigationStarted) return;
  navigationStarted = true;
  window.location.replace(notice ? `dashboard.html?notice=${encodeURIComponent(notice)}` : "dashboard.html");
}

function redirectToSignIn(notice) {
  if (navigationStarted) return;
  navigationStarted = true;
  const target = new URL("index.html", window.location.href);
  target.searchParams.set("notice", notice);
  target.hash = "signin";
  window.location.replace(target.href);
}

function cleanCurrentAuthReturn() {
  history.replaceState(history.state, "", cleanAuthReturnUrl(window.location.href));
}

async function handleSignup(form) {
  const formData = new FormData(form);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  signupEmail = email;
  if (signupEmailInput) signupEmailInput.value = email;

  setFormBusy(form, true, "Creating your account…");
  try {
    if (!supabase) throw new Error("client-unavailable");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/` }
    });

    await handleSignupResponse({
      auth: supabase.auth,
      data,
      error,
      showDashboard: redirectToDashboard,
      showVerification(message) {
        showView("verify");
        setMessage(document.querySelector('#view-verify [data-message]'), message, "info");
      },
      showErrorFeedback(feedback) {
        setMessage(form.querySelector("[data-message]"), feedback.message, feedback.kind);
      }
    });
  } catch (error) {
    const feedback = authErrorMessage(error, "signup");
    setMessage(form.querySelector("[data-message]"), feedback.message, feedback.kind);
  } finally {
    setFormBusy(form, false);
  }
}

async function handleSignin(form) {
  clearPasswordRecoveryIntent(recoveryIntentStorage);
  const formData = new FormData(form);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  setFormBusy(form, true, "Signing in…");
  try {
    if (!supabase) throw new Error("client-unavailable");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const feedback = authErrorMessage(error, "signin");
      setMessage(form.querySelector("[data-message]"), feedback.message, feedback.kind);
      return;
    }

    const result = await getVerifiedUser(supabase.auth);
    if (!result.user) {
      setMessage(
        form.querySelector("[data-message]"),
        "We couldn't confirm your sign-in. Check your details and verify your email if you recently registered.",
        "error"
      );
      return;
    }

    redirectToDashboard();
  } catch (error) {
    const feedback = authErrorMessage(error, "signin");
    setMessage(form.querySelector("[data-message]"), feedback.message, feedback.kind);
  } finally {
    setFormBusy(form, false);
  }
}

async function handleResendVerification(form) {
  const formData = new FormData(form);
  const email = String(formData.get("email") || "").trim();
  if (!email) {
    setMessage(
      form.querySelector("[data-message]"),
      "No signup email is available. Return to signup to enter your email address first."
    );
    return;
  }
  signupEmail = email;

  setFormBusy(form, true, "Requesting a confirmation email…");
  try {
    if (!supabase) throw new Error("client-unavailable");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/` }
    });
    const feedback = error
      ? authErrorMessage(error, "resend")
      : {
          kind: "info",
          message: "If this address has a pending signup, a confirmation email will be sent. Check your inbox and spam folder."
        };
    setMessage(form.querySelector("[data-message]"), feedback.message, feedback.kind);
  } catch (error) {
    const feedback = authErrorMessage(error, "resend");
    setMessage(form.querySelector("[data-message]"), feedback.message, feedback.kind);
  } finally {
    setFormBusy(form, false);
  }
}

async function handleSignupConfirmationReturn() {
  showView("verify", false, false);
  setMessage(document.querySelector('#view-verify [data-message]'), "Checking your confirmation link…", "loading");
  await processSignupConfirmationReturn({
    auth: supabase?.auth,
    authReturn: initialAuthReturn,
    href: initialAuthReturnUrl,
    cleanUrl: cleanCurrentAuthReturn,
    showFeedback: (message) => {
      handlingAuthReturn = false;
      showView("verify", false, false);
      setMessage(document.querySelector('#view-verify [data-message]'), message, "error");
    },
    showDashboard: () => {
      handlingAuthReturn = false;
      redirectToDashboard();
    }
  });
}

async function handleOAuthCallback() {
  await processOAuthReturn({
    auth: supabase?.auth,
    authReturn: initialAuthReturn,
    cleanUrl: cleanCurrentAuthReturn,
    showFeedback: (message) => {
      handlingAuthReturn = false;
      showView("signin", false, false);
      setMessage(document.querySelector('#view-signin [data-message]'), message, "error");
    },
    showDashboard: () => {
      handlingAuthReturn = false;
      redirectToDashboard();
    }
  });
}

async function startOAuthSignIn(button) {
  const provider = button.dataset.oauthProvider;
  const message = button.closest("[data-view]")?.querySelector("[data-message]");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");

  const result = await signInWithOAuth(
    supabase?.auth,
    provider,
    `${window.location.origin}/`
  );

  if (result.error) {
    setMessage(message, oauthErrorMessage(result.error), "error");
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function restoreViewFromLocation() {
  if (handlingAuthReturn) return;
  const requested = views.find((view) => view.dataset.view === location.hash.slice(1)) ?? views[0];
  const current = views.find((view) => !view.hidden);
  if (requested && requested !== current) showView(requested.dataset.view, false);
}

function showRedirectNotice() {
  const url = new URL(window.location.href);
  const notice = url.searchParams.get("notice");
  const messages = {
    "verified-email-required": "Sign in with an account that has a confirmed email address to access the dashboard.",
    "provider-email-required": "Your sign-in provider must supply a confirmed email address to access the dashboard.",
    "session-check-failed": "We couldn't verify your sign-in. Please sign in again.",
    "signed-out": "You have signed out."
  };

  if (!messages[notice]) return;
  setMessage(document.querySelector('#view-signin [data-message]'), messages[notice], "error");
  url.searchParams.delete("notice");
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

async function protectDashboard() {
  const dashboard = document.querySelector("[data-dashboard-app]");
  const status = document.querySelector("[data-access-status]");
  if (!dashboard || !status) return;

  await checkDashboardAccess({
    auth: supabase?.auth,
    redirectToSignIn,
    showDashboard: (user, session) => {
      currentDashboardUser = user;
      const values = accountValues(user, session);
      document.querySelectorAll("[data-account-value]").forEach((value) => {
        value.textContent = values[value.dataset.accountValue] || "—";
      });
      const passwordForm = document.querySelector("#change-password-form");
      configurePasswordForm(user, passwordForm);
      dashboard.hidden = false;
      status.hidden = true;
    }
  });
}

function configurePasswordForm(user, form) {
  if (!form) return;
  const hasPassword = supportsPasswordChange(user);
  const currentPasswordField = form.querySelector("[data-current-password-field]");
  const currentPasswordInput = form.querySelector('[name="currentPassword"]');
  const title = document.querySelector("[data-password-title]");
  const intro = document.querySelector("[data-password-intro]");
  const submit = form.querySelector("[data-password-submit]");

  form.dataset.passwordMode = hasPassword ? "change" : "set";
  if (currentPasswordField) currentPasswordField.hidden = !hasPassword;
  if (currentPasswordInput) currentPasswordInput.required = hasPassword;
  if (title) title.textContent = hasPassword ? "Change Password" : "Set Password";
  if (intro) {
    intro.textContent = hasPassword
      ? "Enter your current password and choose a new password."
      : "Add a password to sign in with your email as well as your connected provider.";
  }
  if (submit) submit.textContent = hasPassword ? "Update password" : "Set password";
}

async function handleSignOut() {
  const button = document.querySelector("[data-signout]");
  const message = document.querySelector("[data-global-message]");
  if (!supabase || !button) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  const result = await performSignOut(supabase.auth);
  if (!result.success) {
    setMessage(message, "We couldn't sign you out. Check your connection and try again.", "error");
    button.disabled = false;
    button.removeAttribute("aria-busy");
    return;
  }
  redirectToSignIn("signed-out");
}

async function handleChangePassword(form) {
  const formData = new FormData(form);
  const currentPassword = String(formData.get("currentPassword") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const isSettingPassword = form.dataset.passwordMode === "set";
  setFormBusy(form, true, isSettingPassword ? "Setting your password…" : "Updating your password…");
  try {
    if (!supabase || !currentDashboardUser) throw new Error("session-unavailable");
    const result = isSettingPassword
      ? await setPassword(supabase.auth, currentDashboardUser, newPassword)
      : await changePassword(supabase.auth, currentDashboardUser, currentPassword, newPassword);
    const { data, error } = result;
    if (error) {
      setMessage(form.querySelector("[data-message]"), passwordChangeMessage(error), "error");
      return;
    }
    if (isSettingPassword) {
      currentDashboardUser = {
        ...(data?.user || currentDashboardUser),
        user_metadata: {
          ...(data?.user?.user_metadata || currentDashboardUser.user_metadata || {}),
          password_signin_enabled: true
        }
      };
      configurePasswordForm(currentDashboardUser, form);
    }
    setMessage(
      form.querySelector("[data-message]"),
      isSettingPassword ? "Password sign-in is now set up for this account." : "Your password has been updated.",
      "success"
    );
  } catch (error) {
    setMessage(form.querySelector("[data-message]"), passwordChangeMessage(error), "error");
  } finally {
    form.querySelectorAll('[name="currentPassword"], [name="newPassword"], [name="confirmPassword"]')
      .forEach((input) => { input.value = ""; });
    setFormBusy(form, false);
  }
}

async function handleRecoveryRequest(form) {
  const email = String(new FormData(form).get("email") || "").trim();
  setFormBusy(form, true, "Requesting a recovery email…");
  try {
    if (!supabase) throw new Error("client-unavailable");
    // Keep route state in the query. Supabase's implicit callback uses the URL
    // fragment for tokens, so adding a view hash here would corrupt that fragment.
    const redirectTo = `${window.location.origin}/index.html?flow=recovery`;
    const { error } = await requestPasswordRecovery(supabase.auth, email, redirectTo);
    if (!error) markPasswordRecoveryIntent(recoveryIntentStorage);
    setMessage(form.querySelector("[data-message]"), passwordRecoveryMessage(error, "request"), error ? "error" : "info");
  } catch (error) {
    setMessage(form.querySelector("[data-message]"), passwordRecoveryMessage(error, "request"), "info");
  } finally {
    setFormBusy(form, false);
  }
}

async function handleNewPassword(form) {
  if (!recoveryFlowActive) {
    setMessage(form.querySelector("[data-message]"), "This password reset link is invalid or expired. Request a new one.", "error");
    return;
  }
  const password = String(new FormData(form).get("password") || "");
  setFormBusy(form, true, "Updating your password…");
  try {
    if (!supabase) throw new Error("client-unavailable");
    const { error } = await updateRecoveredPassword(supabase.auth, password);
    if (error) {
      setMessage(form.querySelector("[data-message]"), passwordRecoveryMessage(error, "update"), "error");
      return;
    }
    recoveryFlowActive = false;
    redirectToDashboard("password-reset");
  } catch (error) {
    setMessage(form.querySelector("[data-message]"), passwordRecoveryMessage(error, "update"), "error");
  } finally {
    form.querySelectorAll("input[type='password']").forEach((input) => { input.value = ""; });
    setFormBusy(form, false);
  }
}

function handleRecoveryUrlFailure() {
  clearPasswordRecoveryIntent(recoveryIntentStorage);
  cleanCurrentAuthReturn();
  handlingAuthReturn = false;
  showView("recovery", false, false);
  setMessage(
    document.querySelector('#view-recovery [data-message]'),
    "This password reset link is invalid or expired. Request a new one.",
    "error"
  );
}

async function handleRecoveryEvent(event) {
  const result = await handlePasswordRecoveryEvent({
    auth: supabase?.auth,
    event,
    cleanUrl: cleanCurrentAuthReturn,
    showForm() {
      recoveryFlowActive = true;
      handlingAuthReturn = false;
      showView("new-password", false, false);
    },
    showFeedback(message) {
      recoveryFlowActive = false;
      handlingAuthReturn = false;
      showView("recovery", false, false);
      setMessage(document.querySelector('#view-recovery [data-message]'), message, "error");
    }
  });
  clearPasswordRecoveryIntent(recoveryIntentStorage);
  return result;
}

function showDashboardNotice() {
  const url = new URL(window.location.href);
  const notice = url.searchParams.get("notice");
  if (notice === "password-reset") {
    setMessage(document.querySelector("[data-global-message]"), "Your password has been reset successfully.", "success");
    url.searchParams.delete("notice");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
}

function subscribeToAuthChanges() {
  if (!supabase) return;
  const onDashboard = document.body.classList.contains("dashboard-page");
  listenForAuthChanges(supabase.auth, async (event, session) => {
    if (!initialAuthEventSeen) {
      initialAuthEventSeen = true;
      if (event === "PASSWORD_RECOVERY") {
        recoveryEventHandled = true;
        await handleRecoveryEvent(event);
        resolveInitialAuthEvent(event);
        resolveRecoveryEvent(event);
      } else {
        resolveInitialAuthEvent(event);
      }
    }
    if (event === "PASSWORD_RECOVERY") {
      if (!recoveryEventHandled && !document.body.classList.contains("dashboard-page")) {
        recoveryEventHandled = true;
        await handleRecoveryEvent(event);
        resolveRecoveryEvent(event);
      }
      return;
    }
    if (onDashboard) {
      if (event === "SIGNED_OUT") {
        redirectToSignIn("signed-out");
        return;
      }
      if (["SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) {
        await protectDashboard();
      }
      return;
    }

    // The sign-in form verifies SIGNED_IN itself; avoid a concurrent duplicate getUser() check.
    if (initialAuthReturn.isAuthReturn || isRecoveryReturn || !session ||
        !["INITIAL_SESSION", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) return;
    await redirectVerifiedUser(supabase.auth, redirectToDashboard);
  });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-view-link]");
  if (link) {
    event.preventDefault();
    if (!['recovery', 'new-password'].includes(link.dataset.viewLink)) {
      clearPasswordRecoveryIntent(recoveryIntentStorage);
    }
    showView(link.dataset.viewLink);
    return;
  }

  const toggle = event.target.closest("[data-password-toggle]");
  if (toggle) {
    const input = document.getElementById(toggle.dataset.passwordToggle);
    if (!input) return;
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    toggle.textContent = visible ? "Hide" : "Show";
    toggle.setAttribute("aria-label", `${visible ? "Hide" : "Show"} ${input.labels[0]?.textContent.toLowerCase() ?? "password"}`);
    return;
  }

  const oauthButton = event.target.closest("[data-oauth-provider]");
  if (oauthButton) {
    clearPasswordRecoveryIntent(recoveryIntentStorage);
    void startOAuthSignIn(oauthButton);
    return;
  }

  const unavailable = event.target.closest("[data-unavailable]");
  if (unavailable) {
    const view = unavailable.closest("[data-view]");
    const target = view?.querySelector("[data-message]") ?? document.querySelector("[data-global-message]");
    setMessage(target, `${unavailable.dataset.unavailable} is not connected yet.`);
    return;
  }

  if (event.target.closest("[data-signout]")) {
    void handleSignOut();
  }
});

window.addEventListener("popstate", restoreViewFromLocation);
window.addEventListener("hashchange", restoreViewFromLocation);
window.addEventListener("pagehide", () => {
  clearViewPasswords(document);
  clearMessages();
});

document.querySelectorAll("[data-local-form]").forEach((form) => {
  form.addEventListener("input", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const message = form.querySelector("[data-message]");
    if (message) setMessage(message, "");
    input.removeAttribute("aria-invalid");
    input.setCustomValidity("");

    if (input.matches("[data-password-rules]")) {
      updatePasswordRequirements(input);
    }

    const confirm = form.querySelector('[name="confirm"], [name="confirmPassword"]');
    const password = form.querySelector('[name="password"], [name="newPassword"]');
    if (confirm && password) {
      const mismatch = Boolean(confirm.value) && password.value !== confirm.value;
      confirm.setCustomValidity(mismatch ? "Passwords do not match." : "");
      if (mismatch) confirm.setAttribute("aria-invalid", "true");
      else confirm.removeAttribute("aria-invalid");
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const confirm = form.querySelector('[name="confirm"], [name="confirmPassword"]');
    const password = form.querySelector('[name="password"], [name="newPassword"]');

    if (password?.matches("[data-password-rules]")) {
      const allRequirementsMet = updatePasswordRequirements(password);
      password.setCustomValidity(allRequirementsMet ? "" : "Choose a password that meets each listed requirement.");
      if (!allRequirementsMet) password.setAttribute("aria-invalid", "true");
    }

    if (confirm && password) {
      const mismatch = password.value !== confirm.value;
      confirm.setCustomValidity(mismatch ? "Passwords do not match." : "");
      if (mismatch) {
        confirm.setAttribute("aria-invalid", "true");
        confirm.reportValidity();
        return;
      }
      confirm.removeAttribute("aria-invalid");
    }

    if (!form.reportValidity()) return;
    if (form.id === "signup-form") {
      void handleSignup(form);
      return;
    }
    if (form.id === "signin-form") {
      void handleSignin(form);
      return;
    }
    if (form.id === "resend-verification-form") {
      void handleResendVerification(form);
      return;
    }
    if (form.id === "change-password-form") {
      void handleChangePassword(form);
      return;
    }
    if (form.id === "recovery-form") {
      void handleRecoveryRequest(form);
      return;
    }
    if (form.id === "new-password-form") {
      void handleNewPassword(form);
      return;
    }

  });
});

function updatePasswordRequirements(input) {
  const rules = evaluatePasswordRequirements(input.value);
  let metCount = 0;

  for (const [name, met] of Object.entries(rules)) {
    const item = input.form.querySelector(`[data-password-rule="${name}"]`);
    if (!item) continue;
    item.dataset.valid = String(met);
    item.firstElementChild.textContent = met ? "✓" : "○";
    metCount += Number(met);
  }

  const status = input.form.querySelector("[data-password-rules-status]");
  if (status) status.textContent = `${metCount} of ${Object.keys(rules).length} requirements met.`;
  return metCount === Object.keys(rules).length;
}

subscribeToAuthChanges();
async function initializePage() {
  if (document.body.classList.contains("dashboard-page")) {
    await protectDashboard();
    if (!document.querySelector("[data-dashboard-app]")?.hidden) showDashboardNotice();
    return;
  }

  const initialView = location.hash.slice(1) || "signin";
  if (!supabase) {
    showView(initialView === "new-password" ? "recovery" : initialView, false, Boolean(location.hash));
    if (initialView === "new-password") setMessage(document.querySelector('#view-recovery [data-message]'), "This password reset link is invalid or expired. Request a new one.", "error");
    showRedirectNotice();
    return;
  }

  if (isRecoveryReturn || initialView === "new-password") {
    if (!initialAuthReturn.hasError) {
      await Promise.race([recoveryEvent, new Promise((resolve) => setTimeout(() => resolve("timeout"), 8000))]);
    }
  } else if (initialAuthReturn.isAuthReturn) {
    await Promise.race([initialAuthEvent, new Promise((resolve) => setTimeout(() => resolve("timeout"), 8000))]);
  }
  if (recoveryFlowActive) return;
  if (isRecoveryReturn || initialView === "new-password") {
    if (initialAuthReturn.hasError || initialAuthEventSeen) handleRecoveryUrlFailure();
    else {
      handlingAuthReturn = false;
      showView("recovery", false, false);
      setMessage(document.querySelector('#view-recovery [data-message]'), "We couldn't verify this password reset link. Check your connection, then request a new one.", "error");
    }
  } else if (initialAuthReturn.isSignupConfirmation) {
    void handleSignupConfirmationReturn();
  } else if (initialAuthReturn.isOAuthReturn) {
    void handleOAuthCallback();
  } else {
    handlingAuthReturn = false;
    showView(initialView, false, Boolean(location.hash));
    showRedirectNotice();
  }
}
void initializePage();
