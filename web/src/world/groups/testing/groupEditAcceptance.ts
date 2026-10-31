import { flushSync } from "react-dom";
import type { GroupOp } from "../../../../../shared/groupOps";
import type { BoardDocument } from "../../board/boardDocument";
import { sharedBoardStore } from "../../board/boardDocument";
import { worldRuntimeStore } from "../../runtimeStore";
import { openGroups } from "../groupActions";

/** Real forms and service Board conflicts, with only synthetic fixture data. */
export async function verifyGroupEdits(
  check: (value: unknown, message: string) => void,
  waitFor: (condition: () => unknown) => Promise<void>,
) {
  const click = (scope: ParentNode, text: string) => {
    const button = [
      ...scope.querySelectorAll<HTMLButtonElement>("button"),
    ].find((element) => element.textContent?.trim() === text);
    if (!button) throw new Error(`Missing Group edit control: ${text}`);
    flushSync(() => button.click());
  };
  const value = (
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    text: string,
  ) => {
    const prototype =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      text,
    );
    flushSync(() =>
      element.dispatchEvent(
        new Event(element instanceof HTMLSelectElement ? "change" : "input", {
          bubbles: true,
        }),
      ),
    );
  };
  const board = async (): Promise<BoardDocument> =>
    (await fetch("/board")).json();
  const compete = async (ops: GroupOp[]) => {
    await fetch("/compete", { method: "POST", body: JSON.stringify(ops) });
    await sharedBoardStore().refresh();
  };
  const open = async (id: string) => {
    // Changing the selected Group resets the previous form's local draft.
    flushSync(() => openGroups(`world:${id === "chat" ? "pair" : "chat"}`));
    await waitFor(() =>
      document
        .querySelector(".world-panel-title")
        ?.textContent?.includes(id === "chat" ? "Team · Review pair" : "Pod ·"),
    );
    flushSync(() => openGroups(`world:${id}`));
    await waitFor(() =>
      document
        .querySelector(".world-panel-title")
        ?.textContent?.includes(id === "chat" ? "Pod ·" : "Team · Review pair"),
    );
  };
  const submit = (form: HTMLFormElement) =>
    flushSync(() => form.requestSubmit());
  const addForm = () =>
    document.querySelector<HTMLFormElement>(".group-members .group-edit");
  check(addForm(), "a refused Add keeps its form open");

  await open("chat");
  click(document, "Edit pod…");
  await waitFor(() => document.querySelector(".group-detail > .group-edit"));
  const edit = document.querySelector<HTMLFormElement>(
    ".group-detail > .group-edit",
  )!;
  value(edit.querySelector("input")!, "Draft Chat");
  value(edit.querySelector("textarea")!, "Draft task\nShip draft");
  value(edit.querySelector('input[type="number"]')!, "7");
  await compete([
    {
      op: "group.set_attrs",
      id: "chat",
      name: "Chat remote",
      attrs: { queue: ["Remote task"], open_pr_limit: 4 },
    },
  ]);
  await fetch("/hold-write", { method: "POST" });
  submit(edit);
  check(edit.isConnected, "Edit stays open while its write is pending");
  await fetch("/release-write", { method: "POST" });
  await waitFor(
    () => !edit.isConnected || edit.querySelector('[role="alert"]'),
  );
  check(
    edit.isConnected &&
      edit.querySelector("input")?.value === "Draft Chat" &&
      edit.querySelector("textarea")?.value === "Draft task\nShip draft" &&
      edit.querySelector<HTMLInputElement>('input[type="number"]')?.value ===
        "7",
    "Edit conflict retains Name, Now and limit drafts",
  );
  if (edit.isConnected) {
    check(
      edit.querySelector('[role="alert"]'),
      "Edit shows its conflict inside the form",
    );
    check(
      edit.textContent?.includes("Chat remote") &&
        edit.textContent.includes("Remote task") &&
        edit.textContent.includes("Open-PR limit: 4"),
      "Edit exposes the current values for review without replacing the draft",
    );
    const before = (await board()).revision;
    click(edit, "Use current version");
    check(
      (await board()).revision === before,
      "reviewing current values never retries a write",
    );
    submit(edit);
    await waitFor(() => !edit.isConnected);
    const saved = (await board()).relations!.groups.find(
      (group) => group.id === "chat",
    )!;
    check(
      saved.name === "Draft Chat" &&
        saved.attrs?.open_pr_limit === 7 &&
        JSON.stringify(saved.attrs?.queue) ===
          JSON.stringify(["Draft task", "Ship draft"]),
      "explicit Edit resubmission saves the retained draft",
    );
  }
  await compete([
    {
      op: "group.set_attrs",
      id: "chat",
      name: "Chat",
      attrs: {
        queue: ["Review the fixes", "Ship the batch"],
        open_pr_limit: 2,
      },
    },
  ]);

  await open("chat");
  const member = [
    ...document.querySelectorAll<HTMLElement>(".group-member"),
  ].find(
    (element) =>
      element.querySelector(".group-member-name b")?.textContent === "reviewer",
  )!;
  click(member, "Roles…");
  const roles = member.querySelector<HTMLFormElement>(".group-role-edit")!;
  const builder = [
    ...roles.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ].find((input) => input.parentElement?.textContent?.trim() === "builder")!;
  flushSync(() => builder.click());
  await compete([{ op: "group.set_attrs", id: "town", name: "Town parallel" }]);
  submit(roles);
  await waitFor(
    () => !roles.isConnected || roles.querySelector('[role="alert"]'),
  );
  check(
    roles.isConnected && builder.checked,
    "Roles conflict retains the checked role draft",
  );
  if (roles.isConnected) {
    check(
      roles.textContent?.includes(
        "The Board changed while this form was open",
      ) && !roles.textContent.includes("The Group changed"),
      "an unrelated Group edit is described as a whole-Board conflict",
    );
    check(
      roles.querySelector('[role="alert"]'),
      "Roles shows its conflict inside the form",
    );
    click(roles, "Use current version");
    submit(roles);
    await waitFor(() => !roles.isConnected);
    check(
      (await board())
        .relations!.groups.find((group) => group.id === "chat")!
        .members.some(
          (entry) =>
            entry.ref === "agent://connection-a/reviewer" &&
            entry.roles.includes("builder") &&
            entry.roles.includes("reviewer"),
        ),
      "explicit Roles resubmission saves checked roles",
    );
  }
  await compete([
    {
      op: "group.set_roles",
      id: "chat",
      refs: ["agent://connection-a/reviewer"],
      roles: ["reviewer"],
    },
  ]);

  await open("pair");
  click(document, "Add…");
  value(addForm()!.querySelector("select")!, "connection-a\0terminal-1");
  await compete([
    { op: "group.create", id: "other-pair", kind: "team", name: "Other pair" },
    {
      op: "group.join",
      id: "other-pair",
      refs: [{ connection_id: "connection-a", terminal_id: "terminal-1" }],
      roles: [],
    },
  ]);
  submit(addForm()!);
  await waitFor(() => !addForm() || addForm()!.querySelector('[role="alert"]'));
  const teams = (await board()).relations!.groups;
  check(
    !teams
      .find((group) => group.id === "pair")!
      .members.some(
        (entry) =>
          typeof entry.ref !== "string" &&
          entry.ref.terminal_id === "terminal-1",
      ) &&
      teams.find((group) => group.id === "other-pair")!.members.length === 1,
    "stale Add conflicts and preserves the other client's Team membership",
  );
  check(
    addForm()?.querySelector("select")?.value === "connection-a\0terminal-1",
    "stale Add retains its selected agent",
  );
  if (addForm()) {
    const before = (await board()).revision;
    click(addForm()!, "Use current version");
    check(
      (await board()).revision === before,
      "reviewing a stale Add does not transfer membership",
    );
    submit(addForm()!);
    await waitFor(() => !addForm());
    check(
      (await board())
        .relations!.groups.find((group) => group.id === "pair")!
        .members.some(
          (entry) =>
            typeof entry.ref !== "string" &&
            entry.ref.terminal_id === "terminal-1",
        ),
      "explicit Add resubmission succeeds and closes the form",
    );
    await compete([
      {
        op: "group.leave",
        id: "pair",
        refs: [{ connection_id: "connection-a", terminal_id: "terminal-1" }],
      },
    ]);
  }
  if (
    (await board()).relations!.groups.some((group) => group.id === "other-pair")
  )
    await compete([{ op: "group.delete", id: "other-pair" }]);

  await open("chat");
  click(document, "Add…");
  value(addForm()!.querySelector("select")!, "connection-a\0terminal-1");
  await fetch("/replace-agent", {
    method: "POST",
    body: JSON.stringify({ name: "replacement" }),
  });
  await worldRuntimeStore.refresh();
  const beforeReplacement = (await board()).revision;
  submit(addForm()!);
  await waitFor(
    () =>
      !addForm() ||
      document
        .querySelector('[role="alert"]')
        ?.textContent?.includes("changed"),
  );
  check(
    (await board()).revision === beforeReplacement && addForm(),
    "replacement in the same terminal refuses Add without retargeting the selected Pod address",
  );
  await fetch("/replace-agent", {
    method: "POST",
    body: JSON.stringify({ name: "b" }),
  });
  await worldRuntimeStore.refresh();

  await open("chat");
  click(document, "Add…");
  value(addForm()!.querySelector("select")!, "connection-a\0terminal-1");
  await compete([{ op: "group.set_attrs", id: "town", name: "Town updated" }]);
  submit(addForm()!);
  await waitFor(() =>
    [...document.querySelectorAll("button")].some(
      (button) => button.textContent === "Confirm",
    ),
  );
  click(document, "Confirm");
  await waitFor(
    () =>
      document
        .querySelector('[role="alert"]')
        ?.textContent?.includes("changed") || !addForm(),
  );
  const pods = (await board()).relations!.groups;
  check(
    pods
      .find((group) => group.id === "town")!
      .members.some(
        (entry) =>
          entry.ref === "agent://connection-a/b" &&
          entry.roles.includes("lead"),
      ) &&
      !pods
        .find((group) => group.id === "chat")!
        .members.some((entry) => entry.ref === "agent://connection-a/b"),
    "a Board edit before transfer confirmation cannot bypass the Add form's reviewed revision",
  );
}
