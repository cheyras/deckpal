# Security Policy

## Reporting a vulnerability

DeckScout is a hobby project maintained by one person. If you find a security issue,
please report it privately:

- **Preferred:** [GitHub Security Advisory](https://github.com/cheyras/deckscout/security/advisories/new)
  on `cheyras/deckscout`.
- **Alternative:** Email cheyras@gmail.com with "DeckScout security" in the subject.

There is no bug bounty. I will respond on a best-effort basis — typically within a
few days. Please do not open a public issue for security vulnerabilities.

## Security model

DeckScout is designed as a **single-user, self-hosted** application. There is no
multi-tenancy and no in-app authorization. The security model assumes a trusted
reverse proxy sits in front of all services.

### What has no authentication

The **API server** (`apps/api`) and the **images server** (`apps/images`) have no
built-in authentication by design. They are intended to be accessed only through a
reverse proxy that handles auth (the reference deployment uses nginx + the SSO gate).

**Never expose the API or images servers directly to the internet.** Doing so makes
your entire collection readable and writable by anyone.

### What has authentication

The **MCP server** (`apps/mcp`) authenticates requests via the `x-brain-key` HTTP
header, validated against the `ROTOM_MCP_KEY` environment variable. Allowed client
hosts are configured via `MCP_ALLOWED_HOSTS` (comma-separated; defaults to
`127.0.0.1,localhost`).

### Network binding

All services bind to `127.0.0.1` by default. This is intentional — the reverse
proxy is the sole ingress point.

### Deployment requirements

If you self-host DeckScout:

1. Place a reverse proxy with authentication in front of the API and images servers.
2. Keep all services bound to `127.0.0.1`.
3. Set `ROTOM_MCP_KEY` to a strong random value if you use the MCP server.
4. Set `MCP_ALLOWED_HOSTS` to only the hosts that should reach the MCP server.
5. Never commit `.env` or other files containing credentials.
