import type { Scheduler } from "../service/ports";
import type { RunProcess } from "../sources/github";
import { createShipyardHttp } from "./http";
import { shipyardInstanceIdentity } from "./identity";
import { ShipyardInstances } from "./instances";
import { ShipyardService, type ShipyardServiceOptions } from "./service";

/** World's Shipyard: release reads, this instance's self-report and its HTTP. */
export async function composeShipyard(options: {
  /** Private folder of local instance self-reports. */
  directory: string;
  dataRoot: string;
  incarnation: string;
  version: string;
  run: RunProcess;
  source: ShipyardServiceOptions["source"];
  now(): number;
  scheduler: Scheduler;
}) {
  const { now } = options;
  const instances = new ShipyardInstances(
    options.directory,
    options.dataRoot,
    now,
    options.scheduler,
  );
  const identity = await shipyardInstanceIdentity(
    options.incarnation,
    options.version,
    now(),
  );
  const service = new ShipyardService({
    run: options.run,
    source: options.source,
    instances: () => instances.read(),
    now,
  });
  return {
    service,
    http: createShipyardHttp(service),
    /** This instance's report id. */
    id: instances.id,
    /** Reports this instance once World is listening; `extra` adds fields. */
    start: (
      port: number,
      host: string,
      tls: boolean,
      extra?: () => Record<string, unknown>,
    ) => instances.start(identity, port, host, tls, extra),
    republish: () => instances.republish(),
    stop() {
      service.close();
      instances.stop();
    },
  };
}
