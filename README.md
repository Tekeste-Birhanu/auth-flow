# auth-flow

A minimal authentication app built with vanilla HTML, CSS, JavaScript, and Supabase Auth. This project is a hands-on exercise in implementing common authentication flows and building a small, maintainable web application.

## Planned application flows

- Email and password authentication
- Email verification
- Google OAuth
- GitHub OAuth
- Password recovery and reset
- Persistent authentication sessions
- Protected dashboard
- Account and session information
- Logout and password change
- Responsive and accessible UI

## Tech Stack

- **HTML5** — page structure
- **CSS3** — styling and responsive layouts
- **Vanilla JavaScript** — application logic
- **npm** — dependency management
- **Supabase Auth** — authentication and session management
- **Supabase JavaScript SDK** — client-side integration

No frontend framework or build tool is planned.

## Development Roadmap

### Module 01 — Setup and UI Foundation

Build the initial interface and establish the project structure.

- Initialize npm and install the Supabase SDK.
- Organize the project files and assets.
- Create login and signup interfaces.
- Add Google and GitHub sign-in buttons.
- Create email verification and password recovery screens.
- Build the dashboard layout.
- Add client-side form validation and UI feedback.
- Create responsive layouts for mobile, tablet, and desktop.
- Use honest placeholders for account details; do not invent a user or session.

### Module 02 — Supabase Integration

Configure Supabase and prepare the application for real authentication.

- Create a Supabase project.
- Configure the Supabase URL and publishable key.
- Initialize the Supabase client.
- Configure authentication redirect URLs.
- Configure email templates and verification settings.
- Configure Google and GitHub OAuth providers.
- Verify that the client can communicate with Supabase.
- Keep secrets and environment-specific configuration out of version control.

### Module 03 — Email and Password Authentication

Implement the primary email-based authentication flows.

- Register with email and password.
- Validate registration and login forms.
- Handle duplicate accounts and invalid credentials.
- Send email verification messages.
- Verify email addresses using Supabase.
- Require email verification before dashboard access for email/password accounts.
- Sign in with email and password.
- Display meaningful authentication errors.
- Handle expired and invalid verification links.

### Module 04 — Session and Dashboard

Manage authenticated sessions and display basic account information.

- Persist and restore authentication sessions.
- Listen for authentication state changes.
- Protect dashboard access from unauthenticated users.
- Redirect authenticated users away from login screens when appropriate.
- Display the user's email and ID.
- Display account creation date and email verification status.
- Display available provider and session information.
- Handle expired sessions and token refresh.
- Implement logout.
- Allow password changes for password-based accounts.

### Module 05 — OAuth Authentication

Implement third-party authentication with Google and GitHub.

- Sign in with Google.
- Sign in with GitHub.
- Configure provider credentials and redirect URLs.
- Handle OAuth redirects and callback processing.
- Restore the authenticated session after returning from the provider.
- Handle cancelled sign-ins and provider errors.
- Handle existing accounts and provider-related edge cases.
- Allow verified OAuth users to access the dashboard without a separate app email-verification step.

### Module 06 — Password Recovery

Implement the complete password-reset flow.

- Request a password recovery email.
- Handle recovery requests without unnecessarily revealing whether an account exists.
- Process the recovery link.
- Validate the recovery session.
- Handle expired or invalid recovery links.
- Validate the new password and confirmation.
- Update the password through Supabase.
- Display success and error feedback.
- Handle navigation after a successful reset.

### Module 07 — Testing and Hardening

Verify the application across normal and failure scenarios.

- Manually test every authentication flow.
- Test invalid credentials and form inputs.
- Test expired, invalid, and reused verification links.
- Test password recovery and OAuth failures.
- Test page refreshes and session restoration.
- Test unauthenticated dashboard access.
- Test logout and expired sessions.
- Verify configuration and key-handling practices.
- Review accessible forms, keyboard navigation, and focus states.
- Test responsive layouts across screen sizes.
- Check browser console errors and network failures.
- Document known limitations and future improvements.

## Project Scope

**Included:** core Supabase Auth flows, a minimal dashboard, session handling, responsive UI, and authentication error handling.

