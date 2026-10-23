### Summary

**Problem:**
<!-- What was broken, missing or risky, and why it matters. Name the real trigger: an issue, a user report, a failing CI job. -->

**Solution:**
<!-- What this PR does and why this approach. Name the mechanism: the module, function or config field involved. -->

---

### Linked issue

<!-- `Closes #123`, or "None". -->

---

### Type

- [ ] Bug fix
- [ ] Feature
- [ ] Improvement
- [ ] Refactor (no behavior change)
- [ ] Docs or tests only
- [ ] CI or tooling

---

### Compatibility (SemVer)

Which release does this need?

- [ ] Patch: restores documented behavior
- [ ] Minor: new behavior that is off or neutral for existing configs
- [ ] Major: breaks documented behavior, or removes or renames a config field or public API
- [ ] None: no change to the package's behavior

**If existing behavior changes, what breaks and how can a user keep the old behavior?**
<!-- "redirect stays true by default, so nothing changes unless a site sets it to false." -->

---

### Tests

- [ ] New or changed tests cover this change
- [ ] A bug fix has a regression test that fails on the old code
- [ ] Not required: <!-- reason -->

**Ran locally:** <!-- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:browser --project=chromium-android` -->

CI runs Node 18, 20 and 22, the examples end to end, and the browser tests in Chromium, WebKit and Firefox.

---

### Size

- [ ] `deeplinker.js` is still under 6 KB min+gzip (`pnpm --filter @deeplinker/runtime size`)
- [ ] Not affected

---

### Docs

- [ ] `README.md` updated (section: ___)
- [ ] `CHANGELOG.md` entry added under `[Unreleased]`
- [ ] Not required: <!-- reason -->

---

### Notes for the reviewer

<!-- Where to start, the one risky file, anything you could not verify (a real device, a host you could not deploy to). -->
