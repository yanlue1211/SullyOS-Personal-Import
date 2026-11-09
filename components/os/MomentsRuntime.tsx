import React, { useEffect, useRef } from "react";
import { useOS } from "../../context/OSContext";
import { getConfig } from "../../features/moments/storage";
import { tick } from "../../features/moments/runtime";
import { MOMENTS_CHANGED } from "../../features/moments/schema";

const MOMENTS_CHECK_INTERVAL_MS = 300000;

/** Page-lifetime scheduler. Hidden != terminated: audio may keep the page
 * alive after switching apps. Browser/OS can still throttle or suspend timers.
 * Never catch up missed intervals or issue concurrent calls. */
export default function MomentsRuntime() {
  const os = useOS(),
    latest = useRef(os);
  latest.current = os;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let running = false;
    let generation = 0;
    let dueAt = Date.now() + MOMENTS_CHECK_INTERVAL_MS;
    let controller: AbortController | undefined;

    const disarm = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const execute = async () => {
      if (disposed || running) return;
      running = true;
      try {
        const c = await getConfig();
        if (disposed || !c.enabled || latest.current.isLocked) return;
        controller = new AbortController();
        await tick({
          api: latest.current.apiConfig,
          user: latest.current.userProfile,
          realtime: latest.current.realtimeConfig,
          signal: controller.signal,
        });
      } catch (error) {
        if (!disposed && !controller?.signal.aborted)
          console.warn("[Moments] Activity paused", error instanceof Error ? error.message : "failed");
      } finally {
        controller = undefined;
        running = false;
        dueAt = Date.now() + MOMENTS_CHECK_INTERVAL_MS;
        if (!disposed) void reconcile();
      }
    };

    const reconcile = async () => {
      const seq = ++generation;
      try {
        const c = await getConfig();
        if (disposed || seq !== generation) return;
        if (!c.enabled || latest.current.isLocked) {
          disarm();
          controller?.abort();
          dueAt = Date.now() + MOMENTS_CHECK_INTERVAL_MS;
          return;
        }
        if (running) return;
        // A timer throttled in the background may be overdue when foregrounded.
        // Run once, then resume normal spacing, never replay missed intervals.
        if (timer !== undefined && Date.now() >= dueAt) disarm();
        if (timer === undefined) {
          timer = setTimeout(() => {
            timer = undefined;
            void execute();
          }, Math.max(0, dueAt - Date.now()));
        }
      } catch (error) {
        if (!disposed) console.warn("[Moments] Schedule unavailable", error);
      }
    };

    const changed = () => { void reconcile(); };
    window.addEventListener(MOMENTS_CHANGED, changed);
    document.addEventListener("visibilitychange", changed);
    void reconcile();
    return () => {
      disposed = true;
      ++generation;
      disarm();
      controller?.abort();
      window.removeEventListener(MOMENTS_CHANGED, changed);
      document.removeEventListener("visibilitychange", changed);
    };
  }, [os.isLocked]);

  return null;
}
