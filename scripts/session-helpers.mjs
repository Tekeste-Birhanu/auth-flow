const dash = "—";

export function evaluatePasswordRequirements(value) {
  const password = String(value ?? "");
  return {
    length: password.length >= 8,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    digit: /[0-9]/.test(password),
    symbol: Array.from(password).some((character) => "!@#$%^&*()_+-=[]{};':\"\\|<>?,./`~".includes(character))
  };
}

function formatDate(value) {
  if (!value) return dash;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? dash : new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function providerNames(user) {
  const providers = new Set([
    ...(Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : []),
    ...(Array.isArray(user?.identities) ? user.identities.map((identity) => identity.provider) : [])
  ]);
  if (user?.app_metadata?.provider) providers.add(user.app_metadata.provider);

  const names = [...providers].map((provider) => ({
    email: "Email and password",
    google: "Google",
    github: "GitHub"
  })[provider] || provider);
  return names.length ? names.join(", ") : dash;
}

export function accountValues(user, session) {
  return {
    email: user?.email || dash,
    id: user?.id || dash,
    verification: user?.email_confirmed_at ? "Verified" : "Not verified",
    provider: providerNames(user),
    created: formatDate(user?.created_at),
    lastSignIn: formatDate(user?.last_sign_in_at),
    expires: formatDate(session?.expires_at ? session.expires_at * 1000 : null)
  };
}

export function supportsPasswordChange(user) {
  return Array.isArray(user?.app_metadata?.providers) && user.app_metadata.providers.includes("email") ||
    Array.isArray(user?.identities) && user.identities.some((identity) => identity.provider === "email");
}

export function listenForAuthChanges(auth, handler) {
  const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
    // Auth callbacks must return before code makes another Auth request.
    setTimeout(() => { void handler(event, session); }, 0);
  });
  return subscription;
}

export async function performSignOut(auth) {
  try {
    const { error } = await auth.signOut();
    return { success: !error };
  } catch {
    return { success: false };
  }
}

export async function changePassword(auth, user, currentPassword, newPassword) {
  if (!supportsPasswordChange(user) || !user?.email) {
    return { error: { code: "password_provider_unavailable" } };
  }
  return auth.updateUser({ password: newPassword, current_password: currentPassword });
}

export function passwordChangeMessage(error) {
  const code = String(error?.code || "").toLowerCase();
  if (code === "password_provider_unavailable") {
    return "Password changes are available only for accounts with an email and password sign-in.";
  }
  if (code === "weak_password") {
    return "Choose a password that meets the project's password requirements.";
  }
  if (code === "same_password") {
    return "Choose a password different from your current password.";
  }
  if (["invalid_credentials", "current_password_invalid"].includes(code)) {
    return "The current password is incorrect. Check it and try again.";
  }
  if (["reauthentication_needed", "reauthentication_required"].includes(code)) {
    return "Sign in again before changing your password.";
  }
  if (error?.name === "AuthRetryableFetchError" || error instanceof TypeError) {
    return "Unable to reach the authentication service. Check your connection and try again.";
  }
  return "The password could not be changed. Check the current password and try again.";
}
