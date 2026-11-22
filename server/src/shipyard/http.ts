import { shipyardRepository } from "../../../shared/shipyard";
import { handleWorldCliEndpoint } from "../http/world-cli-endpoint";
import type { ShipyardService } from "./service";
import { record } from "./parse";

export const SHIPYARD_PATH = "/api/world/shipyard";
export const SHIPYARD_CLI_PATH = `${SHIPYARD_PATH}/cli`;

export function createShipyardHttp(service: ShipyardService) {
  return async (
    request: Request,
    pathname: string,
  ): Promise<Response | null> => {
    if (pathname !== SHIPYARD_PATH && !pathname.startsWith(`${SHIPYARD_PATH}/`))
      return null;
    const refresh = pathname === `${SHIPYARD_PATH}/refresh`;
    if (pathname !== SHIPYARD_PATH && !refresh)
      return json(
        {
          error:
            "Unknown Shipyard call; releases and deployments are read-only.",
        },
        404,
      );
    const method = refresh ? "POST" : "GET";
    if (request.method !== method)
      return new Response("method not allowed", {
        status: 405,
        headers: { allow: method },
      });
    if (request.body !== null)
      return json(
        { error: "Shipyard refresh takes a repo query parameter and no body" },
        400,
      );
    const params = new URL(request.url).searchParams;
    if (
      [...params.keys()].some((key) => key !== "repo") ||
      params.getAll("repo").length > 1
    )
      return json({ error: "Shipyard takes one repo parameter" }, 400);
    if (!params.has("repo") && !refresh) return json(await service.catalog());
    let repo: string;
    try {
      repo = shipyardRepository(params.get("repo"));
    } catch {
      return json(
        { error: "Repository must be a github.com owner/repository name" },
        400,
      );
    }
    return json(await service.snapshot(repo, refresh));
  };
}

/** Same loopback/no-Origin/token boundary as the existing agent CLI. */
export function handleShipyardCli(
  request: Request,
  peer: { address: string; port: number } | null,
  deps: {
    serverPort: number;
    bearerAuth(req: Request, ip: string): true | Response | null;
    service: ShipyardService;
  },
): Promise<Response> {
  return handleWorldCliEndpoint(request, peer, {
    ...deps,
    handle: async (value) => {
      const body = record(value),
        params = record(body.params);
      if (
        (body.params !== undefined &&
          (body.params === null ||
            typeof body.params !== "object" ||
            Array.isArray(body.params))) ||
        Object.keys(body).some((key) => !["command", "params"].includes(key)) ||
        !["list", "show"].includes(String(body.command)) ||
        Object.keys(params).some((key) => !["repo", "refresh"].includes(key)) ||
        (params.refresh !== undefined && typeof params.refresh !== "boolean") ||
        (body.command === "list" && Object.keys(params).length > 0)
      )
        return {
          ok: false,
          code: "usage",
          error:
            "Shipyard supports list or show with repo and optional refresh only",
        };
      const actor = { label: "local Shipyard CLI", verified: false };
      if (body.command === "list")
        return { ok: true, actor, result: await deps.service.catalog() };
      let repo: string;
      try {
        repo = shipyardRepository(params.repo);
      } catch {
        return {
          ok: false,
          code: "usage",
          error: "Repository must be a github.com owner/repository name",
        };
      }
      return {
        ok: true,
        actor,
        result: await deps.service.snapshot(repo, params.refresh === true),
      };
    },
  });
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
