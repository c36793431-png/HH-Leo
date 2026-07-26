type ToastKind = "success" | "error";
type Listener = (message: string, kind: ToastKind) => void;

const listeners = new Set<Listener>();

export function emitToast(message: string, kind: ToastKind = "success") {
  listeners.forEach((l) => l(message, kind));
}

export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
