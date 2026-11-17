/**
 * The date a snapshot is written for (#6, D-6, P-5). Normally today's date in the dashboard's
 * timezone. The Demo workflow passes SNAPSHOT_DATE, the date it took once at job start, so a run
 * that crosses midnight records day N's video in day N's file, not day N+1's.
 */
export function snapshotDate(env: Record<string, string | undefined>, now: Date, timezone: string): string {
  const given = env.SNAPSHOT_DATE;
  if (given) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(given);
    const [y, mo, d] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
    const day = new Date(Date.UTC(y, mo - 1, d));
    if (!m || day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) {
      throw new Error(`SNAPSHOT_DATE must be a real date as YYYY-MM-DD, got ${JSON.stringify(given)}`);
    }
    return given;
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
