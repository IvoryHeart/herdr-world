#!/usr/bin/python3
"""Test-only pin: still fetch the real HTTPS manifest with the real curl.

Automatic bootstrap has no version flag. Redirect only its exact latest URL
to the requested official version. Never substitute an archive or checksum.
"""
import json
import os
import sys

with open('/artifacts/config.json', encoding='utf-8') as config_file:
    version = json.load(config_file)['core']
args = sys.argv[1:]
if version != 'latest':
    args = [f'https://releases.herdr.dev/core/{version}/manifest.json'
            if arg == 'https://releases.herdr.dev/core/latest.json' else arg
            for arg in args]
os.execv('/usr/bin/curl', ['curl', *args])
