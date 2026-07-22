const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Csv = require('../location-csv.js');
const Scheduler = require('../location-scheduler.js');

const ROOT = path.resolve(__dirname, '..');
const readCsv = filename => fs.readFileSync(path.join(ROOT, filename), 'utf8');
const ESTIMATES_TEXT = readCsv('location-estimates.csv');
const DEPENDENCIES_TEXT = readCsv('location-dependencies.csv');
const STAGE_CATALOG_TEXT = readCsv('location-stage-team-capacity.csv');
const BASE_CATALOG = Csv.parseStageTeamCapacities(STAGE_CATALOG_TEXT);
const INITIAL_INPUT = Csv.parseCsv(ESTIMATES_TEXT, BASE_CATALOG);
const STAGE_CATALOG = Csv.mergeStageTeamCapacities(BASE_CATALOG, INITIAL_INPUT.unconfiguredStages);
const STAGE_CAPACITIES = Csv.stageCapacities(STAGE_CATALOG);
const CAPACITIES = Object.fromEntries(Csv.DEPARTMENTS.map(department => [department.id, department.defaultCapacity]));
const stageId = name => Csv.stageIdForName(name);

function defaultInput() {
  return Csv.parseCsv(ESTIMATES_TEXT, STAGE_CATALOG);
}

function scheduleDefault() {
  const input = defaultInput();
  const dependencies = Csv.parseDependencies(DEPENDENCIES_TEXT, STAGE_CATALOG);
  return { input, state: Scheduler.schedule(input, dependencies, STAGE_CAPACITIES, '2026-07-13', CAPACITIES) };
}

test('stage source of truth is the union of estimates and stage/team/capacity CSV', () => {
  assert.equal(INITIAL_INPUT.locations.length, 10);
  assert.equal(INITIAL_INPUT.locations[0].tasks.length, 10);
  assert.equal(INITIAL_INPUT.locations.flatMap(location => location.tasks).length, 100);
  assert.equal(STAGE_CATALOG.length, BASE_CATALOG.length + INITIAL_INPUT.unconfiguredStages.length);
  const estimateOnly = STAGE_CATALOG.filter(stage => INITIAL_INPUT.unconfiguredStages.some(item => item.id === stage.id));
  assert.ok(estimateOnly.every(stage => stage.departmentId === 'unknown' && stage.maxParallelPeople === 1));
});

test('the parser creates one task per estimate row without hardcoded expansion or exclusion', () => {
  const input = defaultInput();
  const first = input.locations[0];
  assert.equal(first.name, 'Beach (Rocky Coast)');
  assert.deepEqual(first.tasks.map(task => task.stageName), [
    'Concept', 'LD Macro Layout', 'LD Greybox', 'Gameplay Pass', 'LA Asset List',
    'Modelling', 'LA Dressing', 'Lighting & VFX', 'Gameplay Balancing', 'QA / Playtest'
  ]);
  assert.equal(first.tasks.reduce((sum, task) => sum + task.estimate, 0), 100);
  assert.equal(first.tasks.find(task => task.stageName === 'Lighting & VFX').sourceStage, 'Lighting & VFX');
});

test('combined CSV controls both team and parallelism for a dynamic stage', () => {
  const catalog = Csv.parseStageTeamCapacities(`Stage,Team,Max Parallel People
Review Gate,Game Design,2`);
  const input = Csv.parseCsv(`Location & Filler Space,Priority,Stage,Status,Est. Days,Notes
Test Location,High,Review Gate,Not Started,5,`, catalog);
  const task = input.locations[0].tasks[0];

  assert.equal(task.departmentId, 'gameDesign');
  assert.equal(Csv.stageCapacities(catalog)[task.stageId], 2);
  assert.match(Csv.serializeStageTeamCapacities(catalog), /Review Gate,Game Design,2/);
});

test('department catalog includes the new production teams and capacities', () => {
  assert.deepEqual(
    Csv.DEPARTMENTS.filter(department => department.id !== 'unknown').map(department => [department.name, department.defaultCapacity]),
    [
      ['Game Design', 20],
      ['Narrative', 20],
      ['VFX', 20],
      ['Concept Art', 40],
      ['Level Design', 80],
      ['Level Art', 40],
      ['3D Outsource', 60],
      ['Technical Art', 20],
      ['Sound', 20]
    ]
  );
  const legacy = Csv.parseStageTeamCapacities('Stage,Team,Max Parallel People\nReview Gate,Design,1');
  assert.equal(legacy[0].departmentId, 'gameDesign');
  assert.equal(legacy[0].team, 'Game Design');
});

