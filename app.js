(function() {
  'use strict';

  const S = HyperboreaScheduler;
  const Csv = HyperboreaCsv;
  const MIN_DAY_WIDTH = 3.65;
  const LEFT = 410;
  const TIMELINE_GUTTER = 18;
  const SPRINT_DISPLAY_START = 18;
  let rawFeatures = Csv.parseCsv(Csv.DEFAULT_CSV);
  let state = null;
  let selected = null;

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

  function range(feature, key) {
    const allocation = feature[key];
    return allocation.length
      ? {
          start: state.days[allocation[0].index].date,
          end: state.days[allocation[allocation.length - 1].index].date
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
    const totalDays = S.daysBetween(state.startDate, S.addDays(state.endDate, 1));
    const count = Math.ceil(totalDays / 14);
    const output = [];
    for (let index = 0; index < count; index++) {
      const start = S.addDays(state.startDate, index * 14);
      const end = S.addDays(start, 13);
      output.push({
        index,
        key: `S${index + 1}`,
        label: `Sprint ${index + SPRINT_DISPLAY_START}`,
        start,
        end: end > state.endDate ? state.endDate : end,
        left: index * 14,
        width: Math.min(14, totalDays - index * 14)
      });
    }
    return output;
  }

  function totals() {
    return rawFeatures.reduce((result, feature) => {
      for (const key of ['gd', 'dev', 'anim', 'td']) result[key] += feature[key];
      return result;
    }, { gd: 0, dev: 0, anim: 0, td: 0 });
  }

  function finishFor(key) {
    let timestamp = 0;
    for (const feature of state.features) {
      const stageRange = range(feature, key);
      if (stageRange) timestamp = Math.max(timestamp, stageRange.end.getTime());
    }
    return timestamp ? new Date(timestamp) : null;
  }

  function renderSummary() {
    const total = totals();
    const sprints = Math.ceil(S.daysBetween(state.startDate, S.addDays(state.endDate, 1)) / 14);
    const blocked = rawFeatures.filter(feature => feature.gd > 0).length;
    const cards = [
      ['Фичи', rawFeatures.length, `${rawFeatures.filter(feature => feature.gd === 0).length} без GD`],
      ['Окончание проекта', fmt(state.endDate), `${sprints} спринтов`],
      ['GD доступны', fmt(state.gdAvailableDate), `${blocked} фич зависят от GD`],
      ['Development', `${total.dev.toFixed(0)} mdays`, `до ${fmt(finishFor('devAlloc'))}`],
      ['Animation', `${total.anim.toFixed(0)} mdays`, `до ${fmt(finishFor('animAlloc'))}`],
      ['Design GD+TD', `${(total.gd + total.td).toFixed(0)} mdays`, `${total.gd.toFixed(0)} GD + ${total.td.toFixed(0)} TD`],
      ['Лимит на этап', `${state.sprintCapacities.perFeature} / sprint`, 'один человек на фичу']
    ];
    document.getElementById('summary').innerHTML = cards.map(card =>
      `<div class="card"><div class="cl">${card[0]}</div><div class="cv">${card[1]}</div><div class="cn">${card[2]}</div></div>`
    ).join('');
  }

  function renderGantt() {
    const blocks = sprintBlocks();
    const query = document.getElementById('search').value.toLowerCase().trim();
    const priority = document.getElementById('priority').value;
    const visible = state.features.filter(feature =>
      (!query || feature.name.toLowerCase().includes(query)) &&
      (priority === 'All' || feature.priority === priority)
    );
    const totalDays = S.daysBetween(state.startDate, S.addDays(state.endDate, 1));
    const ganttShell = document.getElementById('ganttShell');
    const availableTimelineWidth = ganttShell ? ganttShell.clientWidth - LEFT - TIMELINE_GUTTER : 0;
    const dayWidth = Math.max(MIN_DAY_WIDTH, availableTimelineWidth / totalDays);
    const timelineWidth = Math.ceil(totalDays * dayWidth);
    const fullWidth = LEFT + timelineWidth;
    const gdGateLeft = Math.max(0, S.daysBetween(state.startDate, state.gdAvailableDate)) * dayWidth;
    let html = `<div style="width:${fullWidth}px"><div class="sprint-header"><div class="sprint-left">ID · Feature · priority · estimates</div><div class="sprint-track" style="width:${timelineWidth}px">${blocks.map(block =>
      `<div class="sprint-cell" style="left:${block.left * dayWidth}px;width:${block.width * dayWidth}px"><b>${block.label}</b><small>${fmtShort(block.start)}–${fmtShort(block.end)}</small></div>`
    ).join('')}</div></div>`;

    if (!visible.length) {
      document.getElementById('gantt').innerHTML = html + '<div class="empty">Нет фич по фильтру</div></div>';
      return;
    }

    for (const feature of visible) {
      const grid = blocks.map(block =>
        `<div class="grid-sprint" style="left:${block.left * dayWidth}px;width:${block.width * dayWidth}px"></div>`
      ).join('');
      let bars = '';
      for (const stage of [
        { key: 'gdAlloc', css: 'gd', name: 'GD', estimate: feature.gd },
        { key: 'devAlloc', css: 'dev', name: 'DEV', estimate: feature.dev },
        { key: 'animAlloc', css: 'anim', name: 'ANIM', estimate: feature.anim },
        { key: 'tdAlloc', css: 'td', name: 'TD', estimate: feature.td }
      ]) {
        const stageRange = range(feature, stage.key);
        for (const segment of segments(feature[stage.key])) {
          const start = state.days[segment.start].date;
          const end = S.addDays(state.days[segment.end].date, 1);
          const left = S.daysBetween(state.startDate, start) * dayWidth;
          const width = Math.max(3, S.daysBetween(start, end) * dayWidth);
          bars += `<div class="bar ${stage.css}" style="left:${left}px;width:${width}px" title="${stage.name}: ${stage.estimate} mdays · ${fmt(stageRange.start)} — ${fmt(stageRange.end)}"></div>`;
        }
      }
      html += `<div class="feature-row ${selected === feature.id ? 'selected' : ''}" data-id="${esc(feature.id)}" style="width:${fullWidth}px"><div class="meta"><div class="name" title="${esc(feature.name)}"><span class="pid">#${esc(feature.id)}</span> ${esc(feature.name)}</div><div class="meta2"><span class="priority ${feature.priority}">${esc(feature.priorityDisplay)}</span><span class="egd">GD ${feature.gd}</span><span class="edev">DEV ${feature.dev}</span><span class="eanim">ANIM ${feature.anim}</span><span class="etd">TD ${feature.td}</span>${feature.gd > 0 ? '<span class="blocked-note">GD gate</span>' : ''}</div></div><div class="timeline" style="width:${timelineWidth}px">${grid}<div class="gd-gate" style="left:0;width:${gdGateLeft}px"></div><div class="lane l1"></div><div class="lane l2"></div><div class="lane l3"></div>${bars}</div></div>`;
    }

    html += '</div>';
    const gantt = document.getElementById('gantt');
    gantt.innerHTML = html;
    gantt.querySelectorAll('.feature-row').forEach(row => {
      row.onclick = () => openDrawer(row.dataset.id);
    });
  }

  function capacityRow(name, detail, used, total, parts) {
    return `<div class="cap-row"><div class="cap-head"><span>${name}${detail ? ' · ' + detail : ''}</span><span>${used.toFixed(1)} / ${total}</span></div><div class="track">${parts.map(part =>
      `<div class="${part[0]}" style="width:${Math.min(100, part[1] / total * 100)}%"></div>`
    ).join('')}</div></div>`;
  }

  function renderCapacity() {
    const blocks = sprintBlocks();
    const bySprint = new Map(blocks.map(block => [
      block.key, { gd: 0, td: 0, dev: 0, anim: 0, block }
    ]));
    for (const day of state.days) {
      if (!bySprint.has(day.sprint)) continue;
      const usage = bySprint.get(day.sprint);
      for (const key of ['gd', 'td', 'dev', 'anim']) {
        usage[key] += day[key].reduce((sum, item) => sum + item.amount, 0);
      }
    }

    let html = '';
    for (const usage of bySprint.values()) {
      if (usage.gd + usage.td + usage.dev + usage.anim < 1e-7) continue;
      const design = usage.gd + usage.td;
      const maximum = Math.max(
        design / state.sprintCapacities.design,
        usage.dev / state.sprintCapacities.dev,
        usage.anim / state.sprintCapacities.anim
      );
      html += `<div class="cap-card"><div class="cap-title"><strong>${usage.block.label}</strong><span>${maximum > .995 ? 'полная загрузка' : 'есть резерв'}</span></div><div class="cap-dates">${fmt(usage.block.start)} — ${fmt(usage.block.end)}</div>${capacityRow('Design', `GD ${usage.gd.toFixed(1)} + TD ${usage.td.toFixed(1)}`, design, state.sprintCapacities.design, [['fill-gd', usage.gd], ['fill-td', usage.td]])}${capacityRow('Development', '', usage.dev, state.sprintCapacities.dev, [['fill-dev', usage.dev]])}${capacityRow('Animation', '', usage.anim, state.sprintCapacities.anim, [['fill-anim', usage.anim]])}</div>`;
    }
    document.getElementById('capacity').innerHTML = html;
  }

  function stage(feature, key, name, css, estimate) {
    const stageRange = range(feature, key);
    return `<div class="stage"><i class="sc ${css}"></i><div class="sn">${name}</div><div class="st">${estimate} mdays<br>${stageRange ? fmt(stageRange.start) + ' — ' + fmt(stageRange.end) : 'задача отсутствует'}</div></div>`;
  }

  function openDrawer(id) {
    selected = id;
    const feature = state.features.find(item => String(item.id) === String(id));
    const dev = range(feature, 'devAlloc');
    const anim = range(feature, 'animAlloc');
    const td = range(feature, 'tdAlloc');
    const gd = range(feature, 'gdAlloc');
    let rule = feature.gd > 0
      ? `GD глобально доступен с ${fmt(state.gdAvailableDate)}. После GD этой фичи (${fmt(gd.end)}) разблокированы DEV, Animation и TD. `
      : 'GD = 0, поэтому остальные этапы доступны с начала roadmap. ';
    const target = [dev?.end, anim?.end].filter(Boolean).sort((a, b) => b - a)[0];
    if (td && target) {
      rule += `TD заканчивается ${fmt(td.end)} и не раньше позднего production-этапа (${fmt(target)}).`;
    }
    document.getElementById('drawerBody').innerHTML =
      `<h3>#${esc(feature.id)} ${esc(feature.name)}</h3><div class="dp">${esc(feature.priorityDisplay)}</div>` +
      stage(feature, 'gdAlloc', 'GD', 'gd', feature.gd) +
      stage(feature, 'devAlloc', 'DEV', 'dev', feature.dev) +
      stage(feature, 'animAlloc', 'ANIM', 'anim', feature.anim) +
      stage(feature, 'tdAlloc', 'TD', 'td', feature.td) +
      `<div class="rule">${rule}<br>Лимит каждого этапа: ${state.sprintCapacities.perFeature} mdays/спринт.</div>`;
    document.getElementById('drawer').classList.add('open');
    renderGantt();
  }

  function recalculateSchedule() {
    try {
      const capacities = {
        design: +document.getElementById('designCap').value,
        dev: +document.getElementById('devCap').value,
        anim: +document.getElementById('animCap').value,
        perFeature: +document.getElementById('featureCap').value
      };
      if (Object.values(capacities).some(value => !Number.isFinite(value) || value <= 0)) {
        throw new Error('Capacity должна быть положительным числом');
      }
      state = S.schedule(
        rawFeatures,
        document.getElementById('startDate').value,
        document.getElementById('gdStartMonth').value,
        capacities
      );
      selected = null;
      document.getElementById('drawer').classList.remove('open');
      renderSummary();
      renderGantt();
      renderCapacity();
    } catch (error) {
      console.error(error);
      document.getElementById('summary').innerHTML = `<div class="card error-card"><div class="cl">Ошибка расчёта</div><div class="cn">${esc(error.message)}</div></div>`;
      document.getElementById('gantt').innerHTML = `<div class="empty">${esc(error.message)}</div>`;
      document.getElementById('capacity').innerHTML = '';
    }
  }

  function csvCell(value) {
    return `"${String(value ?? '').replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    const header = ['ID', 'Feature name', 'Priority', 'GD estimate', 'GD start', 'GD finish', 'Dev estimate', 'Dev start', 'Dev finish', 'Anim estimate', 'Anim start', 'Anim finish', 'TD estimate', 'TD start', 'TD finish', 'Feature finish'];
    const lines = [header.map(csvCell).join(',')];
    for (const feature of state.features) {
      const gd = range(feature, 'gdAlloc');
      const dev = range(feature, 'devAlloc');
      const anim = range(feature, 'animAlloc');
      const td = range(feature, 'tdAlloc');
      const dates = [dev?.end, anim?.end, td?.end].filter(Boolean);
      const finish = dates.length ? new Date(Math.max(...dates.map(date => date.getTime()))) : null;
      lines.push([
        feature.id, feature.name, feature.priorityDisplay,
        feature.gd, gd ? S.dateKey(gd.start) : '', gd ? S.dateKey(gd.end) : '',
        feature.dev, dev ? S.dateKey(dev.start) : '', dev ? S.dateKey(dev.end) : '',
        feature.anim, anim ? S.dateKey(anim.start) : '', anim ? S.dateKey(anim.end) : '',
        feature.td, td ? S.dateKey(td.start) : '', td ? S.dateKey(td.end) : '',
        finish ? S.dateKey(finish) : ''
      ].map(csvCell).join(','));
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Hyperborea_Roadmap_Schedule_v4_Sprints.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  document.getElementById('recalcButton').addEventListener('click', recalculateSchedule);
  document.getElementById('search').addEventListener('input', renderGantt);
  document.getElementById('priority').addEventListener('change', renderGantt);
  document.getElementById('closeDrawerButton').addEventListener('click', () => {
    selected = null;
    document.getElementById('drawer').classList.remove('open');
    renderGantt();
  });
  document.getElementById('exportButton').addEventListener('click', exportCsv);
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', renderGantt);
  }
  document.getElementById('csvFile').addEventListener('change', async event => {
    try {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      rawFeatures = Csv.parseCsv(await file.text());
      recalculateSchedule();
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  });

  recalculateSchedule();
})();
