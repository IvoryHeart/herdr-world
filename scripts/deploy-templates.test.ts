import { expect, test } from "bun:test";

test("renamed systemd template runs Herdr World and uses the Herdr World environment file", async () => {
  const unit = await Bun.file(
    new URL("../deploy/systemd/herdr-world.service", import.meta.url),
  ).text();
  expect(unit).toContain("Description=Herdr World");
  expect(unit).toContain("ExecStart=%h/.local/bin/herdr-world");
  expect(unit).toContain("EnvironmentFile=-%h/.config/herdr-world/herdr-world.env");
});

test("launchd template executes the installed Herdr World binary with Herdr World identities and state paths", async () => {
  const plist = await Bun.file(
    new URL("../deploy/launchd/dev.herdr.world.plist", import.meta.url),
  ).text();
  const installer = await Bun.file(
    new URL("./install-herdr-world.sh", import.meta.url),
  ).text();
  expect(installer).toContain('target="$install_dir/herdr-world"');
  expect(installer).toContain("HERDR_WORLD_INSTALL_DIR-$HOME/.local/bin");
  expect(plist).toContain('exec "$HOME/.local/bin/herdr-world"');
  expect(plist).not.toContain('exec "$HOME/.local/bin/herdr-gui"');
  expect(plist).toContain("<string>dev.herdr-world</string>");
  expect(plist).toContain("$HOME/.config/herdr-world/herdr-world.env");
  expect(plist).not.toContain("RESTART_SUPERVISOR");
  expect(plist).toContain("__HOME__/Library/Logs/herdr-world.stdout.log");
  expect(plist).toContain("__HOME__/Library/Logs/herdr-world.stderr.log");
});
