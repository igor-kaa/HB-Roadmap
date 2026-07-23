const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Csv = require('../location-csv.js');
const Scheduler = require('../location-scheduler.js');

const ROOT = path.resolve(__dirname, '..');
const readCsv = filename => fs.readFileSync(path.join(ROOT, filename), 'utf8');
const ESTIMATES_TEXT = `Location & Filler Space,Priority,Stage,Status,Est. Days,Notes
Location Alpha,High,Art: Concept Global,Approved,2,
,,Art: Concept Arts,In Progress,2,
,,Art: Additional Concept,Not Started,2,
,,Custom Review,Not Started,1,
Location Beta,Low,Art: Concept Global,Approved,2,
,,Art: Concept Arts,Not Started,2,
,,Art: Additional Concept,Not Started,2,
,,Custom Review,Not Started,1,`;
const DEPENDENCIES_TEXT = readCsv('location-dependencies.csv');
const STAGE_CATALOG_TEXT = readCsv('location-stage-team-capacity.csv');
const BASE_CATALOG = Csv.parseStageTeamCapacities(STAGE_CATALOG_TEXT);
const INITIAL_INPUT = Csv.parseCsv(ESTIMATES_TEXT, BASE_CATALOG);
const STAGE_CATALOG = Csv.mergeStageTeamCapacities(BASE_CATALOG, INITIAL_INPUT.unconfiguredStages);
const STAGE_CAPACITIES = Csv.stageCapacities(STAGE_CATALOG);
const CAPACITIES = Object.fromEntries(Csv.DEPARTMENTS.map(department => [department.id, department.defaultCapacity]));
const stageId = name => Csv.stageIdForName(name);

test('nextSprintMonday selects the current or next sprint start', () => {
  assert.equal(Scheduler.dateKey(Scheduler.nextSprintMonday(new Date(2026, 6, 23, 12))), '2026-07-27');
});

function defaultInput() {
  return Csv.parseCsv(ESTIMATES_TEXT, STAGE_CATALOG);
}

function scheduleDefault() {
  const input = defaultInput();
  const dependencies = Csv.parseDependencies(DEPENDENCIES_TEXT, STAGE_CATALOG);
  return { input, state: Scheduler.schedule(input, dependencies, STAGE_CAPACITIES, '2026-07-13', CAPACITIES) };
}

test('stage source of truth is the union of estimates and stage/team/capacity CSV', () => {
  assert.equal(INITIAL_INPUT.locations.length, 2);
  assert.equal(INITIAL_INPUT.locations[0].tasks.length, 4);
  assert.equal(INITIAL_INPUT.locations.flatMap(location => location.tasks).length, 8);

  assert.equal(STAGE_CATALOG.length, BASE_CATALOG.length + INITIAL_INPUT.unconfiguredStages.length);
  assert.deepEqual(INITIAL_INPUT.unconfiguredStages.map(stage => stage.name), ['Custom Review']);
  const estimateOnly = STAGE_CATALOG.filter(stage => INITIAL_INPUT.unconfiguredStages.some(item => item.id === stage.id));
  assert.ok(estimateOnly.every(stage => stage.departmentId === 'unknown' && stage.maxParallelPeople === 1));
});

test('the parser creates one task per estimate row without hardcoded expansion or exclusion', () => {
  const catalog = Csv.parseStageTeamCapacities(`Stage,Team,Max Parallel People
Planning,Level Design,1
Production,Level Art,2`);
  const input = Csv.parseCsv(`Location & Filler Space,Priority,Stage,Status,Est. Days,Notes
Location A,High,Planning,Approved,2,
,,Production,In Progress,3,
Location B,Low,Planning,Not Started,1,`, catalog);

  assert.equal(input.locations.length, 2);
  assert.deepEqual(input.locations.map(location => location.tasks.length), [2, 1]);
  assert.deepEqual(input.locations[0].tasks.map(task => task.stageName), ['Planning', 'Production']);
  assert.equal(input.locations.flatMap(location => location.tasks).reduce((sum, task) => sum + task.estimate, 0), 6);
  assert.equal(input.locations[0].tasks[1].department, 'Level Art');
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

test('department catalog includes only the current production teams and capacities', () => {
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
  assert.throws(
    () => Csv.parseStageTeamCapacities('Stage,Team,Max Parallel People\nReview Gate,Design,1'),
    /Unknown team: Design/
  );
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
  const knownStage = BASE_CATALOG[0].stage;
  assert.throws(
    () => Csv.parseDependencies(`From Stage,To Stage,Type,Lag Days\n${knownStage},Not In Either Source,FS,0`, STAGE_CATALOG),
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

test('roadmap allocates every estimate and respects team capacities', () => {
  const { state } = scheduleDefault();
  assert.equal(state.locations.length, 2);
  assert.equal(state.tasks.length, 8);
  assert.equal(state.tasks.reduce((sum, task) => sum + task.estimate, 0), 14);

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
  const catalog = Csv.parseStageTeamCapacities(`Stage,Team,Max Parallel People
Planning,Level Design,1
Production,Level Art,1
Review,Level Art,1`);
  const input = Csv.parseCsv(`Location & Filler Space,Priority,Stage,Status,Est. Days,Notes
Test Location,High,Planning,,2,
,,Production,,5,
,,Review,,1,`, catalog);
  const dependencies = Csv.parseDependencies(`From Stage,To Stage,Type,Lag Days
Planning,Production,FS,0
Production,Review,FF,0`, catalog);
  const state = Scheduler.schedule(
    input,
    dependencies,
    Csv.stageCapacities(catalog),
    '2026-07-13',
    { levelDesign: 20, levelArt: 40 }
  );
  const scheduled = new Map(state.tasks.map(task => [task.stageName, task]));
  const planning = scheduled.get('Planning');
  const production = scheduled.get('Production');
  const review = scheduled.get('Review');

  assert.ok(production.allocation[0].index > planning.completeIndex);
  assert.ok(review.completeIndex >= production.completeIndex);
});

test('dependencies for stages absent from estimates are ignored by the scheduler', () => {
  const catalog = Csv.parseStageTeamCapacities(`Stage,Team,Max Parallel People
Planning,Level Design,1
Production,Level Art,1
Review,Game Design,1`);
  const input = Csv.parseCsv(`Location & Filler Space,Priority,Stage,Status,Est. Days,Notes
Test Location,High,Planning,,1,
,,Review,,1,`, catalog);
  const dependencies = Csv.parseDependencies(`From Stage,To Stage,Type,Lag Days
Planning,Production,FS,0
Production,Review,FS,0`, catalog);
  const state = Scheduler.schedule(
    input,
    dependencies,
    Csv.stageCapacities(catalog),
    '2026-07-13',
    { levelDesign: 20, levelArt: 20, gameDesign: 20 }
  );
  assert.deepEqual(state.dependencies, []);
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
