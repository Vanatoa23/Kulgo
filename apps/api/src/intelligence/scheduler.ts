export const SWEEP_HOURS_UTC = [6, 12, 17] as const;

/**
 * Computes milliseconds until the next scheduled UTC sweep hour (06:00, 12:00, or 17:00 UTC).
 */
export function msUntilNextUtcSweep(now = new Date()): number {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();

  for (const hour of SWEEP_HOURS_UTC) {
    const candidate = new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
    if (candidate.getTime() > now.getTime()) {
      return candidate.getTime() - now.getTime();
    }
  }

  const tomorrowFirst = new Date(
    Date.UTC(year, month, day + 1, SWEEP_HOURS_UTC[0], 0, 0, 0),
  );
  return tomorrowFirst.getTime() - now.getTime();
}

export interface SchedulerHandle {
  stop(): void;
}

/**
 * Lightweight zero-dependency 3x daily UTC scheduler (06:00, 12:00, 17:00 UTC).
 */
export function startIntelligenceScheduler(
  onSweep: () => Promise<void>,
): SchedulerHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleNext = () => {
    if (stopped) return;
    const delayMs = Math.max(1_000, msUntilNextUtcSweep(new Date()));
    timer = setTimeout(() => {
      void onSweep()
        .catch((err) => {
          console.error("[kulgo-intelligence] Scheduled sweep failed:", err);
        })
        .finally(() => {
          scheduleNext();
        });
    }, delayMs);
    timer.unref();
  };

  scheduleNext();

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
