# Runner VM

Stupen runs learners' code here, not on the machine that holds accounts and
keys. The server sends a lesson's files to the runner agent (`server/agent.ts`)
in this VM and gets the results back. Set `RUNNER_URL` and `RUNNER_TOKEN` on
the server to use it; without them, code runs on the server itself.

## How it is isolated

- **No network of its own.** QEMU's user network runs with `restrict=on`, so
  the guest reaches neither the host, the LAN, the tailnet nor the internet.
  Three forwards exist: host loopback to guest SSH (22292) and to the agent
  (22291), and guest `10.0.2.100:3128` to the host's egress proxy.
- **One way out.** `stupen-egress.service` (`server/egress-proxy.ts` on host
  loopback) forwards HTTP and HTTPS on ports 80 and 443 to public addresses
  only and refuses loopback, private, link-local, CGNAT and Docker addresses
  at connect time. Package installs and image pulls go through it.
- **Containers in gVisor.** Docker's default runtime is `runsc`, inside the VM.
- **Nothing to steal.** The VM holds no accounts, API keys or other learners'
  files: each request carries one lesson's files, and package caches are keyed
  by an opaque hash. The agent requires a bearer token.

## Build it

On the host (Debian 13, KVM, `genisoimage`, `socat`):

```sh
D=/mnt/fast1/stupen-runner K=~/.local/state/stupen-runner
mkdir -p $D $K && ssh-keygen -t ed25519 -N "" -f $K/id_ed25519
deploy/runner-vm/build-seed.sh $K/id_ed25519.pub $D/seed.iso
qemu-img convert -O qcow2 debian-13-generic-amd64.qcow2 $D/runner.qcow2 && qemu-img resize $D/runner.qcow2 40G
cp deploy/runner-vm/stupen-egress.service deploy/runner-vm/stupen-runner-vm.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now stupen-egress stupen-runner-vm
```

Use the `generic` Debian image: cloud-init in it installs Docker, gVisor,
Node 24, bubblewrap and the compilers through the proxy, checking gVisor and
Node against their published checksums. Then copy a built release to
`/opt/stupen/releases/<rev>` in the guest, point `/opt/stupen/current` at it,
write `RUNNER_TOKEN=…` to `/etc/stupen/agent.env` (mode 600), install
`stupen-agent.service`, and run `scripts/setup-tools.ts` once with
`STUDY_TOOLS_DIR=/var/lib/stupen/tools` and the proxy variables set.

`stupen-egress.service` and the agent should run the same release as the
server, so the proxy's address rules and the agent's protocol match.

## Coding workspace practice capability

The workspace uses authenticated practice protocol v1 for TypeScript/JavaScript,
Python and Go. Deploy the compatible agent before the app, then check
`/v1/status.practice`: version 1 and all four runtime IDs must be present.
Python needs the existing tools venv; Go needs a sandboxed toolchain ≥1.24.
An unavailable/old agent disables practice without app-host execution fallback.
See [release checks and scoped recovery](../../docs/workspace-rollout.md).
