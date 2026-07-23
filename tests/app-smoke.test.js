const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Scheduler = require('../scheduler.js');
const Csv = require('../csv.js');

const ROOT = path.resolve(__dirname, '..');

test('index is file:// compatible and waits for a gameplay CSV', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  assert.deepEqual(scripts, ['csv.js', 'scheduler.js', 'app.js']);
  assert.doesNotMatch(html, /type=["']module["']/i);
  assert.ok(html.indexOf('id="csvFile"') < html.indexOf('id="recalcButton"'));
  assert.match(html, /file-label-primary/);
  assert.match(html, /id="toggleAllFeaturesButton"/);

  const elements = new Map();
  const values = {
    startDate: '2026-07-13',
    gdStartMonth: '2026-07',
    designCap: '60',
    devCap: '100',
    animCap: '40',
    featureCap: '20',
    search: '',
    priority: 'All'
  };

  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        value: values[id] || '',
        clientWidth: id === 'ganttShell' ? 1440 : 0,
        innerHTML: '',
        files: [],
        disabled: false,
        attributes: {},
        listeners: {},
        addEventListener(type, listener) { this.listeners[type] = listener; },
        setAttribute(name, value) { this.attributes[name] = value; },
        querySelectorAll() { return []; },
        classList: { add() {}, remove() {} }
      });
    }
    return elements.get(id);
  }

  const context = {
    HyperboreaScheduler: Scheduler,
    HyperboreaCsv: Csv,
    document: {
      getElementById: element,
      createElement: () => ({ click() {} })
    },
    console,
    alert() {},
    Blob,
    URL,
    Intl
  };

  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'),
    context,
    { filename: 'app.js' }
  );

  const expectedStart = Scheduler.nextSprintMonday();
  const expectedSprint = Math.floor(
    Scheduler.daysBetween(new Date(2025, 10, 17, 12), expectedStart) / 14
  ) + 1;
  assert.equal(element('startDate').value, Scheduler.dateKey(expectedStart));
  assert.match(element('summary').innerHTML, /Gameplay CSV/);
  assert.match(element('gantt').innerHTML, /Ожидание gameplay CSV/);

  const csv = `ID,Feature name,Priority,August Build,Dev,GD,TD,Anim
1,Feature A,Critical,No,5,1,1,0
2,Feature B,High,No,3,0,0,2`;
  await element('csvFile').listeners.change({
    target: { files: [{ text: async () => csv }] }
  });

  assert.match(element('summary').innerHTML, />2</);
  assert.match(element('gantt').innerHTML, /Feature A/);
  assert.match(element('gantt').innerHTML, new RegExp(`Sprint ${expectedSprint}`));
  assert.match(element('gantt').innerHTML, /data-feature-toggle="1"/);
  assert.doesNotMatch(element('gantt').innerHTML, /feature-total-bar/);

  element('toggleAllFeaturesButton').listeners.click();
  assert.equal(element('toggleAllFeaturesButton').innerHTML || element('toggleAllFeaturesButton').textContent, 'Развернуть все');
  assert.match(element('gantt').innerHTML, /feature-row collapsed/);
  assert.match(element('gantt').innerHTML, /feature-total-bar/);
  assert.doesNotMatch(element('gantt').innerHTML, /class="bar gd"/);

  element('toggleAllFeaturesButton').listeners.click();
  assert.doesNotMatch(element('gantt').innerHTML, /feature-row collapsed/);
  const featureToggleTarget = {
    dataset: { featureToggle: '1' },
    closest(selector) { return selector === '[data-feature-toggle]' ? this : null; }
  };
  element('gantt').listeners.click({ target: featureToggleTarget });
  assert.match(element('gantt').innerHTML, /feature-row collapsed/);
  assert.match(element('gantt').innerHTML, /feature-total-bar/);
});
