import { test } from "node:test";
import assert from "node:assert/strict";
import { unfoldLines, parsePropertyLine, parseIcsDate, parseIcs } from "./ics.js";

test("unfoldLines joins continuation lines starting with a space or tab", () => {
  const text = "BEGIN:VEVENT\nSUMMARY:Long\n title\nEND:VEVENT";
  assert.deepEqual(unfoldLines(text), ["BEGIN:VEVENT", "SUMMARY:Long title", "END:VEVENT"]);
});

test("unfoldLines handles CRLF line endings", () => {
  const text = "BEGIN:VEVENT\r\nUID:1\r\nEND:VEVENT";
  assert.deepEqual(unfoldLines(text), ["BEGIN:VEVENT", "UID:1", "END:VEVENT"]);
});

test("unfoldLines drops blank lines", () => {
  const text = "BEGIN:VEVENT\n\nEND:VEVENT";
  assert.deepEqual(unfoldLines(text), ["BEGIN:VEVENT", "END:VEVENT"]);
});

test("parsePropertyLine splits name, params, and value", () => {
  const prop = parsePropertyLine("DTSTART;TZID=America/New_York;VALUE=DATE:20260101");
  assert.equal(prop.name, "DTSTART");
  assert.equal(prop.value, "20260101");
  assert.deepEqual(prop.params, { TZID: "America/New_York", VALUE: "DATE" });
});

test("parsePropertyLine handles a line with no params", () => {
  const prop = parsePropertyLine("UID:abc@example.com");
  assert.equal(prop.name, "UID");
  assert.equal(prop.value, "abc@example.com");
  assert.deepEqual(prop.params, {});
});

test("parsePropertyLine tolerates a colon inside the value", () => {
  const prop = parsePropertyLine("SUMMARY:Meeting: budget review");
  assert.equal(prop.value, "Meeting: budget review");
});

test("parseIcsDate reads a UTC date-time", () => {
  const { epochMs, allDay } = parseIcsDate("20260922T090000Z", {});
  assert.equal(epochMs, Date.UTC(2026, 8, 22, 9, 0, 0));
  assert.equal(allDay, false);
});

test("parseIcsDate treats a TZID value as UTC", () => {
  const { epochMs, allDay } = parseIcsDate("20260922T090000", { TZID: "America/New_York" });
  assert.equal(epochMs, Date.UTC(2026, 8, 22, 9, 0, 0));
  assert.equal(allDay, false);
});

test("parseIcsDate reads an all-day DATE value", () => {
  const { epochMs, allDay } = parseIcsDate("20260922", { VALUE: "DATE" });
  assert.equal(epochMs, Date.UTC(2026, 8, 22));
  assert.equal(allDay, true);
});

test("parseIcsDate reads a bare 8-digit value as all-day even without VALUE=DATE", () => {
  const { allDay } = parseIcsDate("20260922", {});
  assert.equal(allDay, true);
});

test("parseIcsDate throws on an unrecognized value", () => {
  assert.throws(() => parseIcsDate("not-a-date", {}), /unrecognized date-time value/);
});

test("parseIcs extracts UID, SUMMARY, DTSTART, and DTEND from a VEVENT", () => {
  const text = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:standup@example.com",
    "DTSTART:20260922T090000Z",
    "DTEND:20260922T091500Z",
    "SUMMARY:Standup",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\n");

  const events = parseIcs(text);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.uid, "standup@example.com");
  assert.equal(events[0]?.summary, "Standup");
  assert.equal(events[0]?.start, Date.UTC(2026, 8, 22, 9, 0, 0));
  assert.equal(events[0]?.end, Date.UTC(2026, 8, 22, 9, 15, 0));
  assert.equal(events[0]?.allDay, false);
  assert.equal(events[0]?.rrule, null);
});

test("parseIcs unescapes SUMMARY text", () => {
  const text = [
    "BEGIN:VEVENT",
    "UID:1",
    "DTSTART:20260922T090000Z",
    "SUMMARY:Line one\\nLine two\\, with a comma\\; and a semicolon",
    "END:VEVENT",
  ].join("\n");

  const events = parseIcs(text);
  assert.equal(events[0]?.summary, "Line one\nLine two, with a comma; and a semicolon");
});

test("parseIcs defaults DTEND to DTSTART when missing on a timed event", () => {
  const text = ["BEGIN:VEVENT", "UID:1", "DTSTART:20260922T090000Z", "END:VEVENT"].join("\n");
  const events = parseIcs(text);
  assert.equal(events[0]?.end, events[0]?.start);
});

test("parseIcs defaults DTEND to one day after DTSTART for an all-day event", () => {
  const text = ["BEGIN:VEVENT", "UID:1", "DTSTART;VALUE=DATE:20260922", "END:VEVENT"].join("\n");
  const events = parseIcs(text);
  const start = events[0]?.start ?? 0;
  assert.equal(events[0]?.end, start + 24 * 60 * 60 * 1000);
});

test("parseIcs drops a VEVENT with no DTSTART", () => {
  const text = ["BEGIN:VEVENT", "UID:1", "SUMMARY:no start", "END:VEVENT"].join("\n");
  assert.deepEqual(parseIcs(text), []);
});

test("parseIcs carries the raw RRULE value through unparsed", () => {
  const text = [
    "BEGIN:VEVENT",
    "UID:1",
    "DTSTART:20260922T090000Z",
    "RRULE:FREQ=WEEKLY;COUNT=3",
    "END:VEVENT",
  ].join("\n");
  const events = parseIcs(text);
  assert.equal(events[0]?.rrule, "FREQ=WEEKLY;COUNT=3");
});

test("parseIcs parses multiple VEVENT blocks and ignores properties outside them", () => {
  const text = [
    "BEGIN:VCALENDAR",
    "SUMMARY:not an event",
    "BEGIN:VEVENT",
    "UID:1",
    "DTSTART:20260922T090000Z",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:2",
    "DTSTART:20260923T090000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\n");
  const events = parseIcs(text);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.uid), ["1", "2"]);
});
