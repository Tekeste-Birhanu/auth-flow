# Auth-Flow

A minimal authentication app built with vanilla HTML, CSS, JavaScript, and Supabase Auth. It has no frontend framework or build tool.

## Features

- Email/password signup and sign-in with email confirmation
- Google and GitHub sign-in
- Password recovery and reset
- Session persistence, protected dashboard, and logout
- Account details and password setting/changing
- Responsive forms with client-side validation

## Requirements

- Node.js 22 or newer
- A Supabase project

## Run locally

```powershell
npm install
Copy-Item .env.example .env
```

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `.env`, then start the app:

```powershell
npm start
```

Open the local URL printed by the server (default: `http://127.0.0.1:4173`).

## Supabase setup

In Supabase Auth URL configuration, set the local Site URL to `http://127.0.0.1:4173` and allow `http://127.0.0.1:4173/**` as a redirect URL. Enable the Email provider and email confirmation. To use Google or GitHub, configure each provider's credentials in the Supabase Dashboard and use the callback URL shown there (`https://<project-ref>.supabase.co/auth/v1/callback`).

Keep provider secrets and Supabase secret/service-role keys out of browser code and version control. The browser uses only the project URL and publishable key.

## Tests

Run the automated test suite with:

```powershell
npm test
```

Tests use Node's built-in test runner and cover application behavior with mocked Auth responses and selected installed-SDK callback behavior. They do not replace manual browser tests of live email links or Google/GitHub provider flows.

## Modules

1. Setup and UI foundation
2. Supabase integration
3. Email/password authentication
4. Session and dashboard
5. OAuth authentication
6. Password recovery
7. Testing and hardening — **in progress**

Module 07 includes manual checks across authentication success and failure paths, sessions, dashboard protection, accessibility, responsive layouts, configuration, and browser console/network behavior.
