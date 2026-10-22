# Agent skills

[![skills.sh](https://skills.sh/b/nelsutro/agent-skills)](https://skills.sh/nelsutro/agent-skills)

Three production-oriented skills for coding agents. Each skill is a folder with a `SKILL.md`, focused references, and runnable checks.

The repository root is the skills directory. GitHub: [Nelsutro/agent-skills](https://github.com/Nelsutro/agent-skills).

| Skill | Use it for |
| --- | --- |
| [`web-i18n`](web-i18n/SKILL.md) | Internationalizing web apps: ICU messages, plurals, RTL, locale routing, SEO, translation workflow, hardcoded-string and catalog checks. |
| [`saas-authz`](saas-authz/SKILL.md) | Multi-tenant authorization: tenant isolation, RBAC/ABAC, object-level checks, Postgres RLS, Prisma/Drizzle/Supabase scoping, IDOR prevention. |
| [`web-forms`](web-forms/SKILL.md) | Production forms: server-authoritative validation, shared schemas, accessible errors, pending and idempotent submits, uploads, and schema/form drift checks. |

Live on skills.sh: [web-i18n](https://skills.sh/nelsutro/agent-skills/web-i18n) · [saas-authz](https://skills.sh/nelsutro/agent-skills/saas-authz) · [web-forms](https://skills.sh/nelsutro/agent-skills/web-forms)

## Install

With the [skills CLI](https://skills.sh) (Node 22.20+):

```bash
npx skills add nelsutro/agent-skills --skill web-i18n
npx skills add nelsutro/agent-skills --skill saas-authz
npx skills add nelsutro/agent-skills --skill web-forms
```

Install every skill in the repository:

```bash
npx skills add nelsutro/agent-skills
```

Or copy a skill directory into your agent's skills folder (for opencode, `~/.agents/skills/`):

```bash
cp -r saas-authz ~/.agents/skills/
```

Restart the agent after installing so it picks up the new skill.

## Use

Ask for a task that matches the skill, for example:

- "Review this checkout flow and internationalize it."
- "Audit these Prisma queries for cross-tenant access."
- "Add RLS to these migrations and write the negative tests."
- "Make this checkout form accessible and idempotent."

The agent loads `SKILL.md` and reads only the references it needs.

## Checks

All skills ship scripts that work on any project:

```bash
node web-i18n/scripts/scan-hardcoded.mjs src
node web-i18n/scripts/check-locales.mjs locales --base en
node saas-authz/scripts/scan-tenant-scope.mjs src
node saas-authz/scripts/check-rls.mjs db/migrations
node web-forms/scripts/scan-forms.mjs src
node web-forms/scripts/check-form-schema.mjs --schema src/schema.ts --form src/CheckoutForm.tsx
```

All scripts support `--json`. Scanners and schema checks accept `--fail-on` (or `--fail-on-match`) for CI gating. The repository tests exercise every script against seeded before/after fixtures:

```bash
npm test
```

```
web-i18n    20/20 checks passed
saas-authz  21/21 checks passed
web-forms   33/33 checks passed
```

## Repository layout

```
web-i18n/
  SKILL.md
  references/
  scripts/
saas-authz/
  SKILL.md
  references/
  scripts/
web-forms/
  SKILL.md
  references/
  scripts/
examples/
  ...fixtures and end-to-end tests
```

Skills follow the [Agent Skills](https://skills.sh) convention: a `<name>/SKILL.md` file with YAML frontmatter (`name`, `description`). The directory name matches the skill name.

## Publishing and skills.sh

skills.sh indexes public GitHub repositories automatically; there is no submission form.

1. Push this repository to a public GitHub repo.
2. Add topics such as `agent-skills`, `claude-skills`, `ai-agents`.
3. Install one of the skills through the CLI so the install is counted:
   ```bash
   npx skills add nelsutro/agent-skills --skill saas-authz
   ```
4. The skill appears at `https://skills.sh/nelsutro/agent-skills/<skill>`. Rankings are driven by anonymous install telemetry.

Badge for the README:

```md
[![skills.sh](https://skills.sh/b/nelsutro/agent-skills)](https://skills.sh/nelsutro/agent-skills)
```

## License

MIT. See the `LICENSE` file in each skill.
