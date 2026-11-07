import { afterEach, expect, test } from "bun:test";
import {
  offerTownSummary,
  requestTownSummary,
  resetTownSummaryRequestForTest,
} from "./townSummaryRequest";

afterEach(resetTownSummaryRequestForTest);

test("a request made away from Town opens the summary once Town shows", () => {
  const opened: string[] = [];
  requestTownSummary();
  const stop = offerTownSummary(() => opened.push("town"));
  expect(opened).toEqual(["town"]);
  stop();
  // Answered once: Town showing again does not reopen it.
  offerTownSummary(() => opened.push("again"));
  expect(opened).toEqual(["town"]);
});

test("while Town shows, a request opens its summary at once", () => {
  const opened: number[] = [];
  const stop = offerTownSummary(() => opened.push(1));
  requestTownSummary();
  expect(opened).toEqual([1]);
  stop();
  // Town gone: the next request waits for it.
  requestTownSummary();
  expect(opened).toEqual([1]);
  offerTownSummary(() => opened.push(2));
  expect(opened).toEqual([1, 2]);
});

test("a stale Town's withdrawal leaves the newer offer", () => {
  const opened: string[] = [];
  const first = offerTownSummary(() => opened.push("first"));
  offerTownSummary(() => opened.push("second"));
  first();
  requestTownSummary();
  expect(opened).toEqual(["second"]);
});
