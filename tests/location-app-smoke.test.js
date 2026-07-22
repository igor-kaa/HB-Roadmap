const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Csv = require('../location-csv.js');
const Scheduler = require('../location-scheduler.js');
const ROOT = path.resolve(__dirname, '..');
const read = filename => fs.readFileSync(path.join(ROOT, filename), 'utf8');

test('locations page loads external CSV sources and persists the unified stage catalog', async () => {
  const html = read('locations.html');
  const index = read('index.html');
  const estimatesText = read('location-estimates.csv');
  const catalogText = read('location-stage-team-capacity.csv');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  assert.deepEqual(scripts, ['location-csv.js', 'location-scheduler.js', 'location-app.js']);
  assert.doesNotMatch(html, /type=["']module["']/i);
  assert.match(html, /href="index\.html"/);
  assert.match(html, /id="stageTeamCapacityCsvFile"/);
  assert.match(html, /id="stageTeamCapacityExportButton"/);
  assert.match(html, /href="location-stage-team-capacity\.csv"/);
  assert.doesNotMatch(html, /stageCapacityCsvFile|stageTeamsCsvFile/);
  assert.match(html, /id="dependencyGraphDialog"/);
  assert.match(html, /id="toggleAllLocationsButton"/);
  assert.match(index, /href="locations\.html"/);

  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        value: id === 'locationStartDate' ? '2026-07-13' : '',
        clientWidth: id === 'locationGanttShell' ? 1440 : 0,
        innerHTML: '',
        style: {},
        files: [],
        dataset: {},
        listeners: {},
        addEventListener(type, listener) { this.listeners[type] = listener; },
        setAttribute(name, value) { this[name] = value; },
        querySelectorAll() { return []; },
        classList: { add() {}, remove() {} }
      });
    }
    return elements.get(id);
  }

  class LocalCsvRequest {
    open(method, filename) { this.filename = filename; }
    send() {
      this.responseText = read(this.filename);
      this.status = 0;
    }
  }

  const capacityElements = Csv.DEPARTMENTS.map(department => ({
    dataset: { capacity: department.id },
    value: String(department.defaultCapacity)
  }));
  const stored = new Map();
  const alerts = [];
  const context = {
    HyperboreaLocationCsv: Csv,
    HyperboreaLocationScheduler: Scheduler,
    XMLHttpRequest: LocalCsvRequest,
    document: {
      getElementById: element,
      querySelectorAll: selector => selector === '[data-capacity]' ? capacityElements : [],
      createElement: () => ({ click() {} })
    },
    console,
    alert(message) { alerts.push(message); },
    localStorage: {
      getItem: key => stored.has(key) ? stored.get(key) : null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: key => stored.delete(key)
    },
    Blob,
    URL,
    Intl
  };

  vm.runInNewContext(read('location-app.js'), context, { filename: 'location-app.js' });
  assert.match(element('capacityInputs').innerHTML, /Game Design/);
  assert.match(element('capacityInputs').innerHTML, /Narrative/);
  assert.match(element('capacityInputs').innerHTML, /VFX/);
  assert.match(element('capacityInputs').innerHTML, /Concept Art/);
  assert.match(element('locationSummary').innerHTML, />10</);
  assert.match(element('locationSummary').innerHTML, /1000 mdays/);
  assert.match(element('locationSummary').innerHTML, /Stage catalog/);
  assert.match(element('locationGantt').innerHTML, /Beach \(Rocky Coast\)/);
  assert.match(element('locationGantt').innerHTML, /Lighting &amp; VFX/);
  assert.match(element('locationGantt').innerHTML, /data-location-toggle=/);
  assert.match(element('locationGantt').innerHTML, /location-total-bar/);
  assert.match(element('locationGantt').innerHTML, /Весь цикл/);
  element('toggleAllLocationsButton').listeners.click();
  assert.doesNotMatch(element('locationGantt').innerHTML, /location-stage-label/);
  assert.match(element('locationGantt').innerHTML, /location-row collapsed/);
  assert.match(element('locationGantt').innerHTML, /location-total-bar/);
  assert.equal(element('toggleAllLocationsButton').textContent, 'Развернуть все');
  element('toggleAllLocationsButton').listeners.click();
  assert.match(element('locationGantt').innerHTML, /location-stage-label/);
  assert.equal(element('toggleAllLocationsButton').textContent, 'Свернуть все');
  const firstLocationId = element('locationGantt').innerHTML.match(/data-location-toggle="([^"]+)"/)[1];
  const individualToggle = {
    dataset: { locationToggle: firstLocationId },
    closest(selector) { return selector === '[data-location-toggle]' ? this : null; }
  };
  element('locationGantt').listeners.click({ target: individualToggle });
  assert.match(element('locationGantt').innerHTML, new RegExp(`location-row collapsed[^>]+data-id="${firstLocationId}"[^>]+height:36px`));
  assert.equal(element('toggleAllLocationsButton').textContent, 'Свернуть все');
  element('locationGantt').listeners.click({ target: individualToggle });
  assert.doesNotMatch(element('locationGantt').innerHTML, /location-row collapsed/);
  assert.match(element('locationSummary').innerHTML, /id="dependencySummaryCard"/);
  element('dependencySummaryCard').listeners.click();
  assert.match(element('dependencyGraph').innerHTML, /Stage dependency graph/);
  assert.match(element('dependencyGraph').innerHTML, /Concept/);
  assert.match(element('dependencyGraph').innerHTML, /dependency-edge-ff/);
  assert.match(element('dependencyGraph').innerHTML, />FF</);

  const customCatalog = catalogText.replace('Concept,Concept Art,1', 'Concept,Concept Art,0');
  await element('stageTeamCapacityCsvFile').listeners.change({
    target: { files: [{ name: 'custom-stage-catalog.csv', text: async () => customCatalog }] }
  });
  assert.match(stored.get('hyperborea.locations.stage-team-capacity.v1'), /custom-stage-catalog\.csv/);
  assert.match(element('locationSummary').innerHTML, /custom-stage-catalog\.csv/);
  assert.match(element('locationGantt').innerHTML, /unlimited/);

  const estimateWithNewStage = estimatesText + '\n,,New Review Stage,,10,';
  await element('locationsCsvFile').listeners.change({
    target: { files: [{ name: 'new-stage-estimates.csv', text: async () => estimateWithNewStage }] }
  });
  assert.match(alerts.at(-1), /New Review Stage/);
  assert.match(element('locationGantt').innerHTML, /New Review Stage/);
  assert.match(stored.get('hyperborea.locations.stage-team-capacity.v1'), /New Review Stage,Unknown,1/);

  const reassignedCatalog = catalogText + '\nNew Review Stage,Game Design,2';
  await element('stageTeamCapacityCsvFile').listeners.change({
    target: { files: [{ name: 'reassigned-stage-catalog.csv', text: async () => reassignedCatalog }] }
  });
  assert.match(element('locationGantt').innerHTML, /New Review Stage/);
  assert.match(element('locationGantt').innerHTML, /Design .* 10 md/);

  element('locationSummary').innerHTML = '';
  element('locationGantt').innerHTML = '';
  vm.runInNewContext(read('location-app.js'), context, { filename: 'location-app-reload.js' });
  assert.match(element('locationSummary').innerHTML, /reassigned-stage-catalog\.csv/);
  assert.match(element('locationGantt').innerHTML, /New Review Stage/);

  element('resetSavedCsvButton').listeners.click();
  assert.equal(stored.size, 0);
  assert.match(element('locationSummary').innerHTML, /location-stage-team-capacity\.csv/);
});

