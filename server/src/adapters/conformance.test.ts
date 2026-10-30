import { adapterConformance } from "./testing/conformance";
import { herdrFixture, syntheticFixture } from "./testing/fixtures";

adapterConformance("Herdr", herdrFixture);
adapterConformance("Synthetic", syntheticFixture);
