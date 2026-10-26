# A published World binary may predate missing-only CLI support. Keep this Unix
# compatibility path independent of its upgrade command, with atomic publication.
install_missing_herdr() (
  status="$("$world" herdr status)" || return 1
  case "$status" in 'Herdr is not installed.'*) ;; *) return 0 ;; esac
  install_dir="${HERDR_INSTALL_DIR:-$HOME/.local/bin}"
  if [ -e "$install_dir/herdr" ] || [ -L "$install_dir/herdr" ]; then
    if [ -f "$install_dir/herdr" ] && [ -x "$install_dir/herdr" ]; then return 0; fi
    printf 'Herdr installation blocked by non-executable entry: %s; repair it before retrying.\n' "$install_dir/herdr" >&2
    return 1
  fi
  case "$(uname -s):$(uname -m)" in
    Linux:x86_64|Linux:amd64) target=linux-x86_64; expected=@HERDR_SHA_linux-x86_64@ ;;
    Linux:aarch64|Linux:arm64) target=linux-aarch64; expected=@HERDR_SHA_linux-aarch64@ ;;
    Darwin:x86_64|Darwin:amd64) target=macos-x86_64; expected=@HERDR_SHA_macos-x86_64@ ;;
    Darwin:arm64|Darwin:aarch64) target=macos-aarch64; expected=@HERDR_SHA_macos-aarch64@ ;;
    *) return 1 ;;
  esac
  mkdir -p "$install_dir" || return 1
  staging="$(mktemp -d "$install_dir/.herdr.XXXXXXXX")" || return 1
  trap 'rm -rf "$staging"' 0
  trap 'exit 1' HUP INT TERM
  curl -fsSL --proto '=https' --proto-redir '=https' --max-time 120 -o "$staging/herdr" "https://github.com/herdrdev/herdr/releases/download/v@HERDR_VERSION@/herdr-$target" || return 1
  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$staging/herdr" | awk '{print $1}')"
  else
    actual="$(sha256sum "$staging/herdr" | awk '{print $1}')"
  fi
  [ "$actual" = "$expected" ] || return 1
  chmod 755 "$staging/herdr" || return 1
  version="$("$staging/herdr" --version)" || return 1
  [ "$version" = 'herdr @HERDR_VERSION@' ] || return 1
  # Recheck every discovery path after download; publication below still refuses
  # an entry created at the destination after this check, including symlinks.
  status="$("$world" herdr status)" || return 1
  case "$status" in 'Herdr is not installed.'*) ;; *) return 0 ;; esac
  if ln "$staging/herdr" "$install_dir/" 2>/dev/null; then
    printf '%s\n' 'Installed Herdr @HERDR_VERSION@.'
  elif [ ! -f "$install_dir/herdr" ] || [ ! -x "$install_dir/herdr" ]; then
    printf 'Herdr installation blocked by non-executable entry: %s; repair it before retrying.\n' "$install_dir/herdr" >&2
    return 1
  fi
)
