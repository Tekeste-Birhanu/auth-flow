import { supabase } from "./supabase.js";
import {
  authErrorMessage,
  cleanAuthReturnUrl,
  getVerifiedUser,
  handleSignupConfirmationReturn as processSignupConfirmationReturn,
  inspectAuthReturnUrl,
  protectDashboard as checkDashboardAccess
} from "./auth-helpers.mjs";

const views = [...document.querySelectorAll("[data-view]")];
const signupEmailInput = document.querySelector("#verify-email");
let signupEmail = "";
const initialAuthReturn = inspectAuthReturnUrl(window.location.href);
let handlingAuthReturn = initialAuthReturn.isAuthReturn;

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
    if (!signupEmailInput.value) {
      setMessage(
        selected.querySelector("[data-message]"),
        "Enter the email address you used to sign up to request a confirmation link."
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
  if (submit) submit.disabled = busy;
  form.setAttribute("aria-busy", String(busy));
  if (message) setMessage(form.querySelector("[data-message]"), message, "loading");
}

function redirectToDashboard() {
  window.location.replace("dashboard.html");
}

function redirectToSignIn(notice) {
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

    if (error) {
      const feedback = authErrorMessage(error, "signup");
      if (feedback.kind === "neutral") {
        showView("verify");
        setMessage(document.querySelector('#view-verify [data-message]'), feedback.message);
      } else {
        setMessage(form.querySelector("[data-message]"), feedback.message, "error");
      }
      return;
    }

    if (data.session) {
      const result = await getVerifiedUser(supabase.auth);
      if (result.user) {
        redirectToDashboard();
        return;
      }
    }

    showView("verify");
    setMessage(
      document.querySelector('#view-verify [data-message]'),
      "If this email address can be registered, a confirmation link will be sent. Check your inbox and spam folder."
    );
  } catch (error) {
    const feedback = authErrorMessage(error, "signup");
    setMessage(form.querySelector("[data-message]"), feedback.message, feedback.kind);
  } finally {
    setFormBusy(form, false);
  }
}

async function handleSignin(form) {
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
    href: window.location.href,
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
    "session-check-failed": "We couldn't verify your sign-in. Please sign in again."
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
    showDashboard: () => {
      dashboard.hidden = false;
      status.hidden = true;
    }
  });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-view-link]");
  if (link) {
    event.preventDefault();
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

  const unavailable = event.target.closest("[data-unavailable]");
  if (unavailable) {
    const view = unavailable.closest("[data-view]");
    const target = view?.querySelector("[data-message]") ?? document.querySelector("[data-global-message]");
    setMessage(target, `${unavailable.dataset.unavailable} is not connected in Module 03.`);
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

    if (form.id === "resend-verification-form" && input.name === "email") {
      signupEmail = input.value.trim();
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

    const message = form.querySelector("[data-message]");
    if (form.id === "recovery-form") {
      setMessage(message, "Password recovery will be available in a later module. No email was sent.");
    } else if (form.id === "new-password-form") {
      setMessage(message, "Password changes will be available in a later module. No password was changed.");
    } else if (form.id === "change-password-form") {
      setMessage(message, "Password changes will be available in a later module. No password was changed.");
    }
  });
});

if (document.body.classList.contains("dashboard-page")) {
  void protectDashboard();
} else if (initialAuthReturn.isAuthReturn) {
  void handleSignupConfirmationReturn();
} else {
  const initialView = location.hash.slice(1) || "signin";
  showView(initialView, false, Boolean(location.hash));
  showRedirectNotice();
}
