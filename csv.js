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

  // Embedded so index.html remains fully usable when opened directly via file://.
  // "August Build" is deliberately present in the source and ignored by parseCsv.
  const DEFAULT_CSV = `ID,Feature name,Priority,August Build,Dev,GD,TD,Anim
1,Атрибуты и статусы игрока ,Critical,Yes,5,0,1,0
2,Базовый траверсал,Critical,Yes,10,0,2,8
3,Паркур / Контекстное перемещение,Critical,Yes,10,0,2,6
4,Дэш,Critical,Yes,5,0,2,2
5,Клаймбинг,Critical,Yes,15,2,3,6
6,Камера ,Critical,Yes,10,0,3,0
7,Управление под клаву/мышь,Critical,Yes,5,1,0,0
8,Управление под Xbox контроллер,High,Yes,10,1,0,0
9,Main Menu,High,???,3,0,0,0
10,Pause Menu,High,???,5,0,0,0
11,Death Menu,Critical,???,2,0,0,0
12,Базовый функционал,Critical,???,20,2,20,2
13,Меч,Critical,???,5,0,5,10
14,Копье,Critical,Yes,5,0,5,7
15,Хит-реакции Игрока,Critical,Yes,10,0,2,6
16,Дальний бой (реф WWM) ,Low,???,0,0,0,0
17,Абилки: общее,High,???,5,2,5,2
18,Чародей,Critical,???,10,1,3,2
19,Призыватель ,Critical,???,5,0,5,0
20,Медиум (абилки Тени) ,High,???,25,5,10,5
21,Spawn менеджер,Critical,???,2,0,2,0
22,Аггро менеджер ,Critical,???,5,0,2,0
23,State Tree тулзы ,Critical,???,10,0,10,0
24,Мирное поведение AI ,High,???,5,0,3,0
25,Персепшн и реакции ,Critical,???,5,0,5,5
26,Система токенов,Critical,???,5,0,1,0
27,Позиционирование противников ,Critical,???,5,0,5,0
28,Автоматон: Melee Common ,Critical,???,5,0,5,5
29,Автоматон: Range ,High,???,10,0,10,5
30,Автоматон: Melee Elite ,High,???,5,0,5,5
31,Автоматон: Melee Tank ,Medium,???,15,0,10,5
32,Босс (реимпорт) ,Medium,???,10,0,5,8
33,Босс Хранитель ,Low,???,40,5,10,8
34,Квестовая система,High,???,10,0,10,8
35,Диалоговая система ,High,???,10,0,10,10
36,NPC мирные ,Medium,???,20,3,10,20
37,Лут ,High,???,1,0,1,0
38,Сейв-система ,Medium,???,10,0,1,0
39,Подземелья: dungeons,Medium,No,10,0,0,0
40,Интерактибл объекты ,Medium,No,10,2,5,0
41,Ловушки в данже,Medium,No,10,3,5,5
42,Головоломки в данже,Medium,No,20,5,10,5
43,Кат-сцены ,High,Yes,5,0,5,0`;

  return { REQUIRED_COLUMNS, DEFAULT_CSV, parseRows, parseCsv };
});
