const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Csv = require('../location-csv.js');
const Scheduler = require('../location-scheduler.js');

const ROOT = path.resolve(__dirname, '..');

test('locations page is file:// compatible and links back to gameplay roadmap', () => {
  const html = fs.readFileSync(path.join(ROOT, 'locations.html'), 'utf8');
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  assert.deepEqual(scripts, ['location-csv.js', 'location-scheduler.js', 'location-app.js']);
  assert.doesNotMatch(html, /type=["']module["']/i);
  assert.match(html, /href="index\.html"/);
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
        addEventListener() {},
        querySelectorAll() { return []; },
        classList: { add() {}, remove() {} }
      });
    }
    return elements.get(id);
  }

  const capacityElements = Csv.DEPARTMENTS.map(department => ({
    dataset: { capacity: department.id },
    value: '20'
  }));
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
    Blob,
    URL,
    Intl
  };

  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'location-app.js'), 'utf8'), context, { filename: 'location-app.js' });
  assert.match(element('locationSummary').innerHTML, />10</);
  assert.match(element('locationSummary').innerHTML, /1000 mdays/);
  assert.match(element('locationGantt').innerHTML, /Beach \(Rocky Coast\)/);
  assert.match(element('locationGantt').innerHTML, /Sound FX/);
});
