# World's runtime bootstrap for the standalone installer and Homebrew's first
# launch. herdr-core comes first: when neither herdr-core nor the Herdr TUI is
# installed, install herdr-core and start it now and at each login. An installed
# runtime is used as it is; nothing is replaced or updated. This runs the World
# binary's `herdr status` only, so it also works with older pinned releases.
# A status result is presence evidence only when its selected file is executable.
# Keep the running-server state independent of binary discovery.
check_herdr_presence() {
  herdr_status="$("$world" herdr status)" || return 1
  IFS= read -r herdr_status_line <<EOF || return 1
$herdr_status
EOF
  case "$herdr_status_line" in
    'Herdr is not installed.') herdr_missing=1 ;;
    'Herdr is running ('*) herdr_missing=0 ;;
    'Herdr is installed but not running: '*)
      herdr_candidate="${herdr_status_line#Herdr is installed but not running: }"
      if [ ! -f "$herdr_candidate" ] || [ ! -x "$herdr_candidate" ]; then
        printf 'Herdr installation blocked by non-executable entry: %s; repair it before retrying.\n' "$herdr_candidate" >&2
        return 1
      fi
      herdr_missing=0
      ;;
    *) return 1 ;;
  esac
}

# Save the core just installed as a World connection, so World connects to it
# when it starts. World reads core.lock and never starts core itself. This runs
# only without the Herdr TUI, so core is the default and World saves no Local
# Herdr profile. An older World, or one already serving, refuses; the person
# adds it in the UI instead.
herdr_core_register() {
  if "$world" connections add core-local --core --default --auto-connect --label 'herdr-core on this computer' >/dev/null 2>&1; then
    printf 'World will connect to herdr-core when it starts.\n'
  else
    printf 'If World does not list herdr-core, add it under Hosts > Manage connections.\n'
  fi
}

install_missing_runtime() (
  check_herdr_presence || return 1
  [ "$herdr_missing" = 1 ] || return 0
  if herdr_core_find >/dev/null; then return 0; fi
  herdr_core_setup || return 1
  herdr_core_register
)
