# TimeShift — технический репорт (DOM/CSS 2D-игра)

Фактический отчёт для принятия решения: «дожимаем DOM» или «мигрируем на canvas/Phaser». Без выводов вида «FPS падает из‑за X» — только риски, места в коде и что замерить для подтверждения.

---

## 1. Project summary

- **Тип:** 2D-игра на HTML/CSS/JS, рендер через DOM + CSS (лента объектов, пингвин, HUD, модалки).
- **Entrypoint:** `index.html` → скрипты по порядку → `js/main.js`. В `main.js`: при `DOMContentLoaded` (или сразу) вызывается `init()` → `game = new Game()`, `await game.init()`, при необходимости `game.showStartScreenOverlay()`.
- **Основные модули:**
  - **js/main.js** — точка входа, создание `Game`, анимация кнопки PLAY.
  - **js/game.js** — класс `Game`: состояние игры, игровой цикл (rAF), обработка событий (eventBus, клавиши, кнопки), пауза/оверлеи, лидерборд, перки, снапшоты.
  - **js/renderer.js** — класс `Renderer`: лента (`StripConveyorSystem`), коллизии (`CollisionEngine`), пингвин (`PenguinRig`), UI (`RendererUI`), облака (`CloudsBackground`), отрисовка ленты, конвейер, анимация «съедения», дебаг-оверлей.
  - **js/stripConveyor.js** — лента чисел: окно из DOM-кружков (`.number-circle`), рециклинг (удаление/создание узлов), позиция через `transform: translateX`, спавн еды/монет.
  - **js/collisionEngine.js** — коллизии: полигоны челюстей/зубов (SVG path → getPointAtLength + getScreenCTM), SAT, проглатывание/укус/смерть, swallow boost (движение кружка через `style.transform`).
  - **js/rendererUI.js** — HUD (счёт, ранг, Coin Rush, кнопки Slow/Shield/Perks/Sound/Pause), модалки (пауза, язык, перки, лидерборд, Game Over, старт), обновление текста/классов.
  - **js/timer.js** — таймер с ускорением (stepDurationSec, current, maxReached), инверсия, slow down.
  - **js/penguinRig.js** — состояние рта (open/closed), применение позы челюстей через `style.transform`, коллайдеры пингвина.
  - **js/cloudsBackground.js** — 8 облаков в DOM, анимация через rAF (left + getBoundingClientRect в цикле).
  - **js/eventBus.js** — шина событий (on/off/emit).
  - **js/perks.js**, **js/audio.js**, **js/storage.js**, **js/gamepush.js**, **js/playerName.js**, **js/i18n.js** — перки, звук, хранилище, платформа, имя, локализация.

**Ключевые функции (пути):**

| Функция | Файл:строка | Назначение |
|--------|-------------|------------|
| `init()` | js/main.js:38 | Точка входа, создание Game, await game.init() |
| `Game.gameLoop()` | js/game.js:471 | Игровой цикл на rAF: timer.update, render, snapshot, следующий кадр |
| `Game.render()` | js/game.js:524 | Вызов updateUI и renderer.updateConveyor(timer) |
| `Renderer.updateConveyor()` | js/renderer.js:569 | Делегирует stripConveyor.update(timer), автозакрытие рта |
| `StripConveyorSystem.update()` | js/stripConveyor.js:393 | deltaTime, beltPosition, recomputeStripMetrics, ensure/shift window, transform ленты, checkCollisionsAndAutoBite |
| `StripConveyorSystem.recomputeStripMetrics()` | js/stripConveyor.js:434 | querySelectorAll .number-circle, getCircleCenterInStrip по каждому, stripPitchPx |
| `StripConveyorSystem.getCircleCenterInStrip()` | js/stripConveyor.js:722 | getComputedStyle(circleEl) + offsetLeft + offsetWidth |
| `Renderer.getFocusAnchorX()` | js/renderer.js:521 | getBoundingClientRect(container), опционально mouthRightX / focusZone |
| `CollisionEngine.check()` | js/collisionEngine.js:154 | getBoundingClientRect (container, jaw, circles, img), getPathPolyOnScreen, SAT, события eat/collision |
| `RendererUI.updateUI()` | js/rendererUI.js:21 | Много getElementById, textContent, classList.toggle, style.width для сегментов |

