# What changed

<!-- What this does, in a couple of sentences. Not a list of files. -->

# Why

<!-- The problem, or a link to the issue. If this was declined once before in a
different form, say so. -->

Closes #

# How to test

<!-- What a reviewer runs, and what they should see. "npm test" is not enough
on its own — say which behaviour is new and how to observe it. -->

```bash

```

# Checklist

- [ ] `npm test`, `npm run check` and `npm run typecheck` pass locally
- [ ] New behaviour has a test that fails without the change
- [ ] Nothing stores an IP address, a raw user-agent, or an identifier that
      survives a UTC day
- [ ] Any new authenticated route is mounted on the authenticated router, and
      `PUBLIC_API_ROUTES` is unchanged
- [ ] Commit messages are `type(scope): imperative subject`, ≤72 characters

# If this touches the database

- [ ] The migration has a matching file in `rollback/`
- [ ] `npm run db:verify-rollback` passes
- [ ] `compliance/data-map.md` describes any new column on `clicks`

# If this changes what is collected, stored or disclosed

- [ ] `src/routes/public.ts` — the published privacy notice still says only
      true things, and still says all the relevant ones
- [ ] `compliance/data-map.md` and
      `compliance/legitimate-interest-assessment.md` agree with the code

# Bugs found in existing code

<!-- If you found a defect in code that was already merged, describe it here
rather than burying it above: what it was, how you reproduced it, and the test
that now pins it. This is the most valuable thing a pull request can contain
and it should be easy to find. If none, delete this section. -->

# Deviations

<!-- Anything you did differently from CONTRIBUTING.md, and why. A stated
deviation is a conversation; an unstated one is a surprise in review. If none,
delete this section. -->

# Breaking changes

<!-- API shape, schema, configuration. If none, write "None". -->
