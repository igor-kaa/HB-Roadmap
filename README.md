# Hyperborea Roadmap Scheduler

Локальное web-приложение с двумя production-треками:

- `index.html` — roadmap игровых фич;
- `locations.html` — roadmap производства локаций и уровней.

Страницы связаны верхней навигацией и не требуют backend или установки runtime-зависимостей.

## Gameplay Features

Gameplay-страница принимает CSV следующего формата:

```csv
ID,Feature name,Priority,August Build,Dev,GD,TD,Anim
```

`August Build` сохраняется для совместимости и не участвует в расчёте.

## Level Production

### Источники данных

Estimates загружаются пользователем через интерфейс и имеют формат:

```csv
Location & Filler Space,Priority,Stage,Status,Est. Days,Notes
```

Пустое название локации наследуется от предыдущей строки. Каждая непустая строка `Stage` создаёт ровно одну production-задачу: parser не разворачивает, не исключает и не переименовывает этапы по внутренним правилам.

Команда и параллелизм этапа хранятся вместе в `location-stage-team-capacity.csv`:

```csv
Stage,Team,Max Parallel People
Stage A,Game Design,1
Stage B,Level Art,0
```

- `1` — этап получает максимум 1 mday в рабочий день;
- `2`, `3` и далее — этап может одновременно использовать указанное количество людей;
- `0` — этап может использовать весь доступный capacity команды.

Единственный source of truth для списка этапов — объединение значений `Stage` из estimates CSV и stage/team/capacity CSV. В коде нет встроенного каталога или таблицы преобразования этапов.

Если этап пришёл только из estimates, он автоматически добавляется в рабочий каталог с командой `Unknown` и `Max Parallel People = 1`. Обновлённый объединённый каталог можно скачать из интерфейса, отредактировать и загрузить обратно.

### Dependencies

Связи хранятся в `location-dependencies.csv`:

```csv
From Stage,To Stage,Type,Lag Days
Stage A,Stage B,FS,0
```

Dependencies CSV не является источником этапов: обе стороны каждой связи должны уже присутствовать в estimates или stage/team/capacity CSV. Связи применяются только к локациям, в которых присутствуют оба этапа.

Поддерживаются:

- `FS` — следующий этап начинается после завершения предыдущего;
- `FF` — следующий этап не заканчивается раньше предыдущего;
- `Lag Days` — дополнительный лаг в рабочих днях.

Карточка `Dependencies` открывает граф активных связей.

### Capacity и сохранение

Месячные мощности команд задаются на странице. Значения по умолчанию: Game Design — 20, Narrative — 20, VFX — 20, Concept Art — 40, Level Design — 80, Level Art — 40, 3D Outsource — 60, Technical Art — 20, Sound — 20 mdays/месяц.

Загруженные estimates, dependencies и объединённый stage/team/capacity CSV сохраняются в browser local storage и автоматически восстанавливаются при следующем открытии страницы.

Страница запускается без встроенного production-плана и ждёт загрузки estimates CSV, если ранее загруженный файл не найден в browser local storage. Один estimates-файл достаточен для построения плана: отсутствующие настройки этапов временно получают `Unknown` и `Max Parallel People = 1`; stage/team/capacity CSV можно загрузить следом.

## Тесты

Требуется Node.js:

```powershell
npm.cmd test
```

Тесты проверяют обе страницы, динамическое объединение этапов, CSV-валидацию, полноту аллокаций, capacity команд, FS/FF-зависимости и защиту от циклов.