test('blocked file:// default requests do not prevent an estimates upload from bootstrapping the page', async () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        value: id === 'locationStartDate' ? '2026-07-13' : '',
        clientWidth: id === 'locationGanttShell' ? 1200 : 0,
        innerHTML: '',
        style: {},
        dataset: {},
        listeners: {},
        addEventListener(type, listener) { this.listeners[type] = listener; },
        setAttribute(name, value) { this[name] = value; },
        querySelectorAll() { return []; },
        classList: { add() {}, remove() {} }
      });
    }
    return elements.get(id);
  }

  class BlockedLocalRequest {
    open() { throw new Error('file:// request blocked'); }
  }

  const capacities = Csv.DEPARTMENTS.map(department => ({
    dataset: { capacity: department.id },
    value: String(department.defaultCapacity)
  }));
  const stored = new Map();
  const context = {
    HyperboreaLocationCsv: Csv,
    HyperboreaLocationScheduler: Scheduler,
    XMLHttpRequest: BlockedLocalRequest,
    document: {
      getElementById: element,
      querySelectorAll: selector => selector === '[data-capacity]' ? capacities : [],
      createElement: () => ({ click() {} })
    },
    console: { ...console, warn() {} },
    alert() {},
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: key => stored.delete(key)
    },
    Blob,
    URL,
    Intl
  };

  assert.doesNotThrow(() => vm.runInNewContext(read('location-app.js'), context, { filename: 'location-app-file.js' }));
  assert.match(element('locationSummary').innerHTML, /Estimates CSV/);
  assert.match(element('locationGantt').innerHTML, /Ожидание estimates CSV/);
  assert.equal(typeof element('locationsCsvFile').listeners.change, 'function');

  const estimates = `Location & Filler Space,Priority,Stage,Status,Est. Days,Notes
Test Location,High,Stage From Upload,Not Started,2,`;
  await element('locationsCsvFile').listeners.change({
    target: { files: [{ name: 'uploaded-estimates.csv', text: async () => estimates }] }
  });

  assert.match(element('locationGantt').innerHTML, /Test Location/);
  assert.match(element('locationGantt').innerHTML, /Stage From Upload/);
  assert.match(element('locationGantt').innerHTML, /location-total-bar/);
  element('toggleAllLocationsButton').listeners.click();
  assert.doesNotMatch(element('locationGantt').innerHTML, /location-stage-label/);
  assert.match(element('locationGantt').innerHTML, /location-row collapsed/);
  assert.match(element('locationGantt').innerHTML, /location-total-bar/);
  element('toggleAllLocationsButton').listeners.click();
  assert.match(element('locationGantt').innerHTML, /location-stage-label/);
  const locationId = element('locationGantt').innerHTML.match(/data-location-toggle="([^"]+)"/)[1];
  const toggleTarget = {
    dataset: { locationToggle: locationId },
    closest(selector) { return selector === '[data-location-toggle]' ? this : null; }
  };
  element('locationGantt').listeners.click({ target: toggleTarget });
  assert.match(element('locationGantt').innerHTML, /location-row collapsed/);
  assert.doesNotMatch(element('locationGantt').innerHTML, /location-stage-label/);
  element('locationGantt').listeners.click({ target: toggleTarget });
  assert.match(element('locationGantt').innerHTML, /location-stage-label/);
  assert.match(stored.get('hyperborea.locations.stage-team-capacity.v1'), /Stage From Upload,Unknown,1/);
});
