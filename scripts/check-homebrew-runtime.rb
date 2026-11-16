# Native acceptance for the installed Homebrew launcher, outside brew's sandbox.
# Only a temporary World listener starts. With no runtime, the launcher installs
# the real herdr-core into the fixture HOME and starts it (this check stops it
# again); an existing runtime stays a separately owned, unchanged binary.
require "digest"
require "fileutils"
require "socket"
require "timeout"

world, fixture_home = ARGV
abort "usage: check-homebrew-runtime.rb WORLD FIXTURE_HOME" unless world && fixture_home
world = File.expand_path(world)
fixture_home = File.expand_path(fixture_home)
FileUtils.mkdir_p(fixture_home)
runtime_dir = File.join(fixture_home, ".local", "bin")
core = File.join(runtime_dir, "herdr-core")
before = Digest::SHA256.file(core).hexdigest if File.exist?(core)
log = File.join(fixture_home, "world.log")
port = TCPServer.open("127.0.0.1", 0) { |socket| socket.addr[1] }
environment = {
  "HOME" => fixture_home,
  "XDG_CONFIG_HOME" => File.join(fixture_home, ".config"),
  "XDG_DATA_HOME" => File.join(fixture_home, ".local", "share"),
  "PATH" => "#{runtime_dir}:/usr/bin:/bin:/usr/sbin:/sbin",
  "HERDR_INSTALL_DIR" => runtime_dir,
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
  version = IO.popen([core, "--version"], &:read)
  raise "Installed herdr-core is not runnable" unless $?.success? && version.match?(/^hc [0-9]+[.][0-9]+[.][0-9]+/)
  after = Digest::SHA256.file(core).hexdigest
  raise "Existing herdr-core changed" if before && before != after
  puts before ? "Existing herdr-core preserved" : "Missing herdr-core installed and executable"
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
  # Stop the core this check's first launch started; the runner is temporary.
  if !before && File.executable?(core)
    system(environment, core, "server", "stop", out: File::NULL, err: File::NULL)
  end
end