---

## 2. Game loop

- **Тип цикла:** только `requestAnimationFrame`. В `game.js` в `start()` после countdown вызывается `this.gameLoop()`. Смеси с `setInterval` для геймплея нет (setInterval только для loading dots в main.js и для таймеров типа mouthCloseSettle, progressionSyncDebounce).
- **Где update / render:**
  - В одном кадре: `gameLoop()` вызывает `this.timer.update(currentTime)`, затем `this.render()`. В `render()` вызываются `this.updateUI()` и `this.renderer.updateConveyor(this.timer)`.
  - Таймер: дискретные «тики» (stepDurationSec), при перескоке времени обрабатывается несколько тиков в цикле, для каждого emit `TICK_STEP`. Лента не привязана к тикам — движется по времени через `beltPosition += baseSpeed * deltaTime`.
- **Timestep / deltaTime:**
  - Фиксированного timestep для рендера нет: каждый кадр — один вызов update + render.
  - `StripConveyorSystem.update()` использует `deltaTime = nowMs - this.lastBeltUpdateTime` и двигает ленту: `this.beltPosition += (baseSpeed * deltaTime)`.
  - Таймер внутри себя считает шаги по `stepDurationSec` (переменная длительность шага от ускорения/slow down).

Итого: один rAF → один update таймера → один render (updateUI + updateConveyor с физикой ленты и коллизиями).

---

## 3. Render pipeline

**Как двигаются объекты:**

- **CSS-свойства, меняемые в рантайме:**
  - **Лента:** `numberStrip.style.transition = 'none'`, `numberStrip.style.transform = 'translateX(${targetOffset}px)'` — в `stripConveyor.js` в `update()` (строка ~417) и в `shiftStripWindowBy()` (~433).
  - **Кружки на ленте:** `circle.style.transform` (в collisionEngine `applySwallowBoostTick`), `circle.style.marginLeft`/`marginRight` в `applySpawnMeta` при создании; размеры: `circleEl.style.width`, `img.style.width`/`height` в renderer (setFoodPlaceholderSize, updateFoodContainerSize).
  - **Пингвин:** в `penguinRig.js` `applyMouthPose(open)`: `parts.head/style.eye/topJaw/botJaw.style.transform` (rotate) или `removeProperty('transform')`.
  - **Облака:** в `cloudsBackground.js` в rAF: `cloud.style.left`, `cloud.style.top` (при респавне).
  - **Эффекты:** в renderer `animateEatIntoMouth` — клон img с `style.left/top/width/height/transform/opacity/filter/transition`; `showFloatingCoinBonus` — div с `style.left/top`.
- **Централизация:** обновление ленты (одна запись transform на `#number-strip`) делается в одном месте — `StripConveyorSystem.update()`. Классы кружков (`passed`, `normal`, `active`, `danger`) обновляются в `updateStripClasses(currentValue)` в том же update. Остальные записи (челюсти, swallow boost по кружкам, облака, UI) разбросаны по CollisionEngine, PenguinRig, CloudsBackground, RendererUI.

**Итог:** Один «проход» по ленте в update конвейера (transform контейнера + updateStripClasses); движение отдельных кружков и пингвина — в других модулях, в том же кадре.

---

## 4. CSS heavy stuff list

Селекторы/классы с тяжёлыми для композитинга/рисования свойствами (и где они используются):

