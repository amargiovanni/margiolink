# Contributing to MargioLink

Thanks for being here. This document is longer than most because MargioLink
makes a few promises that are unusual for a link shortener, and keeping them
requires the code to be written in specific ways. Most of what follows is
explaining *why* a rule exists, so you can tell when it applies and when it
does not.

If you only read one section, read [The three rules that are not
negotiable](#the-three-rules-that-are-not-negotiable).

---

## Contents

- [Ways to contribute](#ways-to-contribute)
- [Before you start writing](#before-you-start-writing)
- [Getting set up](#getting-set-up)
- [The three rules that are not negotiable](#the-three-rules-that-are-not-negotiable)
- [How we write tests](#how-we-write-tests)
- [Migrations](#migrations)
- [Code conventions](#code-conventions)
- [Commits and pull requests](#commits-and-pull-requests)
- [What review looks for](#what-review-looks-for)
- [Reporting a bug](#reporting-a-bug)

---

## Ways to contribute

Not all of these need code, and the ones that do not are often more useful.

- **Report a bug** you can reproduce. See [Reporting a bug](#reporting-a-bug).
- **Report a vulnerability** — privately, please. See [SECURITY.md](SECURITY.md).
- **Improve the documentation.** If something in the README sent you down the
  wrong path, that is a defect and worth a pull request on its own.
- **Challenge a privacy claim.** The privacy notice and the compliance
  documents make specific, checkable assertions about the code. If one of them
  is not true, that is the most valuable issue you can open. It has happened
  twice already during development, both times caught by reading the documents
  against the source.
- **Write code.** Read on.

## Before you start writing

**Open an issue first for anything that changes behaviour.** Not for a typo or
a small fix — for those, just send the pull request. But for a feature, a new
endpoint, a schema change, or anything touching the analytics or the privacy
design, a short issue saves you from building something that gets declined for
a reason nobody told you.

Say what you want to achieve rather than what you plan to build. There is often
a smaller change that gets you there.

**Things likely to be declined**, so you know before investing time:

- Anything that stores an IP address, a raw user-agent, or any identifier that
  survives a UTC day. This is the one thing MargioLink exists to avoid.
- A third-party analytics, tracking or telemetry integration. The software
  contacts nothing but the browser in front of it, and that is a feature.
- A second datastore. D1 being the only one is what keeps this deployable in
  ten minutes.
- Cookie-based visitor identification, in any form.

**Things very welcome:**

- Anything that makes an existing claim more precisely true
- Test coverage for a branch nothing exercises
- Accessibility work, once the dashboard exists
- Performance work on the redirect path, with a measurement

## Getting set up

You need Node 24 (see `.nvmrc`) and npm. You do **not** need a Cloudflare
account to develop or run the tests — D1 runs locally.

```bash
git clone https://github.com/YOUR-USERNAME/margiolink.git
cd margiolink
npm ci

cp .dev.vars.example .dev.vars
# set ADMIN_USER and ADMIN_PASSWORD to anything, then:
openssl rand -hex 32   # paste as HASH_SECRET

npm run db:migrate:local
npm test               # should be green before you change anything
npm run dev
```

If `npm test` is not green on a fresh clone, that is a bug — please open an
issue rather than working around it.

## The three rules that are not negotiable

Everything else in this document is guidance. These three are the reason the
project is worth using.

### 1. No IP address, no raw user-agent, no cross-day identifier

Both values are read on the redirect path and used as input to one HMAC whose
key contains the current UTC date. They are never stored, never logged, never
put in an error message.

If your change touches `src/ingest/`, `src/lib/crypto.ts`,
`src/lib/request-context.ts` or `src/db/clicks.ts`, assume review will trace
those two values through your diff by hand.

There is a test asserting that a stored click row contains neither value
anywhere in its serialisation. Do not weaken it. If your feature seems to
require one of them, open an issue — there is usually another way, and if there
genuinely is not, that is a conversation rather than a pull request.

The one exception, already in the code, is `login_attempts.ip_hash`: the same
daily-rotating HMAC, used to throttle brute-force attempts against the admin
password, purged daily. It is documented in the data map and the privacy
notice. Adding a second exception needs a very good argument.

### 2. Every authenticated route mounts on the authenticated router

Public and authenticated routes live on separate router objects.
`test/routes/route-guard.test.ts` walks the framework's own route table and
requires `401` from every route not on a pinned allowlist.

This means you do not have to remember to protect a new endpoint — but it also
means that if you find yourself adding an entry to `PUBLIC_API_ROUTES` to make
a test pass, stop. That allowlist is pinned to its exact contents precisely so
that widening it is a deliberate, reviewable act.

### 3. Claims in the documents must be true of the code

`src/routes/public.ts` (the published privacy notice), `compliance/data-map.md`
and `compliance/legitimate-interest-assessment.md` make specific factual
assertions. If your change makes one of them inaccurate — you add a column, you
set a cookie, you store a new field — update the document in the same pull
request.

A test compares the documented `clicks` columns against the live schema in both
directions, so an undocumented column fails the build. It cannot catch a
changed *claim*, though, which is why this is a rule and not just a test.

## How we write tests

**Every change ships with at least one test.** A bug fix ships with a test that
fails before the fix.

**Tests run against a real database.** They execute inside `workerd` with a
real local D1 instance, so your SQL is really run by SQLite. Do not introduce a
mock, an in-memory substitute, or a stub for the database — the value of this
suite is that a query which would fail in production fails here.

**Write the test first, and watch it fail.** Not as ceremony: a test you have
never seen fail is a test you have not verified. This has caught real problems
in this repository — a rollback test that would have passed against a database
that was never migrated, and an assertion that "the token is not stored" which
would have passed if the token were stored backwards.

**Make assertions specific.** `expect(stored.id).not.toBe(token)` passes for
any transformation at all. `expect(stored.id).toBe(await sha256Hex(token))`
proves the property you actually care about. When you write an assertion, ask
what else would satisfy it.

**Use distinct fixture values.** If a test seeds `country` and `city` with the
same placeholder, it cannot catch a swap between them. This is not theoretical
— it is why the live-feed test seeds eleven deliberately different values.

**Prefer table-driven tests over repetition** where a fixed set is being
covered. The dimension tests iterate `Object.keys(DIMENSION_COLUMNS)` rather
than listing fifteen names, so a sixteenth dimension added later is covered
automatically instead of quietly skipped.

## Migrations

**Every migration is reversible.** `migrations/NNNN_name.sql` has a matching
`rollback/NNNN_name.down.sql`, and CI proves it: it applies everything, rolls
the newest one back, and checks the schema both *changed* and came back
identical. A down file that does nothing fails that check.

Run it yourself before pushing:

```bash
npm run db:verify-rollback
```

Down files live in `rollback/`, never in `migrations/` — the test harness reads
that directory wholesale and would treat a down file as a migration.

A down file restores structure. It does not always restore data, and sometimes
it should not: `0002` drops a column that held full third-party referrer URLs,
and bringing those values back would undo the minimisation the migration exists
to perform. Say so in a comment when that applies.

**Never modify a migration that has been released.** Add a new one.

## Code conventions

**Everything in the repository is English** — code, identifiers, comments,
commit messages, documentation.

**Biome handles formatting and linting.** Run `npm run check:fix` before
committing; do not argue with it in review.

**TypeScript is strict, with `noUncheckedIndexedAccess`.** Indexed access gives
you `T | undefined` and you should handle it rather than casting it away. If
you find yourself writing `as SomeType` to silence the compiler, that is worth
a second look — one such cast in this repository turned out to be defeating the
exact check that would have caught a later bug.

**No Node built-ins in `src/`.** This runs on Workers; `nodejs_compat` is
deliberately off. Build scripts under `scripts/` are ordinary Node and may use
whatever they like.

**SQL is hand-written and lives in `src/db/`.** There is no ORM and that is
deliberate — roughly half the queries are analytical `GROUP BY`s that an ORM
would obscure. In exchange: **every caller-supplied value goes through
`.bind()`**, never string interpolation. Column names chosen by the code are
fine as literals; anything from a request is a parameter.

**Files have one responsibility.** `src/lib/` is pure logic with no database
access. `src/db/` holds every SQL statement. `src/routes/` holds request and
response wiring and little else.

## Commits and pull requests

**Commit messages:** `type(scope): imperative subject`, 72 characters or fewer,
in English. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`.

```
feat(links): add expiry fallback URL
fix(db): break listLinks ties by id so newest-first is deterministic
test(cron): cross-validate aggregates against the live queries
```

**One commit, one logical change.** If you fix a bug you found along the way,
commit it separately from your feature — a reviewer should be able to
understand, and revert, each independently.

**Branches:** `feature/short-description` or `fix/short-description`.

**Pull requests** should say what changed, why, and how to test it. The
template will prompt you. Two specific asks:

- If you found and fixed a bug in existing code, give it its own section. A bug
  found in reviewed code is the most useful thing a pull request can contain,
  and it should not be buried under the feature.
- If you deviated from something this document says, say so and why. A stated
  deviation is a discussion; an unstated one is a surprise in review.

Before you push: `npm test`, `npm run check`, `npm run typecheck`. CI runs all
three, but finding out locally is faster.

## What review looks for

Roughly in order of how much attention each gets:

1. **Does it keep the three rules?** Reviewers trace values by hand here rather
   than trusting a description.
2. **Do the tests prove what they claim?** A passing test that would also pass
   with the feature absent is worse than no test, because it looks like
   coverage. Expect to be asked what else would satisfy an assertion.
3. **Is the change what the issue asked for** — no less, and no more? An
   unrequested refactor bundled into a feature will be asked for separately.
4. **Is it correct at the edges?** Empty result sets, missing environment
   variables, a day boundary, a value that is `null` rather than absent.
5. **Would the next person understand it?** Comments explaining *why* are worth
   more than comments explaining *what*.

Review is meant to be useful rather than pleasant, and it goes both ways: if a
review comment seems wrong, say so with your reasoning. That has happened
during development and the reviewer was the one who turned out to be mistaken
more than once.

## Reporting a bug

Open an issue with:

- what you did, precisely enough that someone else can do it;
- what you expected, and what happened instead;
- the commit or release you are on;
- whether it reproduces on a fresh clone with `npm run dev`.

If you can write a failing test, that is worth more than a paragraph of
description — and it is most of the fix.

**If the bug has security implications, do not open a public issue.** See
[SECURITY.md](SECURITY.md).

---

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE), and you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md).
