#!/usr/bin/env node
// Everything that touches the filesystem or process.argv lives in this file.
// The actual logic (parsing, gap-finding) is pure and lives in ics.ts / gaps.ts.

import { readFileSync } from "node:fs";
import { parseIcs } from "./ics.js";
import { computeBusyIntervals, findFreeGaps, formatDuration } from "./gaps.js";

interface Args {
  filePath: string;
  windowStart: number;
  windowEnd: number;
  minGapMinutes: number;
}

function printUsage(): void {
  console.error(
    [
      "usage: ical-gap-finder <file.ics> <window-start-iso> <window-end-iso> [min-gap-minutes]",
      "",
      "example:",
      "  ical-gap-finder tuesday.ics 2026-09-22T09:00:00Z 2026-09-22T17:00:00Z 30",
    ].join("\n")
  );
}

function parseArgs(argv: string[]): Args {
  const [filePath, startIso, endIso, minGapArg] = argv;
  if (!filePath || !startIso || !endIso) {
    throw new Error("missing required arguments");
  }

  const windowStart = Date.parse(startIso);
  const windowEnd = Date.parse(endIso);
  if (Number.isNaN(windowStart) || Number.isNaN(windowEnd)) {
    throw new Error("window start/end must be ISO 8601 timestamps");
  }

  const minGapMinutes = minGapArg !== undefined ? Number(minGapArg) : 30;
  if (Number.isNaN(minGapMinutes) || minGapMinutes < 0) {
    throw new Error("min-gap-minutes must be a non-negative number");
  }

  return { filePath, windowStart, windowEnd, minGapMinutes };
}

function main(): void {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    console.error("");
    printUsage();
    process.exitCode = 1;
    return;
  }

  const text = readFileSync(args.filePath, "utf8");
  const events = parseIcs(text);
  const busy = computeBusyIntervals(events);
  const gaps = findFreeGaps(busy, args.windowStart, args.windowEnd, args.minGapMinutes * 60000);

  if (gaps.length === 0) {
    console.log("no free gaps found in that window");
    return;
  }

  for (const gap of gaps) {
    const start = new Date(gap.start).toISOString();
    const end = new Date(gap.end).toISOString();
    console.log(`${start}  ->  ${end}  (${formatDuration(gap.end - gap.start)})`);
  }
}

main();
