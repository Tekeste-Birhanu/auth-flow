import "./supabase.js";

const views = [...document.querySelectorAll("[data-view]")];
const emailLabel = document.querySelector("[data-preserved-email]");
let signupEmail = "";

function setMessage(container, message, kind = "info") {
  if (!container) return;
  container.textContent = message;
  container.dataset.kind = kind;
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
  if (previous && previous !== selected) {
    clearViewPasswords(previous);
  }

  clearMessages();
  views.forEach((view) => {
    view.hidden = view !== selected;
  });

  if (previous !== selected && moveFocus) {
    selected.querySelector("h1")?.focus();
  }

  if (selected.dataset.view === "verify") {
    emailLabel.textContent = signupEmail || "No email entered";
    const message = selected.querySelector("[data-message]");
    setMessage(
      message,
      signupEmail
        ? "Your details passed local checks. No account has been created and no email has been sent; registration will be connected in a later module."
        : "No account has been created and no email has been sent. Registration will be connected in a later module."
    );
  }

  const title = selected.querySelector("h1")?.textContent;
  document.title = title ? `Auth-Flow | ${title}` : "Auth-Flow";
  if (updateHistory) {
    const hash = `#${selected.dataset.view}`;
    if (location.hash !== hash) history.pushState({ view: selected.dataset.view }, "", hash);
  }
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
    setMessage(target, `${unavailable.dataset.unavailable} is not connected yet. No request was made and no account action was performed.`);
  }
});

function restoreViewFromLocation() {
  const requested = views.find((view) => view.dataset.view === location.hash.slice(1)) ?? views[0];
  const current = views.find((view) => !view.hidden);
  if (requested && requested !== current) showView(requested.dataset.view, false);
}

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
    const submit = form.querySelector('button[type="submit"]');
    const message = form.querySelector("[data-message]");
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
    if (submit) submit.disabled = true;

    if (form.id === "signup-form") {
      signupEmail = new FormData(form).get("email").toString().trim();
      form.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ""; });
      showView("verify");
    } else if (form.id === "signin-form") {
      setMessage(message, "Sign-in is not connected yet. No credentials were sent and no account was accessed.");
    } else if (form.id === "recovery-form") {
      setMessage(message, "Password recovery is not connected yet. No email was sent. This message does not indicate whether an account exists.");
    } else if (form.id === "new-password-form") {
      setMessage(message, "Local checks passed, but no recovery session is present. Your password was not changed; recovery will be connected in a later module.");
    } else if (form.id === "change-password-form") {
      setMessage(message, "Password changes are not connected yet. The current password was not checked and no password was changed.");
    }

    if (submit) submit.disabled = false;
  });
});

showView(location.hash.slice(1) || "signin", false, Boolean(location.hash));
