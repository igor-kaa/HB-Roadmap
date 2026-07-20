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

Месячные мощности департаментов задаются на странице. Значения по умолчанию: Design — 20, Level Design — 80, Level Art — 40, 3D Outsource — 60, Technical Art — 20, Sound — 20 mdays/месяц.

### Параллельная работа над этапом

Лимиты исполнителей хранятся отдельно в `location-stage-capacity.csv`:

```csv
Stage ID,Max Parallel People
CONCEPT,1
LD_MACRO,1
```

- `1` — этап получает максимум 1 mday в рабочий день;
- `2`, `3` и далее — этап может одновременно использовать указанное количество людей;
- `0` — лимита людей нет, этап может использовать весь доступный capacity департамента.

По умолчанию у всех этапов установлена единица, поэтому исходное расписание не меняется. CSV можно заменить через интерфейс страницы.

Все три загружаемых CSV — estimates, dependencies и parallel people — сохраняются в browser local storage после успешной валидации. При следующем открытии или обновлении `locations.html` приложение автоматически восстанавливает последние загруженные версии. Кнопка `Сбросить сохранённые CSV` очищает сохранение и возвращает встроенные дефолты.

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
