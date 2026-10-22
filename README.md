# Agent skills

Two production-oriented skills for coding agents. Each skill is a folder with a `SKILL.md`, focused references, and runnable checks.

| Skill | Use it for |
| --- | --- |
| [`web-i18n`](skills/web-i18n/SKILL.md) | Internationalizing web apps: ICU messages, plurals, RTL, locale routing, SEO, translation workflow, hardcoded-string and catalog checks. |
| [`saas-authz`](skills/saas-authz/SKILL.md) | Multi-tenant authorization: tenant isolation, RBAC/ABAC, object-level checks, Postgres RLS, Prisma/Drizzle/Supabase scoping, IDOR prevention. |

## Install

With the [skills CLI](https://skills.sh) (Node 22.20+):

```bash
npx skills add Nelsutro/agent-skills --skill web-i18n
npx skills add Nelsutro/agent-skills --skill saas-authz
```

Install every skill in the repository:

```bash
npx skills add Nelsutro/agent-skills
```

Or copy a skill directory into your agent's skills folder (for opencode, `~/.agents/skills/`):

```bash
cp -r skills/saas-authz ~/.agents/skills/
```

Restart the agent after installing so it picks up the new skill.

## Use

Ask for a task that matches the skill, for example:

- "Review this checkout flow and internationalize it."
- "Audit these Prisma queries for cross-tenant access."
- "Add RLS to these migrations and write the negative tests."

The agent loads `SKILL.md` and reads only the references it needs.

## Checks

Both skills ship scripts that work on any project:

```bash
node skills/web-i18n/scripts/scan-hardcoded.mjs src
node skills/web-i18n/scripts/check-locales.mjs locales --base en
node skills/saas-authz/scripts/scan-tenant-scope.mjs src
node skills/saas-authz/scripts/check-rls.mjs db/migrations
```

All scripts support `--json` and exit non-zero on errors. The repository tests exercise every script against seeded before/after fixtures:

```bash
npm test
```

```
web-i18n    20/20 checks passed
saas-authz  19/19 checks passed
```

## Repository layout

```
skills/
  web-i18n/
    SKILL.md
    references/
    scripts/
  saas-authz/
    SKILL.md
    references/
    scripts/
examples/
  ...fixtures and end-to-end tests
```

Skills follow the [Agent Skills](https://skills.sh) convention: a `skills/<name>/SKILL.md` file with YAML frontmatter (`name`, `description`). The directory name matches the skill name.

## Publishing and skills.sh

skills.sh indexes public GitHub repositories automatically; there is no submission form.

1. Push this repository to a public GitHub repo.
2. Add topics such as `agent-skills`, `claude-skills`, `ai-agents`.
3. Install one of the skills through the CLI so the install is counted:
   ```bash
   npx skills add Nelsutro/agent-skills --skill saas-authz
   ```
4. The skill appears at `https://skills.sh/Nelsutro/agent-skills/<skill>`. Rankings are driven by anonymous install telemetry.

Badge for the README:

```md
[![skills.sh](https://skills.sh/b/Nelsutro/agent-skills)](https://skills.sh/Nelsutro/agent-skills)
```

## License

MIT. See the `LICENSE` file in each skill.
