import { DateTime } from 'luxon';

export function toUtcIso(dateStr, timezone) {
    return DateTime.fromISO(dateStr, { zone: timezone }).toUTC().toISO({ suppressSeconds: true, suppressMilliseconds: true });
}
