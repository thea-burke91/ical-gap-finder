import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRRule, expandRecurrence, expandEvents } from "./rrule.js";
import type { CalendarEvent } from "./ics.js";

function event(start: number, end: number, rrule: string | null = null): CalendarEvent {
  return { uid: "x", summary: "x", start, end, allDay: false, rrule };
}

const DAY = 24 * 60 * 60 * 1000;

test("parseRRule reads FREQ and defaults INTERVAL to 1", () => {
  assert.deepEqual(parseRRule("FREQ=DAILY"), { freq: "DAILY", interval: 1 });
});

test("parseRRule reads INTERVAL, COUNT, and UNTIL", () => {
  const rule = parseRRule("FREQ=DAILY;INTERVAL=2;COUNT=5");
  assert.equal(rule?.interval, 2);
  assert.equal(rule?.count, 5);
});

test("parseRRule reads BYDAY for a WEEKLY rule", () => {
  const rule = parseRRule("FREQ=WEEKLY;BYDAY=MO,WE,FR");
  assert.deepEqual(rule?.byDay, [1, 3, 5]);
});

test("parseRRule rejects BYDAY on a non-WEEKLY rule", () => {
  assert.equal(parseRRule("FREQ=MONTHLY;BYDAY=MO"), null);
});

test("parseRRule rejects an unsupported or missing FREQ", () => {
  assert.equal(parseRRule("FREQ=SECONDLY"), null);
  assert.equal(parseRRule("INTERVAL=2"), null);
});

test("parseRRule rejects an unrecognized BYDAY code", () => {
  assert.equal(parseRRule("FREQ=WEEKLY;BYDAY=XX"), null);
});

test("parseRRule rejects a non-positive INTERVAL or COUNT", () => {
  assert.equal(parseRRule("FREQ=DAILY;INTERVAL=0"), null);
  assert.equal(parseRRule("FREQ=DAILY;COUNT=0"), null);
});

test("expandRecurrence returns the event unchanged when there's no rule", () => {
  const e = event(0, DAY);
  assert.deepEqual(expandRecurrence(e, null, 0, 10 * DAY), [e]);
});

test("expandRecurrence expands a daily rule across a range", () => {
  const e = event(0, 60 * 60000);
  const rule = parseRRule("FREQ=DAILY");
  const occurrences = expandRecurrence(e, rule, 0, 3 * DAY);
  assert.equal(occurrences.length, 3);
  assert.deepEqual(
    occurrences.map((o) => o.start),
    [0, DAY, 2 * DAY]
  );
});

test("expandRecurrence stops at COUNT occurrences", () => {
  const e = event(0, 60 * 60000);
  const rule = parseRRule("FREQ=DAILY;COUNT=2");
  const occurrences = expandRecurrence(e, rule, 0, 30 * DAY);
  assert.equal(occurrences.length, 2);
});

test("expandRecurrence stops at UNTIL", () => {
  const e = event(0, 60 * 60000);
  const rule = parseRRule(`FREQ=DAILY;UNTIL=${new Date(2 * DAY).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}`);
  const occurrences = expandRecurrence(e, rule, 0, 30 * DAY);
  assert.equal(occurrences.length, 3);
});

test("expandRecurrence honors INTERVAL", () => {
  const e = event(0, 60 * 60000);
  const rule = parseRRule("FREQ=DAILY;INTERVAL=2;COUNT=3");
  const occurrences = expandRecurrence(e, rule, 0, 30 * DAY);
  assert.deepEqual(
    occurrences.map((o) => o.start),
    [0, 2 * DAY, 4 * DAY]
  );
});

test("expandRecurrence expands a weekly BYDAY rule to multiple days per week", () => {
  // 2026-09-21 is a Monday.
  const dtstart = Date.UTC(2026, 8, 21, 9, 0, 0);
  const e = event(dtstart, dtstart + 60 * 60000);
  const rule = parseRRule("FREQ=WEEKLY;BYDAY=MO,WE,FR");
  const occurrences = expandRecurrence(e, rule, dtstart, dtstart + 7 * DAY);
  assert.equal(occurrences.length, 3);
  const weekdays = occurrences.map((o) => new Date(o.start).getUTCDay());
  assert.deepEqual(weekdays, [1, 3, 5]);
});

test("expandRecurrence skips a BYDAY occurrence that falls before DTSTART in its first week", () => {
  // DTSTART on Wednesday with BYDAY=MO,WE: the Monday of that same week is
  // before DTSTART and must not produce a phantom early occurrence.
  const dtstart = Date.UTC(2026, 8, 23, 9, 0, 0); // Wednesday
  const e = event(dtstart, dtstart + 60 * 60000);
  const rule = parseRRule("FREQ=WEEKLY;BYDAY=MO,WE");
  const occurrences = expandRecurrence(e, rule, dtstart - DAY, dtstart + DAY);
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0]?.start, dtstart);
});

test("expandRecurrence skips non-existent monthly anchors instead of rolling over", () => {
  // Jan 31 monthly: February has no 31st, so that period is skipped entirely.
  const dtstart = Date.UTC(2026, 0, 31, 9, 0, 0);
  const e = event(dtstart, dtstart + 60 * 60000);
  const rule = parseRRule("FREQ=MONTHLY;COUNT=3");
  const occurrences = expandRecurrence(e, rule, dtstart, dtstart + 200 * DAY);
  const months = occurrences.map((o) => new Date(o.start).getUTCMonth());
  assert.deepEqual(months, [0, 2, 4]); // Jan, Mar, May -- Feb and Apr have no 31st
});

test("expandRecurrence excludes occurrences entirely outside the requested range", () => {
  const e = event(0, 60 * 60000);
  const rule = parseRRule("FREQ=DAILY;COUNT=10");
  const occurrences = expandRecurrence(e, rule, 5 * DAY, 7 * DAY);
  assert.deepEqual(
    occurrences.map((o) => o.start),
    [5 * DAY, 6 * DAY]
  );
});

test("expandEvents leaves non-recurring events alone and expands recurring ones", () => {
  const plain = event(0, DAY);
  const recurring = event(0, 60 * 60000, "FREQ=DAILY;COUNT=2");
  const expanded = expandEvents([plain, recurring], 0, 3 * DAY);
  assert.equal(expanded.length, 3);
});

test("expandEvents falls back to a single occurrence for an unparsable RRULE", () => {
  const e = event(0, DAY, "FREQ=SECONDLY");
  const expanded = expandEvents([e], 0, 10 * DAY);
  assert.deepEqual(expanded, [e]);
});
