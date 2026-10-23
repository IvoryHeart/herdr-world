import type { GuiSettings } from "../config/gui-settings";
import {
  SourceSettingsError,
  type JiraSettingsPatch,
  type SourcesService,
  type StoredSourceSettings,
} from "./service";

export const WORLD_SOURCES_PATH = "/api/world/sources";
export const WORLD_SOURCES_SETTINGS_KEY = "world_sources";

const MAX_BODY_BYTES = 8 * 1024;
const JIRA_FIELDS = ["enabled", "site", "email", "jql", "token"] as const;

/**
 * - `GET /api/world/sources`: statuses, items and links (bounded refresh).
 * - `POST /api/world/sources/refresh`: refresh now.
 * - `PUT /api/world/sources/github` `{enabled}`.
 * - `PUT /api/world/sources/jira` `{enabled?, site?, email?, jql?, token?}`;
 *   the token is write-only.
 */
export function createSourcesHttpHandler(service: SourcesService) {
  return async (request: Request, pathname: string) => {
    if (pathname === WORLD_SOURCES_PATH) {
      if (request.method !== "GET") return methodNotAllowed("GET");
      return jsonResponse(await service.snapshot());
    }
    if (pathname === `${WORLD_SOURCES_PATH}/refresh`) {
      if (request.method !== "POST") return methodNotAllowed("POST");
      return jsonResponse(await service.snapshot(true));
    }
    if (
      pathname === `${WORLD_SOURCES_PATH}/github` ||
      pathname === `${WORLD_SOURCES_PATH}/jira`
    ) {
      if (request.method !== "PUT") return methodNotAllowed("PUT");
      let body: Record<string, unknown>;
      try {
        body = await readBody(request);
      } catch (cause) {
        return jsonError(errorMessage(cause), 400);
      }
      try {
        if (pathname.endsWith("/github")) {
          const keys = Object.keys(body);
          if (
            !keys.length ||
            keys.some((key) => key !== "enabled" && key !== "mergedDays") ||
            (body.enabled !== undefined && typeof body.enabled !== "boolean") ||
            (body.mergedDays !== undefined &&
              typeof body.mergedDays !== "number")
          )
            return jsonError(
              "GitHub settings take enabled and mergedDays",
              400,
            );
          return jsonResponse(
            await service.configureGitHub({
              ...(body.enabled !== undefined
                ? { enabled: body.enabled as boolean }
                : {}),
              ...(body.mergedDays !== undefined
                ? { mergedDays: body.mergedDays as number }
                : {}),
            }),
          );
        }
        return jsonResponse(await service.configureJira(jiraPatch(body)));
      } catch (cause) {
        // Validation names the field; storage failures stay generic.
        return cause instanceof SourceSettingsError
          ? jsonError(cause.message, 400)
          : jsonError("Could not save source settings", 500);
      }
    }
    return null;
  };
}

function jiraPatch(body: Record<string, unknown>): JiraSettingsPatch {
  if (
    Object.keys(body).some(
      (key) => !(JIRA_FIELDS as readonly string[]).includes(key),
    )
  )
    throw new SourceSettingsError("Jira settings have unknown fields");
  if (body.enabled !== undefined && typeof body.enabled !== "boolean")
    throw new SourceSettingsError("Jira enabled must be true or false");
  for (const key of ["site", "email", "jql", "token"] as const)
    if (
      body[key] !== undefined &&
      body[key] !== null &&
      typeof body[key] !== "string"
    )
      throw new SourceSettingsError(`Jira ${key} must be text`);
  return body as JiraSettingsPatch;
}

export function storedSourceSettings(
  settings: Pick<GuiSettings, "custom">,
): StoredSourceSettings {
  const value = settings.custom[WORLD_SOURCES_SETTINGS_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const stored = value as Record<string, unknown>;
  const part = (key: string) => {
    const entry = stored[key];
    return entry && typeof entry === "object" && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)
      : undefined;
  };
  const github = part("github");
  const jira = part("jira");
  const text = (entry: unknown) => (typeof entry === "string" ? entry : null);
  return {
    ...(github ? { github: { enabled: github.enabled !== false } } : {}),
    ...(jira
      ? {
          jira: {
            enabled: jira.enabled !== false,
            site: text(jira.site),
            email: text(jira.email),
            jql: text(jira.jql),
          },
        }
      : {}),
  };
}

export function withSourceSettings(
  settings: GuiSettings,
  sources: StoredSourceSettings,
): GuiSettings {
  return {
    ...settings,
    custom: { ...settings.custom, [WORLD_SOURCES_SETTINGS_KEY]: sources },
  };
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    throw new Error("Source settings are too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
    throw new Error("Source settings are too large");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Source settings must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Source settings must be an object");
  return value as Record<string, unknown>;
}

function methodNotAllowed(allow: string) {
  return new Response("method not allowed", {
    status: 405,
    headers: { allow },
  });
}

function jsonError(error: string, status: number) {
  return jsonResponse({ error }, { status });
}

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  return Response.json(value, { ...init, headers });
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : "Invalid settings";
}
