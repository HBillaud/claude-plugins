---
name: audit-dns
description: Audit a domain's live DNS records, registrar/host dashboard screenshots or tables, and project codebase to surface critical routing or email deliverability issues, missing records, split-DNS gaps, and unknowns. Covers web routing (A/AAAA/CNAME/ALIAS, apex vs. www redirects, CAA/TLS), email authentication (MX, SPF, DKIM selectors, DMARC enforcement), and transactional mail senders in code (Resend, SendGrid, Postmark, SES). TRIGGER when the user asks to check or audit DNS records, troubleshoot emails going to junk/spam, compare registrar vs. hosting DNS settings (e.g. IONOS/GoDaddy/OVH vs. Vercel/Cloudflare), or says "/web-agency:audit-dns" (or "/audit-dns").
user-invocable: true
allowed-tools: Bash, Glob, Grep, Read, WebSearch
---

# Audit Domain DNS & Email Deliverability

Audit a client domain's DNS configuration end-to-end by combining **live authoritative DNS queries (`dig`)**, **dashboard tables or screenshots** (from both the registrar/mail provider and the active DNS host), and **project codebase inspection**.

The goal is not just to check whether records exist, but to catch the subtle failures that break production web apps or send client emails to spam: split-horizon DNS traps where records sit in an inactive registrar panel, missing account-specific DKIM CNAMEs, weak DMARC defaults (`p=none`), unauthenticated transactional mailers in `api/`, and apex/`www` redirect mismatches.

## Overview & Scope

This skill evaluates four layers and classifies every finding into **Critical Issues**, **Gaps & Hardening**, or **Unknowns & Dashboard Checks**:

1. **Authority & Split-DNS Architecture** — Who is the registrar/mailbox provider vs. which nameservers are actually authoritative (`NS` / `SOA`).
2. **Web Routing, Redirects & TLS (`A`, `AAAA`, `CNAME`, `ALIAS`, `CAA`, `TXT`)** — Apex (`@`) and `www` resolution, HTTP $\to$ HTTPS and canonical host redirects, certificate authority (`CAA`) permissions, and verification `TXT` records.
3. **Corporate Email Deliverability (`MX`, `SPF`, `DKIM`, `DMARC`, `Autodiscover`)** — Compliance with strict enterprise gateways (Mimecast, Proofpoint, Microsoft Defender, Google Workspace).
4. **Application & Transactional Senders** — Cross-checking the repo (`package.json`, `api/`, server routes, `.env*` keys) for transactional email providers (Resend, Postmark, SendGrid, Mailgun, SES, SMTP) that require their own DNS records on the domain.

## Workflow

### 1. Resolve Inputs (or Request the DNS Table / Screenshots)

Check `$ARGUMENTS`, attached screenshots/text tables, and the current repository (`vercel.json`, `index.html` canonical/OG URLs, `README.md`, `CNAME`) to identify:

- The target **domain name** (e.g. `example.com`).
- Any **DNS dashboard screenshots or text tables** provided by the user.

**If no domain AND no DNS dashboard/table (screenshots, pasted rows, or zone export) are provided:**
- Ask the user to provide the target domain and share a screenshot or pasted table of their DNS records from **both**:
  1. Their **active DNS / hosting provider** (e.g. Vercel, Cloudflare, Netlify, Route 53), and
  2. Their **domain registrar / email provider** (e.g. IONOS, OVH, GoDaddy, Namecheap, Google Workspace, Microsoft 365) if separate.
- Explain in one sentence why: public DNS cannot automatically enumerate unknown custom subdomains or unprobed provider-specific DKIM selectors (such as account-ID CNAMEs sitting in an inactive registrar panel).

**If a domain is known (from `$ARGUMENTS` or the repo) but no DNS dashboard/table was shared:**
- Run the live DNS and codebase audit immediately so the user gets instant answers, **and** explicitly note in **Unknowns & Dashboard Checks** that sharing screenshots/tables of the registrar and DNS host panels will allow a full row-by-row diff for hidden records.

