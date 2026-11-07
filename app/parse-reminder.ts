// Turns free text like "call mom monday at 5pm" into a reminder.
//
// Time phrases can appear anywhere in the message, in many forms:
//   relative   "in 30 minutes", "in an hour and a half", "2 hours from now", "in 3 days"
//   days       "today", "tonight", "tomorrow", "day after tomorrow", "next week"
//   weekdays   "monday", "on fri", "next tuesday" (never today; today's name means next week)
//   dates      "nov 12", "12th of november", "11/12", "11/12/2027", "the 15th"
//   times      "5pm", "5:30 p.m.", "17:30", "at 5", "5 o'clock", "noon", "quarter to 6"
//   periods    "morning", "this afternoon", "in the evening", "tonight"
// Whatever is left after removing the time phrases becomes the reminder text.

export type ParseResult =
  | { ok: true; body: string; remindAt: number }
  | { ok: false; error: string };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const numberWords: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  thirty: 30, forty: 40, "forty-five": 45, "forty five": 45, fifty: 50,
  sixty: 60, ninety: 90, few: 3, "a few": 3, couple: 2, "a couple": 2,
};

const QTY =
  "(?:\\d+(?:\\.\\d+)?|forty[- ]five|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|ninety|a\\s+few|few|a\\s+couple(?:\\s+of)?|couple(?:\\s+of)?)";
const UNIT =
  "(?:minutes?|mins?|m|hours?|hrs?|hr|h|days?|weeks?|wks?)";
const PART = `${QTY}\\s*${UNIT}`;
const PARTS = `${PART}(?:\\s*(?:,|and)\\s*${PART})*(?:\\s+and\\s+a\\s+half)?`;

const weekdayIndex: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};
const monthIndex: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const MONTH =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const ORD = "(?:st|nd|rd|th)?";
const AT = "(?:(?:at|by|around|@)\\s*)?";

type Period = "morning" | "afternoon" | "evening" | "night";
const periodDefaultHour: Record<Period, number> = {
  morning: 9, afternoon: 15, evening: 18, night: 20,
};

