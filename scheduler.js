/* Hyperborea Roadmap Scheduling Engine v4.1 — two-week sprints.
 * Default roadmap start: 2026-07-13 (Monday).
 * Default GD availability month: 2026-07.
 * Capacity inputs remain monthly planning values and are converted using
 * 20 working days/month. Therefore every 10-workday sprint receives half.
 *
 * Rules:
 * - Priority: Critical > High > Medium > Low.
 * - One person maximum per feature stage: 1 mday/workday, 10 mdays/sprint.
 * - GD and TD share Design capacity.
 * - GD tasks cannot start before the global GD availability month.
 * - DEV, Animation and TD start only after the feature's GD finishes.
 * - Features with GD=0 are available from the roadmap start.
 * - TD must finish no earlier than both DEV and Animation.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HyperboreaScheduler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const PRIORITY_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const WORKDAYS_PER_MONTH = 20;
  const WORKDAYS_PER_SPRINT = 10;
  const CALENDAR_DAYS_PER_SPRINT = 14;
  const SPRINT_NUMBER_BASE = '2025-11-17';
  const DEFAULTS = Object.freeze({
    roadmapStart: '2026-07-13',
    gdAvailabilityMonth: '2026-07',
    designCapacity: 60,
    devCapacity: 100,
    animCapacity: 40,
    perFeatureCapacity: 20
  });

  function normalizePriority(value) {
    const text = String(value || '').trim();
    const exact = Object.keys(PRIORITY_RANK).find(x => x.toLowerCase() === text.toLowerCase());
    return exact || 'Low';
  }

  function parseDate(value) {
    if (value instanceof Date) return new Date(value);
    const [year, month, day] = String(value).split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  }

  function parseMonth(value) {
    const [year, month] = String(value).split('-').map(Number);
    return new Date(year, month - 1, 1, 12, 0, 0);
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function addDays(date, count) {
    const result = new Date(date);
    result.setDate(result.getDate() + count);
    return result;
  }

  function daysBetween(a, b) {
    const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const end = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((end - start) / 86400000);
  }

  function sprintIndexForDate(startDate, date) {
    return Math.max(0, Math.floor(daysBetween(startDate, date) / CALENDAR_DAYS_PER_SPRINT));
  }

  function sprintKey(index) {
    return `S${index + 1}`;
  }

  function firstWorkdayOnOrAfter(date) {
    const result = new Date(date);
    while (result.getDay() === 0 || result.getDay() === 6) result.setDate(result.getDate() + 1);
    return result;
  }

  function buildWorkdays(startDate, horizonYears, capacities) {
    const end = new Date(startDate.getFullYear() + horizonYears, startDate.getMonth(), startDate.getDate(), 12);
    const days = [];
    const cursor = new Date(startDate);
    const sprintNumberOffset = Math.floor(daysBetween(parseDate(SPRINT_NUMBER_BASE), startDate) / CALENDAR_DAYS_PER_SPRINT);
    const daily = {
      design: capacities.design / WORKDAYS_PER_MONTH,
      dev: capacities.dev / WORKDAYS_PER_MONTH,
      anim: capacities.anim / WORKDAYS_PER_MONTH,
      perFeature: capacities.perFeature / WORKDAYS_PER_MONTH,
    };

    while (cursor < end) {
      if (cursor.getDay() !== 0 && cursor.getDay() !== 6) {
        const sprintIndex = sprintIndexForDate(startDate, cursor);
        days.push({
          date: new Date(cursor),
          sprintIndex,
          sprint: sprintKey(sprintIndex + sprintNumberOffset),
          designCap: daily.design,
          devCap: daily.dev,
          animCap: daily.anim,
          featureCap: daily.perFeature,
          usedDesign: 0,
          usedDev: 0,
          usedAnim: 0,
          gd: [], dev: [], anim: [], td: []
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  function remainingCapacity(day, resource) {
    if (resource === 'design') return day.designCap - day.usedDesign;
    if (resource === 'anim') return day.animCap - day.usedAnim;
    return day.devCap - day.usedDev;
  }

  function consume(day, resource, stage, featureId, amount) {
    if (resource === 'design') day.usedDesign += amount;
    else if (resource === 'anim') day.usedAnim += amount;
    else day.usedDev += amount;
    day[stage].push({ featureId, amount });
  }

  function compareTasks(a, b) {
    const rank = PRIORITY_RANK[a.feature.priority] - PRIORITY_RANK[b.feature.priority];
    return rank || a.feature.order - b.feature.order;
  }

  function allocateParallelForward(days, tasks, resource, stage, allocationKey) {
    let unfinished = tasks.filter(task => task.remaining > 1e-8);
    let dayIndex = 0;

    while (unfinished.length) {
      if (dayIndex >= days.length) throw new Error(`Недостаточный горизонт для ${stage}`);
      let available = remainingCapacity(days[dayIndex], resource);
      const ready = unfinished.filter(task => task.release <= dayIndex).sort(compareTasks);

      if (!ready.length) {
        dayIndex = Math.max(dayIndex + 1, Math.min(...unfinished.map(task => task.release)));
        continue;
      }

      for (const task of ready) {
        if (available <= 1e-8) break;
        const amount = Math.min(days[dayIndex].featureCap, task.remaining, available);
        if (amount <= 1e-8) continue;
        consume(days[dayIndex], resource, stage, task.feature.id, amount);
        task.allocation.push({ index: dayIndex, amount });
        task.remaining -= amount;
        available -= amount;
      }

      unfinished = unfinished.filter(task => task.remaining > 1e-8);
      dayIndex++;
    }

    for (const task of tasks) task.feature[allocationKey] = task.allocation;
  }

  function lastIndex(allocation, fallback = 0) {
    return allocation.length ? allocation[allocation.length - 1].index : fallback;
  }

  function firstDayIndexOnOrAfter(days, targetDate) {
    const index = days.findIndex(day => day.date >= targetDate);
    if (index < 0) throw new Error('Дата доступности GD находится за горизонтом планирования');
    return index;
  }

  function schedule(rawFeatures, startDateValue, gdAvailableMonthValue, capacities) {
    const startDate = parseDate(startDateValue);
    if (startDate.getDay() !== 1) throw new Error('Начало roadmap должно приходиться на понедельник');

    const gdAvailableDate = firstWorkdayOnOrAfter(parseMonth(gdAvailableMonthValue));
    if (gdAvailableDate < startDate) gdAvailableDate.setTime(startDate.getTime());

    const days = buildWorkdays(startDate, 8, capacities);
    const gdReleaseIndex = firstDayIndexOnOrAfter(days, gdAvailableDate);

    const features = rawFeatures.map(feature => ({
      ...feature,
      priorityDisplay: feature.priority,
      priority: normalizePriority(feature.priority),
      gdAlloc: [], devAlloc: [], animAlloc: [], tdAlloc: []
    })).sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.order - b.order);

    const makeTasks = (estimateKey, releaseFn) => features
      .filter(feature => feature[estimateKey] > 0)
      .map(feature => ({ feature, release: releaseFn(feature), remaining: feature[estimateKey], allocation: [] }));

    // All GD work is globally blocked until the selected month.
    allocateParallelForward(days, makeTasks('gd', () => gdReleaseIndex), 'design', 'gd', 'gdAlloc');

    // Features without GD are not blocked by the global GD availability date.
    const releaseAfterGd = feature => feature.gdAlloc.length ? lastIndex(feature.gdAlloc) + 1 : 0;

    allocateParallelForward(days, makeTasks('dev', releaseAfterGd), 'dev', 'dev', 'devAlloc');
    allocateParallelForward(days, makeTasks('anim', releaseAfterGd), 'anim', 'anim', 'animAlloc');

    // TD is fitted into remaining Design capacity, ending at or after the later of DEV/Animation.
    for (const feature of features) {
      if (feature.td <= 0) continue;
      const release = releaseAfterGd(feature);
      const devFinish = lastIndex(feature.devAlloc, release);
      const animFinish = lastIndex(feature.animAlloc, release);
      const target = Math.max(devFinish, animFinish, release);
      let end = target;

      function availableAt(index) {
        return Math.min(Math.max(0, remainingCapacity(days[index], 'design')), days[index].featureCap);
      }

      function cumulativeThrough(index) {
        let total = 0;
        for (let i = release; i <= index; i++) total += availableAt(i);
        return total;
      }

      while (end < days.length && (availableAt(end) <= 1e-8 || cumulativeThrough(end) + 1e-8 < feature.td)) end++;
      if (end >= days.length) throw new Error(`Недостаточный горизонт TD: ${feature.name}`);

      let remaining = feature.td;
      const allocation = [];
      for (let i = end; i >= release && remaining > 1e-8; i--) {
        const amount = Math.min(availableAt(i), remaining);
        if (amount <= 1e-8) continue;
        consume(days[i], 'design', 'td', feature.id, amount);
        allocation.push({ index: i, amount });
        remaining -= amount;
      }
      feature.tdAlloc = allocation.sort((a, b) => a.index - b.index);
    }

    // Validate dependencies and sprint-level capacities.
    const sprintCaps = {
      design: capacities.design / 2,
      dev: capacities.dev / 2,
      anim: capacities.anim / 2,
      perFeature: capacities.perFeature / 2,
    };

    for (const feature of features) {
      const gdEnd = feature.gdAlloc.length ? lastIndex(feature.gdAlloc) : -1;
      for (const key of ['devAlloc', 'animAlloc', 'tdAlloc']) {
        if (feature[key].length && feature[key][0].index <= gdEnd) {
          throw new Error(`Нарушена зависимость GD: ${feature.name} / ${key}`);
        }
      }

      if (feature.tdAlloc.length) {
        const tdEnd = lastIndex(feature.tdAlloc);
        const target = Math.max(lastIndex(feature.devAlloc, 0), lastIndex(feature.animAlloc, 0));
        if (tdEnd < target) throw new Error(`TD закончился раньше production: ${feature.name}`);
      }

      for (const key of ['gdAlloc', 'devAlloc', 'animAlloc', 'tdAlloc']) {
        const bySprint = new Map();
        for (const item of feature[key]) {
          const sprint = days[item.index].sprint;
          bySprint.set(sprint, (bySprint.get(sprint) || 0) + item.amount);
        }
        for (const [sprint, amount] of bySprint) {
          if (amount > sprintCaps.perFeature + 1e-6) {
            throw new Error(`Лимит на фичу превышен: ${feature.name} / ${key} / ${sprint}`);
          }
        }
      }
    }

    const sprintUsage = new Map();
    for (const day of days) {
      if (day.usedDesign > day.designCap + 1e-6) throw new Error(`Design overload ${dateKey(day.date)}`);
      if (day.usedDev > day.devCap + 1e-6) throw new Error(`Dev overload ${dateKey(day.date)}`);
      if (day.usedAnim > day.animCap + 1e-6) throw new Error(`Anim overload ${dateKey(day.date)}`);

      if (!sprintUsage.has(day.sprint)) sprintUsage.set(day.sprint, { design: 0, dev: 0, anim: 0 });
      const usage = sprintUsage.get(day.sprint);
      usage.design += day.usedDesign;
      usage.dev += day.usedDev;
      usage.anim += day.usedAnim;
    }

    for (const [sprint, usage] of sprintUsage) {
      if (usage.design > sprintCaps.design + 1e-6) throw new Error(`Design sprint overload ${sprint}`);
      if (usage.dev > sprintCaps.dev + 1e-6) throw new Error(`Dev sprint overload ${sprint}`);
      if (usage.anim > sprintCaps.anim + 1e-6) throw new Error(`Anim sprint overload ${sprint}`);
    }

    let finalIndex = 0;
    for (const feature of features) {
      for (const key of ['gdAlloc', 'devAlloc', 'animAlloc', 'tdAlloc']) {
        if (feature[key].length) finalIndex = Math.max(finalIndex, lastIndex(feature[key]));
      }
    }

    return {
      days: days.slice(0, finalIndex + 1),
      features,
      startDate,
      endDate: days[finalIndex].date,
      gdAvailableDate,
      gdReleaseIndex,
      capacities: { ...capacities },
      sprintCapacities: sprintCaps,
      constants: { WORKDAYS_PER_MONTH, WORKDAYS_PER_SPRINT, CALENDAR_DAYS_PER_SPRINT }
    };
  }

  return {
    DEFAULTS,
    schedule, normalizePriority, parseDate, parseMonth, dateKey, addDays, daysBetween,
    sprintIndexForDate, sprintKey, firstWorkdayOnOrAfter
  };
});