### 2. Determine DNS Authority & Split-Horizon Traps

Ask the parent zone (registry) for the delegation, then query one of the delegated nameservers directly so cached or split-horizon resolver answers can't mask recent changes:

```bash
domain="<apex domain>"
parent="${domain#*.}"
parent_ns=$(dig +short NS "$parent." | head -1)
echo "=== DELEGATION (from registry) ==="
dig @"$parent_ns" +noall +answer +authority NS "$domain"

ns="<first NS hostname from the delegation above>"
echo "=== AUTHORITATIVE NS / SOA ==="
dig @"$ns" +short NS "$domain"
dig @"$ns" +short SOA "$domain"
echo "=== LOCAL RESOLVER VIEW ==="
dig +short NS "$domain"
```

- Identify the **authoritative DNS host** from the `NS` records (e.g. `*.vercel-dns.com` $\to$ Vercel, `*.ns.cloudflare.com` $\to$ Cloudflare, `*.ui-dns.*` $\to$ IONOS, `dnsNN.ovh.net` / `nsNN.ovh.net` or `*.anycast.me` $\to$ OVH).
- **Query authoritatively from here on:** Every in-zone query in later steps goes to `@$ns`. Authoritative servers don't recurse, so follow `CNAME` / `include:` targets on other domains with a plain `dig +short`. If the local resolver's answer differs from the authoritative one, report the authoritative value as live and note that the change is still propagating.
- **The External Nameserver Trap:** When a domain is registered (or has email hosted) with Provider A (e.g. IONOS, GoDaddy, OVH) but uses custom nameservers pointing to Provider B (e.g. Vercel, Cloudflare), Provider A's internal DNS table becomes **completely inactive**. Any record auto-generated by Provider A (MX, SPF, DKIM selectors, DMARC, `_domainconnect`) has zero effect until manually recreated in Provider B's DNS panel.

### 3. Audit Web Routing, Canonical Redirects & TLS (`A`, `AAAA`, `CNAME`, `CAA`, `TXT`)

Query live web and verification records and test the HTTP/HTTPS redirect chain:

```bash
domain="<domain>"
ns="<authoritative NS from step 2>"
q() { dig @"$ns" +short "$@"; }
echo "=== APEX A / AAAA / CAA / TXT ==="
q A "$domain"
q AAAA "$domain"
q CAA "$domain"
q TXT "$domain"

echo "=== WWW ==="
q CNAME "www.$domain"
q A "www.$domain"
q AAAA "www.$domain"

echo "=== HTTP/HTTPS REDIRECT CHAIN ==="
for url in "http://$domain" "http://www.$domain" "https://$domain" "https://www.$domain"; do
  echo "--- $url ---"
  curl -sSI -L --max-redirs 5 "$url" | grep -Ei '^(HTTP/|location:|server:|strict-transport-security:)'
done
```

Check and flag:
- **HTTP $\to$ HTTPS Upgrade:** Both `http://` URLs must redirect (301/308) to `https://` on the canonical host. A `200` over plain HTTP, or a redirect to a different host, is a **Gap**.
- **Conflicting or Stale Apex Records:** Ensure no legacy registrar parking `A` or `AAAA` records remain alongside active hosting records.
- **Apex vs. `www` Canonical Redirect:** Both `https://<domain>` and `https://www.<domain>` must resolve over valid TLS and redirect cleanly (301/308, single hop preferred) to the canonical host without redirect loops or certificate errors.
- **`CAA` Record Compatibility:** If `CAA` records exist, verify they permit the active host's certificate authority (e.g. `letsencrypt.org`, `pki.goog`, `sectigo.com`). Restrictive CAA records lacking the host's CA will silently block automatic SSL renewal.
- **Root `TXT` Hygiene:** Check for duplicate verification tokens, malformed quotes, or orphaned records.

### 4. Audit Email Deliverability (`MX`, `SPF`, `DKIM`, `DMARC`, `Autodiscover`)

