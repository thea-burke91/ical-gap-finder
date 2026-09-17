// All functions here are pure: they take plain data in and hand plain data
// back, with no file or clock access. That's what makes them cheap to test
// and safe to reuse from a future non-CLI frontend.

import type { CalendarEvent } from "./ics.js";

export interface Interval {
  start: number;
  end: number;
}

/** Turn events into sorted, non-overlapping busy intervals. */
export function computeBusyIntervals(events: CalendarEvent[]): Interval[] {
  const intervals = events
    .filter((event) => event.end > event.start)
    .map((event) => ({ start: event.start, end: event.end }));
  return mergeIntervals(intervals);
}

/** Sort intervals by start time and merge any that overlap or touch. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];

  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last && current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/**
 * Find gaps of at least `minGapMs` inside [windowStart, windowEnd) that
 * aren't covered by any busy interval. Busy intervals may be unsorted and
 * may extend outside the window; both are handled here.
 */
export function findFreeGaps(
  busy: Interval[],
  windowStart: number,
  windowEnd: number,
  minGapMs: number
): Interval[] {
  if (windowEnd <= windowStart) return [];

  const clipped = mergeIntervals(busy)
    .map((interval) => ({
      start: Math.max(interval.start, windowStart),
      end: Math.min(interval.end, windowEnd),
    }))
    .filter((interval) => interval.end > interval.start);

  const gaps: Interval[] = [];
  let cursor = windowStart;

  for (const interval of clipped) {
    if (interval.start > cursor) {
      gaps.push({ start: cursor, end: interval.start });
    }
    cursor = Math.max(cursor, interval.end);
  }

  if (cursor < windowEnd) {
    gaps.push({ start: cursor, end: windowEnd });
  }

  return gaps.filter((gap) => gap.end - gap.start >= minGapMs);
}

/** Render an interval's length as "Xh Ym", dropping the hour part when it's zero. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
