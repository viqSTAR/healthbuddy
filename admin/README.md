# Health Buddy — admin panel

Vite + React. Web rather than React Native because the work here is document
review, dense tables and bulk actions — none of which fit a phone.

```bash
npm install
npm run dev        # http://localhost:5173
```

`vite.config.ts` proxies `/api` to `http://localhost:5000`, so the panel and the
backend share an origin in development and the browser never deals with CORS.
For a deployed build, set `VITE_API_URL` to the API's absolute base URL.

Sign in with an **ADMIN** account (`+15559000001` from the seed). A non-admin who
signs in is told so explicitly rather than being shown empty tables — but that is
convenience only. Every endpoint behind this panel enforces the role itself.

## Pages

| Route | Purpose |
| --- | --- |
| `/` | Live platform counts, pending queue, licences expiring within 60 days |
| `/applications` | Verification queue |
| `/applications/:id` | Document viewer, approve / reject with reason |
| `/users` | All accounts, suspend and restore |
| `/emergency` | Live SOS dispatch with patient coordinates |
| `/audit` | Append-only log of privileged actions |

## Known advisory (assessed, not ignored)

`npm audit` reports a **high** advisory against `react-router` 7.12.0–8.2.0:
*RSC Mode CSRF Bypass Allows Action Execution Before 400 Response*. As of the
last check, 7.18.2 is the newest published release and no patched version
exists — every current version is in range.

**It does not apply to this panel.** The advisory concerns React Router's RSC
(React Server Components) mode and server actions. This app is a pure
client-side SPA: `createRoot` + `BrowserRouter`, built to static assets by Vite,
with no server runtime, no loaders and no actions.

Do not "fix" it by downgrading — `npm audit fix --force` moves to 7.11.0, which
lands inside a *different* advisory range (6.0.0–7.17.0) and gives up bug fixes.
Re-check when a release above 8.2.0 ships.
