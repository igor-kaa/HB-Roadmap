(function() {
  'use strict';

  const Csv = HyperboreaLocationCsv;
  const Scheduler = HyperboreaLocationScheduler;
  const LEFT = 430;
  const TIMELINE_GUTTER = 18;
  const MIN_DAY_WIDTH = 3.65;
  const SPRINT_NUMBER_BASE = new Date(2025, 10, 17, 12);
  const ROW_HEADER = 36;
  const LANE_HEIGHT = 22;
  const DEPENDENCY_NODE_WIDTH = 142;
  const DEPENDENCY_NODE_HEIGHT = 76;
  const DEPENDENCY_COLUMN_GAP = 64;
  const DEPENDENCY_ROW_GAP = 22;
  const DEPENDENCY_GRAPH_PADDING = 28;
  const DEFAULT_FILES = Object.freeze({
    estimates: 'location-estimates.csv',
    dependencies: 'location-dependencies.csv',
    stageCatalog: 'location-stage-team-capacity.csv'
  });
  const STORAGE_KEYS = Object.freeze({
    estimates: 'hyperborea.locations.estimates.v1',
    dependencies: 'hyperborea.locations.dependencies.v1',
    stageCatalog: 'hyperborea.locations.stage-team-capacity.v1'
  });
  const LEGACY_STORAGE_KEYS = Object.freeze([
    'hyperborea.locations.stage-capacities.v1',
    'hyperborea.locations.stage-teams.v1'
  ]);
  const browserStorage = getBrowserStorage();
  const defaultTexts = Object.fromEntries(Object.entries(DEFAULT_FILES).map(([key, filename]) => [key, loadExternalCsv(filename)]));
  const restoredStageCatalog = restoreCsv(STORAGE_KEYS.stageCatalog, Csv.parseStageTeamCapacities, defaultTexts.stageCatalog, DEFAULT_FILES.stageCatalog);
  let stageCatalog = restoredStageCatalog.value || [];
  const restoredInput = restoreCsv(STORAGE_KEYS.estimates, text => Csv.parseCsv(text, stageCatalog), defaultTexts.estimates, DEFAULT_FILES.estimates);
  let input = restoredInput.value;
  let estimatesText = restoredInput.text;
  if (input) stageCatalog = Csv.mergeStageTeamCapacities(stageCatalog, input.unconfiguredStages);
  let dependenciesText = restoreCsvText(STORAGE_KEYS.dependencies, defaultTexts.dependencies, DEFAULT_FILES.dependencies);
  let dependencies = dependenciesForCurrentCatalog(false);
  let stageCapacities = Csv.stageCapacities(stageCatalog);
  let csvSources = {
    estimates: restoredInput.name,
    dependencies: dependenciesText.name,
    stageCatalog: restoredStageCatalog.name
  };
  let state = null;
  let selected = null;
  const collapsedLocations = new Set();

  function getBrowserStorage() {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch (error) {
      return null;
    }
  }

  function loadExternalCsv(filename) {
    try {
      const request = new XMLHttpRequest();
      request.open('GET', filename, false);
      request.send(null);
      if ((request.status === 0 || (request.status >= 200 && request.status < 300)) && request.responseText) {
        return request.responseText;
      }
    } catch (error) {
      console.warn(`Default CSV is unavailable: ${filename}`, error);
    }
    return '';
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
    return defaultText
      ? { value: parser(defaultText), name: defaultName, text: defaultText }
      : { value: null, name: 'Not loaded', text: '' };
  }

  function restoreCsvText(key, defaultText, defaultName) {
    if (browserStorage) {
      try {
        const savedText = browserStorage.getItem(key);
        if (savedText) {
          const saved = JSON.parse(savedText);
          if (saved && typeof saved.text === 'string') return { name: saved.name || 'Saved CSV', text: saved.text };
        }
      } catch (error) {
        try { browserStorage.removeItem(key); } catch (storageError) { /* storage unavailable */ }
        console.warn(`Saved CSV ignored: ${key}`, error);
      }
    }
    return defaultText ? { name: defaultName, text: defaultText } : { name: 'Not loaded', text: '' };
  }

  function dependenciesForCurrentCatalog(strict) {
    if (!dependenciesText || !dependenciesText.text) return [];
    try {
      return Csv.parseDependencies(dependenciesText.text, stageCatalog);
    } catch (error) {
      if (strict) throw error;
      console.warn('Dependencies CSV ignored until its stages are available', error);
      return [];
    }
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
      for (const key of [...Object.values(STORAGE_KEYS), ...LEGACY_STORAGE_KEYS]) {
        try { browserStorage.removeItem(key); } catch (error) { /* storage unavailable */ }
      }
    }
    stageCatalog = defaultTexts.stageCatalog ? Csv.parseStageTeamCapacities(defaultTexts.stageCatalog) : [];
    input = defaultTexts.estimates ? Csv.parseCsv(defaultTexts.estimates, stageCatalog) : null;
    estimatesText = defaultTexts.estimates;
    if (input) stageCatalog = Csv.mergeStageTeamCapacities(stageCatalog, input.unconfiguredStages);
    dependenciesText = {
      name: defaultTexts.dependencies ? DEFAULT_FILES.dependencies : 'Not loaded',
      text: defaultTexts.dependencies
    };
    dependencies = dependenciesForCurrentCatalog(false);
    stageCapacities = Csv.stageCapacities(stageCatalog);
    csvSources = {
      estimates: defaultTexts.estimates ? DEFAULT_FILES.estimates : 'Not loaded',
      dependencies: dependenciesText.name,
      stageCatalog: defaultTexts.stageCatalog ? DEFAULT_FILES.stageCatalog : 'Not loaded'
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

  function locationRange(location) {
    let startIndex = Infinity;
    let endIndex = -Infinity;
    for (const task of location.tasks) {
      for (const item of task.allocation) {
        startIndex = Math.min(startIndex, item.index);
        endIndex = Math.max(endIndex, item.index);
      }
    }
    return Number.isFinite(startIndex)
      ? {
          startIndex,
          endIndex,
          start: state.days[startIndex].date,
          end: state.days[endIndex].date
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
    const firstSprintNumber = Math.floor(Scheduler.daysBetween(SPRINT_NUMBER_BASE, state.startDate) / 14) + 1;
    return Array.from({ length: count }, (_, index) => {
      const start = Scheduler.addDays(state.startDate, index * 14);
      const end = Scheduler.addDays(start, 13);
      return {
        index,
        key: `S${firstSprintNumber + index}`,
        label: `Sprint ${firstSprintNumber + index}`,
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
    document.getElementById('capacityInputs').innerHTML = Csv.DEPARTMENTS.filter(department => department.id !== 'unknown').map(department =>
      `<div class="control"><label>${esc(department.name)} / мес.</label><input data-capacity="${department.id}" type="number" value="${department.defaultCapacity}" min="1" step="1"></div>`
    ).join('');
  }

  function readCapacities() {
    const capacities = { unknown: 20 };
    document.querySelectorAll('[data-capacity]').forEach(inputElement => {
      capacities[inputElement.dataset.capacity] = Number(inputElement.value);
    });
    return capacities;
  }

  function renderSummary() {
    const total = state.tasks.reduce((sum, task) => sum + task.estimate, 0);
    const sprints = Math.ceil(Scheduler.daysBetween(state.startDate, Scheduler.addDays(state.endDate, 1)) / 14);
    const ffCount = state.dependencies.filter(item => item.type === 'FF').length;
    const uploadAction = (id, label) =>
      `<label class="summary-card-action" for="${id}" title="${label}" aria-label="${label}">↥</label>`;
    const downloadAction = (href, label, id = '') =>
      `<a class="summary-card-action"${id ? ` id="${id}"` : ''} href="${href}" download title="${label}" aria-label="${label}">⇩</a>`;
    const cardsHtml = [
      `<div class="card"><div class="cl">Локации</div><div class="cv">${state.locations.length}</div><div class="cn">${state.tasks.length} production-задач</div></div>`,
      `<div class="card"><div class="cl">Общий объём</div><div class="cv">${total.toFixed(0)} mdays</div><div class="cn">${esc(csvSources.estimates)}</div></div>`,
      `<div class="card"><div class="cl">Окончание production</div><div class="cv">${fmt(state.endDate)}</div><div class="cn">${sprints} спринтов</div></div>`,
      `<div class="card dependency-summary-card summary-card-with-actions" id="dependencySummaryCard" tabindex="0" role="button" aria-label="View graph of ${state.dependencies.length} dependencies"><div class="cl">Dependencies</div><div class="cv">${state.dependencies.length}</div><div class="cn">${ffCount} Finish-to-Finish <span>View graph →</span></div><div class="summary-card-actions">${uploadAction('dependenciesCsvFile', 'Загрузить CSV с dependencies')}${downloadAction('location-dependencies.csv', 'Скачать dependencies CSV')}</div></div>`,
      `<div class="card summary-card-with-actions"><div class="cl">Stage catalog</div><div class="cv">${stageCatalog.length}</div><div class="cn">team + parallelism · ${esc(csvSources.stageCatalog)}</div><div class="summary-card-actions">${uploadAction('stageTeamCapacityCsvFile', 'Загрузить CSV этапов, команд и capacity')}${downloadAction('location-stage-team-capacity.csv', 'Скачать CSV этапов, команд и capacity', 'stageTeamCapacityExportAction')}</div></div>`
    ];
    document.getElementById('locationSummary').innerHTML = cardsHtml.join('') + (input.unconfiguredStages.length
      ? `<div class="card error-card"><div class="cl">Stages added from estimates</div><div class="cv">${input.unconfiguredStages.length}</div><div class="cn">${esc(input.unconfiguredStages.map(stage => stage.name).join(', '))} · Unknown team, 1 parallel person</div></div>`
      : '');
    const dependencyCard = document.getElementById('dependencySummaryCard');
    dependencyCard.addEventListener('click', event => {
      if (!event || !event.target || !event.target.closest('.summary-card-action')) openDependencyGraph();
    });
    dependencyCard.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && (!event.target || !event.target.closest('.summary-card-action'))) {
        event.preventDefault();
        openDependencyGraph();
      }
    });
    document.getElementById('stageTeamCapacityExportAction').addEventListener('click', event => {
      event.preventDefault();
      exportStageTeamCapacities();
    });
  }

  function dependencyStageInfo(stageId) {
    const task = state.tasks.find(item => item.stageId === stageId);
    const stage = stageCatalog.find(item => item.id === stageId);
    if (task) return { name: task.stageName, department: task.department, departmentCss: task.departmentCss };
    const department = stage && Csv.DEPARTMENTS.find(item => item.id === stage.departmentId);
    return {
      name: stage ? stage.stage : stageId,
      department: department ? department.name : 'Unknown',
      departmentCss: department ? department.css : 'loc-unknown'
    };
  }

  function dependencyGraphLayout(edges) {
    const nodeIds = [...new Set(edges.flatMap(edge => [edge.from, edge.to]))];
    const depths = new Map(nodeIds.map(stageId => [stageId, 0]));
    for (let pass = 0; pass < nodeIds.length; pass++) {
      for (const edge of edges) {
        depths.set(edge.to, Math.max(depths.get(edge.to), depths.get(edge.from) + 1));
      }
    }
    const stageOrder = new Map(stageCatalog.map((stage, index) => [stage.id, index]));
    const columns = new Map();
    for (const stageId of nodeIds) {
      const depth = depths.get(stageId);
      if (!columns.has(depth)) columns.set(depth, []);
      columns.get(depth).push(stageId);
    }
    for (const column of columns.values()) {
      column.sort((left, right) => (stageOrder.get(left) ?? 999) - (stageOrder.get(right) ?? 999));
    }
    const maximumDepth = Math.max(...depths.values());
    const maximumRows = Math.max(...[...columns.values()].map(column => column.length));
    const contentHeight = maximumRows * DEPENDENCY_NODE_HEIGHT + Math.max(0, maximumRows - 1) * DEPENDENCY_ROW_GAP;
    const positions = new Map();
    for (let depth = 0; depth <= maximumDepth; depth++) {
      const column = columns.get(depth) || [];
      const columnHeight = column.length * DEPENDENCY_NODE_HEIGHT + Math.max(0, column.length - 1) * DEPENDENCY_ROW_GAP;
      const offset = (contentHeight - columnHeight) / 2;
      column.forEach((stageId, row) => positions.set(stageId, {
        x: DEPENDENCY_GRAPH_PADDING + depth * (DEPENDENCY_NODE_WIDTH + DEPENDENCY_COLUMN_GAP),
        y: DEPENDENCY_GRAPH_PADDING + offset + row * (DEPENDENCY_NODE_HEIGHT + DEPENDENCY_ROW_GAP)
      }));
    }
    return {
      nodeIds,
      positions,
      width: DEPENDENCY_GRAPH_PADDING * 2 + (maximumDepth + 1) * DEPENDENCY_NODE_WIDTH + maximumDepth * DEPENDENCY_COLUMN_GAP + 72,
      height: DEPENDENCY_GRAPH_PADDING * 2 + contentHeight
    };
  }

  function dependencyPath(edge, layout, edgeIndex) {
    const from = layout.positions.get(edge.from);
    const to = layout.positions.get(edge.to);
    const startX = from.x + DEPENDENCY_NODE_WIDTH;
    const startY = from.y + DEPENDENCY_NODE_HEIGHT / 2;
    if (edge.type === 'FF') {
      const endX = to.x + DEPENDENCY_NODE_WIDTH;
      const endY = to.y + DEPENDENCY_NODE_HEIGHT / 2;
      const routeX = Math.max(startX, endX) + 42 + edgeIndex * 3;
      const routeY = endY < startY
        ? to.y - 18
        : to.y + DEPENDENCY_NODE_HEIGHT + 18;
      return {
        d: `M ${startX} ${startY} C ${startX + 26} ${startY}, ${startX + 30} ${routeY}, ${startX + 54} ${routeY} L ${routeX} ${routeY} C ${routeX} ${routeY}, ${routeX} ${endY}, ${endX} ${endY}`,
        labelX: routeX - 15,
        labelY: (routeY + endY) / 2 - 5
      };
    }
    const endX = to.x;
    const endY = to.y + DEPENDENCY_NODE_HEIGHT / 2;
    const control = Math.max(42, (endX - startX) * .46);
    return {
      d: `M ${startX} ${startY} C ${startX + control} ${startY}, ${endX - control} ${endY}, ${endX} ${endY}`,
      labelX: (startX + endX) / 2,
      labelY: (startY + endY) / 2 - 7
    };
  }

  function renderDependencyGraph() {
    const edges = state.dependencies;
    const graph = document.getElementById('dependencyGraph');
    if (!edges.length) {
      graph.style.width = '100%';
      graph.style.height = '260px';
      graph.innerHTML = '<div class="empty">No active dependencies for the current stage set</div>';
      document.getElementById('dependencyGraphSubtitle').textContent = `0 active dependencies · ${csvSources.dependencies}`;
      return;
    }
    const layout = dependencyGraphLayout(edges);
    const paths = edges.map((edge, index) => {
      const path = dependencyPath(edge, layout, index);
      const lag = edge.lag ? ` +${edge.lag}d` : '';
      return `<g class="dependency-edge dependency-edge-${edge.type.toLowerCase()}"><path d="${path.d}" marker-end="url(#dependencyArrow${edge.type})"></path>${edge.type === 'FF' || edge.lag ? `<text x="${path.labelX}" y="${path.labelY}">${edge.type}${lag}</text>` : ''}</g>`;
    }).join('');
    const nodes = layout.nodeIds.map(stageId => {
      const position = layout.positions.get(stageId);
      const info = dependencyStageInfo(stageId);
      return `<div class="dependency-node" style="left:${position.x}px;top:${position.y}px;width:${DEPENDENCY_NODE_WIDTH}px;height:${DEPENDENCY_NODE_HEIGHT}px"><i class="sc ${info.departmentCss}"></i><strong>${esc(info.name)}</strong><small>${esc(info.department)}</small><span class="dependency-port dependency-port-start" aria-hidden="true"></span><span class="dependency-port dependency-port-finish" aria-hidden="true"></span></div>`;
    }).join('');
    graph.style.width = `${layout.width}px`;
    graph.style.height = `${layout.height}px`;
    graph.innerHTML = `<svg class="dependency-edges" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="Stage dependency graph"><defs><marker class="dependency-arrow-fs" id="dependencyArrowFS" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker><marker class="dependency-arrow-ff" id="dependencyArrowFF" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>${paths}</svg>${nodes}`;
    document.getElementById('dependencyGraphSubtitle').textContent = `${edges.length} dependencies · ${edges.filter(edge => edge.type === 'FF').length} Finish-to-Finish · ${csvSources.dependencies}`;
  }

  function openDependencyGraph() {
    renderDependencyGraph();
    const dialog = document.getElementById('dependencyGraphDialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.classList.add('open');
  }

  function closeDependencyGraph() {
    const dialog = document.getElementById('dependencyGraphDialog');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.classList.remove('open');
  }

  function warnUnconfiguredStages(parsed) {
    if (parsed.unconfiguredStages.length) {
      alert(`Этапы из estimates добавлены в stage catalog: ${parsed.unconfiguredStages.map(stage => stage.name).join(', ')}. Для них назначены Unknown team и 1 parallel person.`);
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
      const collapsed = collapsedLocations.has(location.id);
      const rowHeight = ROW_HEADER + (collapsed ? 0 : location.tasks.length * LANE_HEIGHT);
      const grid = blocks.map(block =>
        `<div class="grid-sprint" style="left:${block.left * dayWidth}px;width:${block.width * dayWidth}px;height:${rowHeight}px"></div>`
      ).join('');
      const laneLines = collapsed ? '' : location.tasks.map((task, index) =>
        `<div class="location-lane" style="top:${ROW_HEADER + index * LANE_HEIGHT}px"></div>`
      ).join('');
      const labels = collapsed ? '' : location.tasks.map(task =>
        `<div class="location-stage-label"><i class="sc ${task.departmentCss}"></i><span>${esc(task.stageName)}</span><small>${esc(task.department)} · ${task.estimate} md · ${task.maxParallelPeople === 0 ? 'unlimited' : `×${task.maxParallelPeople}`}</small></div>`
      ).join('');
      let bars = '';
      if (!collapsed) {
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
      }
      const totalRange = locationRange(location);
      const totalBar = totalRange ? (() => {
        const endExclusive = Scheduler.addDays(totalRange.end, 1);
        const left = Scheduler.daysBetween(state.startDate, totalRange.start) * dayWidth;
        const duration = Scheduler.daysBetween(totalRange.start, endExclusive);
        const width = Math.max(3, duration * dayWidth);
        return `<div class="bar location-total-bar" style="left:${left}px;width:${width}px" title="${esc(location.name)} · весь цикл · ${fmt(totalRange.start)} — ${fmt(totalRange.end)}"><span>Весь цикл · ${duration} дн.</span></div>`;
      })() : '';
      const statusCount = location.tasks.filter(task => task.status).length;
      const toggleLabel = `${collapsed ? 'Развернуть' : 'Свернуть'} этапы локации ${location.name}`;
      html += `<div class="location-row${collapsed ? ' collapsed' : ''}${selected === location.id ? ' selected' : ''}" data-id="${location.id}" style="width:${fullWidth}px;height:${rowHeight}px"><div class="location-meta" style="height:${rowHeight}px"><div class="location-row-title"><div class="location-row-heading"><button class="location-toggle" type="button" data-location-toggle="${location.id}" aria-expanded="${!collapsed}" aria-label="${esc(toggleLabel)}" title="${esc(toggleLabel)}">${collapsed ? '▸' : '▾'}</button><strong>${esc(location.name)}</strong></div><span>${location.tasks.reduce((sum, task) => sum + task.estimate, 0)} md · ${statusCount} status</span></div>${labels}</div><div class="location-timeline" style="width:${timelineWidth}px;height:${rowHeight}px">${grid}${totalBar}${laneLines}${bars}</div></div>`;
    }
    html += '</div>';
    const gantt = document.getElementById('locationGantt');
    gantt.innerHTML = html;
    updateCollapseAllButton();
  }

  function updateCollapseAllButton() {
    const button = document.getElementById('toggleAllLocationsButton');
    if (!button) return;
    const allCollapsed = state && state.locations.length > 0 && state.locations.every(location => collapsedLocations.has(location.id));
    button.disabled = !state || !state.locations.length;
    button.textContent = allCollapsed ? 'Развернуть все' : 'Свернуть все';
    button.setAttribute('aria-label', allCollapsed ? 'Развернуть этапы всех локаций' : 'Свернуть этапы всех локаций');
  }

  function toggleAllLocations() {
    if (!state || !state.locations.length) return;
    const allCollapsed = state.locations.every(location => collapsedLocations.has(location.id));
    if (allCollapsed) collapsedLocations.clear();
    else state.locations.forEach(location => collapsedLocations.add(location.id));
    renderGantt();
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

  function renderAwaitingEstimates() {
    state = null;
    document.getElementById('locationExportButton').disabled = true;
    document.getElementById('locationSummary').innerHTML = `
      <div class="card summary-card-with-actions">
        <div class="cl">Estimates CSV</div><div class="cv">Required</div>
        <div class="cn">Загрузите CSV с оценками — план построится сразу</div>
        <div class="summary-card-actions"><label class="summary-card-action" for="locationsCsvFile" title="Загрузить estimates CSV">↥</label></div>
      </div>
      <div class="card summary-card-with-actions">
        <div class="cl">Stage catalog</div><div class="cv">${stageCatalog.length || 'Optional'}</div>
        <div class="cn">Команды и parallelism можно загрузить до или после estimates</div>
        <div class="summary-card-actions"><label class="summary-card-action" for="stageTeamCapacityCsvFile" title="Загрузить stage/team/capacity CSV">↥</label></div>
      </div>`;
    document.getElementById('locationGantt').innerHTML = '<div class="empty">Ожидание estimates CSV</div>';
    document.getElementById('locationCapacity').innerHTML = '';
    updateCollapseAllButton();
  }

  function recalculate() {
    if (!input) {
      renderAwaitingEstimates();
      return;
    }
    try {
      state = Scheduler.schedule(input, dependencies, stageCapacities, document.getElementById('locationStartDate').value, readCapacities());
      document.getElementById('locationExportButton').disabled = false;
      selected = null;
      document.getElementById('locationDrawer').classList.remove('open');
      renderSummary();
      renderGantt();
      renderCapacity();
    } catch (error) {
      state = null;
      document.getElementById('locationExportButton').disabled = true;
      console.error(error);
      document.getElementById('locationSummary').innerHTML = `<div class="card error-card"><div class="cl">Ошибка расчёта</div><div class="cn">${esc(error.message)}</div></div>`;
      document.getElementById('locationGantt').innerHTML = `<div class="empty">${esc(error.message)}</div>`;
      document.getElementById('locationCapacity').innerHTML = '';
      updateCollapseAllButton();
    }
  }

  function csvCell(value) {
    return `"${String(value ?? '').replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    if (!state) return;
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

  function exportStageTeamCapacities() {
    const blob = new Blob(['\ufeff' + Csv.serializeStageTeamCapacities(stageCatalog)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'location-stage-team-capacity.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  renderControls();
  document.getElementById('locationRecalcButton').addEventListener('click', recalculate);
  document.getElementById('locationSearch').addEventListener('input', renderGantt);
  document.getElementById('toggleAllLocationsButton').addEventListener('click', toggleAllLocations);
  document.getElementById('locationGantt').addEventListener('click', event => {
    const target = event.target && typeof event.target.closest === 'function' ? event.target : null;
    if (!target) return;
    const toggle = target.closest('[data-location-toggle]');
    if (toggle) {
      const locationId = toggle.dataset.locationToggle;
      if (collapsedLocations.has(locationId)) collapsedLocations.delete(locationId);
      else collapsedLocations.add(locationId);
      renderGantt();
      return;
    }
    const row = target.closest('.location-row');
    if (row) openDrawer(row.dataset.id);
  });
  document.getElementById('locationExportButton').addEventListener('click', exportCsv);
  document.getElementById('stageTeamCapacityExportButton').addEventListener('click', exportStageTeamCapacities);
  document.getElementById('resetSavedCsvButton').addEventListener('click', resetSavedCsv);
  document.getElementById('locationCloseDrawerButton').addEventListener('click', () => {
    selected = null;
    document.getElementById('locationDrawer').classList.remove('open');
    renderGantt();
  });
  document.getElementById('dependencyGraphCloseButton').addEventListener('click', closeDependencyGraph);
  document.getElementById('dependencyGraphDialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) closeDependencyGraph();
  });
  document.getElementById('locationsCsvFile').addEventListener('change', async event => {
    try {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const text = await file.text();
      input = Csv.parseCsv(text, stageCatalog);
      estimatesText = text;
      stageCatalog = Csv.mergeStageTeamCapacities(stageCatalog, input.unconfiguredStages);
      stageCapacities = Csv.stageCapacities(stageCatalog);
      dependencies = dependenciesForCurrentCatalog(true);
      saveCsv(STORAGE_KEYS.stageCatalog, 'Updated stage catalog', Csv.serializeStageTeamCapacities(stageCatalog));
      warnUnconfiguredStages(input);
      saveCsv(STORAGE_KEYS.estimates, file.name, text);
      csvSources.estimates = file.name;
      recalculate();
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  });
  document.getElementById('stageTeamCapacityCsvFile').addEventListener('change', async event => {
    try {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const text = await file.text();
      stageCatalog = Csv.parseStageTeamCapacities(text);
      if (estimatesText) {
        input = Csv.parseCsv(estimatesText, stageCatalog);
        stageCatalog = Csv.mergeStageTeamCapacities(stageCatalog, input.unconfiguredStages);
      }
      stageCapacities = Csv.stageCapacities(stageCatalog);
      dependencies = dependenciesForCurrentCatalog(true);
      saveCsv(STORAGE_KEYS.stageCatalog, file.name, Csv.serializeStageTeamCapacities(stageCatalog));
      csvSources.stageCatalog = file.name;
      warnUnconfiguredStages(input);
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
      dependencies = Csv.parseDependencies(text, stageCatalog);
      dependenciesText = { name: file.name, text };
      saveCsv(STORAGE_KEYS.dependencies, file.name, text);
      csvSources.dependencies = file.name;
      recalculate();
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  });
  if (typeof window !== 'undefined') window.addEventListener('resize', renderGantt);
  recalculate();
})();
