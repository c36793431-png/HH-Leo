"use client";

import { useEffect, useState } from "react";
import { subscribeToast } from "@/lib/toast-bus";

interface ToastEntry {
  id: number;
  message: string;
  kind: "success" | "error";
}

let nextId = 1;

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  useEffect(() => {
    return subscribeToast((message, kind) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, kind }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-lg border px-3 py-2 text-sm shadow-lg ${
            t.kind === "success"
              ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-200"
              : "border-red-500/40 bg-red-950/90 text-red-200"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