**Not included in the initial version:** custom profile tables, account deletion, an admin panel, teams, payments, or a custom backend.

The project uses Node's built-in test runner for static checks and mocked SDK behavior. Live authentication and email-link flows still require manual browser verification.

## Development Approach

The application is built incrementally, with each module establishing a foundation for the next. The Module 01 preview uses honest placeholders rather than mock account data. Email/password authentication is implemented in Module 03; broader session management is handled in Module 04.

## Status

**Current phase:** Module 06 - Password Recovery (manual email-link verification pending)

**Next:** Module 07 - Testing and Hardening

This is a learning and portfolio project focused on understanding authentication flows and building a maintainable application with minimal tooling.

## Module 01 implementation notes

Module 01 provides the authentication and account screens as a UI foundation. Module 03 connects email/password registration, sign-in, confirmation emails, and the verified-user dashboard gate. Module 04 adds session management, account details, logout, and password changes. Module 05 connects Google and GitHub sign-in.

### Module 06 password recovery

The recovery form calls Supabase Auth `resetPasswordForEmail()` with the existing app URL and `?flow=recovery` return marker. The marker stays in the query string so Supabase can use the URL fragment for callback tokens. The app reveals the new-password form only after Supabase emits `PASSWORD_RECOVERY` and the app confirms a valid session and user. Email confirmation is enforced by the dashboard gate, not by the recovery form. Invalid, expired, or reused links return to the recovery form with a safe message. Callback parameters are removed after Supabase processes the return. Password updates use `updateUser({ password })` and the same five password requirements shown during signup and password changes. A successful update keeps the user signed in and redirects to the dashboard with a one-time success notice.

Recovery requests use neutral feedback so the page does not disclose whether an account exists. Supabase Dashboard redirect allowlists must include the local app URL (`http://127.0.0.1:4173/**`) and the production app URL when deployed. Email delivery and link behavior must still be verified manually in a browser with the configured Supabase project.

Start the local static server with `npm start` and open the URL printed in the terminal (by default, `http://127.0.0.1:4173`). The server uses Node's built-in HTTP module, so it adds no runtime dependency or build step.

### Supabase SDK browser loading

The installed SDK is `@supabase/supabase-js` 2.117.3. Its ESM entry (`dist/index.mjs`) imports five other Supabase packages by bare package names. Browsers do not resolve those names automatically, so using the ESM entry directly would require an import map covering the SDK and its transitive package imports.

The project uses the installed SDK's UMD bundle at `node_modules/@supabase/supabase-js/dist/umd/supabase.js` as a classic script, then initializes one shared client from native browser modules. The local Node server reads `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from `.env` and serves only those two public values through `/scripts/config.js`; it does not expose other environment variables. Copy `.env.example` to `.env` and set the values from your Supabase project before starting the server. The SDK itself is consumed through its UMD global to avoid a build tool or a transitive import map.

### Module 02 configuration

Use Node.js 22.0.0 or newer. The server loads `.env` with Node's built-in `process.loadEnvFile` and exits with a safe configuration error if the URL or key is missing, malformed, or a secret/service-role key. The browser receives only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; never put a Supabase secret/service-role key or an OAuth client secret in `.env` or the repository.

For local development, start the server with `npm start` and use `http://127.0.0.1:4173`. In the Supabase Dashboard's URL configuration, set the Site URL to `http://127.0.0.1:4173` and allow `http://127.0.0.1:4173` and `http://127.0.0.1:4173/**` as redirect URLs. These are dashboard settings; the app does not currently define an OAuth callback route.

Enable the Email provider and **Confirm email**. The default **Confirm sign up** email template is used. Editing the template requires custom SMTP. These settings are configured in the Supabase Dashboard, not in application code.

For Google OAuth, create a Web application OAuth client. Add `http://127.0.0.1:4173` as an authorized JavaScript origin and the Supabase project's callback URL as an authorized redirect URI. For GitHub OAuth, use `http://127.0.0.1:4173` as the application homepage and the same Supabase callback as the authorization callback URL. The callback has the form `https://<project-ref>.supabase.co/auth/v1/callback`; copy the exact value shown in the provider settings for the project. Enter each provider's client ID and secret in the corresponding Supabase Dashboard provider settings. Keep provider secrets out of this repository. Google OAuth apps in Testing mode must also list the accounts allowed to test the app.