| Селектор / область | Свойства | Где | Элементы |
|--------------------|----------|-----|----------|
| `.score-wrapper` | box-shadow (большая тень 64px) | styles.css:117 | HUD, статичный |
| `.score-rank` | box-shadow inset | styles.css:172 | HUD |
| `.score-rank-icon img` | filter: brightness(0) invert(1) | styles.css:187 | Иконка ранга |
| `#best-hint:hover`, `.hud-icon-btn-inner:hover`, `.hud-perks-btn:hover` и др. | filter: brightness(1.03), transform | styles.css:88, 252, 282 | Кнопки UI |
| `.hud-icon-btn-inner.icon-btn--sound.is-muted` | filter: grayscale(0.4) brightness(0.9) | styles.css:268 | Кнопка звука |
| `.hud-perks-inner`, кнопки действий | box-shadow (большие 64px) | styles.css:298, 244–247, 493, 1008, 1061 и др. | Игровые кнопки / HUD |
| `.coin-rush-segment-fill` | width меняется из JS (transition) | styles.css:389–393 | Прогресс Coin Rush |
| `#ice-top` | filter: drop-shadow(0 14px 28px …) | styles.css:698 | Ледяная полоса, над лентой |
| `.number-circle` | opacity (normal/passed/consumed) | styles.css:531–543 | Игровые кружки на ленте |
| `.number-circle .food-img` | filter: none !important | styles.css:519 | Спрайты еды |
| `.cloud` | opacity: 0.7, will-change: transform | styles.css:469–471 | Фоновые облака |
| `.floating-coin-bonus` | text-shadow, animation | styles.css:396–416 | Всплывающий +N (игровой эффект) |
| `.overlay-screen` | backdrop-filter: none | styles.css:1142 | Явно отключён |
| Попапы (pause, game-over, perks, leaderboard, start) | box-shadow (крупные), градиенты | Множество правил | Статичный UI оверлеев |
| `.pause-btn--primary img`, `.action-spell-btn img` и др. | filter: brightness(0) invert(1) | styles.css:1236 и др. | Иконки в кнопках |

**Нет в проекте:** mix-blend-mode, mask, clip-path на игровых элементах. blur есть только в анимации съедения в JS: `fx.style.filter = 'blur(0.6px)'` (renderer.js, кратковременно).

**Риск:** Много box-shadow и filter на HUD и кнопках; один drop-shadow на `#ice-top` поверх игровой зоны; opacity на кружках и облаках. Для подтверждения влияния на FPS: замерить Paint/Layout в DevTools при отключении этих правил (например, закомментировать box-shadow/filter на активных путях).

---

## 5. Forced reflow suspects

Паттерн: в одном кадре/тике сначала читается layout (getBoundingClientRect, getComputedStyle, offset*, client*, scroll*), затем в том же кадре выполняется запись в стили/классы. Это может вызывать forced synchronous layout.

| Место | Чтение | Запись в том же кадре | Файл:строки |
|-------|--------|------------------------|-------------|
| CollisionEngine.check | container.getBoundingClientRect(), jawTopRect, jawBotRect; для каждого кружка из circlesToProcess: circle.getBoundingClientRect(), imgEl.getBoundingClientRect(); getPathPolyOnScreen (getScreenCTM) | circle.style.transform (applySwallowBoostTick), circle.classList, img.style.opacity, animateEatIntoMouth (стили fx), updateDebugObjectBoxes (innerHTML, стили) | js/collisionEngine.js:160–162, 187, 207–209, 91–112, 90, 387, 444–447 |
| StripConveyor.update | getFocusAnchorX(container) → внутри getBoundingClientRect(container), focusZone/getBoundingClientRect, numberStrip.querySelector + offsetWidth | numberStrip.style.transition, numberStrip.style.transform | js/stripConveyor.js:417–419; js/renderer.js:521–532, 784–802 |
| StripConveyor.recomputeStripMetrics | Для каждого кружка getCircleCenterInStrip(el) → getComputedStyle(circleEl) + offsetLeft + offsetWidth | Запись dataset.worldX на кружках (не layout, но в том же update до/после — strip transform) | js/stripConveyor.js:434–461, 722–726 |
| StripConveyor.updateStripClasses | (нет явного чтения layout в этой функции) | classList.add/remove на каждом кружке | js/stripConveyor.js:423–434 |
| Renderer.getFocusAnchorX | containerRect, circleEl.offsetWidth, focusRect (getBoundingClientRect) | — (только возврат значения; вызывающий код потом пишет transform) | js/renderer.js:784–802 |
| CloudsBackground.animateClouds (rAF) | container.getBoundingClientRect(), cloud.getBoundingClientRect() в forEach по облакам | cloud.style.left, cloud.style.top | js/cloudsBackground.js:64–71 |
| Renderer.animateEatIntoMouth | imgEl.getBoundingClientRect(), jawBotRect, penguinRootRect | fx.style.*, imgEl.style.opacity, circleEl.classList | js/renderer.js:136–185 |
| Renderer.setFoodPlaceholderSize / updateFoodContainerSize | getComputedStyle(circleEl).getPropertyValue('--circle-size') | circleEl.style.width, img.style.*, colliderSvg.style.* | js/renderer.js:452–453, 475–476, 431–435, 491–494 |
| Renderer.updateDebugObjectBoxes | imgRect / trackedCircle.getBoundingClientRect() | container.innerHTML = '', создание узлов, style.* | js/renderer.js:582–625 |

