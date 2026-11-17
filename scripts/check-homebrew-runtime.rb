# Native acceptance for the installed Homebrew launcher, outside brew's sandbox.
# Only a temporary World listener starts. Nothing real is downloaded, installed
# or started: a fake `curl` first on an isolated PATH serves a fake herdr-core
# release from the fixture, the fake core only logs `server start`, and the
# login entry lands in the fixture HOME. With no runtime, the launcher must run
# its real install steps (manifest, SHA-256, unpack, `--version`) on that fake
# release and start it once; on a later launch the existing core must stay a
# separately owned, unchanged binary that is not started again.
require "digest"
require "fileutils"
require "json"
require "socket"
require "timeout"

world, fixture_home = ARGV
abort "usage: check-homebrew-runtime.rb WORLD FIXTURE_HOME" unless world && fixture_home
world = File.expand_path(world)
fixture_home = File.expand_path(fixture_home)
FileUtils.mkdir_p(fixture_home)
CORE_VERSION = "0.1.21"
runtime_dir = File.join(fixture_home, ".local", "bin")
fake_bin = File.join(fixture_home, "fake-bin")
assets = File.join(fixture_home, "fake-release")
core_log = File.join(fixture_home, "core.log")
core = File.join(runtime_dir, "herdr-core")

unless File.exist?(File.join(assets, "latest.json"))
  stage = File.join(assets, "stage")
  FileUtils.mkdir_p([stage, fake_bin])
  File.write(File.join(stage, "herdr-core"), <<~SH)
    #!/bin/sh
    case "${1:-}" in
      --version) echo 'hc #{CORE_VERSION}' ;;
      server) echo "core server ${2:-} session=${HC_SESSION:-}" >> "$HC_FIXTURE_LOG" ;;
      *) exit 2 ;;
    esac
  SH
  File.chmod(0o755, File.join(stage, "herdr-core"))
  archive = File.join(assets, "herdr-core.tar.gz")
  system({ "COPYFILE_DISABLE" => "1" }, "tar", "-czf", archive, "-C", stage, "herdr-core",
         exception: true)
  url = "https://releases.herdr.dev/core/#{CORE_VERSION}/herdr-core.tar.gz"
  build = { "url" => url, "sha256" => Digest::SHA256.file(archive).hexdigest }
  targets = %w[linux-x86_64 linux-aarch64 macos-x86_64 macos-aarch64]
  File.write(File.join(assets, "latest.json"),
             JSON.pretty_generate("version" => CORE_VERSION,
                                  "targets" => targets.to_h { |target| [target, build] }))
  # Serves only core's release host, by file name, from the fixture.
  File.write(File.join(fake_bin, "curl"), <<~SH)
    #!/bin/sh
    url=""; out=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -o) out="$2"; shift ;;
        https://releases.herdr.dev/core/*) url="$1" ;;
      esac
      shift
    done
    [ -n "$url" ] && [ -n "$out" ] || exit 22
    cp "#{assets}/${url##*/}" "$out" || exit 22
  SH
  # Never enables a real login unit, even where systemd exists.
  File.write(File.join(fake_bin, "systemctl"), "#!/bin/sh\nexit 1\n")
  File.chmod(0o755, File.join(fake_bin, "curl"), File.join(fake_bin, "systemctl"))
end

before = Digest::SHA256.file(core).hexdigest if File.exist?(core)
starts_before = File.exist?(core_log) ? File.readlines(core_log).grep(/server start/).size : 0
log = File.join(fixture_home, "world.log")
port = TCPServer.open("127.0.0.1", 0) { |socket| socket.addr[1] }
environment = {
  "HOME" => fixture_home,
  "XDG_CONFIG_HOME" => File.join(fixture_home, ".config"),
  "XDG_DATA_HOME" => File.join(fixture_home, ".local", "share"),
  "XDG_STATE_HOME" => File.join(fixture_home, ".local", "state"),
  "PATH" => "#{fake_bin}:#{runtime_dir}:/usr/bin:/bin:/usr/sbin:/sbin",
  "HERDR_INSTALL_DIR" => runtime_dir,
  "HC_FIXTURE_LOG" => core_log,
  "HC_INSTALL_DIR" => nil, "HC_SESSION" => nil,
  "HERDR_BIN_PATH" => nil, "HERDR_SSH_HOST" => nil,
  "HERDR_SOCKET_PATH" => nil, "HERDR_CLIENT_SOCKET_PATH" => nil,
  "HERDR_SESSION" => nil, "HERDR_WORLD_SKIP_HERDR" => nil,
  "OPEN_BROWSER" => "0",
}
pid = Process.spawn(environment, world, "--host", "127.0.0.1", "--port", port.to_s,
                    out: log, err: log, pgroup: true, chdir: fixture_home)
begin
  Timeout.timeout(180) do
    loop do
      raise "World exited before listening" if Process.waitpid(pid, Process::WNOHANG)
      begin
        TCPSocket.open("127.0.0.1", port, &:close)
        break
      rescue Errno::ECONNREFUSED
        sleep 0.1
      end
    end
  end
  raise "Missing herdr-core was not installed" unless File.executable?(core)
  version = IO.popen(environment, [core, "--version"], &:read)
  raise "Installed herdr-core is not the fixture's" unless $?.success? && version.strip == "hc #{CORE_VERSION}"
  after = Digest::SHA256.file(core).hexdigest
  raise "Existing herdr-core changed" if before && before != after
  starts = File.exist?(core_log) ? File.readlines(core_log).grep(/server start/).size : 0
  if before
    raise "Existing herdr-core was started again" unless starts == starts_before
  else
    raise "Missing herdr-core was not started once" unless starts == starts_before + 1
  end
  puts before ? "Existing herdr-core preserved" : "Missing herdr-core installed, verified and started"
rescue
  warn File.readlines(log).last(30).join
  raise
ensure
  begin
    Process.kill("TERM", -pid)
    Timeout.timeout(5) { Process.waitpid(pid) }
  rescue Timeout::Error
    Process.kill("KILL", -pid)
    Process.waitpid(pid)
  rescue Errno::ESRCH, Errno::ECHILD
    # The failed child may already have been reaped.
  end
end
