# Windows plugin build via GitHub Actions

The Mac build runs locally; the Windows build runs on a hosted Windows
runner (free for personal use up to 2,000 minutes/month). One-time
setup, then every push under `rtm-send-plugin/` produces a Windows
`.vst3` + signed NSIS installer as a workflow artifact.

The workflow lives at [`.github/workflows/win-plugin.yml`](../../.github/workflows/win-plugin.yml).

## One-time setup

1. **Init the repo and push to GitHub.** From the project root
   (`Compare App/`):

   ```bash
   git init
   git add .github rtm-send-plugin
   git commit -m "Initial RTM Send plugin + Windows CI"
   gh repo create rtm-send-plugin --private --source=. --push
   ```

   Or push to an existing GitHub remote:

   ```bash
   git remote add origin git@github.com:<you>/<repo>.git
   git push -u origin main
   ```

2. **(Optional) Add Windows code-signing secrets.** Without these the
   installer still builds but is unsigned — Windows SmartScreen warns
   users on first run. Skip this step if you don't have an Authenticode
   cert yet.

   On GitHub: **Settings → Secrets and variables → Actions → New
   repository secret.**

   - `WIN_PFX_BASE64` — your `.pfx` cert encoded as base64.
     Generate locally:

     ```bash
     base64 -i path/to/your-cert.pfx | pbcopy
     ```

     Paste into the secret value.

   - `WIN_PFX_PASSWORD` — the password protecting the `.pfx`.

3. **Trigger a build.** Three ways:

   - **Manual:** GitHub → **Actions → Build RTM Send (Windows) →
     Run workflow**.
   - **On push:** any commit touching `rtm-send-plugin/` auto-builds.
   - **On tag:** `git tag rtm-send-v1.0.1 && git push --tags` — the
     workflow attaches the installer to the matching GitHub Release.

## Downloading the installer

1. GitHub → **Actions → Build RTM Send (Windows) →** click the most
   recent green run.
2. Scroll to the bottom — **Artifacts** has:
   - `RTM-Send-Windows` (the installer + SHA-256)
   - `RTM-Send-VST3-raw` (just the bundle, in case you want to drop
     it onto a tester's machine without going through the installer)

## Troubleshooting

**Build fails on the configure step.** Most often a JUCE version skew
— bump or pin the cache key in the workflow if you upgrade JUCE.

**Build succeeds but installer is missing.** Check the *Build NSIS
installer* step log — `makensis` will surface missing-file errors
inline. Most likely the artefacts path moved between JUCE versions.

**SmartScreen still warns even though the installer is signed.**
Authenticode certs build "reputation" — first-time downloaders may
still see a warning until the cert has been used a few times. EV
certs (more expensive) skip this entirely.

**Free GitHub minutes running out.** The runner only fires on push
under `rtm-send-plugin/` and on manual dispatch — restrict further by
removing the `push` trigger and using only `workflow_dispatch`.

## Costs

- Public repo: GitHub Actions free, unlimited.
- Private repo: 2,000 free minutes/month for personal accounts.
  A clean RTM Send Windows build is about 6-8 minutes including
  the NSIS step, so you get 250+ builds/month free.

## What it does NOT include

- **AAX (Pro Tools).** Avid requires PACE Eden signing on a separate
  developer relationship. Add the AAX format and PACE wraptool step
  once that's set up.
- **ARA2.** The AraSDK isn't in the runner. Add a checkout step + a
  cmake `-DARA_SDK_PATH=…` flag if you want ARA on Windows builds.
- **EV (Extended Validation) cert handling.** If you upgrade to an EV
  cert, the signing step needs hardware-token integration (USB
  smart-card) — that doesn't run on hosted runners. EV signing
  typically happens on a self-hosted Windows runner with the token
  attached.
