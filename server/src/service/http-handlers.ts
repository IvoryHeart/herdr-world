import { authTokenPrintCommand } from "../config/auth-token";
import type { ServerConfig } from "../config/server-config";
import { createAuthHandlers } from "../http/auth";
import { createUpdateHandlers } from "../http/update";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";

/** Configure the listener's authentication and update handlers for one service. */
export function createServiceHttpHandlers(
  config: ServerConfig,
  sessionSecret: string,
  scheduleProcessExit: () => void,
) {
  const auth = createAuthHandlers({
    authRequired: config.authRequired,
    password: config.password,
    pin: config.pin,
    sessionSecret,
    urlLoginToken: config.generatedAuthToken,
    tokenCommand:
      config.generatedAuthTokenPath &&
      authTokenPrintCommand(config.generatedAuthTokenPath),
    secureCookies: Boolean(config.tls),
  });
  const update = createUpdateHandlers({
    appVersion: config.appVersion,
    runProcessWithCodeTimeout,
    shQuote,
    scheduleProcessExit,
  });
  return { auth, update };
}
