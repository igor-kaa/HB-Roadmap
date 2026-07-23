const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Scheduler = require('../scheduler.js');
const Csv = require('../csv.js');

const ROOT = path.resolve(__dirname, '..');
const EPSILON = 1e-6;
const DEFAULT_CAPACITIES = {
  design: 60,
  dev: 100,
  anim: 40,
  perFeature: 20
};

test('nextSprintMonday selects the current or next sprint start', () => {
  assert.equal(Scheduler.dateKey(Scheduler.nextSprintMonday(new Date(2026, 6, 21, 12))), '2026-07-27');
  assert.equal(Scheduler.dateKey(Scheduler.nextSprintMonday(new Date(2026, 6, 23, 12))), '2026-07-27');
  assert.equal(Scheduler.dateKey(Scheduler.nextSprintMonday(new Date(2026, 6, 20, 12))), '2026-07-20');
  assert.equal(Scheduler.dateKey(Scheduler.nextSprintMonday(new Date(2026, 6, 26, 12))), '2026-07-27');
});

function loadBaseline() {
  const csv = fs.readFileSync(path.join(ROOT, 'VS RoadMap Data (Igor K).csv'), 'utf8');
  const features = Csv.parseCsv(csv);
  const state = Scheduler.schedule(features, '2026-07-13', '2026-07', DEFAULT_CAPACITIES);
  return { features, state };
}

function lastIndex(allocation, fallback = 0) {
  return allocation.length ? allocation[allocation.length - 1].index : fallback;
}

function sum(allocation) {
  return allocation.reduce((total, item) => total + item.amount, 0);
}

test('CSV loads and preserves the v4.1 regression baseline', () => {
  const { features, state } = loadBaseline();
  const totals = features.reduce((result, feature) => {
    for (const key of ['gd', 'dev', 'anim', 'td']) result[key] += feature[key];
    return result;
  }, { gd: 0, dev: 0, anim: 0, td: 0 });
  const sprintCount = Math.ceil(
    Scheduler.daysBetween(state.startDate, Scheduler.addDays(state.endDate, 1)) / 14
  );

  assert.equal(features.length, 43);
  assert.equal(Scheduler.dateKey(state.startDate), '2026-07-13');
  assert.equal(Scheduler.dateKey(state.endDate), '2026-12-09');
  assert.equal(sprintCount, 11);
  assert.deepEqual(totals, { gd: 32, dev: 393, anim: 145, td: 198 });
  assert.deepEqual(state.sprintCapacities, {
    design: 30,
    dev: 50,
    anim: 20,
    perFeature: 10
  });
});

test('DEV, Animation and TD obey GD dependencies; TD finishes after production', () => {
  const { state } = loadBaseline();

  for (const feature of state.features) {
    const gdEnd = feature.gdAlloc.length ? lastIndex(feature.gdAlloc) : -1;
    for (const key of ['devAlloc', 'animAlloc', 'tdAlloc']) {
      if (feature[key].length) {
        assert.ok(
          feature[key][0].index > gdEnd,
          `${feature.name} / ${key} starts before GD finishes`
        );
      }
    }
    if (feature.tdAlloc.length) {
      const productionEnd = Math.max(
        lastIndex(feature.devAlloc, 0),
        lastIndex(feature.animAlloc, 0)
      );
      assert.ok(
        lastIndex(feature.tdAlloc) >= productionEnd,
        `${feature.name} / TD finishes before production`
      );
    }
  }
});

test('daily and sprint resource capacities are never exceeded', () => {
  const { state } = loadBaseline();
  const bySprint = new Map();

  for (const day of state.days) {
    assert.ok(day.usedDesign <= day.designCap + EPSILON, `Design overload on ${Scheduler.dateKey(day.date)}`);
    assert.ok(day.usedDev <= day.devCap + EPSILON, `DEV overload on ${Scheduler.dateKey(day.date)}`);
    assert.ok(day.usedAnim <= day.animCap + EPSILON, `Animation overload on ${Scheduler.dateKey(day.date)}`);

    if (!bySprint.has(day.sprint)) bySprint.set(day.sprint, { design: 0, dev: 0, anim: 0 });
    const usage = bySprint.get(day.sprint);
    usage.design += day.usedDesign;
    usage.dev += day.usedDev;
    usage.anim += day.usedAnim;
  }

  for (const [sprint, usage] of bySprint) {
    assert.ok(usage.design <= state.sprintCapacities.design + EPSILON, `Design overload in ${sprint}`);
    assert.ok(usage.dev <= state.sprintCapacities.dev + EPSILON, `DEV overload in ${sprint}`);
    assert.ok(usage.anim <= state.sprintCapacities.anim + EPSILON, `Animation overload in ${sprint}`);
  }
});

test('one feature stage never consumes more than one person per sprint', () => {
  const { state } = loadBaseline();

  for (const feature of state.features) {
    for (const key of ['gdAlloc', 'devAlloc', 'animAlloc', 'tdAlloc']) {
      const bySprint = new Map();
      for (const item of feature[key]) {
        const sprint = state.days[item.index].sprint;
        bySprint.set(sprint, (bySprint.get(sprint) || 0) + item.amount);
        assert.ok(
          item.amount <= state.days[item.index].featureCap + EPSILON,
          `${feature.name} / ${key} exceeds the daily one-person limit`
        );
      }
      for (const [sprint, amount] of bySprint) {
        assert.ok(
          amount <= state.sprintCapacities.perFeature + EPSILON,
          `${feature.name} / ${key} exceeds one person in ${sprint}`
        );
      }
    }
  }
});

test('every non-zero estimate is allocated in full', () => {
  const { state } = loadBaseline();
  for (const feature of state.features) {
    assert.ok(Math.abs(sum(feature.gdAlloc) - feature.gd) <= EPSILON, `${feature.name} / GD allocation mismatch`);
    assert.ok(Math.abs(sum(feature.devAlloc) - feature.dev) <= EPSILON, `${feature.name} / DEV allocation mismatch`);
    assert.ok(Math.abs(sum(feature.animAlloc) - feature.anim) <= EPSILON, `${feature.name} / Animation allocation mismatch`);
    assert.ok(Math.abs(sum(feature.tdAlloc) - feature.td) <= EPSILON, `${feature.name} / TD allocation mismatch`);
  }
});

test('CSV parser supports BOM, quoted commas and reordered columns', () => {
  const features = Csv.parseCsv(
    '\uFEFFPriority,Anim,TD,GD,Dev,Feature name,ID,August Build\r\n' +
    'High,2,3,1,5,"Feature, quoted",A-1,Yes\r\n'
  );
  assert.deepEqual(features, [{
    id: 'A-1',
    order: 0,
    name: 'Feature, quoted',
    priority: 'High',
    dev: 5,
    gd: 1,
    td: 3,
    anim: 2
  }]);
});
