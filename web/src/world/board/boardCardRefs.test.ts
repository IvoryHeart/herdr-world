import { expect, mock, test } from "bun:test";
import { createBoardCardRefs } from "./boardCardRefs";

function fixture() {
  const elements = new Map<string, HTMLElement>();
  const observer = {
    observe: mock<(element: Element) => void>(() => {}),
    unobserve: mock<(element: Element) => void>(() => {}),
  };
  return {
    elements,
    observer,
    ref: createBoardCardRefs(elements, () => observer),
  };
}

test("a mounted card keeps its ref and observer across renders", () => {
  const { elements, observer, ref } = fixture();
  const element = {} as HTMLElement;
  const first = ref("card");
  first(element);
  for (let i = 0; i < 10; i++) {
    expect(ref("card")).toBe(first);
    ref("card")(element);
  }
  expect(elements.get("card")).toBe(element);
  expect(observer.observe).toHaveBeenCalledTimes(1);
  expect(observer.unobserve).not.toHaveBeenCalled();
});

test("replacement and removal release exactly the previous element", () => {
  const { elements, observer, ref } = fixture();
  const first = {} as HTMLElement;
  const second = {} as HTMLElement;
  const callback = ref("card");
  callback(first);
  callback(second);
  expect(observer.unobserve.mock.calls).toEqual([[first]]);
  expect(observer.observe.mock.calls).toEqual([[first], [second]]);
  callback(null);
  expect(elements.has("card")).toBe(false);
  expect(observer.unobserve.mock.calls).toEqual([[first], [second]]);
  expect(ref("card")).not.toBe(callback);
});

test("an uncommitted render keeps no callback, and a remounted ref is stable", () => {
  const { elements, observer, ref } = fixture();
  expect(ref("abandoned")).not.toBe(ref("abandoned"));
  expect(elements.size).toBe(0);
  const callback = ref("card");
  const element = {} as HTMLElement;
  callback(element);
  callback(null);
  callback(element);
  expect(ref("card")).toBe(callback);
  expect(observer.observe).toHaveBeenCalledTimes(2);
  expect(observer.unobserve).toHaveBeenCalledTimes(1);
});
