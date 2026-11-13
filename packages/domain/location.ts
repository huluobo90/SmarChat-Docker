import ct from "countries-and-timezones";

export interface CustomerLocation {
  country: string;
  timeZone: string;
  source: "manual" | "phone" | "unknown";
}
const names = new Intl.DisplayNames(["zh-CN"], { type: "region" });
export const countryOptions: { code: string; name: string; zones: string[] }[] =
  Object.values(ct.getAllCountries())
    .map((country) => ({
      code: country.id,
      name: names.of(country.id) || country.name,
      zones: country.timezones.filter((zone) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
export function countryName(code: string): string {
  return (
    countryOptions.find((country) => country.code === code)?.name ??
    "国家待确认"
  );
}
export function validateLocation(country: string, timeZone: string): void {
  if (!country && !timeZone) return;
  const entry = countryOptions.find((value) => value.code === country);
  if (!entry || (timeZone && !entry.zones.includes(timeZone)))
    throw new Error("请选择有效的国家和对应时区");
}
export function localClock(timeZone: string, now = Date.now()): string {
  if (!timeZone) return "当地时间待确认";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(now);
  } catch {
    return "当地时间待确认";
  }
}
