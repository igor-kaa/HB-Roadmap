const test = require('node:test');
const assert = require('node:assert/strict');
const Csv = require('../location-csv.js');
const Scheduler = require('../location-scheduler.js');

const CAPACITIES = Object.fromEntries(Csv.DEPARTMENTS.map(department => [department.id, department.defaultCapacity]));
const STAGE_CAPACITIES = Csv.parseStageCapacities(Csv.DEFAULT_STAGE_CAPACITY_CSV);

function scheduleDefault() {
  const input = Csv.parseCsv(Csv.DEFAULT_CSV);
  const dependencies = Csv.parseDependencies(Csv.DEFAULT_DEPENDENCIES_CSV);
  return { input, state: Scheduler.schedule(input, dependencies, STAGE_CAPACITIES, '2026-07-13', CAPACITIES) };
}

test('Locations Inventory format expands into the level production model', () => {
  const input = Csv.parseCsv(Csv.DEFAULT_CSV);

  assert.equal(input.locations.length, 10);
  assert.equal(input.locations[0].name, 'Beach (Rocky Coast)');
  assert.equal(input.locations[0].tasks.length, 10);
  assert.equal(input.excluded.length, 20);
  assert.deepEqual(
    input.locations[0].tasks.filter(task => ['LIGHTING', 'VISUAL_FX', 'SOUND_FX'].includes(task.stageId)).map(task => [task.stageId, task.estimate]),
    [['LIGHTING', 10], ['VISUAL_FX', 10], ['SOUND_FX', 10]]
  );
});

test('department default capacities match the level production plan', () => {
  assert.deepEqual(CAPACITIES, {
    design: 20,
    levelDesign: 80,
    levelArt: 40,
    modeling: 60,
    technicalArt: 20,
    sound: 20
  });
});

test('every stage defaults to one parallel person', () => {
  assert.deepEqual(STAGE_CAPACITIES, {
    CONCEPT: 1,
    LD_MACRO: 1,
    LD_GREYBOX: 1,
    GAMEPLAY_PASS: 1,
    LA_ASSET_LIST: 1,
    MODELLING: 1,
    LA_DRESSING: 1,
    LIGHTING: 1,
    VISUAL_FX: 1,
    SOUND_FX: 1
  });
});

test('stage parallelism supports fixed people and zero as unlimited', () => {
  const input = Csv.parseCsv(Csv.DEFAULT_CSV);
  input.locations = input.locations.slice(0, 1);
  const dependencies = Csv.parseDependencies(Csv.DEFAULT_DEPENDENCIES_CSV);
  const twoPeople = { ...STAGE_CAPACITIES, LD_MACRO: 2 };
  const unlimited = { ...STAGE_CAPACITIES, LD_MACRO: 0 };
  const stateTwo = Scheduler.schedule(input, dependencies, twoPeople, '2026-07-13', CAPACITIES);
  const stateUnlimited = Scheduler.schedule(input, dependencies, unlimited, '2026-07-13', CAPACITIES);
  const macroTwo = stateTwo.locations[0].tasks.find(task => task.stageId === 'LD_MACRO');
  const macroUnlimited = stateUnlimited.locations[0].tasks.find(task => task.stageId === 'LD_MACRO');

  assert.deepEqual(macroTwo.allocation.map(item => item.amount), [2, 2, 2, 2, 2]);
  assert.deepEqual(macroUnlimited.allocation.map(item => item.amount), [4, 4, 2]);
});

test('stage capacity parser rejects missing and negative values', () => {
  assert.throws(
    () => Csv.parseStageCapacities('Stage ID,Max Parallel People\nCONCEPT,-1'),
    /Max Parallel People/
  );
  assert.throws(
    () => Csv.parseStageCapacities('Stage ID,Max Parallel People\nCONCEPT,1'),
    /не содержит/
  );
});

test('default location roadmap allocates every estimate and respects capacities', () => {
  const { state } = scheduleDefault();
  assert.equal(state.locations.length, 10);
  assert.equal(state.tasks.length, 100);
  assert.equal(state.tasks.reduce((sum, task) => sum + task.estimate, 0), 1000);
  assert.equal(Scheduler.dateKey(state.endDate), '2027-05-28');

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

test('FS branches run after Greybox and Visual FX and Sound FX stay independent', () => {
  const { state } = scheduleDefault();
  for (const location of state.locations) {
    const byStage = new Map(location.tasks.map(task => [task.stageId, task]));
    const greyboxEnd = byStage.get('LD_GREYBOX').completeIndex;
    for (const stageId of ['GAMEPLAY_PASS', 'LA_DRESSING', 'VISUAL_FX', 'SOUND_FX']) {
      assert.ok(byStage.get(stageId).allocation[0].index > greyboxEnd, `${location.name} / ${stageId} starts before Greybox ends`);
    }
    assert.equal(byStage.get('VISUAL_FX').departmentId, 'technicalArt');
    assert.equal(byStage.get('SOUND_FX').departmentId, 'sound');
  }
});

test('FF keeps LA Dressing open until Modelling has finished', () => {
  const input = Csv.parseCsv(Csv.DEFAULT_CSV);
  input.locations = input.locations.slice(0, 1);
  const byStage = new Map(input.locations[0].tasks.map(task => [task.stageId, task]));
  byStage.get('MODELLING').estimate = 30;
  byStage.get('LA_DRESSING').estimate = 2;
  const state = Scheduler.schedule(
    input,
    Csv.parseDependencies(Csv.DEFAULT_DEPENDENCIES_CSV),
    STAGE_CAPACITIES,
    '2026-07-13',
    CAPACITIES
  );
  const scheduled = new Map(state.locations[0].tasks.map(task => [task.stageId, task]));
  const dressing = scheduled.get('LA_DRESSING');
  const modelling = scheduled.get('MODELLING');

  assert.ok(dressing.allocation[0].index > scheduled.get('LD_GREYBOX').completeIndex);
  assert.ok(dressing.completeIndex >= modelling.completeIndex);
  assert.ok(dressing.allocation.length > 1);
});

test('dependency parser rejects cycles', () => {
  const input = Csv.parseCsv(Csv.DEFAULT_CSV);
  input.locations = input.locations.slice(0, 1);
  const dependencies = Csv.parseDependencies(Csv.DEFAULT_DEPENDENCIES_CSV);
  dependencies.push({ from: 'LIGHTING', to: 'CONCEPT', type: 'FS', lag: 0 });
  assert.throws(
    () => Scheduler.schedule(input, dependencies, STAGE_CAPACITIES, '2026-07-13', CAPACITIES),
    /циклическую зависимость/
  );
});