Run live queries across all email authentication records and follow every `CNAME` or `include:` target to its leaf value:

```bash
domain="<domain>"
ns="<authoritative NS from step 2>"
q() { dig @"$ns" +short "$@"; }
echo "=== MX ==="
q MX "$domain"

echo "=== SPF (Root TXT) ==="
q TXT "$domain" | grep -i "v=spf1"

echo "=== DMARC ==="
q CNAME "_dmarc.$domain"
q TXT "_dmarc.$domain"

echo "=== AUTODISCOVER / AUTOCONFIG ==="
q CNAME "autodiscover.$domain"
q CNAME "autoconfig.$domain"

echo "=== COMMON DKIM SELECTORS ==="
for sel in google default dkim mail k1 k2 k3 s1 s2 s1-ionos s2-ionos selector1 selector2 resend smtp mandrill mx krs pic; do
  res=$(q CNAME "${sel}._domainkey.$domain"; q TXT "${sel}._domainkey.$domain")
  if [ -n "$res" ]; then
    echo "--- ${sel}._domainkey ---"
    echo "$res"
  fi
done
```

For each protocol, apply strict enterprise deliverability rules:

1. **MX Records:**
   - Must point to hostnames with `A`/`AAAA` records, **never** to a `CNAME` (RFC 2181).
   - Priorities must be explicitly set (even if equal, e.g. `10 mx00.ionos.com` and `10 mx01.ionos.com`).
2. **SPF (`TXT` on `@`):**
   - **Single Record Rule:** There must be **exactly one** `v=spf1` TXT record at the root (`@`). Multiple `v=spf1` records immediately cause an SPF `PermError` and invalidate SPF entirely.
   - **Follow `include:` Chains:** Run `dig +short TXT <included-domain>` on every `include:` mechanism:
     - Count total DNS-querying mechanisms (`include`, `a`, `mx`, `ptr`, `exists`, `redirect`) — must be **$\le 10$** (RFC 7208).
     - Verify regional cluster coverage (e.g. if a client uses IONOS in Europe vs. US, check whether `_spf-us.ionos.com` or `_spf-eu.ionos.com` matches their MX/account region, or include both if needed).
   - **Qualifier:** Must end with `~all` (SoftFail) or `-all` (HardFail). Flag `?all` (Neutral) or `+all` (Pass all — critical vulnerability). A record with `redirect=<domain>` and no `all` mechanism is valid (RFC 7208): the redirect target's `all` applies, so follow it and judge that qualifier instead.
3. **DKIM (`<selector>._domainkey`):**
   - **Follow CNAME Targets:** For every discovered or screenshot-visible DKIM `CNAME`, run `dig TXT <target>` to verify it resolves to a valid public key (`v=DKIM1; p=...`).
   - **Provider Account-Ownership Selectors:** Some providers with shared `s1`/`s2` DKIM keys require a **3rd account-specific CNAME** when using external nameservers so the provider can verify domain ownership and activate signing:
     - **IONOS:** Requires **three** CNAMEs: `s1-ionos._domainkey` $\to$ `s1.dkim.ionos.com`, `s2-ionos._domainkey` $\to$ `s2.dkim.ionos.com`, **AND** `s<AccountID>._domainkey` $\to$ `s<AccountID>.dkim.ionos.com` (visible in the inactive IONOS DNS table). Note that `dig TXT s<AccountID>.dkim.ionos.com` may return `NXDOMAIN` publicly because IONOS uses the CNAME pointer itself for ownership verification while signing mail with `s1-ionos`/`s2-ionos`.
   - **Unguessable Selectors:** The probe loop only covers fixed selector names. Postmark uses timestamped selectors (e.g. `20230601123456pm._domainkey`), SES Easy DKIM uses three random tokens, and Mailgun accounts vary (`mx`, `krs`, `pic`, custom). An empty probe result for these providers is **❓ Unknown**, not missing: get the selector from the provider dashboard, the user's screenshot, or the `s=` tag of a `DKIM-Signature` header in a message they sent, then query it directly.
   - If you encounter an unfamiliar selector or `NXDOMAIN` target, use `WebSearch` to check the provider's external-nameserver DKIM documentation before judging it.
