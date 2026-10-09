# jevman

A Pac-Man benchmark for decision models: System One models (TypeSafe's jev, `typesafe/jev-1.13.0`, and the others
Opper serves) steer Pac-Man in real time against the classic arcade ghosts, and `npm run leaderboard` measures which
plays best. You can [add your own](#benchmark-your-own-model).

The page opens on jev's recorded benchmark game, with the leaderboard and the method below it. Two things to do:

- **Play against the AIs**: you steer Pac-Man and AI models play the four ghosts, one model each (Mixed: Clef, jev,
  Kev and GPT-6 Luna) or all the same one; tap a ghost to switch its model. A model that doesn't wake up in time is
  stood in for by an awake one, so the game still starts. Signed out, this runs on the [free credits](#option-d--free-credits-for-everyone-the-hosted-page)
  while they last; when they are used up, the classic ghosts stay free.
- **Watch**: the chips under the board play jev's recording, or any other model live.

While a model plays, its odds are drawn on the board at each junction. The activity log under the board (folded by
default) lists every decision with its odds, the other options and the latency, plus deaths, ghosts eaten and fruit;
backup moves are the greedy rule standing in when a model could not answer in time (see
[How decisions work](#how-decisions-work)).

Play it at <https://opper.ai/jevman-benchmark/>. Source: <https://github.com/opper-ai/jevman-benchmark>, which
started as a fork of [joch/jevman](https://github.com/joch/jevman).

## Run

Requires Node ≥ 22.18, which runs the TypeScript server directly. Developed on Node 26; the Docker image uses Node 24.

```bash
npm install
cp .env.example .env   # then set up option A, B or C below
npm run dev            # http://localhost:5173
```

### Option A — your own Opper key in `.env`

Set `OPPER_API_KEY` to a **project-scoped** Opper API key. Every jev call is billed to that key.
This is meant for local development: on an https deployment the key is ignored (unless you set
`JEV_ALLOW_DEV_KEY=1`), because it would pay for every visitor.

### Option B — Login with Opper (players pay for their own play)

1. Register an OAuth app with Opper and add the redirect URI `http://localhost:5173/auth/callback`
   (or your deployment's `https://…/auth/callback`; below a [base path](#deployment), e.g.
   `https://opper.ai/jevman-benchmark/auth/callback`).
2. Set `OPPER_CLIENT_ID`, `OPPER_CLIENT_SECRET` and `SESSION_SECRET` (`openssl rand -hex 32`) in `.env`. The
   redirect URI defaults to the dev server's; set `OPPER_REDIRECT_URI` for another one, or, for a deployment,
   `PUBLIC_BASE_URL` (see [Deployment](#deployment)).

Visitors who aren't signed in watch a **recorded demo** of a jev game. "Sign in with Opper" sends
them through Opper's sign-in; afterwards jev plays live and every call is billed to **their own
Opper wallet**. The player's key is kept in an encrypted, httpOnly cookie (the page's JavaScript
never sees it). "Sign out" clears the cookie; to revoke the app's key entirely, remove jevman under
connected apps in your [Opper wallet](https://platform.opper.ai/wallet).

### Option C — your own TypeSafe key (jev straight from TypeSafe)

jev is made by [TypeSafe](https://typesafe.ai). To call TypeSafe's own System One API instead of going
through Opper, get an API key from TypeSafe (see [docs.typesafe.ai](https://docs.typesafe.ai/introduction/quickstart))
and set `TYPESAFE_API_KEY` in `.env` (and optionally `TYPESAFE_BASE_URL`, default
`https://api.typesafe.ai`). Calls then go to `POST {TYPESAFE_BASE_URL}/v1/systemone` with model
`jev-1.13.0`; the request and answers are the same as through Opper. TypeSafe's API returns no
cost, so the panel shows an **estimate** (`≈`) from token usage at TypeSafe's published price
($0.042 per million input tokens; output is free). Like option A this is a local key, ignored on
https deployments unless `JEV_ALLOW_DEV_KEY=1`. `npm run smoke` and `npm run bench` use it too.

This is also the easiest way to play jevman without an Opper account: clone the repo, add your
TypeSafe key, `npm run dev`. The hosted page links here from its header, under "Sign in with Opper".

### Option D — free credits for everyone (the hosted page)

Set `OPPER_POOL_API_KEY` to an Opper API key whose money is meant for visitors. Signed-out visitors then play every
mode on it, with no sign-in, until its balance runs out; the page header shows what is left (`$84.12 free credits`),
where a signed-in player's name goes. Once it is empty, the page asks visitors to sign in and play on their own
Opper account, as before. There is nothing to manage here: the key's organization balance *is* the pool, so give the
key its own Opper organization and top that up whenever you like. The server reads the balance from Opper
(`GET /v3/me`, every 30 s, and subtracts each call's cost in between), and Opper itself stops the key at zero.

The pool pays only for what a game sends: requests of at most 16 KB and five questions, and at most 8 a second per
visitor (a game against four AI ghosts makes about 4), so a script can't drain it in minutes. Visitors are told apart by
IP address; behind proxies that append to `X-Forwarded-For`, set `JEV_TRUSTED_PROXIES` to how many (default `2` in
production: CloudFront and the load balancer, else `0`). The rate limit is kept in memory per server; the balance is
the hard limit.

### Which key is used

A signed-in Login-with-Opper player always plays on their own key, through Opper. Otherwise the free credits
(`OPPER_POOL_API_KEY`) pay while they last, and then the server's local key: `TYPESAFE_API_KEY` if set, else
`OPPER_API_KEY`. Variables exported in your shell take precedence over `.env`. The account area in the page header
says which one is in use.

### Another model

jev is the default, but any model that speaks the System One API can play: set `JEV_MODEL` to its
name, for example `opper/kev-4b` or `opper/clef` through Opper. It applies to the game, `npm run smoke`
and `npm run bench`, and recordings note the model that played. Through TypeSafe directly (option C)
the cost estimate still uses jev's price. It is the server's default: a model the game or the bench
names explicitly (`--pacman-model`, `npm run leaderboard`) must be one of the
[decision models](#decision-models) and wins over it.

## Scripts

- `npm test` — unit tests (includes a check that the committed demo still replays exactly).
- `npm run build` / `npm start` — production build, then the production server on `PORT` (default 3000).
- `npm run smoke` — one real batched call to jev with the `.env` key (TypeSafe or Opper).
- `npm run bench` — headless real-time games reporting survival time, score, pellets, deaths,
  calls, fallbacks, latency and cost. Paid whenever a model drives a character.
  Flags: `--games 4` (played in parallel), `--pacman jev|greedy` and `--ghosts greedy|jev` (`jev`
  means "a decision model"), `--pacman-model` and `--ghost-model` (any id below; default jev),
  `--max 120` (seconds per game), `--record path.json` (with `--games 1`: save the game for replay). Each model gets a warm-up call
  first, because Opper-hosted models can take many seconds to answer after being idle. The demo was recorded with
  `npm run bench -- --games 1 --pacman jev --ghosts greedy --max 120 --record public/demo/jev-demo.json`;
  re-record it if a change to the game rules makes the replay test fail.
- `npm run leaderboard` — every decision model plays Pac-Man against the scripted ghosts, so the
  model itself is measured. Writes `public/leaderboard.json` (ranked by
  mean score), which the site shows at `/leaderboard`, and prints a table. Same flags as `bench`, plus `--models id,id` (default: all),
  `--parallel 4` (games at a time per model); defaults to 8 games per model and a 300 s cap.
- `npm run bench -- --endpoint http://…` — plays Pac-Man with any model behind your own HTTP endpoint; with
  `--submit submissions/<id> --name … --by …` it records the leaderboard's games as a submission. See
  [CONTRIBUTING.md](CONTRIBUTING.md#benchmark-your-own-model).
- `npm run submissions` — replays every submitted game in [`submissions/`](submissions) and writes
  `public/community.json`, the leaderboard's **self-reported** list. The image build runs it too, so a submission that
  doesn't check out fails CI.
- `npm run deaths -- game.json` — replays a recorded game and prints, for each of Pac-Man's deaths,
  his last few junction decisions with the routes as jev saw them.

## Decision models

Opper serves several System One decision models with the same API, listed in
[`shared/models.ts`](shared/models.ts): `typesafe/jev-1.13.0` (TypeSafe, the default),
`opper/clef` and `opper/clef-flash` (Cloudflare), `opper/kev-4b` (a Qwen3.5-4B fine-tune by Jared
Palmer) `berget/convaiinnovations/laya` (ConvAI Innovations; its 512-token context is shorter
than one of our questions) and `openai/gpt-6-luna-decisions` (OpenAI's GPT-6 Luna Decisions, which Opper translates
to System One). The server forwards only these. Through Opper any of them can play; a
TypeSafe key (option C) reaches jev only.

Any other model can join the leaderboard as **self-reported**: its makers run the benchmark against their own
endpoint and send the recorded games in a pull request, which CI replays. See
[CONTRIBUTING.md](CONTRIBUTING.md#benchmark-your-own-model).

In the game, pick the models in the Play dialog: one for Pac-Man (the chips) and one for all the ghosts. Each card on the
decision panel has a dropdown to switch that character's model, also mid-game. Choices are remembered in your browser; the default is the server's
(jev, or `JEV_MODEL`), and the game only names a model when you pick another one. Opper-hosted
models scale down when idle, so picking one sends a tiny warm-up call (`POST /api/warm`, one cheap
call): Play waits for it ("Waking up Clef…"), and a mid-game switch takes over once the new model
answers.

## Controls

Arrows/WASD steer Pac-Man when you play him · `J` or the Pac-Man button hands him to the AI or back · `P` pause ·
`R` restart · `M` sound on/off · the speed slider slows the game down. Space/Enter presses Watch (or Play); Restart and `R` end the game and open the Play dialog, Play again replays the same setup. On a phone,
swipe anywhere on the game card: the board, the strips around it or the swipe pad under it.

## Cost

Each jev call costs about **$0.00005**, through Opper or straight from TypeSafe. With jev playing
Pac-Man a game makes about 1–2 calls per second, so a typical game (two to three minutes until he
runs out of lives) costs **about $0.01**, or **about $0.35 per hour** of continuous play. When you
steer Pac-Man and jev plays the four ghosts it makes about 4 calls per second, **about $0.75 per
hour**; with the AI on both sides, about the two together. Lowering the speed makes fewer calls. `npm run bench` reports the exact cost per game.

## Benchmark your own model

Any model can join the [leaderboard](https://opper.ai/jevman-benchmark/leaderboard) as **self-reported**. Put it behind an
HTTP endpoint that answers jevman's questions (copy [`scripts/example-endpoint.ts`](scripts/example-endpoint.ts)),
then:

```bash
npm run bench -- --endpoint http://localhost:8787 --games 2
npm run bench -- --endpoint http://localhost:8787 --submit submissions/my-model --name "My Model" --by your-github-handle
npm run submissions
```

The second command plays 24 games (the minimum for a submission; add `--games 100` to match our runs) and writes them to `submissions/my-model/`; the third checks them
the way CI will. Commit the folder and open a pull request: CI replays every game and checks its score. The request
and answer format, the rules and what "self-reported" means are in
[CONTRIBUTING.md](CONTRIBUTING.md#benchmark-your-own-model).

## Player high scores

Games against AI ghosts count on a board per lineup (Mixed, and one per model on all four ghosts), top ten each.
Players enter three initials, signed in or not; the page sends the game's recording and the server replays it with the
game's own code (`src/player-check.ts`, bundled for the server by `vite build --ssr` into `dist-ssr`), so only the
replay's score goes on a board. A board keeps one line per player: per Opper account when signed in, else per address
and initials. The boards live in memory and are saved whole after each entry:
- with `JEV_HIGHSCORES_BUCKET` (and `JEV_HIGHSCORES_KEY`, default `highscores.json`), to that S3 object in
  `AWS_REGION`, with the ECS task role's credentials (or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`), so they
  survive deploys. On Opper's ECS both come from SSM. Each save only replaces the version it read (S3 conditional
  writes); when another task wrote in between, as old and new tasks do during a deploy, its boards are merged in
  first. An entry deleted from the object by hand comes back from a task still holding it: redeploy after editing.
- otherwise to `JEV_HIGHSCORES_FILE`, else a file in the system's temp folder (local runs).

Nothing is shown or entered until the boards have been read; if the store can't be read, `/api/highscores`
answers 503 and nothing is written over what it holds.

## How decisions work

When a character commits to a corridor its next junction is known, so the game asks jev about it
straight away (one System One request per frame, one `choice` question per character, options =
legal directions described with computed facts: distances to pellets, power pellets, fruit and
ghosts, whether the nearest ghost is coming closer, and whether a ghost can reach the end of the
corridor before Pac-Man). Up to three requests are in flight at once. If the character reaches the
junction before the answer, it waits there (its panel card says "thinking…"). After 2 s, or on an
error, it uses a greedy rule.

Pac-Man can also get a second question mid-corridor: when a dangerous ghost is in the corridor
ahead, or can reach the junction at its end before he does, jev is asked whether to keep going or
turn back right now (`pacman_escape`). Pac-Man keeps moving while it is open, and each situation is
asked once.

## Deployment

jevman runs on Opper's ECS (eu-north-1) at <https://opper.ai/jevman-benchmark/>, next to apps like
[media-studio](https://opper.ai/media-studio). CloudFront and the load balancer forward the full path, so the app
itself lives below the prefix. A green push to `main` builds the image, pushes it to ECR as `:<commit>` and rolls the
ECS service ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)). The infrastructure (ECR repository, ECS
service, load balancer rule, IAM roles) is in
[opper-ai/terraform](https://github.com/opper-ai/terraform), `environments/eu-north/jevman-benchmark.tf`.

Settings, all optional (empty serves the app at the root, as for local development):

- `APP_BASE_PATH` — the path prefix, e.g. `/jevman-benchmark`. A build argument of the image (Vite's `base`, so the
  client's assets, requests and links stay below it) and the server's runtime setting: requests below it are served
  with the prefix removed, `/jevman-benchmark` redirects to `/jevman-benchmark/`, everything else is 404 except
  `/health`, which answers at the root too for load balancer health checks. The session and sign-in cookies are
  scoped to the prefix.
- `VITE_PUBLIC_URL` — build argument: the public origin for share links and social-card tags; CI builds with
  `https://opper.ai`. Unset, they point at `https://opper.ai/jevman-benchmark/`.
- `PUBLIC_BASE_URL` — the public origin, e.g. `https://opper.ai`. The Login with Opper redirect URI is then
  `${PUBLIC_BASE_URL}${APP_BASE_PATH}/auth/callback`, and requests from that origin count as same-site.
- `OPPER_OAUTH_REDIRECT_URI` — an explicit redirect URI; wins over `OPPER_REDIRECT_URI` and `PUBLIC_BASE_URL`.
- A production image (`NODE_ENV=production`) refuses to start without an https `PUBLIC_BASE_URL` or
  `OPPER_OAUTH_REDIRECT_URI`; set `JEVMAN_ALLOW_HTTP=1` to try a production build over plain http.

Secrets live in SSM Parameter Store under `/opper/eu-north/jevman-benchmark/` (`OPPER_CLIENT_ID`,
`OPPER_CLIENT_SECRET`, `SESSION_SECRET`, and `OPPER_POOL_API_KEY` for the [free credits](#option-d--free-credits-for-everyone-the-hosted-page)).
A new parameter reaches the app when its tasks next start (a deploy, or forcing a new deployment of the service). The image's entrypoint is Opper's
[loadsecrets](https://github.com/opper-ai/opper-secrets), which exports every parameter under `OPPER_SSM_PREFIXES`
into the environment and then starts the server; run the image elsewhere with `OPPER_SSM_PREFIXES='[]'` to skip SSM.
The loadsecrets image is private, so building the image locally needs `docker login ghcr.io`
(`gh auth token | docker login ghcr.io -u "$(gh api user -q .login)" --password-stdin`). On SIGTERM the server stops
reporting healthy, keeps serving for 5 s while the load balancer drains it, and exits within 25 s, before ECS's 30 s
stop timeout.

## License

Copyright © 2026 Johnny Chadda. jevman is free software under the
[GNU Affero General Public License v3.0 or later](LICENSE). You may use, change and host it. If you
run a modified version as a service, you must offer its users the source of your version, as the
game's "Source on GitHub" link does for this one.
