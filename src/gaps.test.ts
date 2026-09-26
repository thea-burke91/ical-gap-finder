import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBusyIntervals, mergeIntervals, findFreeGaps, formatDuration } from "./gaps.js";
import type { CalendarEvent } from "./ics.js";

function event(start: number, end: number): CalendarEvent {
  return { uid: "x", summary: "x", start, end, allDay: false, rrule: null };
}

test("mergeIntervals sorts and merges overlapping intervals", () => {
  const merged = mergeIntervals([
    { start: 100, end: 200 },
    { start: 150, end: 250 },
    { start: 500, end: 600 },
  ]);
  assert.deepEqual(merged, [
    { start: 100, end: 250 },
    { start: 500, end: 600 },
  ]);
});

test("mergeIntervals merges touching intervals (end === next start)", () => {
  const merged = mergeIntervals([
    { start: 0, end: 100 },
    { start: 100, end: 200 },
  ]);
  assert.deepEqual(merged, [{ start: 0, end: 200 }]);
});

test("mergeIntervals leaves non-overlapping intervals separate", () => {
  const merged = mergeIntervals([
    { start: 0, end: 10 },
    { start: 20, end: 30 },
  ]);
  assert.deepEqual(merged, [
    { start: 0, end: 10 },
    { start: 20, end: 30 },
  ]);
});

test("computeBusyIntervals drops zero-length and inverted events", () => {
  const busy = computeBusyIntervals([event(100, 100), event(200, 150), event(300, 400)]);
  assert.deepEqual(busy, [{ start: 300, end: 400 }]);
});

test("findFreeGaps returns the whole window when there's no busy time", () => {
  const gaps = findFreeGaps([], 0, 1000, 0);
  assert.deepEqual(gaps, [{ start: 0, end: 1000 }]);
});

test("findFreeGaps finds the gap between two busy intervals", () => {
  const busy = [
    { start: 0, end: 100 },
    { start: 200, end: 300 },
  ];
  const gaps = findFreeGaps(busy, 0, 300, 0);
  assert.deepEqual(gaps, [{ start: 100, end: 200 }]);
});

test("findFreeGaps clips busy intervals that extend outside the window", () => {
  const busy = [{ start: -50, end: 50 }];
  const gaps = findFreeGaps(busy, 0, 100, 0);
  assert.deepEqual(gaps, [{ start: 50, end: 100 }]);
});

test("findFreeGaps drops gaps shorter than the minimum length", () => {
  const busy = [
    { start: 0, end: 100 },
    { start: 110, end: 200 },
  ];
  const gaps = findFreeGaps(busy, 0, 200, 20);
  assert.deepEqual(gaps, []);
});

test("findFreeGaps handles unsorted, overlapping busy intervals", () => {
  const busy = [
    { start: 150, end: 250 },
    { start: 0, end: 100 },
    { start: 90, end: 160 },
  ];
  const gaps = findFreeGaps(busy, 0, 300, 0);
  assert.deepEqual(gaps, [{ start: 250, end: 300 }]);
});

test("findFreeGaps returns nothing when the window is empty or inverted", () => {
  assert.deepEqual(findFreeGaps([], 100, 100, 0), []);
  assert.deepEqual(findFreeGaps([], 100, 0, 0), []);
});

test("formatDuration renders minutes only under an hour", () => {
  assert.equal(formatDuration(45 * 60000), "45m");
});

test("formatDuration renders whole hours without a minutes part", () => {
  assert.equal(formatDuration(2 * 60 * 60000), "2h");
});

test("formatDuration renders hours and minutes together", () => {
  assert.equal(formatDuration(105 * 60000), "1h 45m");
});

test("formatDuration rounds to the nearest minute", () => {
  assert.equal(formatDuration(89 * 1000), "1m");
});