4. **DMARC (`_dmarc.<domain>`):**
   - **Missing DMARC = Spam/Junk:** Enterprise gateways (Mimecast, Proofpoint, Microsoft 365 Defender, Google Workspace) heavily penalize or quarantine domains lacking `_dmarc`.
   - **Watch Out for Weak Provider CNAMEs:** Many registrars (e.g. `dmarc.ionos.com`) use a CNAME that resolves to `"v=DMARC1; p=none;"`. Always run `dig +short TXT <cname-target>` to inspect the actual policy.
   - **Recommended Policy (staged):** Once SPF and DKIM are verified in place, replace missing or report-less `p=none` records in two stages. Always include `rua` so senders the audit didn't discover (CRM, newsletter, invoicing tools) show up in aggregate reports before enforcement starts:
     1. **Monitor (2–4 weeks):**
        ```text
        v=DMARC1; p=none; rua=mailto:dmarc@<domain>; adkim=r; aspf=r
        ```
     2. **Enforce** once the reports show every legitimate source passing SPF or DKIM in alignment:
        ```text
        v=DMARC1; p=quarantine; rua=mailto:dmarc@<domain>; adkim=r; aspf=r; pct=100
        ```
     - Skip straight to stage 2 only if the user confirms every service that sends as `@<domain>` and each one passes.
     - If the `rua` mailbox doesn't exist yet, list creating it (or using a DMARC report service) as a required action. A `rua` address on another domain needs that domain to publish `<domain>._report._dmarc.<rua-domain>` `TXT "v=DMARC1"`.

### 5. Cross-Reference the Codebase for Transactional Email & Subdomains

When run inside a project workspace, scan the whole repo (monorepo packages, `lib/`, `pages/`, serverless function folders included) for email integrations and from-addresses. **Never print secret values:** every command below prints only the matched token (`-o`) or the key name, and `.env*` files are excluded from the source scan.

```bash
domain="<domain>"
skip=(--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build --exclude-dir=.next --exclude-dir=.vercel --exclude-dir=.netlify --exclude-dir=coverage)

echo "=== MAIL PACKAGES (all package.json files) ==="
grep -rnoE "${skip[@]}" --include=package.json \
  '"(resend|@sendgrid/[a-z-]+|nodemailer|postmark|mailgun\.js|mailgun-js|@aws-sdk/client-sesv?2?|mailersend|@getbrevo/brevo|@mailchimp/mailchimp_transactional)"[[:space:]]*:' . 2>/dev/null

echo "=== MAIL SDK USAGE IN SOURCE ==="
grep -rnoE "${skip[@]}" --exclude='.env*' \
  --include='*.js' --include='*.jsx' --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.cjs' \
  --include='*.py' --include='*.php' --include='*.rb' --include='*.go' \
  'new Resend\(|api\.resend\.com|resend\.emails|@sendgrid/mail|api\.sendgrid\.com|postmark|ServerClient\(|mailgun|SESv2Client|SESClient|SendEmailCommand|nodemailer|createTransport|(CONTACT|MAIL|EMAIL|SMTP)_[A-Z0-9_]+' . 2>/dev/null

echo "=== FROM-ADDRESSES ON THE DOMAIN ==="
grep -rhoE "${skip[@]}" "[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)*${domain//./\\.}" . 2>/dev/null | sort -u

echo "=== MAIL-RELATED ENV KEYS (names only) ==="
find . -maxdepth 4 -name '.env*' -not -path '*/node_modules/*' -exec \
  grep -HE '^[A-Z0-9_]*(RESEND|SENDGRID|POSTMARK|MAILGUN|SES|SMTP|MAIL|FROM|DOMAIN)[A-Z0-9_]*=' {} + 2>/dev/null | cut -d= -f1
```

