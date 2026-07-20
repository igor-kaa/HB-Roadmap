(function() {
  'use strict';

  const Csv = HyperboreaLocationCsv;
  const Scheduler = HyperboreaLocationScheduler;
  const LEFT = 430;
  const TIMELINE_GUTTER = 18;
  const MIN_DAY_WIDTH = 3.65;
  const ROW_HEADER = 36;
  const LANE_HEIGHT = 22;
  const STORAGE_KEYS = Object.freeze({
    estimates: 'hyperborea.locations.estimates.v1',
    dependencies: 'hyperborea.locations.dependencies.v1',
    stageCapacities: 'hyperborea.locations.stage-capacities.v1',
    stageTeams: 'hyperborea.locations.stage-teams.v1'
  });
  const browserStorage = getBrowserStorage();
  const restoredStageTeams = restoreCsv(STORAGE_KEYS.stageTeams, Csv.parseStageTeams, Csv.DEFAULT_STAGE_TEAMS_CSV, 'Built-in stage teams');
  let stageTeams = restoredStageTeams.value;
  const restoredInput = restoreCsv(STORAGE_KEYS.estimates, text => Csv.parseCsv(text, stageTeams), Csv.DEFAULT_CSV, 'Built-in estimates');
  const restoredDependencies = restoreCsv(STORAGE_KEYS.dependencies, Csv.parseDependencies, Csv.DEFAULT_DEPENDENCIES_CSV, 'Built-in dependencies');
  const restoredStageCapacities = restoreCsv(STORAGE_KEYS.stageCapacities, Csv.parseStageCapacities, Csv.DEFAULT_STAGE_CAPACITY_CSV, 'Built-in parallelism');
  let input = restoredInput.value;
  let estimatesText = restoredInput.text;
  let dependencies = restoredDependencies.value;
  let stageCapacities = restoredStageCapacities.value;
  let csvSources = {
    estimates: restoredInput.name,
    dependencies: restoredDependencies.name,
    stageCapacities: restoredStageCapacities.name
  };
  let state = null;
  let selected = null;

  function getBrowserStorage() {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch (error) {
      return null;
    }
  }

  function restoreCsv(key, parser, defaultText, defaultName) {
    if (browserStorage) {
      try {
        const savedText = browserStorage.getItem(key);
        if (savedText) {
          const saved = JSON.parse(savedText);
          if (saved && typeof saved.text === 'string') {
            return { value: parser(saved.text), name: saved.name || 'Saved CSV', text: saved.text };
          }
        }
      } catch (error) {
        try { browserStorage.removeItem(key); } catch (storageError) { /* storage unavailable */ }
        console.warn(`Saved CSV ignored: ${key}`, error);
      }
    }
    return { value: parser(defaultText), name: defaultName, text: defaultText };
  }

  function saveCsv(key, name, text) {
    if (!browserStorage) return false;
    try {
      browserStorage.setItem(key, JSON.stringify({ name, text }));
      return true;
    } catch (error) {
      console.warn(`CSV could not be saved: ${key}`, error);
      return false;
    }
  }

  function resetSavedCsv() {
    if (browserStorage) {
      for (const key of Object.values(STORAGE_KEYS)) {
        try { browserStorage.removeItem(key); } catch (error) { /* storage unavailable */ }
      }
    }
    input = Csv.parseCsv(Csv.DEFAULT_CSV);
    estimatesText = Csv.DEFAULT_CSV;
    stageTeams = Csv.parseStageTeams(Csv.DEFAULT_STAGE_TEAMS_CSV);
    dependencies = Csv.parseDependencies(Csv.DEFAULT_DEPENDENCIES_CSV);
    stageCapacities = Csv.parseStageCapacities(Csv.DEFAULT_STAGE_CAPACITY_CSV);
    csvSources = {
      estimates: 'Built-in estimates',
      dependencies: 'Built-in dependencies',
      stageCapacities: 'Built-in parallelism'
    };
    recalculate();
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[char]);
  }

  function fmt(date) {
    return date
      ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
      : '—';
  }

  function fmtShort(date) {
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(date);
  }

  function range(task) {
    return task.allocation.length
      ? {
          start: state.days[task.allocation[0].index].date,
          end: state.days[task.allocation[task.allocation.length - 1].index].date
        }
      : null;
  }

  function segments(allocation) {
    if (!allocation.length) return [];
    const output = [];
    let start = allocation[0].index;
    let previous = start;
    for (let index = 1; index < allocation.length; index++) {
      const current = allocation[index].index;
      if (current !== previous + 1) {
        output.push({ start, end: previous });
        start = current;
      }
      previous = current;
    }
    output.push({ start, end: previous });
    return output;
  }

  function sprintBlocks() {
    const totalDays = Scheduler.daysBetween(state.startDate, Scheduler.addDays(state.endDate, 1));
    const count = Math.ceil(totalDays / 14);
    return Array.from({ length: count }, (_, index) => {
      const start = Scheduler.addDays(state.startDate, index * 14);
      const end = Scheduler.addDays(start, 13);
      return {
        index,
        key: `S${index + 1}`,
        label: `Sprint ${index + 1}`,
        start,
        end: end > state.endDate ? state.endDate : end,
        left: index * 14,
        width: Math.min(14, totalDays - index * 14)
      };
    });
  }

  function renderControls() {
    document.getElementById('legend').innerHTML = Csv.DEPARTMENTS.map(department =>
      `<span><i class="dot ${department.css}"></i>${esc(department.name)}</span>`
    ).join('');
    document.getElementById('capacityInputs').innerHTML = Csv.DEPARTMENTS.map(department =>
      `<div class="control"><label>${esc(department.name)} / мес.</label><input data-capacity="${department.id}" type="number" value="${department.defaultCapacity}" min="1" step="1"></div>`
    ).join('');
  }

  function readCapacities() {
    const capacities = {};
    document.querySelectorAll('[data-capacity]').forEach(inputElement => {
      capacities[inputElement.dataset.capacity] = Number(inputElement.value);
    });
    return capacities;
  }

  function renderSummary() {
    const total = state.tasks.reduce((sum, task) => sum + task.estimate, 0);
    const sprints = Math.ceil(Scheduler.daysBetween(state.startDate, Scheduler.addDays(state.endDate, 1)) / 14);
    const ffCount = state.dependencies.filter(item => item.type === 'FF').length;
    const cards = [
      ['Локации', state.locations.length, `${state.tasks.length} production-задач`],
      ['Общий объём', `${total.toFixed(0)} mdays`, 'без Gameplay Balancing и QA'],
      ['Окончание production', fmt(state.endDate), `${sprints} спринтов`],
      ['Dependencies', state.dependencies.length, `${ffCount} Finish-to-Finish`],
      ['Milestone-работы', input.excluded.length, 'пока исключены из расчёта'],
      ['Parallelism', new Set(Object.values(state.stageCapacities)).size === 1 ? Object.values(state.stageCapacities)[0] : 'Custom', `0 = unlimited · ${csvSources.stageCapacities}`]
    ];
    document.getElementById('locationSummary').innerHTML = cards.map(card =>
      `<div class="card"><div class="cl">${card[0]}</div><div class="cv">${card[1]}</div><div class="cn">${card[2]}</div></div>`
    ).join('') + (input.unknownStages.length
      ? `<div class="card error-card"><div class="cl">Неизвестные этапы</div><div class="cv">${input.unknownStages.length}</div><div class="cn">${esc(input.unknownStages.map(stage => stage.name).join(', '))} · команда Unknown, capacity 20</div></div>`
      : '');
  }

  function warnUnknownStages(parsed) {
    if (parsed.unknownStages.length) {
      alert(`Неизвестные этапы: ${parsed.unknownStages.map(stage => stage.name).join(', ')}. Они добавлены в план под командой Unknown с capacity 20.`);
    }
  }

  function renderGantt() {
    if (!state) return;
    const query = document.getElementById('locationSearch').value.toLowerCase().trim();
    const visible = state.locations.filter(location => !query || location.name.toLowerCase().includes(query));
    const blocks = sprintBlocks();
    const totalDays = Scheduler.daysBetween(state.startDate, Scheduler.addDays(state.endDate, 1));
    const shell = document.getElementById('locationGanttShell');
    const available = shell ? shell.clientWidth - LEFT - TIMELINE_GUTTER : 0;
    const dayWidth = Math.max(MIN_DAY_WIDTH, available / totalDays);
    const timelineWidth = Math.ceil(totalDays * dayWidth);
    const fullWidth = LEFT + timelineWidth;
    let html = `<div style="width:${fullWidth}px"><div class="sprint-header"><div class="sprint-left">Location · stage · department · estimate</div><div class="sprint-track" style="width:${timelineWidth}px">${blocks.map(block =>
      `<div class="sprint-cell" style="left:${block.left * dayWidth}px;width:${block.width * dayWidth}px"><b>${block.label}</b><small>${fmtShort(block.start)}–${fmtShort(block.end)}</small></div>`
    ).join('')}</div></div>`;

    if (!visible.length) {
      document.getElementById('locationGantt').innerHTML = html + '<div class="empty">Нет локаций по фильтру</div></div>';
      return;
    }

    for (const location of visible) {
      const rowHeight = ROW_HEADER + location.tasks.length * LANE_HEIGHT;
      const grid = blocks.map(block =>
        `<div class="grid-sprint" style="left:${block.left * dayWidth}px;width:${block.width * dayWidth}px;height:${rowHeight}px"></div>`
      ).join('');
      const laneLines = location.tasks.map((task, index) =>
        `<div class="location-lane" style="top:${ROW_HEADER + index * LANE_HEIGHT}px"></div>`
      ).join('');
      const labels = location.tasks.map(task =>
        `<div class="location-stage-label"><i class="sc ${task.departmentCss}"></i><span>${esc(task.stageName)}</span><small>${esc(task.department)} · ${task.estimate} md · ${task.maxParallelPeople === 0 ? 'unlimited' : `×${task.maxParallelPeople}`}</small></div>`
      ).join('');
      let bars = '';
      location.tasks.forEach((task, index) => {
        const taskRange = range(task);
        for (const segment of segments(task.allocation)) {
          const start = state.days[segment.start].date;
          const end = Scheduler.addDays(state.days[segment.end].date, 1);
          const left = Scheduler.daysBetween(state.startDate, start) * dayWidth;
          const width = Math.max(3, Scheduler.daysBetween(start, end) * dayWidth);
          bars += `<div class="bar location-bar ${task.departmentCss}" style="top:${ROW_HEADER + index * LANE_HEIGHT + 5}px;left:${left}px;width:${width}px" title="${esc(task.stageName)} · ${task.estimate} mdays · ${fmt(taskRange.start)} — ${fmt(taskRange.end)}"><span>${esc(task.stageName)}</span></div>`;
        }
      });
      const statusCount = location.tasks.filter(task => task.status).length;
      html += `<div class="location-row ${selected === location.id ? 'selected' : ''}" data-id="${location.id}" style="width:${fullWidth}px;height:${rowHeight}px"><div class="location-meta" style="height:${rowHeight}px"><div class="location-row-title"><strong>${esc(location.name)}</strong><span>${location.tasks.reduce((sum, task) => sum + task.estimate, 0)} md · ${statusCount} status</span></div>${labels}</div><div class="location-timeline" style="width:${timelineWidth}px;height:${rowHeight}px">${grid}${laneLines}${bars}</div></div>`;
    }
    html += '</div>';
    const gantt = document.getElementById('locationGantt');
    gantt.innerHTML = html;
    gantt.querySelectorAll('.location-row').forEach(row => {
      row.onclick = () => openDrawer(row.dataset.id);
    });
  }

  function capacityRow(department, used, total) {
    return `<div class="cap-row"><div class="cap-head"><span>${esc(department.name)}</span><span>${used.toFixed(1)} / ${total}</span></div><div class="track"><div class="fill-${department.css}" style="width:${Math.min(100, used / total * 100)}%"></div></div></div>`;
  }

  function renderCapacity() {
    const blocks = sprintBlocks();
    const usageBySprint = new Map(blocks.map(block => [
      block.key,
      { block, usage: Object.fromEntries(Csv.DEPARTMENTS.map(department => [department.id, 0])) }
    ]));
    for (const day of state.days) {
      const current = usageBySprint.get(day.sprint);
      if (!current) continue;
      for (const department of Csv.DEPARTMENTS) current.usage[department.id] += day.used[department.id] || 0;
    }
    document.getElementById('locationCapacity').innerHTML = [...usageBySprint.values()]
      .filter(item => Object.values(item.usage).some(value => value > 1e-7))
      .map(item => {
        const maximum = Math.max(...Csv.DEPARTMENTS.map(department => item.usage[department.id] / state.sprintCapacities[department.id]));
        return `<div class="cap-card"><div class="cap-title"><strong>${item.block.label}</strong><span>${maximum > .995 ? 'полная загрузка' : 'есть резерв'}</span></div><div class="cap-dates">${fmt(item.block.start)} — ${fmt(item.block.end)}</div>${Csv.DEPARTMENTS.map(department => capacityRow(department, item.usage[department.id], state.sprintCapacities[department.id])).join('')}</div>`;
      }).join('');
  }

  function openDrawer(locationId) {
    selected = locationId;
    const location = state.locations.find(item => item.id === locationId);
    const byId = new Map(location.tasks.map(task => [task.id, task]));
    const stages = location.tasks.map(task => {
      const taskRange = range(task);
      const dependenciesText = task.incoming.length
        ? task.incoming.map(item => `${byId.get(item.taskId).stageName} (${item.type}${item.lag ? ` +${item.lag}` : ''})`).join(', ')
        : 'нет';
      return `<div class="location-drawer-stage"><i class="sc ${task.departmentCss}"></i><div><strong>${esc(task.stageName)}</strong><small>${esc(task.department)} · ${task.estimate} mdays · ${esc(task.status || 'No status')}</small><span>${taskRange ? `${fmt(taskRange.start)} — ${fmt(taskRange.end)}` : 'Оценка отсутствует'}<br>Parallel people: ${task.maxParallelPeople === 0 ? 'unlimited' : task.maxParallelPeople}<br>Depends on: ${esc(dependenciesText)}</span></div></div>`;
    }).join('');
    document.getElementById('locationDrawerBody').innerHTML = `<h3>${esc(location.name)}</h3><div class="dp">${location.tasks.reduce((sum, task) => sum + task.estimate, 0)} mdays total</div>${stages}`;
    document.getElementById('locationDrawer').classList.add('open');
    renderGantt();
  }

  function recalculate() {
    try {
      state = Scheduler.schedule(input, dependencies, stageCapacities, document.getElementById('locationStartDate').value, readCapacities());
      selected = null;
      document.getElementById('locationDrawer').classList.remove('open');
      renderSummary();
      renderGantt();
      renderCapacity();
    } catch (error) {
      console.error(error);
      document.getElementById('locationSummary').innerHTML = `<div class="card error-card"><div class="cl">Ошибка расчёта</div><div class="cn">${esc(error.message)}</div></div>`;
      document.getElementById('locationGantt').innerHTML = `<div class="empty">${esc(error.message)}</div>`;
      document.getElementById('locationCapacity').innerHTML = '';
    }
  }

  function csvCell(value) {
    return `"${String(value ?? '').replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    const header = ['Location ID', 'Location', 'Priority', 'Stage ID', 'Stage', 'Department', 'Max Parallel People', 'Status', 'Estimate', 'Start', 'Finish'];
    const lines = [header.map(csvCell).join(',')];
    for (const location of state.locations) {
      for (const task of location.tasks) {
        const taskRange = range(task);
        lines.push([
          location.id, location.name, location.priorityDisplay, task.stageId, task.stageName,
          task.department, task.maxParallelPeople, task.status, task.estimate,
          taskRange ? Scheduler.dateKey(taskRange.start) : '',
          taskRange ? Scheduler.dateKey(taskRange.end) : ''
        ].map(csvCell).join(','));
      }
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Hyperborea_Level_Production_Schedule.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportStageTeams() {
    const blob = new Blob(['\ufeff' + Csv.serializeStageTeams(stageTeams)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'location-stage-teams.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  renderControls();
  document.getElementById('locationRecalcButton').addEventListener('click', recalculate);
  document.getElementById('locationSearch').addEventListener('input', renderGantt);
  document.getElementById('locationExportButton').addEventListener('click', exportCsv);
  document.getElementById('stageTeamsExportButton').addEventListener('click', exportStageTeams);
  document.getElementById('resetSavedCsvButton').addEventListener('click', resetSavedCsv);
  document.getElementById('locationCloseDrawerButton').addEventListener('click', () => {
    selected = null;
    document.getElementById('locationDrawer').classList.remove('open');
    renderGantt();
  });
  document.getElementById('locationsCsvFile').addEventListener('change', async event => {
    try {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const text = await file.text();
      input = Csv.parseCsv(text, stageTeams);
      estimatesText = text;
      stageTeams = Csv.mergeStageTeams(stageTeams, input.unknownStages);
      saveCsv(STORAGE_KEYS.stageTeams, 'Updated stage teams', Csv.serializeStageTeams(stageTeams));
      warnUnknownStages(input);
      saveCsv(STORAGE_KEYS.estimates, file.name, text);
      csvSources.estimates = file.name;
      recalculate();
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  });
  document.getElementById('stageTeamsCsvFile').addEventListener('change', async event => {
    try {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const text = await file.text();
      stageTeams = Csv.parseStageTeams(text);
      input = Csv.parseCsv(estimatesText, stageTeams);
      stageTeams = Csv.mergeStageTeams(stageTeams, input.unknownStages);
      saveCsv(STORAGE_KEYS.stageTeams, file.name, Csv.serializeStageTeams(stageTeams));
      recalculate();
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  });
  document.getElementById('dependenciesCsvFile').addEventListener('change', async event => {
    try {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const text = await file.text();
      dependencies = Csv.parseDependencies(text);
      saveCsv(STORAGE_KEYS.dependencies, file.name, text);
      csvSources.dependencies = file.name;
      recalculate();
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  });
  document.getElementById('stageCapacityCsvFile').addEventListener('change', async event => {
    try {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const text = await file.text();
      stageCapacities = Csv.parseStageCapacities(text);
      saveCsv(STORAGE_KEYS.stageCapacities, file.name, text);
      csvSources.stageCapacities = file.name;
      recalculate();
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  });
  if (typeof window !== 'undefined') window.addEventListener('resize', renderGantt);
  recalculate();
})();
