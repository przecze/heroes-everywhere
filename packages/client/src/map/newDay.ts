// The new day's card (VCMI's VisibleDateInfo): the day's own picture, NEWDAY, or NEWWEEKn on the
// first day of a week after the first, and the number over it ("Day 3" or, on a new week, "Week 2").
import { calendar, startsWeek, weekIndex } from "@heroes/core";

export function newDayCard(day: number): { def: string; newWeek: boolean; n: number } {
  const newWeek = startsWeek(day) && day > 1;
  return newWeek ? { def: `newweek${calendar(day).week}.def`, newWeek, n: weekIndex(day) + 1 } : { def: "newday.def", newWeek, n: calendar(day).day };
}
