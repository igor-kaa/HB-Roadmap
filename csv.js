(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HyperboreaCsv = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const REQUIRED_COLUMNS = ['ID', 'Feature name', 'Priority', 'Dev', 'GD', 'TD', 'Anim'];

  function parseRows(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;

    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      const next = text[index + 1];
      if (quoted) {
        if (char === '"' && next === '"') {
          cell += '"';
          index++;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        row.push(cell);
        cell = '';
      } else if (char === '\n') {
        row.push(cell.replace(/\r$/, ''));
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }

    if (quoted) throw new Error('CSV содержит незакрытую кавычку');
    if (cell.length || row.length) {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
    }
    return rows;
  }

  function parseCsv(text) {
    const rows = parseRows(String(text || '').replace(/^\uFEFF/, ''));
    if (!rows.length) throw new Error('CSV пуст');

    const headers = rows.shift().map(value => value.trim());
    const columnIndex = name => headers.findIndex(
      header => header.toLowerCase() === name.toLowerCase()
    );
    const missing = REQUIRED_COLUMNS.filter(name => columnIndex(name) < 0);
    if (missing.length) {
      throw new Error('CSV должен содержать: ' + REQUIRED_COLUMNS.join(', '));
    }

    return rows
      .filter(row => row.some(value => value.trim()))
      .map((row, order) => ({
        id: (row[columnIndex('ID')] || String(order + 1)).trim(),
        order,
        name: (row[columnIndex('Feature name')] || '').trim(),
        priority: (row[columnIndex('Priority')] || 'Low').trim(),
        dev: +row[columnIndex('Dev')] || 0,
        gd: +row[columnIndex('GD')] || 0,
        td: +row[columnIndex('TD')] || 0,
        anim: +row[columnIndex('Anim')] || 0
      }));
  }

  return { parseCsv };
});