Критичная цепочка в каждом кадре: `updateConveyor` → `recomputeStripMetrics()` (много getComputedStyle + offsetLeft/offsetWidth по кружкам) → затем в том же update вызов `getFocusAnchorX()` (getBoundingClientRect) → запись `numberStrip.style.transform` → `checkCollisionsAndAutoBite()` (много getBoundingClientRect и getPathPolyOnScreen, затем запись transform/classList на кружках). Порядок «много read → потом write» создаёт риск layout thrashing. Метрика для проверки: Performance → запись «Recalculate Style» / «Layout» сразу после скрипта в том же кадре; уменьшение числа вызовов getBoundingClientRect/getComputedStyle в одном кадре и батчирование записей должно снижать пики.

---

## 6. Hot-path list

Функции, которые с высокой вероятностью вызываются каждый кадр или очень часто во время игры:

| № | Функция | Что делает |
|---|---------|------------|
| 1 | Game.gameLoop | rAF callback: timer.update, render, snapshot, requestAnimationFrame |
| 2 | Game.render | updateUI + renderer.updateConveyor(timer) |
| 3 | StripConveyorSystem.update | deltaTime, beltPosition, recomputeStripMetrics ×2, ensureStripWindowInitialized, maybeRecycleStripWindow, updateStripClasses, getFocusAnchorX, запись numberStrip.style.transform, checkCollisionsAndAutoBite |
| 4 | StripConveyorSystem.recomputeStripMetrics | querySelectorAll('.number-circle'), rebuildWorldCoordinates, getCircleCenterInStrip на каждом кружке (getComputedStyle + offsetLeft + offsetWidth) |
| 5 | StripConveyorSystem.getCircleCenterInStrip | getComputedStyle(circleEl) + offsetLeft + offsetWidth/2 |
| 6 | StripConveyorSystem.updateStripClasses | forEach по кружкам: classList.add/remove (passed, normal, active, danger) |
| 7 | Renderer.getFocusAnchorX | getBoundingClientRect(container), опционально querySelector('.number-circle'), offsetWidth, getBoundingClientRect(focusZone) или mouthRightX |
| 8 | CollisionEngine.check | getBoundingClientRect (container, jaw, circles), getPathPolyOnScreen ×4 (челюсти), querySelectorAll('.number-circle:not(.passed)'), для до 10 кружков: getBoundingClientRect, querySelector, getPathPolyOnScreen, SAT, запись style/classList/emit |
| 9 | RendererUI.updateUI | Много getElementById, textContent, classList.toggle, style.width (coin-rush segments) |
| 10 | Timer.update | currentTime, calculateStepDuration, цикл тиков, eventBus.emit('TICK_STEP') |
| 11 | StripConveyorSystem.getWorldSegmentByBeltPosition | querySelectorAll('.number-circle'), map в nodes, rebuildWorldCoordinates при необходимости |
| 12 | CollisionEngine.getPathPolyOnScreen | getTotalLength, getScreenCTM, getPointAtLength в цикле (для коллайдеров челюстей/еды) |
| 13 | PenguinRig.getPenguinParts | Много querySelector по focusZone (root, head, eye, topJaw, botJaw, paths) — вызывается из CollisionEngine.check и из getFocusAnchorX/mouth |
| 14 | CloudsBackground animate (rAF) | Отдельный rAF: querySelectorAll('.cloud'), forEach getBoundingClientRect + style.left/top |

Примечание: облака имеют свой rAF, не синхронизированный с gameLoop; при паузе игры облака продолжают анимироваться, пока не вызваны stop.

---

