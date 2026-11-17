import {
  createHerdrControlPorts,
  createTuiPassThrough,
  type TuiControlClient,
} from "../herdr-runtime";

/** Keep native-traffic characterizations while consumers use the runtime ports. */
export function herdrRuntimeFixture<Client extends TuiControlClient>(
  herdr: Client,
) {
  return {
    herdr,
    tui: createTuiPassThrough("herdr", herdr),
    ...createHerdrControlPorts(herdr),
  };
}
