export const SWEEP_HOURS_UTC = [6, 12, 17] as const;

export interface UtcSweepSlot {
  slotKey: string;
  scheduledFor: Date;
  delayMs: number;
}

export interface ScheduledSweepContext {
  slotKey: string;
  scheduledForIso: string;
}

function formatUtcSweepSlotKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `scheduled:${year}-${month}-${day}T${hour}:00Z`;
}

/**
 * Computes the next scheduled UTC sweep slot (06:00, 12:00, or 17:00 UTC),
 * its deterministic lease key, and milliseconds until it fires.
 */
export function nextUtcSweepSlot(now = new Date()): UtcSweepSlot {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();

  for (const hour of SWEEP_HOURS_UTC) {
    const candidate = new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
    if (candidate.getTime() > now.getTime()) {
      return {
        slotKey: formatUtcSweepSlotKey(candidate),
        scheduledFor: candidate,
        delayMs: candidate.getTime() - now.getTime(),
      };
    }
  }

  const tomorrowFirst = new Date(
    Date.UTC(year, month, day + 1, SWEEP_HOURS_UTC[0], 0, 0, 0),
  );
  return {
    slotKey: formatUtcSweepSlotKey(tomorrowFirst),
    scheduledFor: tomorrowFirst,
    delayMs: tomorrowFirst.getTime() - now.getTime(),
  };
}

/**
 * Computes milliseconds until the next scheduled UTC sweep hour (06:00, 12:00, or 17:00 UTC).
 */
export function msUntilNextUtcSweep(now = new Date()): number {
  return nextUtcSweepSlot(now).delayMs;
}

export interface SchedulerHandle {
  stop(): void;
}

/**
 * Lightweight zero-dependency 3x daily UTC scheduler (06:00, 12:00, 17:00 UTC).
 * Emits a deterministic `slotKey` per scheduled window so replicas sharing
 * ArcadeDB coordinate via `IntelligenceSweepLease`.
 */
export function startIntelligenceScheduler(
  onSweep: (context: ScheduledSweepContext) => Promise<void>,
): SchedulerHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleNext = () => {
    if (stopped) return;
    const slot = nextUtcSweepSlot(new Date());
    const delayMs = Math.max(1_000, slot.delayMs);
    timer = setTimeout(() => {
      void onSweep({
        slotKey: slot.slotKey,
        scheduledForIso: slot.scheduledFor.toISOString(),
      })
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
