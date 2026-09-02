# Welcome to Oltrematica

## How We Use Claude

Based on Andrea Margiovanni's usage over the last 30 days (54 sessions):

Work Type Breakdown:
  Build Feature     █████████████░░░░░░░  67%
  Improve Quality   ███████░░░░░░░░░░░░░  33%

Top Skills & Commands:
  /model            ████░░░░░░░░░░░░░░░░  1x/month

Top MCP Servers:
  Cloudflare Docs   ████████████████████  6 calls

## Your Setup Checklist

### Codebases
- [ ] margiolink — https://github.com/amargiovanni/margiolink
- [ ] oltrematica-compliance-skills — the plugin that supplies the compliance and harness skills below. Ask Andrea for the repo URL; it is checked out at `~/dev/skills/oltrematica-compliance-skills`
- [ ] adr-management-skill — architecture decision records, at `~/dev/skills/adr-management-skill`

### MCP Servers to Activate
- [ ] Cloudflare Docs (`plugin_cloudflare_cloudflare-docs`) — searches Cloudflare's live documentation instead of relying on the model's training data, which matters because the Workers and D1 APIs move faster than any cutoff. It ships with the Cloudflare plugin: run `/plugin` and install `cloudflare`, no account or token needed for docs search.

### Skills to Know About

The `oltrematica-skills` plugin carries these. Install it once and they load automatically when a task matches — you rarely invoke them by name.

**Gates and workflow**
- `/run-gates` — runs the mandate gates over your current change: tests green, migrations reversible, authorization present. Run it before you claim anything is done.
- The plugin also installs a **Stop hook** (`verify_before_done.sh`) that blocks a completion claim while the test evidence is stale. Two of Andrea's last sessions opened with that hook firing — it is doing its job, not malfunctioning. When it fires, re-run the tests rather than arguing with it.

**Compliance** — these fire on the words you would naturally use, not on jargon
- `gdpr-evidence` — legal basis, data maps, retention, breach clocks. Triggers on things like "can we log the IP address" or "how long do we keep it".
- `cra-evidence` — SBOMs, dependency vulnerabilities, release dossiers. Triggers on "are we CRA ready" or "cut v2.3".
- `cra-incident-reporting` — the Article 14 reporting clock, and the coordinated vulnerability disclosure policy. Also the right skill for "we need a SECURITY.md".
- `eaa-evidence`, `ai-act-evidence`, `pld-evidence` — accessibility, AI systems, product liability.
- `/compliance-status` — where this repo stands on its regulatory evidence, and which skill owns each gap.

**Harness**
- `claude-md-authoring` — writing or fixing a CLAUDE.md. Use it when Claude keeps ignoring a documented rule; the usual cause is a CLAUDE.md carrying procedure that belongs in a skill.
- `harness-audit`, `harness-eval`, `/catalogue-eval` — auditing the repo's Claude setup and testing whether a skill actually fires.
- `adr-management` — drafts an architecture decision record when a real decision gets made.

**Superpowers** (separate plugin, worth having)
- `brainstorming` → `writing-plans` → `subagent-driven-development` is the chain Andrea used to build margiolink's backend: talk the design through, write it down, then execute it task by task with a fresh subagent and a review gate per task.

## Team Tips

_TODO_

## Get Started

_TODO_

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->
