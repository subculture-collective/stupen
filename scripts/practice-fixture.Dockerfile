# Disposable verification environment; never used by the app or production runner.
FROM node:24-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap python3 python3-venv && rm -rf /var/lib/apt/lists/*
# Match deploy/runner-vm: /usr/local/bin/node is a symlink into /opt/node.
RUN mkdir -p /opt/node/bin && mv /usr/local/bin/node /opt/node/bin/node && ln -s /opt/node/bin/node /usr/local/bin/node
ENV STUDY_TOOLS_DIR=/opt/stupen-tools
RUN python3 -m venv /opt/stupen-tools/py
WORKDIR /workspace
