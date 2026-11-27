---
name: cryptoscope-debugging
description: Investigate a CRYPTOSCOPE regression, broken market-data flow, flaky client test, or failing CI check with a reproducible baseline and focused verification.
---

Start with the exact Issue, commit SHA, command and failure. Identify whether the failing path is a fixture, a live browser session, or a GitHub runner.

Trace the observed input from its source to the user-visible output. Check the venue, native market ID, units, timestamp, stale-data guard and rendering state at the boundary where each value changes. Compare with a known working path. Remove credentials and personal data from diagnostics.

Write one hypothesis and choose the smallest safe local observation that could refute it. Use an existing failing test or add a focused regression test when the change needs one. Record the failure on the baseline, then apply the smallest correction and rerun the same check. If the symptom disappears without your change, investigate the test or environment before attributing a fix.

Run relevant regressions on the final SHA. Record commands, exit codes, fixture or live mode, and any unverified environment. Leave TLS and normal access controls enabled. Follow the task's permissions for all external actions.
