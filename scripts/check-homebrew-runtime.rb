# Native acceptance for the installed Homebrew launcher, outside brew's sandbox.
# macOS uses the real signed release and a live core socket; Linux serves a
# fake release and logs starts. Run twice with the same isolated HOME, across
# `brew reinstall`: missing core installs/starts once, existing core stays
# unchanged and stopped. Use a short HOME (mktemp -d /tmp/hw.XXXXXX) so macOS's
# 103-byte socket limit is respected. Any real core started here is stopped.
require "digest"
require "fileutils"
require "json"
require "socket"
require "thread"
require "timeout"

world, fixture_home = ARGV
abort "usage: check-homebrew-runtime.rb WORLD FIXTURE_HOME" unless world && fixture_home
world = File.expand_path(world)
fixture_home = File.expand_path(fixture_home)
FileUtils.mkdir_p(fixture_home)
CORE_VERSION = "0.1.21"
macos = RUBY_PLATFORM.include?("darwin")
runtime_dir = File.join(fixture_home, ".local", "bin")
fake_bin = File.join(fixture_home, "fake-bin")
assets = File.join(fixture_home, "fake-release")
core_log = File.join(fixture_home, "core.log")
core = File.join(runtime_dir, "herdr-core")

unless macos || File.exist?(File.join(assets, "latest.json"))
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
  targets = %w[linux-x86_64 linux-aarch64]
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

def core_running?(lock)
  return false unless File.file?(lock)
  UNIXSocket.open(File.read(lock).strip, &:close)
  true
rescue Errno::ENOENT, Errno::ECONNREFUSED
  false
end

lock = File.join(fixture_home, ".local", "state", "herdr-core", "default", "core.lock")
raise "Fixture core must be stopped before this check" if macos && core_running?(lock)
before = Digest::SHA256.file(core).hexdigest if File.exist?(core)
starts_before = File.exist?(core_log) ? File.readlines(core_log).grep(/server start/).size : 0
log = File.join(fixture_home, "world.log")
port = TCPServer.open("127.0.0.1", 0) { |socket| socket.addr[1] }
environment = {
  "HOME" => fixture_home,
  "XDG_CONFIG_HOME" => File.join(fixture_home, ".config"),
  "XDG_DATA_HOME" => File.join(fixture_home, ".local", "share"),
  "XDG_STATE_HOME" => File.join(fixture_home, ".local", "state"),
  # No fake curl or service tools on macOS: exercise Apple's real verification.
  "PATH" => "#{macos ? runtime_dir : "#{fake_bin}:#{runtime_dir}"}:/usr/bin:/bin:/usr/sbin:/sbin",
  "HERDR_INSTALL_DIR" => runtime_dir,
  "HC_FIXTURE_LOG" => core_log,
  "HC_INSTALL_DIR" => nil, "HC_SESSION" => nil,
  "HERDR_BIN_PATH" => nil, "HERDR_SSH_HOST" => nil,
  "HERDR_SOCKET_PATH" => nil, "HERDR_CLIENT_SOCKET_PATH" => nil,
  "HERDR_SESSION" => nil, "HERDR_WORLD_SKIP_HERDR" => nil,
  "OPEN_BROWSER" => "0",
}
read, write = IO.pipe
pid = Process.spawn(environment, world, "--host", "127.0.0.1", "--port", port.to_s,
                    out: write, err: write, pgroup: true, chdir: fixture_home)
write.close
# Block on the listener's startup event, while retaining diagnostics. Avoid a
# readiness probe loop during a potentially slow signed-release download.
ready = Queue.new
reader = Thread.new do
  File.open(log, "w") do |output|
    output.sync = true
    read.each_line do |line|
      output.write(line)
      # World may display the loopback listener as localhost (including 0.3.5).
      ready << :listening if line.match?(/listening url=http:\/\/(?:127\.0\.0\.1|localhost):#{port}(?:\s|$)/)
    end
  end
  ready << :exited
end
begin
  Timeout.timeout(900) do
    raise "World exited before listening" unless ready.pop == :listening
  end
  TCPSocket.open("127.0.0.1", port, &:close)
  raise "Missing herdr-core was not installed" unless File.executable?(core)
  if macos
    system("/usr/bin/codesign", "--verify", "--strict", "-R",
           '=anchor apple generic and certificate leaf[subject.OU] = "2W9652Q7QR"',
           core, exception: true)
  end
  version = IO.popen(environment, [core, "--version"], &:read)
  expected_version = macos ? /\Ahc \d+\.\d+\.\d+[^\s]*\z/ : /\Ahc #{Regexp.escape(CORE_VERSION)}\z/
  raise "Installed herdr-core has an invalid version" unless $?.success? && expected_version.match?(version.strip)
  after = Digest::SHA256.file(core).hexdigest
  raise "Existing herdr-core changed" if before && before != after
  if macos
    starts = File.read(log).lines.count { |line| line.strip == "Starting herdr-core..." }
    raise "Unexpected core running state" unless core_running?(lock) == !before
    if !before && !File.read(log).include?("Checksum verified.")
      raise "Missing herdr-core was not downloaded and verified"
    end
  else
    starts = (File.exist?(core_log) ? File.readlines(core_log).grep(/server start/).size : 0) - starts_before
  end
  if before
    raise "Existing herdr-core was started again" unless starts.zero?
  else
    raise "Missing herdr-core was not started once" unless starts == 1
  end
  puts before ? "Existing herdr-core preserved" : "Missing herdr-core installed, verified and started"
rescue
  warn File.readlines(log).last(30).join if File.exist?(log)
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
  ensure
    if macos && File.executable?(core) && core_running?(lock)
      system(environment, core, "server", "stop", exception: true)
      raise "Fixture herdr-core did not stop" if core_running?(lock)
    end
    reader.join(5)
    reader.kill if reader.alive?
    read.close
  end
end
