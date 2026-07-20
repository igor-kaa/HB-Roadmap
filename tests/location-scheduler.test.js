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
  assert.equal(BASE_CATALOG.length, 12);
  assert.equal(INITIAL_INPUT.unconfiguredStages.length, 3);
  assert.equal(STAGE_CATALOG.length, 15);
  assert.equal(INITIAL_INPUT.locations.length, 10);
  assert.equal(INITIAL_INPUT.locations[0].tasks.length, 10);
  assert.equal(INITIAL_INPUT.locations.flatMap(location => location.tasks).length, 100);

  assert.deepEqual(INITIAL_INPUT.unconfiguredStages.map(stage => stage.name), ['Lighting & VFX', 'Gameplay Balancing', 'QA / Playtest']);
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
});

test('combined CSV controls both team and parallelism for a dynamic stage', () => {
  const catalog = Csv.parseStageTeamCapacities(`Stage,Team,Max Parallel People
Review Gate,Design,2`);
  const input = Csv.parseCsv(`Location & Filler Space,Priority,Stage,Status,Est. Days,Notes
Test Location,High,Review Gate,Not Started,5,`, catalog);
  const task = input.locations[0].tasks[0];

  assert.equal(task.departmentId, 'design');
  assert.equal(Csv.stageCapacities(catalog)[task.stageId], 2);
  assert.match(Csv.serializeStageTeamCapacities(catalog), /Review Gate,Design,2/);
});

test('combined CSV validates duplicates, teams and capacity', () => {
  assert.throws(
    () => Csv.parseStageTeamCapacities('Stage,Team,Max Parallel People\nReview,Design,-1'),
    /Max Parallel People/
  );
  assert.throws(
    () => Csv.parseStageTeamCapacities('Stage,Team,Max Parallel People\nReview,No Such Team,1'),
    /Unknown team/
  );
  assert.throws(
    () => Csv.parseStageTeamCapacities('Stage,Team,Max Parallel People\nReview,Design,1\n review ,Design,2'),
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
  const input = defaultInput();
  input.locations = input.locations.slice(0, 1);
  const dependencies = Csv.parseDependencies(DEPENDENCIES_TEXT, STAGE_CATALOG);
  const macroId = stageId('LD Macro Layout');
  const twoPeople = { ...STAGE_CAPACITIES, [macroId]: 2 };
  const unlimited = { ...STAGE_CAPACITIES, [macroId]: 0 };
  const stateTwo = Scheduler.schedule(input, dependencies, twoPeople, '2026-07-13', CAPACITIES);
  const stateUnlimited = Scheduler.schedule(input, dependencies, unlimited, '2026-07-13', CAPACITIES);
  const macroTwo = stateTwo.locations[0].tasks.find(task => task.stageId === macroId);
  const macroUnlimited = stateUnlimited.locations[0].tasks.find(task => task.stageId === macroId);

  assert.deepEqual(macroTwo.allocation.map(item => item.amount), [2, 2, 2, 2, 2]);
  assert.deepEqual(macroUnlimited.allocation.map(item => item.amount), [4, 4, 2]);
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
  const input = defaultInput();
  input.locations = input.locations.slice(0, 1);
  const dependencies = Csv.parseDependencies(DEPENDENCIES_TEXT, STAGE_CATALOG);
  dependencies.push({ from: stageId('Gameplay Pass'), to: stageId('Concept'), type: 'FS', lag: 0 });
  assert.throws(
    () => Scheduler.schedule(input, dependencies, STAGE_CAPACITIES, '2026-07-13', CAPACITIES),
    /циклическую зависимость/
  );
});