## 7. GC/allocation suspects

По паттернам кода (без профилирования):

| Место | Почему риск | Минимальное исправление |
|-------|-------------|-------------------------|
| getGameState() вызывается каждый кадр (render → updateUI) | Каждый вызов создаёт новый объект с полями timer, perks, score, coins, streak, spellCount, cooldowns и т.д. | Кэшировать объект и мутировать поля, либо вызывать getGameState реже (например, только при изменении счёта/перков) |
| StripConveyor: getWorldSegmentByBeltPosition | circles.map → массив nodes с объектами { el, value, world, center } каждый вызов | Переиспользовать один массив/буфер, заполнять по индексу |
| StripConveyor: rebuildWorldCoordinates, centers = circles.map(getCircleCenterInStrip) | Новый массив centers при каждом recomputeStripMetrics | Один массив центров, обновлять in-place |
| StripConveyor: pickWeightedChunk → weighted = templates.map(…) | Новый массив при планировании чанков (не каждый кадр, но при ensureSpawnQueue) | Переиспользовать массив или вынести создание из горячего пути |
| CollisionEngine.check: nearbyCandidates.slice(0, 10).map((entry) => entry.circle) | Новый массив каждый кадр | Один массив circlesToProcess, заполнять и обрезать length |
| CollisionEngine: getSwallowBoostState(circle, nowMs) | При первом обращении создаётся объект state и кладётся в WeakMap — не каждый кадр на новый объект, но новые объекты при новых кружках | Оставить как есть или пул объектов state |
| Renderer.animateEatIntoMouth | document.createElement('img'), appendChild, setTimeout(remove) | Не в hot path (по событию съедения); при желании — пул img для fx |
| Renderer.showFloatingCoinBonus | document.createElement('div'), appendChild, setTimeout(remove) | Аналогично — по событию; можно пул div |
| RendererUI.updateUI | Не создаёт массивы в цикле, но много getElementById и присвоений textContent | Оставить; при необходимости — batch DOM reads/writes |
| eventBus.emit | forEach по listeners — без создания массивов в emit | — |
| Game.setupEventListeners | Один раз при создании Game; document.querySelectorAll('.start-spell-btn').forEach(addEventListener) | Обработчики вешаются один раз, дубликатов нет при одном экземпляре Game |

Обработчики событий не добавляются многократно без удаления: подписки в setupEventListeners выполняются один раз; eventBus.on в Game и Renderer тоже при инициализации. JSON.parse/stringify в кадре не используются.

---

## 8. Separation of concerns score (A/B/C)

- **Логика и координаты:**
  - Позиция ленты задаётся числом `beltPosition` и интерполяцией по «мировым» координатам кружков (`dataset.worldX`). Мировые координаты пересчитываются из DOM: `getCircleCenterInStrip` использует `offsetLeft`, `offsetWidth`, `getComputedStyle(margin)`. То есть **источник истины для положения кружков — DOM (layout)**, а не отдельный массив координат в памяти. Логика «какой шаг сейчас у рта» и смещение ленты — в JS (segment.currentValue, targetOffset).
- **Единый слой обновления визуала:**
  - Лента: один контейнер, запись transform в одном месте (StripConveyor.update). Визуал кружков (классы, размеры, картинки) обновляется в StripConveyor (updateStripClasses, applySpawnMeta), Renderer (ensureFoodCircle, setFoodPlaceholderSize, updateFoodContainerSize), CollisionEngine (transform при swallow boost, классы/opacity при съедении). То есть **единого единственного слоя «только отрисовка» нет** — обновление визуала размазано по конвейеру, коллизиям и рендереру.
- **UI и игровое поле в DOM:**
  - Всё в одном дереве: `#game-container` содержит `#ui-overlay`, `#game-area` (фон, лёд, number-strip-container, focus-zone с пингвином), `#controls`, оверлеи (pause, language, perks, leaderboard, rename, game-over, countdown, start). Игровая лента и пингвин — соседи с HUD и попапами в одном документе.

**Оценка: B (средне, 3–7 дней).**

