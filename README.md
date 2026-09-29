# Mingwei Games

A static platform game frontend with a small WordPress backend. The domain and
personal homepage stay with Northwest; GitHub Pages serves the games subdomain.
No runtime frontend dependencies, external fonts, analytics or third-party art.

## Locations

- Homepage: https://mingweiyang.com/
- Games: https://games.mingweiyang.com/
- Accounts: https://mingweiyang.com/wp-admin/admin-post.php?action=mwg_account
- WordPress plugin source: [wordpress/mwg-games](wordpress/mwg-games)

## Local development and deployment

Requires Node.js 22 and PHP 8+ for replay parity tests.

```sh
npm test
python3 -m http.server 4173
# Open http://localhost:4173
```

If the system PHP binary cannot start (for example, a broken Homebrew shared
library), an isolated test runtime avoids changing the global PHP installation:

```sh
PHP_BIN=php-wasm-cli npm exec --yes --package=node@24 --package=@php-wasm/cli@3.1.56 -- node --test
```

Practice works without the backend. Login in a cross-site localhost iframe can be
blocked by browser cookie policy; use the deployed games subdomain for ranked
end-to-end testing. Do not weaken cookie security to make localhost work.

Push to `main` to run tests and publish the frontend through GitHub Actions.
Only `index.html`, `styles.css`, `app.js`, `sim.js`, and `CNAME` are deployed.
WordPress PHP code is not executed on GitHub Pages.

To update the backend:

```sh
cd wordpress
zip -r ../mwg-games.zip mwg-games
```

Upload the ZIP in WordPress -> Plugins -> Add Plugin -> Upload Plugin. Activate
on first installation; on an update, confirm replacing this plugin only.
Backend deployment is manual until Northwest provides a supported automated
deployment interface. No hosting or GitHub credentials belong in this repository.

If physics change, update and test both simulations, deploy the plugin before
the frontend, and avoid changing rules while runs are in progress. For incompatible
future rule changes, add a new game version and leaderboard rather than reusing
the existing `cloud-hop-v1` records.

## Authentication and data

The account page creates WordPress **subscriber** accounts, not administrators.
Use a nickname: usernames and best scores are public. Emails are private;
passwords are hashed by WordPress. Email ownership is not verified on signup.
Password recovery uses WordPress mail and requires working outbound email from
the host. Do not promise recovery until email delivery has been tested.
After signing in, return to the game tab and click the profile refresh button;
this reloads the cookie-authenticated bridge and its REST nonce.

The site saves the best score, best-run time, completed-run count and last result.
It does **not** resume a round in the middle of a jump. A player can export their
own records as JSON. WordPress Tools -> Game data export downloads a private
all-player backup for the administrator. Deleting a WordPress user deletes their
game records as well; already-downloaded backups must be handled separately.

The frontend never connects directly to the database and never receives an admin
password or application password. An allowlisted same-site iframe makes
authenticated requests using WordPress cookies and a REST nonce. Both sides
validate message origin and source. Browser cookie restrictions or expired
sessions produce explicit errors; practice mode never pretends to save online.

### API contract

REST namespace: `/wp-json/mwg/v1/`

- `GET profile`: own summary and account links, or `player: null`.
- `GET leaderboard`: public top 20 nicknames/scores/times.
- `POST start`: authenticated; creates a single-use run for the current player.
- `POST finish`: authenticated; accepts `{runId, inputs}`, **not a score**.
- `GET export`: authenticated; exports only the current player's records.

The PHP simulator replays at most 7,200 fixed ticks and derives the score.
Runs expire after 15 minutes; runs submitted faster than their replay duration
(with a 2-second tolerance) are rejected. Identical retries of the last accepted
run are idempotent. Starting a new run replaces the previous unfinished one,
including from another tab/device.

Replay validation prevents arbitrary claimed scores and impossible physics.
It does **not** prove that a human played: bots, scripted valid inputs and
tool-assisted play remain possible. This is a casual leaderboard, not a
prize-bearing or competitive anti-cheat system.

### Free-tier resource limits

Defaults intentionally protect the small Northwest plan:

- 200 registration attempts lifetime, 20/day globally, 3/hour per source IP.
- Account requests: 300/hour globally and 20/15 minutes per source IP.
- Game API requests: 12,000/hour globally and 180/minute per source IP.
- Ranked starts: 30/10 minutes per player; validations: 60/hour per player.
- One aggregate record per player; no unlimited replay/history storage.

Attempts can consume quota even when signup fails. Administrators can adjust the
explicit limits in the plugin after checking resource usage. These are protective
application limits, not guaranteed hosting capacity or DDoS protection. Rate-limit
keys use salted hashes, expire, and do not store plaintext IP addresses. The host
may have its own access logs. Actual hosting limits and acceptable use still apply.

## DNS and domain renewal

Add only `games CNAME sunnysunny3145.github.io`. Keep the existing root, `www`,
mail and other DNS records unchanged, including the registrar and nameservers.
Configure GitHub Pages with `games.mingweiyang.com` and enforce HTTPS once its
certificate is issued. GitHub account-level custom-domain verification is
recommended to protect against subdomain takeover.

The Northwest promotional domain-renewal eligibility with external game hosting
has not been confirmed by support. Keeping registration at Northwest is not a
guarantee of future promotional terms. No paid plan is required by this code.

## Backup and migration

Game data lives in `{wp_prefix}mwg_players`, separate from WordPress posts.
Stable `player_id` UUIDs are portable. `user_id` is a WordPress identity mapping,
not the permanent player identifier. `{wp_prefix}mwg_limits` stores disposable
rate counters, plus the registration capacity counter.

1. Download a private JSON game-data backup and verify it can be parsed.
2. Separately back up WordPress files/database if restoring the entire host.
3. Define equivalent player/result tables on the destination.
4. Import IDs, scores, ticks, counts and last results without changing IDs.
5. Implement the same API semantics and replay validation on the new backend.
6. Plan identity migration separately: this export contains no password hashes
   or emails. A different identity provider may require account linking or
   password resets. Do not merge accounts solely by unverified email.
7. Pause ranked writes, take a final export, validate counts and values, then
   switch the frontend data connection. Keep the previous backup for rollback.

Game-state export is implemented; an importer for an as-yet-unselected database
is not. Future free/low-cost databases still have quotas and may require payment
as traffic grows. Export before ending Northwest hosting.

## Verification

The automated suite checks deterministic JavaScript/PHP replay parity, malformed
and oversized replays, authorization boundaries, export isolation, idempotent
score submission, origin-checked messaging and nonce refresh after login.

Live WordPress checks also exercised signup, password login, logout, server-side
score calculation, accelerated/forged-score rejection, score persistence after
signing in again, own-data export and administrator backup export. Temporary
test accounts and their scores were removed afterwards.

Password-reset email delivery has not been verified. HTTPS issuance for a newly
bound GitHub Pages domain is separate from a successful code deployment; do not
bypass certificate warnings or enable authenticated play over HTTP.

The deployed games domain has a valid GitHub-managed certificate and enforced
HTTPS. Authenticated profile loading through the cross-origin bridge, mobile
touch controls and the homepage game link have been checked in the browser.
