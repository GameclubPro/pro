import { useEffect } from "react";

/**
 * Syncs CSS viewport height variable with Telegram stable viewport.
 */
export function useTelegramViewport() {
  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const tg = window?.Telegram?.WebApp;

    const applyViewport = () => {
      const stableHeight = typeof tg?.viewportStableHeight === "number" ? tg.viewportStableHeight : null;
      const height = stableHeight && stableHeight > 0 ? stableHeight : window.innerHeight;
      document.documentElement.style.setProperty("--tg-vh", `${height}px`);
    };

    try {
      tg?.ready?.();
    } catch {
      /* noop */
    }

    applyViewport();

    tg?.onEvent?.("viewportChanged", applyViewport);
    window.addEventListener("resize", applyViewport);

    return () => {
      tg?.offEvent?.("viewportChanged", applyViewport);
      window.removeEventListener("resize", applyViewport);
    };
  }, []);
}
