const AUTH_CALLBACK_KEYS = ["access_token", "error", "error_code", "error_description", "code"];

export function inspectAuthReturnUrl(href) {
  const url = new URL(href);
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");

  // Match Supabase JS behavior: query parameters take precedence over the fragment.
  url.searchParams.forEach((value, key) => params.set(key, value));

  return {
    isAuthReturn: AUTH_CALLBACK_KEYS.some((key) => params.has(key)) || params.get("type") === "signup",
    isSignupConfirmation: params.get("type") === "signup",
    hasAccessToken: params.has("access_token"),
    errorCode: (params.get("error_code") || "").toLowerCase(),
    hasError: params.has("error") || params.has("error_code") || params.has("error_description")
  };
}

export function cleanAuthReturnUrl(href) {
  const url = new URL(href);
  return `${url.pathname}`;
}

export async function getVerifiedAuthState(auth) {
  const { data: sessionData, error: sessionError } = await auth.getSession();
  if (sessionError) return { user: null, session: null, reason: "session-error" };
  if (!sessionData.session) return { user: null, session: null, reason: "no-session" };

  // getUser() validates the saved access token with Supabase Auth.
  const { data: userData, error: userError } = await auth.getUser();
  if (userError) return { user: null, session: null, reason: "user-error" };
  if (!userData.user) return { user: null, session: null, reason: "no-user" };
  if (!userData.user.email_confirmed_at) return { user: null, session: null, reason: "email-unverified" };

  return { user: userData.user, session: sessionData.session, reason: null };
}

export async function getVerifiedUser(auth) {
  const result = await getVerifiedAuthState(auth);
  return { user: result.user, reason: result.reason };
}

export async function redirectVerifiedUser(auth, redirect) {
  try {
    const result = await getVerifiedUser(auth);
    if (!result.user) return false;
    redirect();
    return true;
  } catch {
    return false;
  }
}

export async function protectDashboard({ auth, showDashboard, redirectToSignIn }) {
  try {
    const result = await getVerifiedAuthState(auth);
    if (!result.user) {
      redirectToSignIn(result.reason === "user-error" || result.reason === "session-error"
        ? "session-check-failed"
        : "verified-email-required");
      return false;
    }

    showDashboard(result.user, result.session);
    return true;
  } catch {
    redirectToSignIn("session-check-failed");
    return false;
  }
}

export async function handleSignupConfirmationReturn({ auth, authReturn, href, cleanUrl, showFeedback, showDashboard }) {
  try {
    if (authReturn.hasError || !authReturn.isSignupConfirmation || !authReturn.hasAccessToken) {
      throw new Error("invalid-confirmation-link");
    }

    const callbackUrl = new URL(href);
    const callbackParams = new URLSearchParams(callbackUrl.hash.slice(1));
    callbackUrl.searchParams.forEach((value, key) => callbackParams.set(key, value));
    const callbackToken = callbackParams.get("access_token");
    const { data: callbackData, error: callbackError } = await auth.getSession();
    if (callbackError || !callbackData.session || callbackData.session.access_token !== callbackToken) {
      throw callbackError || new Error("invalid-confirmation-link");
    }

    const result = await getVerifiedUser(auth);
    if (!result.user) {
      if (["session-error", "user-error"].includes(result.reason)) {
        throw new Error("confirmation-service-unavailable");
      }
      throw new Error("invalid-confirmation-link");
    }

    cleanUrl();
    showDashboard();
    return { success: true };
  } catch (error) {
    cleanUrl();
    const unavailable = error.message === "confirmation-service-unavailable" ||
      error.name === "AuthRetryableFetchError" || error instanceof TypeError;
    showFeedback(unavailable
      ? "We couldn't verify this link with Supabase. Check your connection and request a new confirmation link."
      : verificationLinkMessage(authReturn.errorCode));
    return { success: false, reason: unavailable ? "service-unavailable" : "invalid-link" };
  }
}

export function authErrorMessage(error, operation) {
  const code = String(error?.code || "").toLowerCase();

  if (operation === "signup" && ["email_exists", "user_already_exists"].includes(code)) {
    return {
      kind: "neutral",
      message: "If this email address can be registered, a confirmation link will be sent. Check your inbox and spam folder."
    };
  }

  if (["over_email_send_rate_limit", "over_request_rate_limit"].includes(code)) {
    return { kind: "error", message: "Too many attempts. Wait a little while, then try again." };
  }

  if (operation === "signup" && code === "weak_password") {
    return { kind: "error", message: "Choose a password that meets the project's password requirements." };
  }

  if (operation === "signup" && ["email_address_invalid", "validation_failed"].includes(code)) {
    return { kind: "error", message: "Check the email address and password, then try again." };
  }

  if (operation === "signup" && code === "signup_disabled") {
    return { kind: "error", message: "New registrations are temporarily unavailable." };
  }

  if (error?.name === "AuthRetryableFetchError" || error instanceof TypeError) {
    return { kind: "error", message: "Unable to reach the authentication service. Check your connection and try again." };
  }

  if (operation === "resend") {
    return {
      kind: "neutral",
      message: "If this address has a pending signup, a confirmation email will be sent. Check your inbox and spam folder."
    };
  }

  if (operation === "signin" && ["invalid_credentials", "email_not_confirmed", "user_not_found"].includes(code)) {
    return {
      kind: "error",
      message: "We couldn't sign you in with those details. Check your email and password, and confirm your address if you recently registered."
    };
  }

  return { kind: "error", message: "The request couldn't be completed. Try again in a moment." };
}

export function verificationLinkMessage(errorCode) {
  if (errorCode === "otp_expired") {
    return "This verification link has expired or was already used. Return to create account to request another link.";
  }
  return "This verification link is invalid, expired, or already used. Return to create account to request another link.";
}
