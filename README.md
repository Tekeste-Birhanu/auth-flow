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

The project starts with manual testing. Automated tests and additional features may be introduced later.

## Development Approach

The application is built incrementally, with each module establishing a foundation for the next. The Module 01 preview uses honest placeholders rather than mock account data. Real authentication and session state will be handled by Supabase in later modules.

## Status

**Current phase:** Module 01 — Setup and UI Foundation (complete)

**Next:** Module 02 — Supabase Integration

This is a learning and portfolio project focused on understanding authentication flows and building a maintainable application with minimal tooling.

## Module 01 implementation notes

Module 01 provides the authentication and account screens as a UI preview. Forms perform local validation only; no authentication, network request, session, or account data is simulated. The dashboard is not protected until session handling is added in a later module.

Start the local static server with `npm start` and open the URL printed in the terminal (by default, `http://127.0.0.1:4173`). The server uses Node's built-in HTTP module, so it adds no runtime dependency or build step.

### Supabase SDK browser loading

The installed SDK is `@supabase/supabase-js` 2.117.3. Its ESM entry (`dist/index.mjs`) imports five other Supabase packages by bare package names. Browsers do not resolve those names automatically, so using the ESM entry directly would require an import map covering the SDK and its transitive package imports.

For the later integration module, the simplest approach with the installed package and no build tool is to serve its verified UMD bundle at `node_modules/@supabase/supabase-js/dist/umd/supabase.js` as a classic script, then use the resulting `supabase` browser global from application code loaded with `<script type="module">`. This keeps application code in native ES modules and avoids maintaining a transitive import map. The trade-off is that the SDK itself is consumed through its UMD global rather than as an ES module. Module 01 does not load or initialize the SDK because its UI does not need it.
