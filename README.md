# LiveView Reconnect Ring

Chrome extension that keeps Ring multi-cam live view from dying.

Ring's web dashboard (`account.ring.com`) drops camera tiles and shows
**Reconnect**. This extension clicks it for you so feeds stay up.

Repo: [`liveview-reconnect-ring`](https://github.com/shivmegharaj/liveview-reconnect-ring)

**Not affiliated with Ring or Amazon.** Unofficial tool for your own live-view
monitoring. Review the code before installing. The `debugger` permission is
required so reconnect clicks work; use only on a profile you trust.

## Install

1. Download or clone this repo
2. Chrome → `chrome://extensions` → enable **Developer mode**
3. **Load unpacked** → select the `extension/` folder
4. Open `https://account.ring.com`, sign in, open Multi-Cam
5. Click the extension icon to see camera status

Install it only on the Chrome profile that runs the live view.

## How recovery works

Ring ignores synthetic clicks. Reloading the page also does not help: the
Multi-Cam URL carries a single-use live-session token, so a reload drops you
to the plain Dashboard. The only reliable restart is a real (trusted) mouse
click, which an extension can only produce through Chrome's debugger API
(CDP). This extension automatically:

- clicks each tile's **Reconnect** with a trusted click
- when Ring kicks you to the Dashboard, trusted-clicks **Start Live Views**

Recovery is confirmed only when video frames advance. Failed attempts back
off with jitter and, after several, raise a desktop notification.

## Usage

- Keep **Active** on and leave Multi-Cam open
- Use **Refresh** in the popup after you add/remove cameras

## The yellow "debugging this browser" bar

Because recovery uses the debugger API, Chrome shows a yellow bar while a
click is in flight (attach, click, detach). That warning is process-wide: it
appears on every open Chrome window and profile in the same browser process,
even profiles that do not have this extension. Attach itself only targets the
Ring tab; the warning UI is broader by design. No extension API can hide it.

Ways to avoid the bar:

1. **Enterprise force-install** (best on machines you own). Policy-installed
   extensions skip the bar.
2. **Dedicated Chrome via script** (below). Uses its own user-data-dir plus
   `--silent-debugger-extension-api`. A normal second Chrome launch usually
   joins your existing process and ignores new flags, so the separate data
   dir matters.

### Silent-debugger Chrome (Mac / Windows / Linux)

Needs Python 3. From the repo root:

```bash
python3 scripts/open-chrome.py
```

On Windows (Command Prompt or PowerShell):

```bat
py -3 scripts\open-chrome.py
```

That window is a separate Chrome profile. Load unpacked `extension/` there,
open Multi-Cam, keep **Active** on. Your everyday Chrome is unchanged and
will not show the yellow bar from this instance.

Optional overrides:

- `CHROME_PATH`: full path to the Chrome binary
- `LVR_CHROME_DATA_DIR`: custom profile folder

## Privacy

Local-only. Nothing is sent off your machine.

- Reads `https://account.ring.com/*` to find dead tiles and Reconnect / Start
  Live Views controls
- Uses `chrome.debugger` on that Ring tab only for the brief trusted click,
  then detaches
- Stores the Active preference and short-lived tile health in extension storage
- No accounts, passwords, analytics, ads, or author-operated servers
- No Ring private APIs

Privacy questions: open a GitHub issue on this repository.

## Security

Only the latest release is supported. Report vulnerabilities via GitHub's
private vulnerability reporting on this repo (or an issue without exploit
details asking for a secure contact). Do not post working exploit code
publicly.

The extension requests the `debugger` permission solely to click Reconnect on
`account.ring.com`. It never handles Ring credentials.

## Intended use

For keeping **your own** Ring multi-cam live view alive on a machine you
control. Do not use this to probe, scrape, or abuse Ring's services. Forks
that change host permissions or debugger behavior should be reviewed before
install.

## License

[MIT](LICENSE)
