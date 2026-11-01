import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GroupEditFeedback } from "./GroupEditFeedback";

test("a whole-Board conflict identifies the Board while retaining this Group's current values and explicit review", () => {
  const html = renderToStaticMarkup(
    <GroupEditFeedback
      changed
      error={null}
      current="Current roles for reviewer: reviewer."
      onReview={() => {}}
    />,
  );
  expect(html).toContain("The Board changed while this form was open");
  expect(html).not.toContain("The Group changed");
  expect(html).toContain("Current roles for reviewer: reviewer.");
  expect(html).toContain("Use current version");
});
