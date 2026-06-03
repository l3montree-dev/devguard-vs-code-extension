# DevGuard for VS Code

> [!WARNING]  
> **Proof of Concept** This integration is not yet production-ready. It is intended for experimentation and feedback only.


Inline npm dependency-risk insights in your `package.json`, powered by [DevGuard](https://devguard.org).

While you edit `package.json`, each dependency gets a **color-coded** end-of-line badge (red = malicious / low scorecard, amber = vulnerabilities / weak scorecard / stale, green = clean) and a rich hover card showing:

- **⚠ malicious** — whether the package version is flagged in DevGuard's malicious-package feed
- **known vulnerabilities** — count of CVEs affecting the resolved version (with IDs and fixed versions)
- **release age** — when the version was published
- **transitive dependencies** — how many packages it pulls in (computed from your `package-lock.json`)
- **OpenSSF Scorecard** — the project's score and weakest checks
- **risks pulled in via transitive deps** — when connected, shown right after the direct count as `0 vulns (3 in deps)`; the hover breaks down own vs. transitive risk for the connected asset

Each dependency section also gets a summary on its header line (e.g. `Σ 2 vulns · avg age 1.4y · avg scorecard 5.8`).

The inline insights work **without signing in** — they use DevGuard's public package-inspection endpoint. Connecting with a personal access token additionally lets you pick an asset (repository) and overlays that asset's real findings.

## Requirements

- A DevGuard backend. For local development this defaults to `http://localhost:8080` (configurable via `devguard.apiUrl`).
- For asset selection / SBOM / asset overlays: a DevGuard **personal access token** (PAT).

## Getting started

1. Open a project with a `package.json`. Badges appear automatically (no sign-in required).
2. Run **DevGuard: Connect (Personal Access Token)** and paste your PAT. It is validated against the backend and stored in VS Code Secret Storage.
3. Run **DevGuard: Select Organization / Project / Asset** (or click the status-bar item) to connect the workspace to an asset. Hovers then show that asset's open risks per package.

## Commands

| Command | Description |
| --- | --- |
| `DevGuard: Connect (Personal Access Token)` | Store and validate a PAT. |
| `DevGuard: Disconnect` | Remove the stored token and asset selection. |
| `DevGuard: Select Organization / Project / Asset` | Pick the asset to overlay. |
| `DevGuard: Refresh Dependency Insights` | Clear the cache and re-fetch for visible `package.json` files. |
| `DevGuard: Set Up Dependency Proxy (.npmrc)` | Point the project's npm registry at DevGuard's dependency proxy, which blocks malicious packages at install time. |
| `DevGuard: View SBOM for Selected Asset` | Open the connected asset's CycloneDX SBOM as a read-only document. |
| `DevGuard: Generate SBOM (Run devguard-scanner SCA)` | Run the `devguard-scanner sca` CLI on the project to generate and upload an SBOM to the selected asset, then refresh insights. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `devguard.apiUrl` | `http://localhost:8080` | Backend base URL. Only this host receives signed requests. |
| `devguard.inlineDecorations.enabled` | `true` | Toggle the inline badges. |
| `devguard.inlineDecorations.verbosity` | `full` | `compact` (counts only) or `full` (adds age and scorecard). |
| `devguard.request.concurrency` | `6` | Max concurrent API requests while enriching. |
| `devguard.request.timeoutMs` | `8000` | Per-request timeout. |
| `devguard.cache.ttlMinutes` | `720` | How long package results are cached. |
| `devguard.scannerPath` | `devguard-scanner` | Path to the `devguard-scanner` CLI used by "Generate SBOM". |

## How the version is resolved

For accurate per-version data, the extension resolves each dependency to a concrete version, preferring (1) the nearest `package-lock.json`, then (2) the installed copy under `node_modules`, then (3) a concrete version cleaned from the `package.json` range. The **transitive count** is computed from the `package-lock.json` dependency graph. pnpm/yarn lockfiles are not yet supported for resolution; those fall back to `node_modules` or the range, and the transitive count is shown as unavailable.

## Security

- Your PAT is an ECDSA private key. It is stored **only** in VS Code Secret Storage — never in settings, workspace state, or logs.
- Requests are signed (RFC 9421 HTTP Message Signatures, ECDSA P‑256) only when sent to the configured `devguard.apiUrl` host; redirects are not followed for signed requests.
- The server's signatures cover the request method and body digest (not the full URL), and accept a short replay window. Keep `devguard.apiUrl` on HTTPS for non-local backends; the extension warns before connecting over plain http to a remote host.
- The public package-inspection endpoint sends package coordinates (name + version) to your configured backend.

## Privacy

Package names and versions from your `package.json` are sent to the configured DevGuard backend to look up risk data. With a local backend (`localhost:8080`) this stays on your machine.
