(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HyperboreaLocationScheduler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const WORKDAYS_PER_MONTH = 20;
  const WORKDAYS_PER_SPRINT = 10;
  const CALENDAR_DAYS_PER_SPRINT = 14;
  const EPSILON = 1e-8;
  const PRIORITY_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };

  function normalizePriority(value) {
    const text = String(value || '').trim();
    return Object.keys(PRIORITY_RANK).find(key => key.toLowerCase() === text.toLowerCase()) || 'Medium';
  }

  function parseDate(value) {
    if (value instanceof Date) return new Date(value);
    const [year, month, day] = String(value).split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
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

  function buildWorkdays(startDate, capacities, horizonYears) {
    const end = new Date(startDate.getFullYear() + horizonYears, startDate.getMonth(), startDate.getDate(), 12);
    const dailyCapacities = Object.fromEntries(
      Object.entries(capacities).map(([key, value]) => [key, value / WORKDAYS_PER_MONTH])
    );
    const days = [];
    const cursor = new Date(startDate);
    while (cursor < end) {
      if (cursor.getDay() !== 0 && cursor.getDay() !== 6) {
        const sprintIndex = sprintIndexForDate(startDate, cursor);
        days.push({
          date: new Date(cursor),
          sprintIndex,
          sprint: `S${sprintIndex + 1}`,
          capacities: { ...dailyCapacities },
          used: Object.fromEntries(Object.keys(capacities).map(key => [key, 0])),
          allocations: []
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  function validateDependencies(stageIds, dependencies) {
    const unique = new Set();
    const outgoing = new Map([...stageIds].map(id => [id, []]));
    const indegree = new Map([...stageIds].map(id => [id, 0]));
    for (const dependency of dependencies) {
      if (!stageIds.has(dependency.from) || !stageIds.has(dependency.to)) {
        throw new Error(`Dependency ссылается на отсутствующий этап: ${dependency.from} → ${dependency.to}`);
      }
      const key = `${dependency.from}|${dependency.to}|${dependency.type}`;
      if (unique.has(key)) throw new Error(`Повтор dependency: ${dependency.from} → ${dependency.to} (${dependency.type})`);
      unique.add(key);
      outgoing.get(dependency.from).push(dependency.to);
      indegree.set(dependency.to, indegree.get(dependency.to) + 1);
    }

    const queue = [...stageIds].filter(id => indegree.get(id) === 0);
    let visited = 0;
    while (queue.length) {
      const current = queue.shift();
      visited++;
      for (const next of outgoing.get(current)) {
        indegree.set(next, indegree.get(next) - 1);
        if (indegree.get(next) === 0) queue.push(next);
      }
    }
    if (visited !== stageIds.size) throw new Error('Dependencies содержат циклическую зависимость');
  }

  function compareTasks(a, b) {
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.locationOrder - b.locationOrder || a.stageOrder - b.stageOrder;
  }

  function schedule(input, dependencies, stageCapacities, startDateValue, capacities) {
    const startDate = parseDate(startDateValue);
    if (startDate.getDay() !== 1) throw new Error('Начало roadmap должно приходиться на понедельник');
    if (!input || !Array.isArray(input.locations) || !input.locations.length) throw new Error('Нет локаций для расчёта');
    for (const [department, capacity] of Object.entries(capacities || {})) {
      if (!Number.isFinite(capacity) || capacity <= 0) throw new Error(`Capacity ${department} должна быть положительным числом`);
    }

    const inputTasks = input.locations.flatMap(location => location.tasks);
    const stageIds = new Set(inputTasks.map(task => task.stageId));
    const activeDependencies = dependencies.filter(dependency =>
      stageIds.has(dependency.from) && stageIds.has(dependency.to)
    );
    validateDependencies(stageIds, activeDependencies);
    for (const stageId of stageIds) {
      const maxParallelPeople = stageCapacities && stageCapacities[stageId];
      if (!Number.isInteger(maxParallelPeople) || maxParallelPeople < 0) {
        throw new Error(`Некорректный Max Parallel People: ${stageId}`);
      }
    }
    const stageOrder = new Map([...stageIds].map((id, index) => [id, index]));
    const locations = input.locations.map(location => ({
      ...location,
      priorityDisplay: location.priority,
      priority: normalizePriority(location.priority),
      tasks: location.tasks.map(task => ({
        ...task,
        locationId: location.id,
        locationName: location.name,
        locationOrder: location.order,
        priority: normalizePriority(location.priority),
        stageOrder: stageOrder.get(task.stageId),
        maxParallelPeople: stageCapacities[task.stageId],
        remaining: task.estimate,
        allocation: [],
        completeIndex: task.estimate <= EPSILON ? -1 : null,
        incoming: []
      }))
    }));
    const tasks = locations.flatMap(location => location.tasks);
    const taskById = new Map(tasks.map(task => [task.id, task]));

    for (const location of locations) {
      const byStage = new Map(location.tasks.map(task => [task.stageId, task]));
      for (const dependency of activeDependencies) {
        const from = byStage.get(dependency.from);
        const to = byStage.get(dependency.to);
        if (!from || !to) continue;
        to.incoming.push({ ...dependency, taskId: from.id });
      }
    }

    const days = buildWorkdays(startDate, capacities, 8);
    let unfinished = tasks.filter(task => task.remaining > EPSILON).length;
    let dayIndex = 0;

    while (unfinished > 0) {
      if (dayIndex >= days.length) throw new Error('Недостаточный горизонт планирования (8 лет)');
      const day = days[dayIndex];
      for (const departmentId of Object.keys(capacities)) {
        let available = day.capacities[departmentId];
        if (available <= EPSILON) continue;
        const ready = tasks.filter(task => {
          if (task.departmentId !== departmentId || task.remaining <= EPSILON) return false;
          return task.incoming.filter(item => item.type === 'FS').every(item => {
            const predecessor = taskById.get(item.taskId);
            return predecessor.completeIndex !== null && dayIndex >= predecessor.completeIndex + 1 + item.lag;
          });
        }).sort(compareTasks);

        for (const task of ready) {
          if (available <= EPSILON) break;
          const taskCapacity = task.maxParallelPeople === 0 ? available : task.maxParallelPeople;
          let amount = Math.min(taskCapacity, task.remaining, available);
          const wouldFinish = amount + EPSILON >= task.remaining;
          if (wouldFinish) {
            const finishAllowed = task.incoming.filter(item => item.type === 'FF').every(item => {
              const predecessor = taskById.get(item.taskId);
              return predecessor.completeIndex !== null && dayIndex >= predecessor.completeIndex + item.lag;
            });
            if (!finishAllowed) amount = 0;
          }
          if (amount <= EPSILON) continue;
          task.remaining -= amount;
          if (task.remaining <= EPSILON) {
            task.remaining = 0;
            task.completeIndex = dayIndex;
            unfinished--;
          }
          task.allocation.push({ index: dayIndex, amount });
          day.used[departmentId] += amount;
          day.allocations.push({ taskId: task.id, locationId: task.locationId, stageId: task.stageId, departmentId, amount });
          available -= amount;
        }
      }
      dayIndex++;
    }

    const finalIndex = Math.max(0, ...tasks.map(task => task.completeIndex || 0));
    const usedDays = days.slice(0, finalIndex + 1);
    const sprintCapacities = Object.fromEntries(
      Object.entries(capacities).map(([key, value]) => [key, value / 2])
    );

    for (const task of tasks) {
      const allocated = task.allocation.reduce((sum, item) => sum + item.amount, 0);
      if (Math.abs(allocated - task.estimate) > 1e-6) throw new Error(`Неполная аллокация: ${task.locationName} / ${task.stageName}`);
      for (const item of task.incoming) {
        const predecessor = taskById.get(item.taskId);
        if (item.type === 'FS' && task.allocation.length && task.allocation[0].index < predecessor.completeIndex + 1 + item.lag) {
          throw new Error(`Нарушена FS dependency: ${predecessor.stageName} → ${task.stageName}`);
        }
        if (item.type === 'FF' && task.completeIndex < predecessor.completeIndex + item.lag) {
          throw new Error(`Нарушена FF dependency: ${predecessor.stageName} → ${task.stageName}`);
        }
      }
    }

    for (const day of usedDays) {
      for (const departmentId of Object.keys(capacities)) {
        if (day.used[departmentId] > day.capacities[departmentId] + 1e-6) {
          throw new Error(`Capacity overload: ${departmentId} / ${dateKey(day.date)}`);
        }
      }
    }

    return {
      locations,
      tasks,
      dependencies: activeDependencies,
      stageCapacities: { ...stageCapacities },
      days: usedDays,
      startDate,
      endDate: usedDays[usedDays.length - 1].date,
      capacities: { ...capacities },
      sprintCapacities,
      constants: { WORKDAYS_PER_MONTH, WORKDAYS_PER_SPRINT, CALENDAR_DAYS_PER_SPRINT }
    };
  }

  return {
    schedule,
    normalizePriority,
    parseDate,
    dateKey,
    addDays,
    daysBetween,
    sprintIndexForDate
  };
});
