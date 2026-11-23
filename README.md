# Unified Training

A local practice portal for Codeforces, AtCoder, CSES, USACO, QOJ, and any problem link you want to save. Sign in with an email and password to save your training progress or explore the read-only demo.

## macOS desktop app

Open `desktop/Unified Training.app` in Finder. The app rebuilds the Bend module and web frontend on launch, runs its own local server on port 4175, and opens the app in a desktop window. Quit the desktop app to stop its server. Use **Reload** (⌘R) to refresh the view. Use **Unified Training → Rebuild and Reload** (⇧⌘R) to apply changes while the window is open.

On a fresh checkout, run `npm ci`, `npm run engine:setup`, and `npm run desktop:build` to create the bundle. The standard `npm run build` also regenerates the desktop app on macOS. The bundle uses this checkout and the Node.js installation used to build it. It loads the same PostgreSQL and Supabase settings as the browser server. With the desktop app running, you can also use [the desktop server in a browser](http://127.0.0.1:4175). Run one app server per database. For an isolated desktop test instance, set `TRAINING_DESKTOP_PORT` in the app process environment.

## Run locally

Requires Node 22.14+ and Git. For local Supabase, install the current [Supabase CLI and a Docker-compatible container runtime](https://supabase.com/docs/guides/local-development/cli/getting-started). Run these commands from the project folder.

```sh
npm ci
npm run engine:setup
supabase start
cp .env.example .env.local
```

Copy the database URL, API URL, and publishable key from `supabase status` into `.env.local`, using `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` respectively. Keep the database URL on the server. Exported environment variables take precedence over the file.

```sh
npm run db:migrate
npm run desktop:build
npm start
```

Open [Unified Training](http://127.0.0.1:4173), create an account, and get the confirmation code from [local Mailpit](http://127.0.0.1:54324). The same inbox receives password recovery codes. To use the macOS app, stop `npm start` and open the bundle in Finder. The server listens on loopback. Set `PORT` for a different standalone browser port.

In your personal profile, save your public handles in **Connections** and click **Refresh** on Problemset. The first sync can take longer for accounts with extensive submission history. With AtCoder’s English-only filter active, **Rules → Check more** verifies additional statements as needed.

### Connect to hosted Supabase

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to the matching project’s API URL and publishable key. In the project’s **Connect** panel, choose **Session pooler** and set its PostgreSQL URI as `DATABASE_URL`. Download the project CA certificate and append `?sslmode=verify-full&sslrootcert=/absolute/path/to/ca.crt` to the URI, or use `&` if it already has query parameters. Percent-encode special characters in the password and certificate path. Run `npm run db:migrate` against this database. Keep the `unified_training` schema private and outside the Supabase Data API’s exposed schemas. [Supabase connection settings](https://supabase.com/docs/guides/database/connecting-to-postgres)

In Supabase Auth, enable email/password sign-up and email confirmation, set the minimum password length to at least 8 characters, and configure SMTP for public sign-ups. Copy the provided confirmation and recovery HTML into the corresponding Auth email templates. Both templates use `{{ .Token }}` so that users can enter the code in the desktop app or browser. [Confirmation template](supabase/templates/confirmation.html) · [Recovery template](supabase/templates/recovery.html) · [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)

### Deploy to Render

The included `render.yaml` defines one free Node.js web service. Render builds the Bend module and frontend, then serves the site and API from the same HTTPS address. The free service sleeps after 15 minutes without inbound traffic. [Render free tier](https://render.com/docs/free)

1. Run `npm run db:migrate` locally against the hosted Supabase project you want the web app to use. Use the hosted Supabase Auth settings above so friends can receive confirmation and recovery codes.
2. Connect a Git repository containing this project to a new [Render Blueprint](https://render.com/docs/infrastructure-as-code). Keep `.env.local` and local data out of the repository. Supply `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the hosted session pooler `DATABASE_URL` in Render.
3. Add the Supabase database CA certificate to Render as a [secret file](https://render.com/docs/configure-environment-variables#secret-files) named `supabase-ca.crt`. In the Render database URL, use `sslmode=verify-full&sslrootcert=/etc/secrets/supabase-ca.crt` in the query string. Redeploy after adding the certificate if the initial start ran before it was present.
4. Set the Supabase Auth **Site URL** to the service's HTTPS address. Open `/api/health` on that address to check that the service started, then verify sign-in and save a practice solve before sharing the URL.

Render provides its public URL automatically. If you add a custom domain, set `TRAINING_PUBLIC_URL` to its HTTPS origin and update the Supabase Auth Site URL. Keep one app server per database, including any desktop app connected to the same hosted project.

### Move an existing SQLite profile

1. Create and confirm the destination account. Open its personal profile once to initialize it, then quit the app or stop the browser server. Keep a backup of the SQLite database. If the old app uses WAL and its WAL file is still present, keep it alongside the database or make a SQLite backup using the SQLite backup command.
2. Find the confirmed account’s UUID in **Supabase → Authentication → Users**. Run the import with the same destination configuration used by the app.

   ```sh
   npm run db:import -- --source data/training.sqlite --owner <account-uuid>
   ```

3. Reopen the app and verify your personal profile. The importer reads the old database as a snapshot, requires an empty destination profile, and commits the import in one transaction. It keeps the original SQLite file and regenerates the demo from bundled sample data when the server starts.

## Verify judge accounts

In **My personal profile → Connections**, save your handle and choose **Verify ownership**. For AtCoder, temporarily paste the challenge code into your public **Affiliation** field. For Codeforces, submit the provided C++ snippet on the assigned archived practice problem. Click **Check verification** within 15 minutes. After AtCoder verifies, you can restore your original affiliation.

Public sync is available as soon as you save a handle. A claimed AtCoder solve counts after a refresh imports the matching accepted submission.

## Train with Timus

In **My personal profile → Connections**, save your public Timus author URL or numeric author ID. Use **Sync** to import submissions. An initial sync imports older submissions in batches and can resume from the last saved batch. For optional ownership verification, paste the challenge into your public **Motto** through **Update your info** on Timus, then check verification in Connections.

In **Rules → Add rule → Timus topic practice**, choose topics. Use **More filters** for difficulty bounds, attempt history, and order. You can load the public catalog and use topic rules without linking an account. Finish syncing your history before using the **Unattempted** filter.

## Import CSES progress

Open **Connections → Import progress** for both tutorials.

- **Saved page.** Sign in on the [CSES Tasks page](https://cses.fi/problemset/list/). In Safari on Mac, choose **File → Save As → Page Source**. In Chrome, Edge, Firefox, or Vivaldi, use **Save Page As → HTML Only**. Choose or drop the saved `.html` or `.htm` file in Unified Training, then review and import the solves.
- **Bookmark.** In the same desktop browser you use for CSES, open Unified Training and drag **Import CSES solves** from the import dialog onto your bookmarks bar. If you use the macOS app, leave it running and open the address shown in the tutorial in your browser. Whenever you want to import, click the bookmark from the signed-in CSES Tasks page. Sign in if prompted, then review the solves in your personal profile and confirm the import.

Existing Unified Training CSES extension JSON exports can still be selected in the file picker. Imports keep any dates you already recorded. Use **Stats → CSES completion → Review undated CSES solves** to add dates for activity and volume metrics.

## Practice with USACO Guide

Open **Rules → Add rule** and choose **Practice problems** under **USACO Guide**. Choose a division or search for a module. Use **More filters** to narrow by difficulty, topic, or judge. Select a single module to follow its checklist, or choose **Mix sections** for a varied practice order. Section weights start at 1. Setting a weight to 0 excludes that section. **Rules → USACO Guide** lets you open each checklist or edit its rule. Rules follow catalog updates. Browse the full catalog from **Rules → USACO Guide → Browse Guide**. Problem links open on their original judges for practice and submission.

In [USACO Guide Settings → User Data](https://usaco.guide/settings#user-data), click **Export User Data**. In Unified Training, use **Connections → Import Guide progress** to preview and import that JSON file into your personal profile. Problems marked **Solved** or **Reviewing** count toward completion. A recorded **Solved** event can supply the date, and existing solve dates are kept. The import also brings over module statuses.

The bundled problem metadata is adapted from the [USACO Guide by the Competitive Programming Initiative](https://github.com/cpinitiative/usaco-guide) under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). To update the catalog, run `npm run guide:refresh -- <full-commit-sha>`, rebuild, and reopen the app or use **Rebuild and Reload**. The generated catalog records its upstream revision.

## Manage a practice queue

- **Rules → Practice mix settings** shows what each source contributes. Expand a source to edit its rules. **Automatic** takes turns among sources with matches. In **Custom**, set source weights, such as 80 for AtCoder and 20 for Codeforces, and preview the next 20 problems. A weight of zero excludes a source. Sources with matches fill open slots.
- Set an upsolve rule's **Round scope** to **Every finished round** to apply that division's cutoff to the public archive. The queue offers unsolved problems from newest to oldest across every-round upsolve rules. Refresh the catalog from **Problemset** and track round completion in **Stats → Codeforces training**.
- **Rules → Add rule → Codeforces → Practice all rounds** queues unsolved problems from finished public rounds, including rounds you never entered. You can narrow by division or last problem letter. Use **Refresh** on Problemset to load the catalog. A linked handle lets the app exclude your accepted submissions.
- **Problemset → Add links** accepts batches of QOJ, Codeforces Gym, and other URLs. In **Rules → Manual lists**, edit a list to reorder it or pick an entire CSES section. Custom mix also exposes the list’s cap under **Advanced queue settings**.
- For synced judges, refresh after solving. For a manual problem, use the check control beside its name to save or change the solve date.
- **Stats** includes four time windows, average solves per day, active days, a source-colored heatmap, and completion breakdowns.

## Checks

```sh
npm run engine:build
npm run check
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test
npm run desktop:build
```

The PostgreSQL tests create and clean up disposable databases. Use a local PostgreSQL connection with permission to create databases for `TEST_DATABASE_URL`. Running `npm test` without this variable runs the database-independent tests. To include real email confirmation and recovery, also set `TEST_SUPABASE_URL`, `TEST_SUPABASE_PUBLISHABLE_KEY`, and `TEST_MAILPIT_URL` from your local Supabase stack.

Bend implements inclusive rating matching, distance to target, virtual-finish comparisons for the queue allocator, earliest-acceptance selection, and calendar-window aggregation. The host compiles the engine to a JavaScript module and imports it directly. It supplies typed numeric inputs and handles the judge metadata, database, and UI.
