// Minimal RFC 5545 parsing: just enough to pull VEVENT start/end times out
// of a calendar file. No RRULE expansion yet, no VALARM/VTIMEZONE handling.

export interface CalendarEvent {
  uid: string;
  summary: string;
  /** milliseconds since epoch */
  start: number;
  /** milliseconds since epoch */
  end: number;
  allDay: boolean;
}

interface RawProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Undo RFC 5545 line folding: a CRLF/LF followed by a space or tab joins the previous line. */
export function unfoldLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const rawLines = normalized.split("\n");
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      lines.push(line);
    }
  }
  return lines;
}

/** Parse a single "NAME;PARAM=VALUE;...:value" content line. */
export function parsePropertyLine(line: string): RawProperty {
  const colonIndex = line.indexOf(":");
  if (colonIndex === -1) {
    return { name: line, params: {}, value: "" };
  }
  const head = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1);
  const parts = head.split(";");
  const name = parts[0] ?? "";
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value };
}

/**
 * Parse an iCal date/date-time value into epoch milliseconds.
 * Handles DATE (YYYYMMDD), and DATE-TIME (YYYYMMDDTHHMMSS[Z]).
 * Values with a TZID param are treated as UTC, since we don't ship a
 * timezone database -- this is a known limitation, see README.
 */
export function parseIcsDate(value: string, params: Record<string, string>): { epochMs: number; allDay: boolean } {
  const isDateOnly = params["VALUE"] === "DATE" || /^\d{8}$/.test(value);
  if (isDateOnly) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    return { epochMs: Date.UTC(year, month - 1, day), allDay: true };
  }

  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!match) {
    throw new Error(`unrecognized date-time value: ${value}`);
  }
  const [, y, mo, d, h, mi, s] = match;
  const epochMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return { epochMs, allDay: false };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Parse all VEVENT blocks in an .ics file into CalendarEvent records. */
export function parseIcs(text: string): CalendarEvent[] {
  const lines = unfoldLines(text);
  const events: CalendarEvent[] = [];

  let inEvent = false;
  let uid = "";
  let summary = "";
  let start: number | null = null;
  let end: number | null = null;
  let allDay = false;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      uid = "";
      summary = "";
      start = null;
      end = null;
      allDay = false;
      continue;
    }
    if (line === "END:VEVENT") {
      if (inEvent && start !== null) {
        const resolvedEnd = end !== null ? end : allDay ? start + ONE_DAY_MS : start;
        events.push({ uid, summary, start, end: resolvedEnd, allDay });
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    const prop = parsePropertyLine(line);
    switch (prop.name) {
      case "UID":
        uid = prop.value;
        break;
      case "SUMMARY":
        summary = unescapeText(prop.value);
        break;
      case "DTSTART": {
        const parsed = parseIcsDate(prop.value, prop.params);
        start = parsed.epochMs;
        allDay = parsed.allDay;
        break;
      }
      case "DTEND": {
        const parsed = parseIcsDate(prop.value, prop.params);
        end = parsed.epochMs;
        break;
      }
      default:
        break;
    }
  }

  return events;
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}
