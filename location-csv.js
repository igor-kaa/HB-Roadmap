(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HyperboreaLocationCsv = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const REQUIRED_COLUMNS = ['Location & Filler Space', 'Priority', 'Stage', 'Status', 'Est. Days', 'Notes'];
  const DEPENDENCY_COLUMNS = ['From Stage', 'To Stage', 'Type', 'Lag Days'];
  const STAGE_TEAM_CAPACITY_COLUMNS = ['Stage', 'Team', 'Max Parallel People'];
  const DEPARTMENTS = Object.freeze([
    { id: 'gameDesign', name: 'Game Design', css: 'loc-game-design', defaultCapacity: 20 },
    { id: 'narrative', name: 'Narrative', css: 'loc-narrative', defaultCapacity: 20 },
    { id: 'vfx', name: 'VFX', css: 'loc-vfx', defaultCapacity: 20 },
    { id: 'conceptArt', name: 'Concept Art', css: 'loc-concept-art', defaultCapacity: 40 },
    { id: 'levelDesign', name: 'Level Design', css: 'loc-ld', defaultCapacity: 80 },
    { id: 'levelArt', name: 'Level Art', css: 'loc-la', defaultCapacity: 40 },
    { id: 'modeling', name: '3D Outsource', css: 'loc-3d', defaultCapacity: 60 },
    { id: 'technicalArt', name: 'Technical Art', css: 'loc-ta', defaultCapacity: 20 },
    { id: 'sound', name: 'Sound', css: 'loc-sound', defaultCapacity: 20 },
    { id: 'unknown', name: 'Unknown', css: 'loc-unknown', defaultCapacity: 20 }
  ]);

  function parseRows(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const source = String(text || '').replace(/^\uFEFF/, '');

    for (let index = 0; index < source.length; index++) {
      const char = source[index];
      const next = source[index + 1];
      if (quoted) {
        if (char === '"' && next === '"') {
          cell += '"';
          index++;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        row.push(cell);
        cell = '';
      } else if (char === '\n') {
        row.push(cell.replace(/\r$/, ''));
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }

    if (quoted) throw new Error('CSV contains an unclosed quote');
    if (cell.length || row.length) {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
    }
    return rows;
  }

  function columnReader(rows, required) {
    if (!rows.length) throw new Error('CSV is empty');
    const headers = rows.shift().map(value => value.trim());
    const index = name => headers.findIndex(header => header.toLowerCase() === name.toLowerCase());
    const missing = required.filter(name => index(name) < 0);
    if (missing.length) throw new Error('CSV must contain: ' + missing.join(', '));
    return { index };
  }

  function normalizeStageName(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function stageIdForName(value) {
    const normalized = normalizeStageName(value);
    let hash = 2166136261;
    for (let index = 0; index < normalized.length; index++) {
      hash ^= normalized.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `STAGE_${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  }

  function findDepartment(team) {
    const normalized = String(team || '').trim().toLowerCase();
    return DEPARTMENTS.find(item =>
      item.id.toLowerCase() === normalized ||
      item.name.toLowerCase() === normalized
    );
  }

  function parseStageTeamCapacities(text) {
    const rows = parseRows(text);
    const { index } = columnReader(rows, STAGE_TEAM_CAPACITY_COLUMNS);
    const entries = [];
    const names = new Set();

    for (const row of rows.filter(row => row.some(value => String(value || '').trim()))) {
      const stage = String(row[index('Stage')] || '').trim();
      const team = String(row[index('Team')] || '').trim();
      const rawCapacity = String(row[index('Max Parallel People')] || '').trim();
      const maxParallelPeople = Number(rawCapacity);
      if (!stage || !team || rawCapacity === '') throw new Error('Stage, Team and Max Parallel People must not be empty');
      const normalized = normalizeStageName(stage);
      if (names.has(normalized)) throw new Error(`Duplicate stage in stage/team/capacity CSV: ${stage}`);
      const department = findDepartment(team);
      if (!department) throw new Error(`Unknown team: ${team}`);
      if (!Number.isInteger(maxParallelPeople) || maxParallelPeople < 0) {
        throw new Error(`Max Parallel People must be an integer >= 0: ${stage}`);
      }
      names.add(normalized);
      entries.push({
        id: stageIdForName(stage),
        stage,
        team: department.name,
        departmentId: department.id,
        maxParallelPeople
      });
    }

    if (!entries.length) throw new Error('Stage/team/capacity CSV is empty');
    return entries;
  }

  function mergeStageTeamCapacities(stageCatalog, stages) {
    const result = stageCatalog.map(entry => ({ ...entry }));
    const names = new Set(result.map(entry => normalizeStageName(entry.stage)));
    for (const stage of stages || []) {
      const name = stage.name || stage.stage;
      const normalized = normalizeStageName(name);
      if (!normalized || names.has(normalized)) continue;
      result.push({
        id: stageIdForName(name),
        stage: name,
        team: 'Unknown',
        departmentId: 'unknown',
        maxParallelPeople: 1
      });
      names.add(normalized);
    }
    return result;
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function serializeStageTeamCapacities(stageCatalog) {
    return [
      STAGE_TEAM_CAPACITY_COLUMNS,
      ...stageCatalog.map(entry => [entry.stage, entry.team, entry.maxParallelPeople])
    ].map(row => row.map(csvCell).join(',')).join('\n');
  }

  function parseCsv(text, stageCatalog) {
    const catalog = stageCatalog || [];
    const catalogByName = new Map(catalog.map(entry => [normalizeStageName(entry.stage), entry]));
    const rows = parseRows(text);
    const { index } = columnReader(rows, REQUIRED_COLUMNS);
    const locations = [];
    const unconfiguredStages = [];
    const unconfiguredByName = new Map();
    let location = null;

    for (const row of rows) {
      if (!row.some(value => String(value || '').trim())) continue;
      const locationName = String(row[index('Location & Filler Space')] || '').trim();
      if (locationName) {
        location = {
          id: `L${String(locations.length + 1).padStart(2, '0')}`,
          order: locations.length,
          name: locationName,
          priority: String(row[index('Priority')] || '').trim() || 'Medium',
          tasks: []
        };
        locations.push(location);
      }
      if (!location) continue;

      const sourceStage = String(row[index('Stage')] || '').trim();
      if (!sourceStage) continue;
      const normalized = normalizeStageName(sourceStage);
      const registered = catalogByName.get(normalized);
      if (!registered && !unconfiguredByName.has(normalized)) {
        const unconfigured = { id: stageIdForName(sourceStage), name: sourceStage };
        unconfiguredByName.set(normalized, unconfigured);
        unconfiguredStages.push(unconfigured);
      }
      const stageId = registered ? registered.id : unconfiguredByName.get(normalized).id;
      const rawEstimate = String(row[index('Est. Days')] || '').trim();
      const estimate = rawEstimate === '' ? 0 : Number(rawEstimate.replace(',', '.'));
      if (!Number.isFinite(estimate) || estimate < 0) {
        throw new Error(`Invalid estimate: ${location.name} / ${sourceStage}`);
      }
      if (location.tasks.some(task => task.stageId === stageId)) {
        throw new Error(`Duplicate stage: ${location.name} / ${sourceStage}`);
      }

      const department = registered ? findDepartment(registered.team) : findDepartment('Unknown');
      location.tasks.push({
        id: `${location.id}:${stageId}`,
        stageId,
        stageName: registered ? registered.stage : sourceStage,
        departmentId: department.id,
        department: department.name,
        departmentCss: department.css,
        estimate,
        status: String(row[index('Status')] || '').trim(),
        notes: String(row[index('Notes')] || '').trim()
      });
    }

    if (!locations.length) throw new Error('CSV contains no locations');
    return { locations, unconfiguredStages };
  }

  function parseDependencies(text, stageCatalog) {
    const catalogByName = new Map((stageCatalog || []).map(entry => [normalizeStageName(entry.stage), entry]));
    const rows = parseRows(text);
    const { index } = columnReader(rows, DEPENDENCY_COLUMNS);
    const dependencies = rows
      .filter(row => row.some(value => String(value || '').trim()))
      .map(row => {
        const fromName = String(row[index('From Stage')] || '').trim();
        const toName = String(row[index('To Stage')] || '').trim();
        const fromStage = catalogByName.get(normalizeStageName(fromName));
        const toStage = catalogByName.get(normalizeStageName(toName));
        const type = String(row[index('Type')] || 'FS').trim().toUpperCase();
        const lag = Number(String(row[index('Lag Days')] || '0').trim());
        if (!fromStage || !toStage) throw new Error(`Dependency references a stage outside estimates and stage/team/capacity CSV: ${fromName} -> ${toName}`);
        if (!['FS', 'FF'].includes(type)) throw new Error(`Only FS and FF dependencies are supported: ${fromName} -> ${toName}`);
        if (!Number.isInteger(lag) || lag < 0) throw new Error(`Lag Days must be an integer >= 0: ${fromName} -> ${toName}`);
        return { from: fromStage.id, to: toStage.id, type, lag };
      });
    if (!dependencies.length) throw new Error('Dependencies CSV is empty');
    return dependencies;
  }

  function stageCapacities(stageCatalog) {
    return Object.fromEntries((stageCatalog || []).map(entry => [entry.id, entry.maxParallelPeople]));
  }

  return {
    DEPARTMENTS,
    stageIdForName,
    parseStageTeamCapacities,
    mergeStageTeamCapacities,
    serializeStageTeamCapacities,
    parseCsv,
    parseDependencies,
    stageCapacities
  };
});
