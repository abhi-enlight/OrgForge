# Installing the OrgForge Connector (Packaged External Client App)

The **OrgForge Connector** is the packaged External Client Application (ECA)
that OrgForge uses to authenticate against your Salesforce org. It ships as a
Salesforce package: installing it once per org (as a System Administrator) is
what unlocks both capabilities — **agent building** and **governed org
changes**. Until it is installed, the app shows a "setup needed" state and the
Chat Copilot stays locked.

> Referenced by `backend/src/orgforge/routes/orgs.js` and surfaced by the
> diagnostics route (`backend/src/routes/diagnostics.js`), which return the
> install URL to the UI so users never have to hunt for it.

---

## 1. Get the install link

The app surfaces the install link automatically whenever the package is
missing — the URL is built org-type-aware, so it always points at the right
Salesforce login domain:

| Org type | Install-link domain |
|---|---|
| Production | `https://login.salesforce.com/packaging/installPackage.apexp?p0=<version-id>` |
| Sandbox | `https://test.salesforce.com/packaging/installPackage.apexp?p0=<version-id>` |
| Scratch | `<instance-url>/packaging/installPackage.apexp?p0=<version-id>` |

Where it shows up:

- **Chat page** — the full-screen "Connector package required to chat" gate
  ("Open Install Link" / "Copy Link for IT").
- **Install popup** — the "One-Time Org Setup Needed" modal.
- **Readiness banner** — the once-per-session "Setup needed before you can
  build agents" banner now links **"Get the install link"**.
- **Settings → Advanced** — the Diagnostics row for the connector package
  links **"Get install link"** when the package is missing.

If the backend is configured with a custom package version, the env vars below
drive both the install link and the detection.

## 2. Install the package

1. Open the install link (or copy it to your IT admin).
2. Log in to the target org with **System Administrator** privileges.
3. Choose **Install for All Users** and accept the requested access.
4. Installation usually completes in under a minute.

> The connector is the app's OAuth client (scopes: Basic, Api, RefreshToken,
> OpenID; PKCE + refresh-token rotation enforced).

## 3. Grant users access

In **Setup → External Client App Manager**, open the connector (label
*OrgForge by Enlight Lab*, developer name `OrgForge_ECA`) and set
**Permitted Users** to **All users may self-authorize** (or assign the
admin-approved permission set) so the app can exchange OAuth tokens.

## 4. Verify & re-check

- In the app, click **"I've installed it — Re-check"** (or Settings → Advanced
  → **Run diagnostics**). The check is NOT cached for a missing verdict, so a
  fresh install is picked up on the very next check.
- The check considers the connector installed when **either**:
  1. the managed package appears in `InstalledSubscriberPackage` (by
     SubscriberPackageId — any version counts), **or**
  2. the External Client Application `OrgForge_ECA` exists in the org.

  The second signal is what makes unmanaged installs (and package-version id
  mismatches) work — see Troubleshooting.

## 5. Configuration (backend)

Defaults are pinned in `backend/src/orgforge/routes/orgs.js`,
`backend/src/routes/diagnostics.js` and `packages/diagnostics/src/preflight.js`;
override per environment:

| Env var | Purpose | Default |
|---|---|---|
| `ORGFORGE_ECA_PACKAGE_VERSION_ID` | The 04t package-version id used for the install link + detection | `04tfj000000QFHxAAO` (orgs/diagnostics) · `04tfj000000NNITAA4` (diagnostics preflight) |
| `ORGFORGE_PACKAGE_VERSION_ID` | Legacy alias for the above (still honored) | — |
| `ORGFORGE_PACKAGE_ID` | The 033 SubscriberPackageId the package-health check queries | `033fj000000PqLBAA0` |

> ⚠️ Keep `ORGFORGE_ECA_PACKAGE_VERSION_ID` in sync across the three files, and
> make sure it is the version you actually distribute — a stale id is the #1
> cause of the false "setup needed" in §6.

## 6. Troubleshooting — "I installed it, but it still says setup needed"

1. **Re-check** — the missing verdict is never cached, but the *installed*
   result is cached for 10 minutes (package-health) / 24 hours (diagnostics).
   Use **Re-check** / **Run diagnostics** to bypass.
2. **Reconnect the org** — an expired/revoked access token makes the check
   return `error` (rendered as "Connector status unknown"), not "missing".
3. **Check the version id** — if the app was rebuilt/re-released, the pinned
   04t/033 ids may not match what you installed. Update the env vars (§5) and
   re-check.
4. **Unmanaged installs are covered** — if the connector was installed as an
   unmanaged package (no `InstalledSubscriberPackage` row), detection falls
   back to the `OrgForge_ECA` External Client Application. If the ECA isn't
   found either, the org genuinely doesn't have the connector — re-run §2–§3.
5. **Verify in Salesforce directly** — Setup → Installed Packages should list
   the connector, and Setup → External Client App Manager should show
   `OrgForge_ECA`. Both present + a re-check in the app means the app-side
   package ids are the problem (see §5).
