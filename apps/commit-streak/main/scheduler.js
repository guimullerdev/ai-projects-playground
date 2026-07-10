// Escalating reminders. Runs off a 60s wall-clock tick (not setTimeout to an
// exact hour) because the laptop sleeps and setTimeout across a sleep is not
// reliable — a plain "is it past HH:MM yet, and did I already fire it today"
// check survives sleep/wake fine as long as something re-ticks after resume.

function parseHM(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesNow(now) {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Pure decision function: given config + persisted flags + today's commit
 * status, what should happen right now?
 *
 * Returns:
 *   { iconState: 'done' | 'rest' | 'ok' | 'late', toFire: {time, tone} | null }
 */
function evaluate(config, todayFlags, { committedToday, isRestDay, snoozedUntil }, now = new Date()) {
  if (committedToday) return { iconState: 'done', toFire: null };
  if (isRestDay) return { iconState: 'rest', toFire: null };

  const nowMin = minutesNow(now);
  const snoozed = snoozedUntil && now.getTime() < new Date(snoozedUntil).getTime();

  const iconState = nowMin >= parseHM(config.lateIconHour) ? 'late' : 'ok';

  if (snoozed) return { iconState, toFire: null };

  // fire the latest schedule slot whose time has passed and hasn't fired yet
  let toFire = null;
  for (const slot of config.notifySchedule) {
    if (nowMin >= parseHM(slot.time) && !todayFlags[slot.time]) {
      toFire = slot; // keep going — a later slot that's also due wins
    }
  }
  return { iconState, toFire };
}

module.exports = { evaluate, parseHM, minutesNow };