test('combined CSV validates duplicates, teams and capacity', () => {
  assert.throws(
    () => Csv.parseStageTeamCapacities('Stage,Team,Max Parallel People\nReview,Game Design,-1'),
    /Max Parallel People/
  );
  assert.throws(
    () => Csv.parseStageTeamCapacities('Stage,Team,Max Parallel People\nReview,No Such Team,1'),
    /Unknown team/
  );
  assert.throws(
    () => Csv.parseStageTeamCapacities('Stage,Team,Max Parallel People\nReview,Game Design,1\n review ,Game Design,2'),
    /Duplicate stage/
  );
});

test('dependencies resolve through the source-of-truth union and cannot add stages', () => {
  const dependencies = Csv.parseDependencies(DEPENDENCIES_TEXT, STAGE_CATALOG);
  assert.ok(dependencies.length > 0);
  assert.throws(
    () => Csv.parseDependencies('From Stage,To Stage,Type,Lag Days\nConcept,Not In Either Source,FS,0', STAGE_CATALOG),
    /outside estimates and stage\/team\/capacity CSV/
  );
});

test('stage parallelism supports fixed people and zero as unlimited', () => {
  const catalog = Csv.parseStageTeamCapacities(`Stage,Team,Max Parallel People
Production,Level Design,2`);
  const input = Csv.parseCsv(`Location & Filler Space,Priority,Stage,Status,Est. Days,Notes
Test Location,High,Production,,10,`, catalog);
  const productionId = stageId('Production');
  const stateTwo = Scheduler.schedule(
    input, [], { [productionId]: 2 }, '2026-07-13', { levelDesign: 80 }
  );
  const stateUnlimited = Scheduler.schedule(
    input, [], { [productionId]: 0 }, '2026-07-13', { levelDesign: 80 }
  );

  assert.deepEqual(stateTwo.tasks[0].allocation.map(item => item.amount), [2, 2, 2, 2, 2]);
  assert.deepEqual(stateUnlimited.tasks[0].allocation.map(item => item.amount), [4, 4, 2]);
});

test('priority values are normalized, validated and used to order locations', () => {
  const catalog = Csv.parseStageTeamCapacities(`Stage,Team,Max Parallel People
Production,Level Design,1`);
  const input = Csv.parseCsv(`Location & Filler Space,Priority,Stage,Status,Est. Days,Notes
Low first in CSV,Low,Production,,1,
Critical alias,P0,Production,,1,
High third,high,Production,,1,`, catalog);
  const state = Scheduler.schedule(
    input,
    [],
    Csv.stageCapacities(catalog),
    '2026-07-13',
    { levelDesign: 20 }
  );

  assert.deepEqual(state.locations.map(location => location.name), [
    'Critical alias', 'High third', 'Low first in CSV'
  ]);
  assert.deepEqual(state.locations.map(location => location.priority), ['Critical', 'High', 'Low']);
  assert.throws(() => Scheduler.normalizePriority('Urgent'), /Unknown location priority: Urgent/);
});

