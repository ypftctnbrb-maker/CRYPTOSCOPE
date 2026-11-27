---
name: cryptoscope-browser-checks
description: Verify CRYPTOSCOPE browser behavior and mobile regressions with existing local fixtures, focusing on market selection, chart updates, stale data and responsive layouts.
---

Read the browser tests in the candidate tree and use the relevant existing entry point. Use the workspace's provisioned browser and test runner. For a network-independent check, serve the public artifact over loopback and route its data requests to fixtures. Start with the existing smoke test:

```sh
node tests/smoke.cjs
```

When the candidate includes `tests/project-information.cjs`, run `node --test tests/project-information.cjs` to verify packaging.
When the candidate has `tests/browser-venue-catalogue.cjs`, run it with its documented environment variables and the installed Playwright/Chromium. For responsive changes, check the Issue's mobile and desktop widths. Verify the selected market and both price and CVD output, empty states, and cleanup after selection changes. Use explicit waits on meaningful page conditions, and include evidence of the CVD series only when the candidate supports it.

Report the browser version, fixture or live transport, width, command and exit status. WebKit emulation and a physical Safari run are separate results. Keep certificate verification enabled for live tests and track TLS, HTTP and application failures separately. Follow the task's publication permissions for screenshots and recordings.
