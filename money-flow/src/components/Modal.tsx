import { useLayoutEffect, useRef, type ReactNode } from 'react';

interface Props {
  /** id of the heading that names the dialog */
  labelledBy: string;
  className?: string;
  /** Escape / backdrop click. Leave out for a dialog that needs an explicit choice (it then stays open). */
  onDismiss?: () => void;
  children: ReactNode;
}

/**
 * Native modal <dialog>: the browser moves focus in, keeps Tab inside, makes the page behind inert
 * and returns focus to where it was when the dialog closes.
 */
export default function Modal({ labelledBy, className, onDismiss, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  /** true while React itself is closing the dialog (unmount) */
  const closing = useRef(false);

  // layout effect: its cleanup runs before React removes the <dialog>, so close() can hand focus back
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    closing.current = false;
    if (!d.open) d.showModal();
    return () => {
      closing.current = true;
      if (d.open) d.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal ${className ?? ''}`}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        dismiss.current?.();
      }}
      // Some browsers close on a repeated Escape even when cancel is prevented: follow or undo that.
      onClose={() => {
        // ignore our own close, and a stale close event that arrives after the dialog was reopened
        if (closing.current || ref.current?.open) return;
        if (dismiss.current) dismiss.current();
        else ref.current?.showModal();
      }}
      onClick={(e) => {
        // a click on the dialog element itself (not its content) is a click on the backdrop
        if (e.target === e.currentTarget) dismiss.current?.();
      }}
    >
      {children}
    </dialog>
  );
}