The client is initialized on both pages, but Module 02 does not make an authentication request. A non-mutating connectivity check can request `GET <SUPABASE_URL>/auth/v1/settings` with the publishable key in the `apikey` header; an HTTP 200 response confirms the browser can reach Supabase Auth. This check does not create a user or session.

### Module 03 email/password authentication

Registration and sign-in use the shared Supabase client. With **Confirm email** enabled, registration sends a confirmation email and keeps the user on the verification view. The confirmation link returns to the existing application root (`http://127.0.0.1:4173/`), which is already in the local redirect allow list; no separate callback page or route is used. The installed SDK processes the implicit-flow URL, and the app then calls `getUser()` to confirm the account before treating the link as successful or revealing the dashboard.

The redirect uses the app's current origin. Before testing from another host, add that host's root URL to the Supabase Auth redirect allow list.

The dashboard shell starts hidden. It is shown only after Supabase confirms an authenticated user whose `email_confirmed_at` value is present. The check fails closed and sends unauthenticated, unverified, or unverifiable sessions back to sign-in. This is a browser-side gate for the current static dashboard; protected database data and broader session management are outside this module.

Duplicate signup and resend responses use neutral messages so the interface does not unnecessarily reveal whether an email address has an account. Confirmation links that return an Auth error, contain malformed callback data, or fail user verification are treated as unsuccessful. Auth tokens and error details are removed from the address bar after processing. The app maps known errors to safe messages instead of showing raw Auth responses.

Run `npm test` for automated checks. Complete the live registration, email-link, invalid/expired-link, sign-in, and direct-dashboard-access checks manually in a browser using a test email address. The hosted default Supabase email sender is suitable for initial testing but has a low sending limit; configure custom SMTP if more frequent testing is needed.

### Module 04 session and dashboard

The Supabase client persists and restores sessions and refreshes access tokens through the SDK. The application listens for initial session restoration, sign-in, sign-out, token refresh, and user updates. The dashboard remains hidden until the saved session is checked with Supabase and the user has a confirmed email address. Authenticated users with a confirmed email are redirected from the sign-in page to the dashboard.

The dashboard displays the verified user's email, ID, email verification status, provider, creation date, last sign-in, and current session expiration. Sign-out clears the Supabase session. The password section offers **Set Password** to authenticated users without password sign-in and **Change Password** to users who have it. Setting a password for an OAuth account uses the authenticated Supabase client and records a user-metadata display flag; the flag only selects the UI label and does not authorize the operation. Changing an existing password requires the current password in the app form.

Run `npm test` for automated checks. Manually verify persisted sessions after reload, auth changes across tabs, token refresh and expired-session redirects, logout, account values, and successful and rejected password changes in a browser.

### Module 05 OAuth authentication

The Google and GitHub buttons call Supabase Auth's OAuth sign-in method and return to the current app origin. The existing root page is the callback destination; no additional app route is introduced. Supabase JS processes the returned OAuth session, and the app verifies it with `getUser()` before navigating to the dashboard. OAuth users must have an email address and a confirmed email on their Supabase Auth user. A provider-confirmed email passes the existing dashboard gate without a separate app confirmation flow. OAuth errors and cancellations receive safe messages, and callback parameters are removed from the address bar.

Supabase Dashboard settings and provider credentials remain manually configured as described in Module 02. Supabase automatically links matching identities when it can verify they share the same email; the application does not perform manual identity linking.

Run `npm test` for automated OAuth callback and provider-request checks. Manually verify Google and GitHub sign-in, cancel each provider flow, test provider errors, confirm the returned session survives reload, and verify that accounts without an email or confirmed email cannot access the dashboard. Also set a password on a Google/GitHub account, confirm the section switches to **Change Password**, then sign out and verify email/password sign-in reaches the same user ID. Google apps in Testing mode must include the test accounts.
