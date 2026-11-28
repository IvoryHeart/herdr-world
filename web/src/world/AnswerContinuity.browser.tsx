import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import AnswerContinuityFixture from "../testing/AnswerContinuityFixture";
import "../styles/tokens.css";
import "../styles/base.css";

const root = createRoot(document.getElementById("root")!);
let key = 0;
// Synchronous so each check starts on a fresh fixture, not the previous tree.
const render = () =>
  flushSync(() => root.render(<AnswerContinuityFixture key={++key} />));
render();
const frame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
async function until(ok: () => boolean) {
  for (let i = 0; i < 60 && !ok(); i++) await frame();
  return ok();
}
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent === label,
  );
const typed = (agent: string) =>
  document.querySelector(`[data-agent="${agent}"]`)?.textContent ?? "";
if (button("Restart World")) void fetch("/ready", { method: "POST" });

Object.assign(window, {
  /** Town › Reception › Outbox after a restart; returns failed checks. */
  async answerContinuityChecks() {
    render();
    const errors: string[] = [],
      check = (ok: boolean, message: string) => {
        if (!ok) errors.push(message);
      };
    check(
      await until(() => Boolean(button("Restart World"))),
      "Fixture did not render",
    );
    check(
      await until(() =>
        Boolean(document.querySelector(".town-reception-letter")),
      ),
      "Reception shows no Outbox letter before the restart",
    );
    check(
      document.querySelector(".town-reception-letter")?.textContent === "✉2",
      "Both saved answers wait before the restart",
    );
    button("Restart World")!.click();
    check(
      await until(() => typed("Atlas").startsWith("Atlas: 1 answer")),
      "The resumed original session was not sent its answer",
    );
    check(
      await until(
        () =>
          document.querySelector(".town-reception-letter")?.textContent ===
          "✉1",
      ),
      "Reception still counts the sent answer",
    );
    document
      .querySelector<HTMLButtonElement>(".town-reception-letter")!
      .click();
    check(
      await until(
        () => document.querySelectorAll(".answer-delivery").length === 1,
      ),
      "Outbox should hold only Beacon's answer",
    );
    const card = document.querySelector<HTMLElement>(".answer-delivery");
    const text = card?.textContent ?? "";
    check(
      card?.getAttribute("aria-label") === "Answer delivery to Beacon",
      "The remaining card is not Beacon's",
    );
    check(text.includes("Not sent"), "Beacon's answer is not Not sent");
    check(
      text.includes(
        "couldn't prove the agent that asked is still the same session",
      ),
      "The plain restart reason is missing",
    );
    check(
      text.includes("herdr-world ask get q-continuity-beacon"),
      "The full ask get command is missing",
    );
    check(
      Boolean(
        [...(card?.querySelectorAll("button") ?? [])].find(
          (entry) => entry.textContent === "Copy answer",
        ),
      ),
      "Copy answer is missing",
    );
    check(!button("Send again…"), "A refused answer offers Send again");
    check(typed("Atlas") === "Atlas: 1 answer · Sent", "Atlas is not Sent");
    check(typed("Beacon") === "Beacon: 0 answers", "Beacon was typed into");
    button("Check again")!.click();
    await frame();
    await frame();
    check(
      typed("Atlas") === "Atlas: 1 answer · Sent" &&
        typed("Beacon") === "Beacon: 0 answers",
      "A later check replayed input",
    );
    check(
      document.querySelectorAll(".answer-delivery").length === 1 &&
        (
          document.querySelector(".answer-delivery")?.textContent ?? ""
        ).includes("Not sent"),
      "A later check changed Beacon's refusal",
    );
    check(
      document.documentElement.scrollWidth <= innerWidth,
      `Page overflows ${innerWidth}px`,
    );
    return errors;
  },
});
