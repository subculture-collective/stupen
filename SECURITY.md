# Security policy

## Reporting a vulnerability

Do not report vulnerabilities in public issues. Use GitHub's private reporting on this repository: Security → Report a vulnerability. Include the commit, what an attacker can do, how to reproduce it, and the deployment settings involved (sign-in proxy, `EDGE_SECRET`, sandbox, Docker).

## What is in scope

- Escaping the bubblewrap sandbox or a lesson container.
- Reaching the host, the LAN or the tailnet from a container, the egress proxy or the link fetcher.
- Reading or changing another user's data, or acting as another user.
- Reaching the app without the sign-in proxy when `EDGE_SECRET` is set.
- A preview frame reading the app or calling its API.

## Known limits

- Containers share the host kernel. They isolate learning projects; they are not a boundary for hostile multi-tenant code. Give access only to people you trust with the server.
- Anyone signed in can spend the server's Claude and ChatGPT subscriptions.
- The help limit is an instruction to a language model, not a security control.

## Secrets

Never commit `.env` files, tokens, keys or real learner data. `EDGE_SECRET` belongs in the service's environment file, not in this repository.
