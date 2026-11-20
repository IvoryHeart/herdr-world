/** Pages that are one existing settings component each, loaded on first open. */

import { createElement } from "react";

export const speechPage = {
  load: () =>
    import("../../components/SpeechSettings").then((module) => ({
      default: module.SpeechSettings,
    })),
};

export const worldNamePage = {
  load: () =>
    import("../../components/InstanceNameSettings").then((module) => ({
      // Its only prop is a client for tests; a page passes none.
      default: () => createElement(module.InstanceNameSettings),
    })),
};

export const worktreeCommandPage = {
  load: () =>
    import("../../components/WorktreeCommandSettings").then((module) => ({
      default: module.WorktreeCommandSettings,
    })),
};

export const connectionPage = { load: () => import("./ConnectionPage") };
export const runtimePage = { load: () => import("./RuntimePage") };
export const integrationsPage = { load: () => import("./IntegrationsPage") };
