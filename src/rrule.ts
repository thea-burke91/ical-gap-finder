// RFC 5545 RRULE expansion, limited to what mainstream calendar exports
// actually use: FREQ of DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT,
// UNTIL, and BYDAY (only meaningful for WEEKLY here). BYMONTHDAY, BYSETPOS,
// WKST, and RDATE/EXDATE aren't handled -- an event using one of those comes
// back as a single occurrence at its own DTSTART/DTEND, same as before this
// module existed.

import type { CalendarEvent } from "./ics.js";
import { parseIcsDate } from "./ics.js";

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RecurrenceRule {
  freq: Frequency;
  interval: number;
  count?: number;
  until?: number;
  byDay?: number[]; // 0 = Sunday .. 6 = Saturday, matches Date#getUTCDay
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PERIODS = 100000;

const WEEKDAY_CODES: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

function isFrequency(value: string): value is Frequency {
  return value === "DAILY" || value === "WEEKLY" || value === "MONTHLY" || value === "YEARLY";
}

/** Parse an RRULE property value. Returns null if FREQ is missing/unsupported or the value is malformed. */
export function parseRRule(value: string): RecurrenceRule | null {
  const parts: Record<string, string> = {};
  for (const chunk of value.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq === -1) continue;
    parts[chunk.slice(0, eq).toUpperCase()] = chunk.slice(eq + 1);
  }

  const freqValue = parts["FREQ"];
  if (freqValue === undefined || !isFrequency(freqValue)) return null;

  const intervalRaw = parts["INTERVAL"];
  const interval = intervalRaw !== undefined ? Number(intervalRaw) : 1;
  if (!Number.isFinite(interval) || interval < 1) return null;

  const rule: RecurrenceRule = { freq: freqValue, interval };

  const countRaw = parts["COUNT"];
  if (countRaw !== undefined) {
    const count = Number(countRaw);
    if (!Number.isFinite(count) || count < 1) return null;
    rule.count = count;
  }

  const untilRaw = parts["UNTIL"];
  if (untilRaw !== undefined) {
    rule.until = parseIcsDate(untilRaw, {}).epochMs;
  }

  const byDayRaw = parts["BYDAY"];
  if (byDayRaw !== undefined) {
    if (freqValue !== "WEEKLY") return null; // ordinal BYDAY (e.g. "1MO") needs MONTHLY/YEARLY semantics we don't implement
    const days: number[] = [];
    for (const code of byDayRaw.split(",")) {
      const weekday = WEEKDAY_CODES[code.trim().toUpperCase()];
      if (weekday === undefined) return null;
      days.push(weekday);
    }
    rule.byDay = days;
  }

  return rule;
}

/** The anchor date for the Nth period of the rule (period 0 is always DTSTART). NaN means "no valid date this period", e.g. Feb 31. */
function periodAnchor(dtstart: number, rule: RecurrenceRule, periodIndex: number): number {
  switch (rule.freq) {
    case "DAILY":
      return dtstart + periodIndex * rule.interval * ONE_DAY_MS;
    case "WEEKLY":
      return dtstart + periodIndex * rule.interval * 7 * ONE_DAY_MS;
    case "MONTHLY": {
      const d = new Date(dtstart);
      const targetMonth = d.getUTCMonth() + periodIndex * rule.interval;
      const candidate = Date.UTC(
        d.getUTCFullYear(),
        targetMonth,
        d.getUTCDate(),
        d.getUTCHours(),
        d.getUTCMinutes(),
        d.getUTCSeconds()
      );
      const expectedMonth = ((targetMonth % 12) + 12) % 12;
      return new Date(candidate).getUTCMonth() === expectedMonth ? candidate : NaN;
    }
    case "YEARLY": {
      const d = new Date(dtstart);
      const candidate = Date.UTC(
        d.getUTCFullYear() + periodIndex * rule.interval,
        d.getUTCMonth(),
        d.getUTCDate(),
        d.getUTCHours(),
        d.getUTCMinutes(),
        d.getUTCSeconds()
      );
      return new Date(candidate).getUTCMonth() === d.getUTCMonth() ? candidate : NaN;
    }
  }
}

/** All occurrence start times that fall within the given period, sorted ascending. */
function occurrencesInPeriod(anchor: number, rule: RecurrenceRule): number[] {
  if (rule.freq === "WEEKLY" && rule.byDay && rule.byDay.length > 0) {
    const anchorWeekday = new Date(anchor).getUTCDay();
    const weekStart = anchor - anchorWeekday * ONE_DAY_MS;
    return rule.byDay.map((weekday) => weekStart + weekday * ONE_DAY_MS).sort((a, b) => a - b);
  }
  return [anchor];
}

/**
 * Expand a single event into its concrete occurrences overlapping
 * [rangeStart, rangeEnd). A null rule (no RRULE, or one we don't parse)
 * just returns the event's own DTSTART/DTEND occurrence.
 */
export function expandRecurrence(
  event: CalendarEvent,
  rule: RecurrenceRule | null,
  rangeStart: number,
  rangeEnd: number
): CalendarEvent[] {
  if (!rule) return [event];

  const duration = event.end - event.start;
  const results: CalendarEvent[] = [];
  let emitted = 0;

  for (let periodIndex = 0; periodIndex < MAX_PERIODS; periodIndex++) {
    const anchor = periodAnchor(event.start, rule, periodIndex);
    if (Number.isNaN(anchor)) continue;

    const occurrences = occurrencesInPeriod(anchor, rule);
    const earliest = occurrences[0];
    if (earliest === undefined) continue;
    if (earliest > rangeEnd) break;
    if (rule.until !== undefined && earliest > rule.until) break;

    for (const occurrenceStart of occurrences) {
      if (occurrenceStart < event.start) continue;
      if (rule.until !== undefined && occurrenceStart > rule.until) continue;

      emitted += 1;
      if (rule.count !== undefined && emitted > rule.count) {
        return results;
      }

      if (occurrenceStart < rangeEnd && occurrenceStart + duration > rangeStart) {
        results.push({ ...event, start: occurrenceStart, end: occurrenceStart + duration });
      }
    }
  }

  return results;
}

/** Expand every event in a calendar, replacing recurring events with their occurrences inside [rangeStart, rangeEnd). */
export function expandEvents(events: CalendarEvent[], rangeStart: number, rangeEnd: number): CalendarEvent[] {
  const expanded: CalendarEvent[] = [];
  for (const event of events) {
    const rule = event.rrule !== null ? parseRRule(event.rrule) : null;
    expanded.push(...expandRecurrence(event, rule, rangeStart, rangeEnd));
  }
  return expanded;
}
