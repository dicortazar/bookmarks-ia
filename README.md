# Bookmarks AI

Two parts:

1. **On your phone** you share a link with the app. It is appended to `Bookmarks AI/bookmarks-queue.json` in your Google Drive.
2. **Every night at 02:55 (Madrid)** a Claude scheduled task processes the queue: it reads each page, writes a title, summary, key points and tags, builds a PDF card, and writes a digest of everything new. Your phone can be off.

In the app you see:
- **Latest** — the digest of the most recent run.
- **Pending** — links not processed yet; failed ones show ⚠.
- **Documents** — everything processed, with search, tag filters and a detail view (summary, key points, open page, view PDF).

No Claude API key needed: it runs on your Claude subscription.

## Drive layout
Created by Claude (not by the app) so the scheduled task can read and write it:
```
Bookmarks AI/
  bookmarks-queue.json  ← link queue (the app appends and removes processed entries)
  Cards/                ← the task: "<date> <title> [id].pdf" + ".json"; "ERROR [id].json" on failure
  Digests/              ← the task: one JSON per run
```

## Setup (once)

### 1. Publish on GitHub Pages
1. Create a repo (e.g. `bookmarks-ia`) and upload this folder's contents.
2. Settings → Pages → Deploy from a branch → `main` / root.
3. URL: `https://<user>.github.io/bookmarks-ia/`.

### 2. Google Client ID
1. In https://console.cloud.google.com create a project.
2. APIs & Services → Library → enable **Google Drive API**.
3. Google Auth Platform → Get started → Audience **External**; keep it in *Testing* and add your account as a **test user**.
4. Clients → Create client → **Web application**; Authorized JavaScript origins: `https://<user>.github.io`.
5. Copy the Client ID.

The app requests the `drive` scope (see and edit your Drive files) because it writes to the queue and reads cards that Claude created. In practice it only touches the `Bookmarks AI` folder. Google will show an "unverified app" warning — expected for a personal app in Testing mode; tap *Continue*.

### 3. On the phone
1. Open the URL in Chrome → ⚙ → paste the Client ID → **Connect Google Drive**.
2. Chrome menu → **Install app**.
3. From any app: **Share → Bookmarks**.

## Notes
- The PDF is a card (title, link, dates, tags, summary, key points), not a copy of the page. For the full page, use Chrome's *Share → Print → Save as PDF*.
- Pages that need JavaScript or a login may fail; they show ⚠ under Pending and you can remove them.
- You can also ask Claude directly, e.g. "what did I save this week about OSPOs?".
- `make_ficha.py` is the script the task uses to build cards (reference copy).