export function parseReminder(text: string, now = new Date()): ParseResult {
  // Matched phrases are blanked out of `rest` (same length), so what is left
  // is the reminder text and later patterns can't reuse the same words.
  let rest = ` ${text.trim()} `;
  function take(pattern: RegExp): RegExpExecArray | null {
    const m = pattern.exec(rest);
    if (m) {
      rest =
        rest.slice(0, m.index) +
        " ".repeat(m[0].length) +
        rest.slice(m.index + m[0].length);
    }
    return m;
  }

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const addDays = (d: Date, n: number) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  let offsetMs = 0; // "in 30 minutes": an exact moment from now
  let day: Date | null = null; // the day the reminder falls on
  let keepCurrentTime = false; // "in 3 days" with no time keeps the time of day
  let hour: number | null = null;
  let minute = 0;
  let meridiem: "am" | "pm" | null = null;
  let period: Period | null = null;

  // --- Relative offsets -------------------------------------------------
  const relative =
    take(new RegExp(`\\b(?:in|after)\\s+(${PARTS}|half\\s+an?\\s+hour)\\b`, "i")) ??
    take(new RegExp(`\\b(${PARTS})\\s+from\\s+now\\b`, "i"));
  if (relative) {
    const phrase = relative[1].toLowerCase();
    let ms = 0;
    let lastUnit = 0;
    if (/^half\s+an?\s+hour$/.test(phrase)) ms = HOUR / 2;
    const partRe = new RegExp(`(${QTY})\\s*(${UNIT})\\b`, "gi");
    for (const [, qty, unit] of phrase.matchAll(partRe)) {
      const q = qty.replace(/\s+of$/, "").replace(/\s+/g, " ");
      const n = numberWords[q] ?? Number(q);
      lastUnit = unit.startsWith("w")
        ? 7 * DAY
        : unit.startsWith("d")
          ? DAY
          : unit.startsWith("h")
            ? HOUR
            : MINUTE;
      ms += n * lastUnit;
    }
    if (/and\s+a\s+half$/.test(phrase)) ms += lastUnit / 2;

    if (ms >= DAY && ms % DAY === 0) {
      // Whole days or weeks pick a day; a time can still be given for it.
      day = addDays(todayStart, ms / DAY);
      keepCurrentTime = true;
    } else {
      offsetMs = ms;
    }
  }

  // --- Calendar dates ---------------------------------------------------
  let m: RegExpExecArray | null;
  if (
    (m = take(new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?${MONTH}\\s+(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?\\b`, "i")))
  ) {
    day = calendarDay(monthIndex[m[1].slice(0, 3).toLowerCase()], Number(m[2]), m[3]);
  } else if (
    (m = take(new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH}(?:,?\\s+(\\d{4}))?\\b`, "i")))
  ) {
    day = calendarDay(monthIndex[m[2].slice(0, 3).toLowerCase()], Number(m[1]), m[3]);
  } else if ((m = take(/\b(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/i))) {
    day = calendarDay(Number(m[1]) - 1, Number(m[2]), m[3]);
  } else if ((m = take(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i))) {
    // "the 15th": this month, or next month if it has passed.
    const n = Number(m[1]);
    let d = new Date(now.getFullYear(), now.getMonth(), n);
    if (d < todayStart) d = new Date(now.getFullYear(), now.getMonth() + 1, n);
    day = d.getDate() === n ? d : null;
    if (!day) return { ok: false, error: "That date doesn’t exist." };
  }

  function calendarDay(month: number, date: number, yearText?: string) {
    let year = yearText
      ? Number(yearText.length === 2 ? `20${yearText}` : yearText)
      : now.getFullYear();
    let d = new Date(year, month, date);
    // No year given and the date has passed: it means next year.
    if (!yearText && d < todayStart) d = new Date(++year, month, date);
    return d.getMonth() === month ? d : new Date(NaN);
  }
  if (day && isNaN(day.getTime())) {
    return { ok: false, error: "That date doesn’t exist." };
  }

  // --- Weekdays ---------------------------------------------------------
  const weekday =
    take(/\b(?:(on|this|next|coming|this\s+coming)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i) ??
    take(/\b(?:(on|this|next|coming)\s+)?(tues?|weds?|thu|thur|thurs|fri)\b\.?/i) ??
    // "mon", "sat" and "sun" are also ordinary words, so they need a lead-in.
    take(/\b(on|this|next|coming)\s+(mon|sat|sun)\b\.?/i);
  if (weekday && !day) {
    const target = weekdayIndex[weekday[2].slice(0, 3).toLowerCase()];
    let diff = (target - now.getDay() + 7) % 7;
    // Naming today's weekday means next week ("monday" said on a Monday),
    // unless it's "this monday".
    if (diff === 0 && weekday[1]?.toLowerCase() !== "this") diff = 7;
    day = addDays(todayStart, diff);
  }

  // --- Day words --------------------------------------------------------
  if (take(/\b(?:the\s+)?day\s+after\s+(?:tomorrow|tmrw|tmr)\b/i)) {
    day ??= addDays(todayStart, 2);
  } else if (take(/\b(?:tomorrow|tmrw|tmr|tmw)\b/i)) {
    day ??= addDays(todayStart, 1);
  } else if (take(/\btonight\b/i)) {
    day ??= todayStart;
    period = "night";
  } else if (take(/\b(?:later\s+)?today\b/i)) {
    day ??= todayStart;
  } else if (take(/\bnext\s+week\b/i)) {
    day ??= addDays(todayStart, 7);
  }

  // --- Part of the day --------------------------------------------------
  const periodMatch = take(
    /\b(?:in\s+the\s+|this\s+|at\s+)?(morning|afternoon|evening|night)\b/i,
  );
  if (periodMatch) period = periodMatch[1].toLowerCase() as Period;

  // --- Clock times ------------------------------------------------------
  if ((m = take(new RegExp(`\\b${AT}(noon|midday|midnight)\\b`, "i")))) {
    hour = m[1].toLowerCase() === "midnight" ? 0 : 12;
    meridiem = hour === 0 ? "am" : "pm";
    if (hour === 0 && !day) day = addDays(todayStart, 1);
  } else if (
    (m = take(new RegExp(`\\b${AT}(half|quarter|\\d{1,2})\\s+(past|after|to|till|til|before)\\s+(\\d{1,2})(?:\\s*([ap])\\.?\\s?m\\b\\.?)?\\b`, "i")))
  ) {
    const amount = m[1].toLowerCase();
    const mins = amount === "half" ? 30 : amount === "quarter" ? 15 : Number(amount);
    const before = /^(to|till|til|before)$/i.test(m[2]);
    hour = Number(m[3]);
    minute = mins;
    if (before) {
      hour = (hour + 11) % 12 || 12;
      minute = 60 - mins;
    }
    if (m[4]) meridiem = m[4].toLowerCase() === "a" ? "am" : "pm";
  } else if (
    (m = take(new RegExp(`(?:\\b|@)${AT}(\\d{1,2})(?:[:.](\\d{2}))?\\s*([ap])\\.?\\s?m\\b\\.?`, "i")))
  ) {
    hour = Number(m[1]);
    minute = Number(m[2] ?? 0);
    meridiem = m[3].toLowerCase() === "a" ? "am" : "pm";
    if (hour === 0 || hour > 12) {
      return { ok: false, error: "That time doesn’t look right." };
    }
  } else if ((m = take(new RegExp(`(?:\\b|@)${AT}(\\d{1,2}):(\\d{2})\\b`, "i")))) {
    hour = Number(m[1]);
    minute = Number(m[2]);
    // "17:30" or "09:00" is a 24-hour time.
    if (hour > 12 || m[1].startsWith("0")) meridiem = hour >= 12 ? "pm" : "am";
  } else if (
    (m = take(/(?:\b(?:at|by|around)\s+|@\s*)(\d{1,2})(?:\s*o'?clock)?\b/i)) ??
    (m = take(/\b(\d{1,2})\s*o'?clock\b/i))
  ) {
    hour = Number(m[1]);
    if (hour > 12) meridiem = "pm";
  }

  if (hour !== null) {
    if (hour > 23 || minute > 59) {
      return { ok: false, error: "That time doesn’t look right." };
    }
    if (meridiem && hour <= 12 && hour > 0) {
      hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
    }
  }

  // --- Put it together --------------------------------------------------
  let remindAt: number;
  if (offsetMs > 0) {
    remindAt = now.getTime() + offsetMs;
  } else if (hour !== null) {
    let h = hour;
    const ambiguous = meridiem === null && hour >= 1 && hour <= 12;
    if (ambiguous && period) {
      h = period === "morning" ? hour % 12 : (hour % 12) + 12;
    }
    if (ambiguous && !period) {
      // "at 5" with no am/pm: on a later day, guess the usual waking hours
      // (7–11 morning, 12–6 afternoon/evening). Today, take the next one
      // that hasn't passed.
      const guess = hour >= 7 && hour <= 11 ? hour : (hour % 12) + 12;
      const base = day ?? todayStart;
      if (base.getTime() === todayStart.getTime()) {
        const options = [hour % 12, (hour % 12) + 12].map((hh) =>
          at(base, hh, minute),
        );
        const next = options.find((t) => t > now.getTime());
        if (next !== undefined) {
          h = new Date(next).getHours();
        } else {
          h = guess;
          if (!day) day = addDays(todayStart, 1);
        }
      } else {
        h = guess;
      }
    }
    remindAt = at(day ?? todayStart, h, minute);
    // A time with no day means the next time it comes around.
    if (!day && remindAt <= now.getTime()) {
      remindAt = at(addDays(todayStart, 1), h, minute);
    }
  } else if (day || period) {
    const d = day ?? todayStart;
    if (period) remindAt = at(d, periodDefaultHour[period], 0);
    else if (keepCurrentTime) remindAt = at(d, now.getHours(), now.getMinutes());
    else remindAt = at(d, 9, 0); // a day with no time defaults to 9:00 AM
    if (!day && remindAt <= now.getTime()) {
      remindAt = at(addDays(todayStart, 1), periodDefaultHour[period!], 0);
    }
  } else {
    return {
      ok: false,
      error:
        "I couldn’t find a time in that. Try “Call mom tomorrow at 5pm” or “Remind me in 30 minutes to study.”",
    };
  }

  if (remindAt <= now.getTime()) {
    return { ok: false, error: "That time has already passed." };
  }

  const body = cleanBody(rest);
  if (!body) return { ok: false, error: "What should I remind you about?" };
  if (body.length > 320) {
    return { ok: false, error: "Keep the description under 320 characters." };
  }
  return { ok: true, body, remindAt };
}

function at(day: Date, hour: number, minute: number) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).getTime();
}

// Strip "remind me to" and the little words left dangling around removed
// time phrases ("call mom on" -> "call mom").
function cleanBody(text: string) {
  let s = text.replace(/\s+/g, " ").trim();
  s = s.replace(
    /^(?:(?:hey|hi|ok|okay|please|pls|can you|could you|would you|will you)[\s,]+)*(?:remind me|remember|reminder|don'?t forget|set a reminder)\b[\s,:]*/i,
    "",
  );
  const lead = /^(?:to|that|about|of|on|at|by|in|for|and|then|,|:|-)\s+/i;
  const trail = /\s*(?:\b(?:on|at|by|in|for|and|then|from|until|the|please|pls)|[,:;-])$/i;
  for (let changed = true; changed; ) {
    const before = s;
    s = s.replace(lead, "").replace(trail, "").replace(/[\s.!?,]+$/, "").trim();
    changed = s !== before;
  }
  // Leftover connectors between two removed phrases ("call mom at  on").
  s = s.replace(/\s+(?:on|at|by)\s+(?=(?:on|at|by)\b)/gi, " ");
  return s;
}
