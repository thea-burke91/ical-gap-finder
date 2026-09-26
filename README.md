# ical-gap-finder

Find free time slots in an `.ics` calendar file, from the command line.

Every calendar app is happy to show you where you're *busy*. Finding a
30-minute hole across three exported calendars, by eye, is the annoying
part. This tool takes one `.ics` file, a time window, and a minimum gap
length, and prints the openings.

## Usage

```
ical-gap-finder <file.ics> <window-start-iso> <window-end-iso> [min-gap-minutes]
```

Example, given `tuesday.ics`:

```
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:standup@example.com
DTSTART:20260922T090000Z
DTEND:20260922T091500Z
SUMMARY:Standup
END:VEVENT
BEGIN:VEVENT
UID:review@example.com
DTSTART:20260922T110000Z
DTEND:20260922T120000Z
SUMMARY:Design review
END:VEVENT
END:VCALENDAR
```

Running:

```
$ ical-gap-finder tuesday.ics 2026-09-22T09:00:00Z 2026-09-22T17:00:00Z 30
2026-09-22T09:15:00.000Z  ->  2026-09-22T11:00:00.000Z  (1h 45m)
2026-09-22T12:00:00.000Z  ->  2026-09-22T17:00:00.000Z  (5h)
```

The last argument is optional and defaults to 30 minutes; gaps shorter
than that are dropped.

## Building

```
npm run build
node dist/cli.js tuesday.ics 2026-09-22T09:00:00Z 2026-09-22T17:00:00Z
```

No dependencies, so there's nothing to install first.

## Testing

```
npm test
```

Compiles with `tsc` and runs the `*.test.ts` files next to each module
with Node's built-in test runner. No test framework dependency either.

## Current limitations

- `RRULE` recurrence is expanded for `FREQ=DAILY/WEEKLY/MONTHLY/YEARLY`
  with `INTERVAL`, `COUNT`, `UNTIL`, and `BYDAY` (weekly only). Anything
  else in the rule -- `BYMONTHDAY`, `BYSETPOS`, `RDATE`/`EXDATE`, ordinal
  `BYDAY` like `1MO` -- falls back to a single occurrence at the event's
  own `DTSTART`/`DTEND`.
- No timezone database. `DTSTART;TZID=...` values are read as if they
  were UTC. Anything with a trailing `Z`, or already in UTC, is exact.
- `VALARM`, `VTIMEZONE`, and other non-`VEVENT` blocks are ignored.

## Design

`src/ics.ts`, `src/rrule.ts`, and `src/gaps.ts` export only pure
functions: given the same input they always return the same output, with
no file or clock access. `src/cli.ts` is the only file that touches
`process.argv` or the filesystem, and it's a thin wrapper around the
other three. That split is what makes those three modules
straightforward to unit test, which is what the `*.test.ts` files next
to them do.

## License

MIT, see [LICENSE](LICENSE).
