import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { useLayer } from "../../layerStack";
import { cn } from "../../utils";
import "./popover.css";

type PopoverLayerRefs = {
  trigger: React.MutableRefObject<HTMLElement | null>;
  content: React.MutableRefObject<HTMLElement | null>;
};
const PopoverLayerContext = React.createContext<PopoverLayerRefs | null>(null);

function setRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/**
 * Radix's popover on the shared layer stack (layerStack.ts): the stack, not
 * Radix, closes it on Escape, an outside press or Back, so nested layers
 * close one at a time and a press on the terminal still dismisses it.
 */
function Popover({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const latest = React.useRef(onOpenChange);
  latest.current = onOpenChange;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      latest.current?.(next);
    },
    [controlledOpen],
  );
  const refs = React.useRef<PopoverLayerRefs>({
    trigger: { current: null },
    content: { current: null },
  }).current;
  useLayer(open, () => setOpen(false), {
    element: () => refs.content.current,
    anchors: () => [refs.trigger.current],
  });
  return (
    <PopoverLayerContext.Provider value={refs}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen} {...props} />
    </PopoverLayerContext.Provider>
  );
}

const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>((props, ref) => {
  const refs = React.useContext(PopoverLayerContext);
  return (
    <PopoverPrimitive.Trigger
      ref={(node) => {
        if (refs) refs.trigger.current = node;
        setRef(ref, node);
      }}
      {...props}
    />
  );
});
PopoverTrigger.displayName = PopoverPrimitive.Trigger.displayName;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(
  (
    {
      className,
      align = "start",
      sideOffset = 8,
      onEscapeKeyDown,
      onPointerDownOutside,
      onFocusOutside,
      onCloseAutoFocus,
      ...props
    },
    ref,
  ) => {
    const refs = React.useContext(PopoverLayerContext);
    return (
      <PopoverPrimitive.Portal>
        <div className="popover-portal">
          <PopoverPrimitive.Content
            ref={(node) => {
              if (refs) refs.content.current = node;
              setRef(ref, node);
            }}
            align={align}
            sideOffset={sideOffset}
            className={cn("popover-content", className)}
            onEscapeKeyDown={(event) => {
              onEscapeKeyDown?.(event);
              if (refs) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              onPointerDownOutside?.(event);
              if (refs) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              onCloseAutoFocus?.(event);
              // The stack returns focus to what had it before opening, or
              // leaves it with what an outside press reached.
              if (refs) event.preventDefault();
            }}
            onFocusOutside={(event) => {
              onFocusOutside?.(event);
              // Focus follows a press (the stack decides those); Tab still
              // leaves and closes the popover.
              if (refs && pressedRecently()) event.preventDefault();
            }}
            {...props}
          />
        </div>
      </PopoverPrimitive.Portal>
    );
  },
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

let lastPress = -Infinity;
if (typeof window !== "undefined")
  window.addEventListener(
    "pointerdown",
    () => {
      lastPress = performance.now();
    },
    true,
  );
function pressedRecently() {
  return performance.now() - lastPress < 1_000;
}

export { Popover, PopoverContent, PopoverTrigger };
