# Hyperborea Roadmap Scheduler

Локальное web-приложение с двумя независимыми production-треками:

- `index.html` — roadmap игровых фич;
- `locations.html` — roadmap производства локаций и уровней.

Страницы связаны верхней навигацией, используют общий визуальный стиль и работают напрямую через `file://`: backend и установка зависимостей не требуются.

## Gameplay Features

Gameplay-страница принимает CSV следующего формата:

```csv
ID,Feature name,Priority,August Build,Dev,GD,TD,Anim
```

`August Build` сохраняется для совместимости и не участвует в расчёте.

## Level Production

Locations-страница принимает исходный формат Locations Inventory:

```csv
Location & Filler Space,Priority,Stage,Status,Est. Days,Notes
```

Пустое название локации наследуется от предыдущей строки, как в исходной Google-таблице. Строки `Total`, пустые разделители, `Gameplay Balancing` и `QA / Playtest` не становятся production-задачами.

Исходный этап `Lighting & VFX` разворачивается в три независимых этапа с той же оценкой:

- Lighting — Level Art;
- Visual FX — Technical Art;
- Sound FX — Sound.

Это временное правило совместимости с текущим CSV. Если в будущем исходник будет содержать отдельные строки `Lighting`, `Visual FX` и `Sound FX`, parser также примет их напрямую.

Месячные мощности департаментов задаются на странице. Значения по умолчанию: Design — 20, Level Design — 80, Level Art — 40, 3D Outsource — 60, Technical Art — 20, Sound — 20 mdays/месяц. В отличие от gameplay roadmap, одна location-задача может использовать весь свободный capacity своего департамента. Если она заканчивается до исчерпания дневного capacity, остаток в тот же рабочий день переходит следующей готовой задаче.

### Dependencies

Статические связи хранятся в `location-dependencies.csv`:

```csv
From Stage ID,To Stage ID,Type,Lag Days
CONCEPT,LD_MACRO,FS,0
MODELLING,LA_DRESSING,FF,0
```

Поддерживаются:

- `FS` — следующий этап начинается после завершения предыдущего;
- `FF` — следующий этап не заканчивается раньше предыдущего;
- `Lag Days` — дополнительный лаг в рабочих днях.

CSV можно заменить через интерфейс. Встроенная копия dependency-графа позволяет странице работать без HTTP-сервера.

## Тесты

Требуется Node.js:

```powershell
npm.cmd test
```

Тесты проверяют обе страницы, CSV parser, полноту аллокаций, мощности департаментов, FS/FF-зависимости, независимость Visual FX и Sound FX, защиту от циклов и отсутствие регрессий gameplay scheduler.
