import { expect, test } from "bun:test";
import { ideBlockedPath } from "./providers";
import {
  IDE_FRAME_POLICY,
  type IdeUpstream,
  ideResponseHeaders,
  parseIdeRoute,
  scopeIdeCookie,
  scopeIdeLocation,
  upstreamPath,
  upstreamRequestHeaders,
} from "./proxy";

const ID = "AbCdEfGhIjKlMnOpQrStUv";
const vscode: IdeUpstream = {
  instanceId: ID,
  provider: "vscode",
  socketPath: "/tmp/ide.sock",
  token: "secret-token",
  stripsBasePath: false,
};
const codeServer: IdeUpstream = {
  ...vscode,
  provider: "code-server",
  token: null,
  stripsBasePath: true,
};
const page = new URL(`http://world.example:8080/ide/${ID}/`);

test("only well-formed instance routes parse", () => {
  expect(parseIdeRoute(`/ide/${ID}`)).toEqual({ instanceId: ID, rest: "" });
  expect(parseIdeRoute(`/ide/${ID}/static/a.js`)).toEqual({
    instanceId: ID,
    rest: "/static/a.js",
  });
  expect(parseIdeRoute("/ide/short/")).toBeNull();
  expect(parseIdeRoute(`/ide/${ID}..%2F/`)).toBeNull();
  expect(parseIdeRoute("/api/ide/x")).toBeNull();
});

test("World's cookies and credentials never reach the IDE; the token is added", () => {
  const headers = upstreamRequestHeaders(
    new Headers({
      cookie: `herdr_world_session=owner; vscode-tkn=forged; vscode-secret-key-path=/ide/${ID}/mint; code-server-session=s`,
      authorization: "Bearer owner",
      "x-forwarded-for": "198.51.100.7",
      host: "world.example:8080",
      accept: "text/html",
    }),
    vscode,
  );
  expect(headers.get("cookie")).toBe(
    `vscode-secret-key-path=/ide/${ID}/mint; code-server-session=s; vscode-tkn=secret-token`,
  );
  expect(headers.get("authorization")).toBeNull();
  expect(headers.get("x-forwarded-for")).toBeNull();
  expect(headers.get("host")).toBe("world.example:8080");
  expect(headers.get("accept")).toBe("text/html");
  expect(
    upstreamRequestHeaders(
      new Headers({ cookie: "vscode-tkn=forged" }),
      codeServer,
    ).get("cookie"),
  ).toBeNull();
});

test("IDE cookies are pinned to the instance route; the token and foreign cookies are dropped", () => {
  expect(scopeIdeCookie("vscode-tkn=secret; Path=/", ID)).toBeNull();
  expect(scopeIdeCookie("herdr_world_session=x; Path=/", ID)).toBeNull();
  expect(
    scopeIdeCookie(
      "vscode-cli-secret-half=h; HttpOnly; Path=/; Domain=world.example",
      ID,
    ),
  ).toBe(`vscode-cli-secret-half=h; HttpOnly; Path=/ide/${ID}`);
});

test("redirects stay inside the instance route", () => {
  expect(scopeIdeLocation(`/ide/${ID}/?folder=x`, vscode, page)).toBe(
    `/ide/${ID}/?folder=x`,
  );
  expect(scopeIdeLocation("/", vscode, page)).toBeNull();
  expect(
    scopeIdeLocation("https://elsewhere.example/", vscode, page),
  ).toBeNull();
  expect(scopeIdeLocation(`/ide/${ID}x/`, vscode, page)).toBeNull();
  // code-server answers at its root: World puts the route back.
  expect(scopeIdeLocation("./login", codeServer, page)).toBe(
    `/ide/${ID}/login`,
  );
  expect(scopeIdeLocation("/healthz", codeServer, page)).toBe(
    `/ide/${ID}/healthz`,
  );
  expect(upstreamPath(codeServer, `/ide/${ID}/static/x.js`)).toBe(
    "/static/x.js",
  );
  expect(upstreamPath(codeServer, `/ide/${ID}`)).toBe("/");
  expect(upstreamPath(vscode, `/ide/${ID}/x`)).toBe(`/ide/${ID}/x`);
});

test("responses lose service-worker widening and get a private cache policy", () => {
  const upstream = new Headers({
    "service-worker-allowed": "/",
    "content-type": "text/html",
  });
  upstream.append("set-cookie", "vscode-tkn=secret; Path=/");
  upstream.append("set-cookie", "vscode-secret-key-path=k; Path=/");
  const headers = ideResponseHeaders(upstream, vscode, page)!;
  expect(headers.get("service-worker-allowed")).toBeNull();
  expect(headers.getSetCookie()).toEqual([
    `vscode-secret-key-path=k; Path=/ide/${ID}`,
  ]);
  expect(headers.get("cache-control")).toBe("private, no-cache");
  expect(headers.get("content-security-policy")).toBe(IDE_FRAME_POLICY);
  // The IDE's own policy stays; World's frame policy is a second one, and
  // the browser enforces both.
  const framed = ideResponseHeaders(
    new Headers({
      "content-security-policy": "frame-src 'self' https://*.vscode-cdn.net",
    }),
    vscode,
    page,
  )!;
  expect(framed.get("content-security-policy")).toBe(
    `frame-src 'self' https://*.vscode-cdn.net, ${IDE_FRAME_POLICY}`,
  );
  expect(
    ideResponseHeaders(
      new Headers({ location: "https://elsewhere.example/" }),
      vscode,
      page,
    ),
  ).toBeNull();
});

test("code-server's port proxies are never forwarded, however the path is spelled", () => {
  for (const rest of [
    "/proxy/3000/",
    "/absproxy/3000/x",
    "/proxy",
    "/PROXY/3000",
    "//proxy/3000",
    "/%70roxy/3000",
    "/%2Fabsproxy/3000",
    "/%E0%A4%A",
  ])
    expect(ideBlockedPath("code-server", rest)).toBe(true);
  for (const rest of ["/", "/static/proxy/x", "/proxyish", ""])
    expect(ideBlockedPath("code-server", rest)).toBe(false);
  // VS Code's own server has no port proxy; its paths pass as they are.
  expect(ideBlockedPath("vscode", "/proxy/3000/")).toBe(false);
});
