/** The game's calendar: day 1 is Month 1, Week 1, Day 1; a month is four weeks of seven days. */
export function calendar(day: number): { month: number; week: number; day: number } {
  const d = day - 1;
  return { month: Math.floor(d / 28) + 1, week: Math.floor((d % 28) / 7) + 1, day: (d % 7) + 1 };
}

/** "Month 1, Week 2, Day 3" (or "Month: 1, ...", or in the game's own words). */
export function dateLine(day: number, sep = " ", [month, week, today] = ["Month", "Week", "Day"]): string {
  const c = calendar(day);
  return `${month}${sep}${c.month}, ${week}${sep}${c.week}, ${today}${sep}${c.day}`;
}

/** Month, week and day, in that order (for a translated "Month %1, Week %2, Day %3"). */
export function dateParts(day: number): [number, number, number] {
  const c = calendar(day);
  return [c.month, c.week, c.day];
}

/** Weeks since the game began (0 in the first week): what "once a week" counts by. */
export function weekIndex(day: number): number {
  return Math.floor((day - 1) / 7);
}

/** The first day of a week (day 1 too). */
export const startsWeek = (day: number) => (day - 1) % 7 === 0;
/** The first day of a month (day 1 too). */
export const startsMonth = (day: number) => (day - 1) % 28 === 0;
