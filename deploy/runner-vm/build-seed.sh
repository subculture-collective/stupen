#!/bin/sh
# Build the cloud-init seed ISO for the runner VM.
#   build-seed.sh <ssh-public-key-file> <out.iso>
set -eu
here=$(dirname "$0")
key=$(cat "$1")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
sed "s|@SSH_PUBLIC_KEY@|$key|" "$here/user-data.template" > "$work/user-data"
printf 'instance-id: stupen-runner-1\nlocal-hostname: stupen-runner\n' > "$work/meta-data"
genisoimage -quiet -output "$2" -volid cidata -joliet -rock "$work/user-data" "$work/meta-data"
