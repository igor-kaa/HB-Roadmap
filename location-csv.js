(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HyperboreaLocationCsv = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const REQUIRED_COLUMNS = ['Location & Filler Space', 'Priority', 'Stage', 'Status', 'Est. Days', 'Notes'];
  const DEPENDENCY_COLUMNS = ['From Stage ID', 'To Stage ID', 'Type', 'Lag Days'];
  const DEPARTMENTS = Object.freeze([
    { id: 'design', name: 'Design', css: 'loc-design', defaultCapacity: 20 },
    { id: 'levelDesign', name: 'Level Design', css: 'loc-ld', defaultCapacity: 80 },
    { id: 'levelArt', name: 'Level Art', css: 'loc-la', defaultCapacity: 40 },
    { id: 'modeling', name: '3D Outsource', css: 'loc-3d', defaultCapacity: 60 },
    { id: 'technicalArt', name: 'Technical Art', css: 'loc-ta', defaultCapacity: 20 },
    { id: 'sound', name: 'Sound', css: 'loc-sound', defaultCapacity: 20 }
  ]);

  const STAGES = Object.freeze({
    CONCEPT: { id: 'CONCEPT', name: 'Concept', departmentId: 'design' },
    LD_MACRO: { id: 'LD_MACRO', name: 'LD Macro Layout', departmentId: 'levelDesign' },
    LD_GREYBOX: { id: 'LD_GREYBOX', name: 'LD Greybox', departmentId: 'levelDesign' },
    GAMEPLAY_PASS: { id: 'GAMEPLAY_PASS', name: 'Gameplay Pass', departmentId: 'design' },
    LA_ASSET_LIST: { id: 'LA_ASSET_LIST', name: 'LA Asset List', departmentId: 'levelArt' },
    MODELLING: { id: 'MODELLING', name: 'Modelling', departmentId: 'modeling' },
    LA_DRESSING: { id: 'LA_DRESSING', name: 'LA Dressing', departmentId: 'levelArt' },
    LIGHTING: { id: 'LIGHTING', name: 'Lighting', departmentId: 'levelArt' },
    VISUAL_FX: { id: 'VISUAL_FX', name: 'Visual FX', departmentId: 'technicalArt' },
    SOUND_FX: { id: 'SOUND_FX', name: 'Sound FX', departmentId: 'sound' }
  });

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

    if (quoted) throw new Error('CSV содержит незакрытую кавычку');
    if (cell.length || row.length) {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
    }
    return rows;
  }

  function columnReader(rows, required) {
    if (!rows.length) throw new Error('CSV пуст');
    const headers = rows.shift().map(value => value.trim());
    const index = name => headers.findIndex(header => header.toLowerCase() === name.toLowerCase());
    const missing = required.filter(name => index(name) < 0);
    if (missing.length) throw new Error('CSV должен содержать: ' + missing.join(', '));
    return { index };
  }

  function normalizeStageName(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function stagesForSourceName(value) {
    const name = normalizeStageName(value);
    const direct = {
      'concept': ['CONCEPT'],
      'ld macro layout': ['LD_MACRO'],
      'ld greybox': ['LD_GREYBOX'],
      'gameplay pass': ['GAMEPLAY_PASS'],
      'la asset list': ['LA_ASSET_LIST'],
      'modelling': ['MODELLING'],
      'modeling': ['MODELLING'],
      'la dressing': ['LA_DRESSING'],
      'lighting': ['LIGHTING'],
      'visual fx': ['VISUAL_FX'],
      'sound fx': ['SOUND_FX'],
      'lighting & vfx': ['LIGHTING', 'VISUAL_FX', 'SOUND_FX'],
      'lighting & vfx ': ['LIGHTING', 'VISUAL_FX', 'SOUND_FX'],
      'vfx': ['VISUAL_FX', 'SOUND_FX']
    };
    return direct[name] || [];
  }

  function parseCsv(text) {
    const rows = parseRows(text);
    const { index } = columnReader(rows, REQUIRED_COLUMNS);
    const locations = [];
    const excluded = [];
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
      if (normalized === 'total') continue;
      if (normalized === 'gameplay balancing' || normalized === 'qa / playtest') {
        excluded.push({ locationId: location.id, locationName: location.name, stage: sourceStage });
        continue;
      }

      const stageIds = stagesForSourceName(sourceStage);
      if (!stageIds.length) throw new Error(`Неизвестный этап: ${sourceStage}`);
      const rawEstimate = String(row[index('Est. Days')] || '').trim();
      const estimate = rawEstimate === '' ? 0 : Number(rawEstimate.replace(',', '.'));
      if (!Number.isFinite(estimate) || estimate < 0) {
        throw new Error(`Некорректная оценка: ${location.name} / ${sourceStage}`);
      }
      const status = String(row[index('Status')] || '').trim();
      const notes = String(row[index('Notes')] || '').trim();

      for (const stageId of stageIds) {
        const stage = STAGES[stageId];
        const department = DEPARTMENTS.find(item => item.id === stage.departmentId);
        if (location.tasks.some(task => task.stageId === stageId)) {
          throw new Error(`Повтор этапа: ${location.name} / ${stage.name}`);
        }
        location.tasks.push({
          id: `${location.id}:${stageId}`,
          stageId,
          stageName: stage.name,
          departmentId: stage.departmentId,
          department: department.name,
          departmentCss: department.css,
          estimate,
          status,
          notes,
          sourceStage
        });
      }
    }

    if (!locations.length) throw new Error('CSV не содержит локаций');
    return { locations, excluded };
  }

  function parseDependencies(text) {
    const rows = parseRows(text);
    const { index } = columnReader(rows, DEPENDENCY_COLUMNS);
    const dependencies = rows
      .filter(row => row.some(value => String(value || '').trim()))
      .map(row => {
        const from = String(row[index('From Stage ID')] || '').trim().toUpperCase();
        const to = String(row[index('To Stage ID')] || '').trim().toUpperCase();
        const type = String(row[index('Type')] || 'FS').trim().toUpperCase();
        const lag = Number(String(row[index('Lag Days')] || '0').trim());
        if (!STAGES[from] || !STAGES[to]) throw new Error(`Неизвестный Stage ID в dependency: ${from} → ${to}`);
        if (!['FS', 'FF'].includes(type)) throw new Error(`Поддерживаются только FS и FF: ${from} → ${to}`);
        if (!Number.isInteger(lag) || lag < 0) throw new Error(`Lag Days должен быть целым числом ≥ 0: ${from} → ${to}`);
        return { from, to, type, lag };
      });
    if (!dependencies.length) throw new Error('CSV dependencies пуст');
    return dependencies;
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function buildDefaultCsv() {
    const names = [
      'Beach (Rocky Coast)',
      'Tartarian Hall - Medium Compound',
      'Suomi Village - Big Compound',
      'Dungeon (Automaton Factory) - Huge Compound',
      'ObeliskTeleportA (Rocky Coast)',
      'ObeliskTeleportB (Suomi Village)',
      'SampoRoom (Small Compound)',
      'Background - All',
      'Filler Space - All (without POI, Compounds)',
      'Star Fortress (Big Compound)'
    ];
    const stages = [
      'Concept', 'LD Macro Layout', 'LD Greybox', 'Gameplay Pass', 'LA Asset List',
      'Modelling', 'LA Dressing', 'Lighting & VFX', 'Gameplay Balancing', 'QA / Playtest'
    ];
    const lines = [REQUIRED_COLUMNS.join(',')];
    names.forEach((name, locationIndex) => {
      stages.forEach((stage, stageIndex) => {
        let status = '';
        if (locationIndex === 0 && ['Concept', 'LD Macro Layout', 'LD Greybox'].includes(stage)) status = 'Approved';
        if (locationIndex === 0 && ['LA Asset List', 'Modelling'].includes(stage)) status = 'Work In Progress';
        if (locationIndex === 0 && ['Gameplay Balancing', 'QA / Playtest'].includes(stage)) status = 'Not Started';
        if (locationIndex === 2 && stage === 'Concept') status = 'Approved';
        lines.push([
          stageIndex === 0 ? name : '', '', stage, status, 10, ''
        ].map(csvCell).join(','));
      });
      lines.push(['', '', 'Total', '', 10, ''].join(','));
      if (locationIndex < names.length - 1) lines.push(',,,,,');
    });
    return lines.join('\n');
  }

  const DEFAULT_DEPENDENCIES_CSV = `From Stage ID,To Stage ID,Type,Lag Days
CONCEPT,LD_MACRO,FS,0
LD_MACRO,LD_GREYBOX,FS,0
LD_GREYBOX,GAMEPLAY_PASS,FS,0
CONCEPT,LA_ASSET_LIST,FS,0
LA_ASSET_LIST,MODELLING,FS,0
LD_GREYBOX,LA_DRESSING,FS,0
MODELLING,LA_DRESSING,FF,0
LA_DRESSING,LIGHTING,FS,0
LD_GREYBOX,VISUAL_FX,FS,0
LD_GREYBOX,SOUND_FX,FS,0`;

  return {
    REQUIRED_COLUMNS,
    DEPENDENCY_COLUMNS,
    DEPARTMENTS,
    STAGES,
    DEFAULT_CSV: buildDefaultCsv(),
    DEFAULT_DEPENDENCIES_CSV,
    parseRows,
    parseCsv,
    parseDependencies
  };
});
