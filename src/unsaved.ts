import { useEffect, useId } from "react";

const pending = new Map<string, boolean>();
export function hasUnsavedChanges() { return [...pending.values()].some(Boolean); }
export function confirmLeave() {
  return !hasUnsavedChanges() || window.confirm("Discard your unsaved edits?");
}
export function useUnsavedChanges(dirty: boolean) {
  const id = useId();
  useEffect(() => {
    pending.set(id, dirty);
    const warn = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => { pending.delete(id); window.removeEventListener("beforeunload", warn); };
  }, [dirty, id]);
}
