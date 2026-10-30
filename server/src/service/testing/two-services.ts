import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  askThroughCli,
  browserSocket,
  login,
  startTestService,
  type TestService,
} from "./services";

/** Text only one service's own files may contain. */
export const MARKERS = { first: "first-7f3a", second: "second-9c2e" } as const;

type Name = keyof typeof MARKERS;

export type TwoServicesReport = {
  /** Each service's Web Push public key. */
  publicKeys: Record<Name, string | null>;
  /** The status of each service's login cookie on the other service. */
  crossCookieStatus: Record<Name, number>;
  /** Whether each service held its folder's lock while it ran. */
  lockedWhileRunning: Record<Name, boolean>;
};

function expectOk(response: Response, what: string) {
  if (!response.ok) throw new Error(`${what} failed with ${response.status}`);
}

/** Write every World-owned store of one service through its public surfaces. */
async function writeEveryStore(
  started: TestService,
  marker: string,
  password: string,
) {
  const cookie = await login(started.base, password);
  const json = { cookie, "content-type": "application/json" };
  expectOk(
    await fetch(`${started.base}/api/instance-settings`, {
      method: "PUT",
      headers: { ...json, "x-herdr-world-settings": "1" },
      body: JSON.stringify({ title_suffix: marker }),
    }),
    "naming the instance",
  );
  const socket = await browserSocket(started.base, cookie);
  try {
    await socket.call("world.board.patch", {
      ops: [
        {
          op: "note.put",
          note: {
            id: "note-1",
            text: `${marker} note`,
            color: "yellow",
            x: 10,
            y: 20,
          },
        },
      ],
    });
    const { profiles } = await socket.call("world.profiles.get");
    await socket.call("world.profiles.save", {
      profile: { ...profiles[0], name: `${marker} profile` },
    });
    const root = started.service.paths.root;
    await socket.call("connections.create", {
      profile: {
        id: marker,
        label: marker,
        type: "local",
        control_socket_path: join(root, "local-control.sock"),
        client_socket_path: join(root, "local-render.sock"),
        auto_connect: false,
      },
    });
  } finally {
    socket.close();
  }
  expectOk(await askThroughCli(started, `${marker} question?`), "asking");
  // Saving a source refreshes the enabled ones. GitHub's runs `gh`, which keeps
  // its own state under the process's home folder, so switch it off first.
  expectOk(
    await fetch(`${started.base}/api/world/sources/github`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ enabled: false }),
    }),
    "switching GitHub off",
  );
  expectOk(
    await fetch(`${started.base}/api/world/sources/jira`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ token: `${marker}-jira-token` }),
    }),
    "saving the Jira token",
  );
  const push = await fetch(`${started.base}/api/notifications/push`, {
    headers: { cookie },
  });
  return {
    cookie,
    publicKey: ((await push.json()) as { publicKey: string | null }).publicKey,
  };
}

/**
 * Run two services in this process, each with its own folder below `top`,
 * write every store of both, and stop them.
 */
export async function runTwoServices(top: string): Promise<TwoServicesReport> {
  const passwords = {
    first: "first-service-password",
    second: "second-service-password",
  };
  const first = await startTestService(join(top, "first"), {
    password: passwords.first,
  });
  const second = await startTestService(join(top, "second"), {
    password: passwords.second,
  }).catch(async (error) => {
    await first.service.stop();
    throw error;
  });
  try {
    await Promise.all([first.connected, second.connected]);
    const wroteFirst = await writeEveryStore(
      first,
      MARKERS.first,
      passwords.first,
    );
    const wroteSecond = await writeEveryStore(
      second,
      MARKERS.second,
      passwords.second,
    );
    const status = async (started: TestService, cookie: string) =>
      (await fetch(`${started.base}/api/health`, { headers: { cookie } }))
        .status;
    return {
      publicKeys: {
        first: wroteFirst.publicKey,
        second: wroteSecond.publicKey,
      },
      crossCookieStatus: {
        first: await status(second, wroteFirst.cookie),
        second: await status(first, wroteSecond.cookie),
      },
      lockedWhileRunning: {
        first: existsSync(join(top, "first", "instance.lock")),
        second: existsSync(join(top, "second", "instance.lock")),
      },
    };
  } finally {
    await Promise.all([first.service.stop(), second.service.stop()]);
  }
}
