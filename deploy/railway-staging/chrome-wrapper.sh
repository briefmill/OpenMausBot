#!/bin/sh
set -eu
HOME=/data/.openmausbot/browser-home
export HOME
mkdir -p "$HOME"
exec /opt/openmausbot-browser/chrome "$@"