- If the codebase sends transactional emails (e.g. contact forms or lead magnets via **Resend**, **SendGrid**, **Postmark**, **Mailgun**, or **SES**) from `@<domain>` or a subdomain of it:
  - Query the authoritative nameserver for that provider's verification records on the sending domain (e.g. for Resend: `dig @$ns +short TXT resend._domainkey.<domain>`, `dig @$ns +short MX send.<domain>`, `dig @$ns +short TXT send.<domain>`).
  - Flag a **Gap** if the codebase uses a transactional sender whose DKIM / Return-Path records are missing from live DNS.

### 6. Diff Screenshots / Tables Row-by-Row

When the user provides screenshots or tables from one or more dashboards:
- Reconcile **every single row** between the registrar/mail provider table, the active DNS host table, and live `dig` output.
- Classify each row explicitly:
  - **Present & Live** (matches across provider and active DNS).
  - **Upgraded in Active DNS** (e.g. custom `_dmarc` TXT with `p=quarantine` replacing a weak provider CNAME).
  - **Missing in Active DNS — Action Required** (e.g. missing 3rd DKIM selector, missing DMARC, missing Resend records).
  - **Inactive / Not Needed** (e.g. `_domainconnect` when DNS is hosted externally, or stale registrar `A`/`www` records superseded by the active host's `ALIAS`/`CNAME`).

## Common Mistakes

1. **Trusting `s1`/`s2` DKIM CNAMEs alone on external nameservers:** Providers like IONOS require a 3rd account-specific `s<AccountID>._domainkey` CNAME to verify domain ownership on external DNS before enabling DKIM signing. Always ask for or inspect the registrar's inactive DNS table.
2. **Creating a second SPF `TXT` record instead of editing the existing one:** Adding a second `v=spf1` TXT record breaks SPF completely (`PermError`). Always merge `include:` mechanisms into the single root SPF record.
3. **Leaving the root domain suffix in the DNS Hostname field:** Many DNS UIs (e.g. GoDaddy, Namecheap, IONOS) append the zone to whatever is typed in `Name`, so entering `s1-ionos._domainkey.example.com` creates `s1-ionos._domainkey.example.com.example.com`. Cloudflare strips a trailing zone name itself, so a fully-qualified entry there is fine. Recommend entering only the relative label (blank or `@` for the root, matching the target UI), and before calling an existing record broken, confirm with `dig @$ns +short CNAME <name>.<domain>.<domain>` that the doubled name actually exists.

## Output Contract

Structure the audit report into four clear sections:

1. **Status Overview Table** — Every audited area (`NS/Authority`, `Web Routing (@ / www / HTTPS)`, `CAA / TLS`, `MX`, `SPF`, `DKIM`, `DMARC`, `Transactional Mail in Code`) with status (`✅ Working`, `⚠️ Gap / Partial`, `❌ Critical / Missing`, `❓ Unknown`) and concrete live values.
2. **Exact DNS Changes to Make** — Prioritized, copy-pasteable blocks (`Name`, `Type`, `Value`, `TTL`, `Priority`) formatted for the user's active DNS provider UI.
3. **Unknowns & Dashboard Checks** — Anything that cannot be verified from public DNS alone and requires user confirmation:
   - Missing dashboard screenshots/tables (if not yet provided).
   - Provider control-panel toggles (e.g. confirming DKIM signing is toggled ON inside the mail provider dashboard).
   - Live email header test: sending a test message to a Gmail address $\to$ **Show original** (or [mail-tester.com](https://www.mail-tester.com)) to confirm `SPF: PASS`, `DKIM: PASS`, and `DMARC: PASS`.
4. **Deliverability & Launch Hygiene Notes** — Brief context-relevant tips (e.g. avoiding PDF attachments and tracking pixels on first-touch cold outreach to corporate firewalls like Mimecast/Proofpoint).
