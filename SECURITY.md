# Security policy

MargioLink handles two things worth attacking: an admin account that can rewrite
where a link points, and click records about people who never chose to interact
with this software. Reports about either are welcome.

This document is also MargioLink's **coordinated vulnerability disclosure
policy**, which Annex I Part II of the EU Cyber Resilience Act
(Regulation (EU) 2024/2847) requires a manufacturer to have in place. It is
mirrored in machine-readable form at `/.well-known/security.txt` on any
deployment.

## Reporting a vulnerability

**Email <andrea@margiovanni.it>**, or use GitHub's private advisory form:
<https://github.com/amargiovanni/margiolink/security/advisories/new>

Either reaches the maintainer privately. The GitHub form has the advantage of
becoming the published advisory if the report is confirmed; email has the
advantage of not requiring an account.

Please include, as far as you can:

- the commit or release affected;
- what an attacker can achieve, and what access they need to start;
- steps to reproduce, or a proof of concept;
- whether the issue is, to your knowledge, already public or being exploited.

**Please do not open a public issue for a security report.** Please do not test
against a deployment you do not own — this is software other people run, and a
proof of concept against someone else's instance is an attack on them, not a
demonstration to us.

## What you can expect

This is a small project maintained by one person. The targets below are honest
about that rather than aspirational; a policy nobody can honour is worse than
no policy.

| Stage | Target |
| --- | --- |
| Acknowledgement that your report arrived | 5 business days |
| Initial assessment shared with you | 15 business days |
| Fix or mitigation for a confirmed high-severity issue | 90 days, sooner where exploitation is observed |
| Public disclosure | Coordinated with you, normally once a fix is available |

You will be credited in the advisory unless you ask not to be.

## Scope

**In scope** — this repository, and specifically:

- the redirect path and its link-password gate;
- the admin authentication, session handling and login throttle;
- the authenticated API surface under `/api`;
- the click-ingestion path, and in particular anything that causes an IP
  address, a raw user-agent or a link password to be stored or logged;
- the visitor-hash construction, and anything that makes a visitor linkable
  across UTC days;
- the scheduled jobs, and anything that makes retention silently stop deleting.

**Out of scope:**

- findings from automated scanners with no demonstrated impact;
- denial of service by traffic volume against a deployment;
- vulnerabilities in Cloudflare's platform — report those to
  [Cloudflare](https://hackerone.com/cloudflare);
- social engineering;
- missing hardening that has no exploit path, unless you can show one.

## Safe harbour

We will not pursue or support legal action against anyone acting in good faith
under this policy: who avoids privacy violations, data destruction and service
interruption, who uses only accounts they own or have permission to use, and
who gives us reasonable time to respond before disclosing publicly.

## Deployments you run

MargioLink is software you host yourself, so the operator of a deployment is
its data controller and, under the CRA, may be the one placing it on the
market. Two consequences worth stating plainly.

**Set your secrets.** `HASH_SECRET` must be at least 32 characters of real
entropy. The Worker refuses to serve rather than run with a missing or weak
one — that behaviour is deliberate, and it exists because an earlier version
failed open, silently producing forgeable link tokens and reproducible visitor
hashes while looking identical from outside.

**Rotating `HASH_SECRET` is not free.** It makes every existing visitor hash
discontinuous, so unique-visitor counts reset. Rotate it if you believe it has
leaked; do not rotate it on a schedule.

## If a vulnerability turns out to be exploited in the wild

An actively exploited vulnerability triggers reporting obligations under CRA
Article 14 that run on 24-hour and 72-hour clocks from the moment the
manufacturer becomes aware. What that means for you as a reporter: we may have
to notify authorities before the coordinated public disclosure date we agreed
with you. We will tell you when that happens and why.

If a report also involves personal data held in a deployment, GDPR Article 33's
own 72-hour clock runs in parallel, to a different authority, and is the
deployment operator's obligation rather than ours.

---

*Last reviewed: 2026-09-01 · Controller and maintainer: Andrea Margiovanni*
