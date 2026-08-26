#!/usr/bin/env bash
set -euo pipefail

if rg -n --glob '*.{ts,tsx,js,mjs,rs}' \
  '(dynamic plugin|plugin marketplace|fleet database|central gateway|second multiplexer)' \
  web/src bridge/src vendor/herdr-compat/src; then
  echo "Herdr World core contains a prohibited control-plane or dynamic-loader implementation" >&2
  exit 1
fi

echo "Herdr World independence audit passed"
