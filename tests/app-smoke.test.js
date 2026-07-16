const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Scheduler = require('../scheduler.js');
const Csv = require('../csv.js');

const ROOT = path.resolve(__dirname, '..');

test('index is file:// compatible and the browser app boots without a backend', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  assert.deepEqual(scripts, ['csv.js', 'scheduler.js', 'app.js']);
  assert.doesNotMatch(html, /type=["']module["']/i);

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
        innerHTML: '',
        files: [],
        addEventListener() {},
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

  assert.match(element('summary').innerHTML, />43</);
  assert.match(element('summary').innerHTML, /09 дек\. 2026 г\./);
  assert.match(element('gantt').innerHTML, /Sprint 11/);
});