- Логика частично отделена (timer, beltPosition, перки, счёт), но позиции кружков и якорь рта зависят от DOM (getBoundingClientRect, getCircleCenterInStrip). Вынести «только логику» рендера потребует введения абстракции координат (например, свои x для кружков и контейнера ленты) и одного места, где по этим данным выставляются transform/классы.
- Единого render-pass нет: strip transform в одном месте, классы кружков — в другом, челюсти и swallow boost — в третьем. Для абстракции рендера нужно собрать все записи в DOM в один слой (например, один метод `render(state)` в Renderer), который по состоянию обновляет только стили/классы.
- UI и игра в одном DOM — разделение возможно по слоям (игровой слой vs UI слой), но замена только «игрового» слоя на canvas потребует чёткого разделения узлов и, возможно, двух контейнеров (canvas под game-area vs остальной DOM).

---

## 9. Top 10 files to review first

| № | Файл | Зачем смотреть |
|---|------|----------------|
| 1 | js/game.js | Игровой цикл (gameLoop, render), частота updateUI и updateConveyor |
| 2 | js/stripConveyor.js | Рециклинг DOM, getCircleCenterInStrip (getComputedStyle + offset*), updateStripClasses, запись transform ленты |
| 3 | js/collisionEngine.js | Массовые getBoundingClientRect и getPathPolyOnScreen в check(), запись style/classList |
| 4 | js/renderer.js | getFocusAnchorX (layout read), animateEatIntoMouth, ensureFoodCircle, setFoodPlaceholderSize, updateFoodContainerSize (getComputedStyle), showFloatingCoinBonus |
| 5 | js/rendererUI.js | updateUI (много DOM-обращений каждый кадр), innerHTML/ createElement в модалках |
| 6 | js/penguinRig.js | getPenguinParts (много querySelector), getPenguinMouthRightX (getBoundingClientRect), applyMouthPose (style.transform) |
| 7 | js/timer.js | Формула stepDuration, update с тиками |
| 8 | js/cloudsBackground.js | Отдельный rAF, getBoundingClientRect в цикле по облакам, запись style.left/top |
| 9 | styles.css | box-shadow, filter, drop-shadow на #ice-top, opacity на кружках и облаках |
| 10 | index.html | Структура #game-container (игровая зона и UI в одном дереве) |

---

## 10. Метрики, которые нужно измерить (чеклист для ручной проверки)

Не выводы из кода, а что именно замерить, чтобы подтвердить или снять риски.

- **DevTools → Performance:** записать 10–20 секунд геймплея (лента движется, еда съедается), затем:
  - Смотреть **Main** (JS): какие функции занимают больше всего времени в кадре (gameLoop, update, check, getCircleCenterInStrip, getBoundingClientRect).
  - Смотреть **Layout / Recalculate Style:** сколько раз за кадр, идут ли подряд несколько Layout после одного скрипта (признак reflow thrashing).
  - Смотреть **Paint / Composite:** время и частота; какие слои перерисовываются.
- **Performance → Experience → FPS:** средний FPS и просадки при активной ленте и при открытии рта/съедении.
- **Memory:** снять heap snapshot до и после 1–2 минут игры; рост объёма (и наличие отцепленных DOM-узлов) после рециклинга ленты и анимаций (floating bonus, eat fx).
- **Rendering (вкладка):** включить «Paint flashing» / «Layout Shift» — какие области перерисовываются каждый кадр (ожидаемо: лента, возможно HUD при updateUI).
- **Счётчики, которые важны:**
  1. Время на кадр (frame time) в ms.
  2. Количество Recalculate Style / Layout за один кадр.
  3. Время выполнения CollisionEngine.check и StripConveyor.update в процентах от кадра.
  4. Количество вызовов getBoundingClientRect и getComputedStyle за кадр (поиск в Performance по имени).
  5. Количество DOM-узлов в #number-strip (и меняется ли при рецикле).
  6. Количество узлов с box-shadow / filter в видимой области (Elements → подсветка).
  7. Heap size до/после сессии и после GC.
  8. FPS на целевых устройствах (слабый мобильный / средний десктоп).

Этого достаточно, чтобы принять решение «дожимать DOM» (оптимизация reflow, батчирование, упрощение CSS) или планировать миграцию на canvas/Phaser с опорой на фактические цифры.
