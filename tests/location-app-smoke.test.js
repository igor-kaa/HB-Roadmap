const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Csv = require('../location-csv.js');
const Scheduler = require('../location-scheduler.js');

const ROOT = path.resolve(__dirname, '..');

test('locations page is file:// compatible, persists CSV uploads and links back to gameplay roadmap', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'locations.html'), 'utf8');
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  assert.deepEqual(scripts, ['location-csv.js', 'location-scheduler.js', 'location-app.js']);
  assert.doesNotMatch(html, /type=["']module["']/i);
  assert.match(html, /href="index\.html"/);
  assert.match(html, /id="stageCapacityCsvFile"/);
  assert.match(html, /href="location-stage-capacity\.csv"/);
  assert.match(index, /href="locations\.html"/);

  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        value: id === 'locationStartDate' ? '2026-07-13' : '',
        clientWidth: id === 'locationGanttShell' ? 1440 : 0,
        innerHTML: '',
        files: [],
        dataset: {},
        listeners: {},
        addEventListener(type, listener) { this.listeners[type] = listener; },
        querySelectorAll() { return []; },
        classList: { add() {}, remove() {} }
      });
    }
    return elements.get(id);
  }

  const capacityElements = Csv.DEPARTMENTS.map(department => ({
    dataset: { capacity: department.id },
    value: String(department.defaultCapacity)
  }));
  const stored = new Map();
  const context = {
    HyperboreaLocationCsv: Csv,
    HyperboreaLocationScheduler: Scheduler,
    document: {
      getElementById: element,
      querySelectorAll: selector => selector === '[data-capacity]' ? capacityElements : [],
      createElement: () => ({ click() {} })
    },
    console,
    alert() {},
    localStorage: {
      getItem: key => stored.has(key) ? stored.get(key) : null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: key => stored.delete(key)
    },
    Blob,
    URL,
    Intl
  };

  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'location-app.js'), 'utf8'), context, { filename: 'location-app.js' });
  assert.match(element('locationSummary').innerHTML, />10</);
  assert.match(element('locationSummary').innerHTML, /1000 mdays/);
  assert.match(element('locationGantt').innerHTML, /Beach \(Rocky Coast\)/);
  assert.match(element('locationGantt').innerHTML, /Sound FX/);

  const customParallelism = Csv.DEFAULT_STAGE_CAPACITY_CSV.replace('LD_MACRO,1', 'LD_MACRO,0');
  await element('stageCapacityCsvFile').listeners.change({
    target: { files: [{ name: 'custom-parallelism.csv', text: async () => customParallelism }] }
  });
  assert.match(stored.get('hyperborea.locations.stage-capacities.v1'), /custom-parallelism\.csv/);
  assert.match(element('locationSummary').innerHTML, /custom-parallelism\.csv/);
  assert.match(element('locationGantt').innerHTML, /unlimited/);

  element('locationSummary').innerHTML = '';
  element('locationGantt').innerHTML = '';
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'location-app.js'), 'utf8'), context, { filename: 'location-app-reload.js' });
  assert.match(element('locationSummary').innerHTML, /custom-parallelism\.csv/);
  assert.match(element('locationGantt').innerHTML, /unlimited/);

  element('resetSavedCsvButton').listeners.click();
  assert.equal(stored.size, 0);
  assert.match(element('locationSummary').innerHTML, /Built-in parallelism/);
  assert.doesNotMatch(element('locationGantt').innerHTML, /unlimited/);
});
