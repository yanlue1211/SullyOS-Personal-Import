import React, { useEffect, useRef } from "react";
import { useOS } from "../../context/OSContext";
import { getConfig } from "../../features/moments/storage";
import { tick } from "../../features/moments/runtime";
import { MOMENTS_CHANGED } from "../../features/moments/schema";
/** Does not mount a timer while disabled. Only a single five-minute local check. */
export default function MomentsRuntime() {
  const os = useOS(),
    latest = useRef(os);
  latest.current = os;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined,
      disposed = false,
      checking = false;
    let controller: AbortController | undefined;
    const configure = async () => {
      if (checking || disposed) return;
      checking = true;
      try {
        const c = await getConfig();
        if (disposed) return;
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (!c.enabled || document.hidden || latest.current.isLocked) {
          controller?.abort();
          return;
        }
        timer = setTimeout(async () => {
          timer = undefined;
          controller = new AbortController();
          try {
            await tick({
              api: latest.current.apiConfig,
              user: latest.current.userProfile,
              realtime: latest.current.realtimeConfig,
              signal: controller.signal,
            });
          } catch (e) {
            console.warn(
              "[Moments] Activity paused",
              e instanceof Error ? e.message : "failed",
            );
          } finally {
            controller = undefined;
            void configure();
          }
        }, 300000);
      } finally {
        checking = false;
      }
    };
    const visibility = () => {
      void configure();
    };
    window.addEventListener(MOMENTS_CHANGED, visibility);
    document.addEventListener("visibilitychange", visibility);
    void configure();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      window.removeEventListener(MOMENTS_CHANGED, visibility);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [os.isLocked]);
  return null;
}
