import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What Tab can reach inside `root`, in order */
function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    // Not the hidden file inputs and the like
    (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  );
}

/**
 * Keyboard behaviour of a modal dialog. Put the returned ref (and `tabIndex={-1}`) on the
 * element with `role="dialog"`.
 *
 * - The focus moves into the dialog when it opens, and returns to where it was when it closes.
 * - Tab and Shift+Tab stay inside the dialog instead of wandering into the page behind it.
 * - Esc closes it. Pass `canClose: false` while the dialog must stay (e.g. an export is
 *   running), so its progress cannot be hidden by accident.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(isOpen: boolean, onClose: () => void, canClose = true) {
  const dialogRef = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  useEffect(() => {
    closeRef.current = onClose;
    canCloseRef.current = canClose;
  });

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });

    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (canCloseRef.current) closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      const items = focusableIn(dialog);
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const isOutside = !dialog.contains(active) || active === dialog;
      if (e.shiftKey && (active === first || isOutside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || isOutside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
      // Back to the button that opened the dialog, if it is still there
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [isOpen]);

  return dialogRef;
}