test('each department focuses on two ready locations and returns when a higher-ranked location unblocks', () => {
  const catalog = Csv.parseStageTeamCapacities(`Stage,Team,Max Parallel People
LD Early,Level Design,1
LA Work,Level Art,1
LD Pass,Level Design,1`);
  const input = Csv.parseCsv(`Location & Filler Space,Priority,Stage,Status,Est. Days,Notes
Rocky Coast,Critical,LD Early,,1,
,,LA Work,,3,
,,LD Pass,,1,
Tartarian Hall,Critical,LD Early,,3,
,,LA Work,,3,
,,LD Pass,,1,
Starfortress Dungeon,Critical,LD Early,,3,
,,LA Work,,3,
,,LD Pass,,1,`, catalog);
  const dependencies = Csv.parseDependencies(`From Stage,To Stage,Type,Lag Days
LA Work,LD Pass,FS,0`, catalog);
  const state = Scheduler.schedule(
    input,
    dependencies,
    Csv.stageCapacities(catalog),
    '2026-07-13',
    { levelDesign: 60, levelArt: 20 }
  );
  const levelDesignLocations = dayIndex => [...new Set(state.days[dayIndex].allocations
    .filter(allocation => allocation.departmentId === 'levelDesign')
    .map(allocation => allocation.locationId))];

  assert.deepEqual(levelDesignLocations(0), ['L01', 'L02']);
  assert.deepEqual(levelDesignLocations(1), ['L02', 'L03']);
  assert.deepEqual(levelDesignLocations(3), ['L01', 'L03']);
  assert.equal(state.constants.MAX_ACTIVE_LOCATIONS_PER_DEPARTMENT, 2);
  for (const day of state.days) {
    for (const departmentId of ['levelDesign', 'levelArt']) {
      const activeLocations = new Set(day.allocations
        .filter(allocation => allocation.departmentId === departmentId)
        .map(allocation => allocation.locationId));
      assert.ok(activeLocations.size <= 2, `${departmentId} exceeds its location focus on ${day.date}`);
    }
  }
});

test('default roadmap allocates every estimate and respects team capacities', () => {
  const { state } = scheduleDefault();
  assert.equal(state.locations.length, 10);
  assert.equal(state.tasks.length, 100);
  assert.equal(state.tasks.reduce((sum, task) => sum + task.estimate, 0), 1000);

  for (const task of state.tasks) {
    const allocated = task.allocation.reduce((sum, item) => sum + item.amount, 0);
    assert.ok(Math.abs(allocated - task.estimate) < 1e-6, `${task.id} allocation mismatch`);
  }
  for (const day of state.days) {
    for (const department of Csv.DEPARTMENTS) {
      assert.ok(day.used[department.id] <= day.capacities[department.id] + 1e-6, `${department.id} overload`);
    }
  }
});

test('FS and FF dependencies use dynamic stage IDs', () => {
  const input = defaultInput();
  input.locations = input.locations.slice(0, 1);
  const byStage = new Map(input.locations[0].tasks.map(task => [task.stageId, task]));
  byStage.get(stageId('Modelling')).estimate = 30;
  byStage.get(stageId('LA Dressing')).estimate = 2;
  const state = Scheduler.schedule(
    input,
    Csv.parseDependencies(DEPENDENCIES_TEXT, STAGE_CATALOG),
    STAGE_CAPACITIES,
    '2026-07-13',
    CAPACITIES
  );
  const scheduled = new Map(state.locations[0].tasks.map(task => [task.stageId, task]));
  const greybox = scheduled.get(stageId('LD Greybox'));
  const dressing = scheduled.get(stageId('LA Dressing'));
  const modelling = scheduled.get(stageId('Modelling'));

  assert.ok(dressing.allocation[0].index > greybox.completeIndex);
  assert.ok(dressing.completeIndex >= modelling.completeIndex);
});

test('dependencies for stages absent from estimates are ignored by the scheduler', () => {
  const input = defaultInput();
  const macroId = stageId('LD Macro Layout');
  for (const location of input.locations) location.tasks = location.tasks.filter(task => task.stageId !== macroId);
  const state = Scheduler.schedule(
    input,
    Csv.parseDependencies(DEPENDENCIES_TEXT, STAGE_CATALOG),
    STAGE_CAPACITIES,
    '2026-07-13',
    CAPACITIES
  );
  assert.equal(state.dependencies.some(item => item.from === macroId || item.to === macroId), false);
});

test('dependency cycles are rejected after dynamic name resolution', () => {
  const catalog = Csv.parseStageTeamCapacities(`Stage,Team,Max Parallel People
Stage A,Level Design,1
Stage B,Level Design,1`);
  const input = Csv.parseCsv(`Location & Filler Space,Priority,Stage,Status,Est. Days,Notes
Test Location,High,Stage A,,1,
,,Stage B,,1,`, catalog);
  const dependencies = Csv.parseDependencies(`From Stage,To Stage,Type,Lag Days
Stage A,Stage B,FS,0
Stage B,Stage A,FS,0`, catalog);
  assert.throws(
    () => Scheduler.schedule(input, dependencies, Csv.stageCapacities(catalog), '2026-07-13', { levelDesign: 20 }),
    /циклическую зависимость/
  );
});
