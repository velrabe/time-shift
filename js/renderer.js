// Система рендеринга
class Renderer {
    constructor() {
        this.numberStrip = document.getElementById('number-strip');
        this.focusZone = document.getElementById('focus-zone');
        this.controlButtons = document.getElementById('control-buttons');
        this.perksContainer = document.getElementById('perks-container'); // legacy (может быть null)

        // Leaderboard modal UI
        this.leaderboardModal = document.getElementById('leaderboard-modal');
        this.leaderboardListEl = document.getElementById('leaderboard-list');
        this.leaderboardMeEl = document.getElementById('leaderboard-me');
        this.leaderboardCloseBtn = document.getElementById('leaderboard-close-btn');
        
        this.focusZoneCenter = 0; // будет вычислено
        
        // Состояние анимаций (разделены для независимой работы)
        this.circleAnimationId = null; // ID анимации круга
        this.stripAnimationId = null;   // ID анимации ленты
        this.currentStripOffset = 0;   // Текущее смещение ленты в px
        
        // Параметры круга
        this.focusZoneBaseSize = 0;
        this.circleExpandScale = 2.0; // Круг увеличивается в 2 раза

        // Метрики ленты для аналитического расчета оффсета (чтобы не зависеть от DOM-rect дрейфа)
        this.stripMinValue = 0;        // минимальное значение, отрисованное в ленте
        this.stripPitchPx = null;      // расстояние между центрами соседних кружков
        this.stripFirstCenterPx = null; // центр первого кружка относительно левого края ленты
        this.lastCurrentValue = null;  // последний current (для расчета deltaSteps)
        this.stripRange = 15;          // "полезный" радиус вокруг current
        this.stripHalfWindow = 30;     // фактический DOM-буфер (2*30+1 = 61 точка)
        this.stripRecycleMargin = 10;  // насколько близко к краям допускаем current перед recycle

        // Коллизия "опасность касается головы" (триггер гейм-овера)
        this._deathTriggered = false;
        this._deathTriggeredForStart = null;

        // Debug overlay
        this.debug = (() => {
            try {
                const qs = new URLSearchParams(window.location.search);
                return qs.has('debug') || qs.get('debug') === '1';
            } catch (e) {
                return false;
            }
        })();
        this.biteOffsetX = 0; // px: можно калибровать "точку укуса" (положительное = вправо, отрицательное = влево)
        this.debugEls = null;
        // conveyor-mode state
        this._conveyorEnabled = true;
        this._biteTickCounter = -1;
        this._biteStartedThisTick = false;
        // фиксируем "статический" якорь рта, чтобы лента не следовала за transform-анимацией укуса
        this._cachedMouthRightX = 0;
        // conveyor bite state (avoid restarting animation each frame)
        this._conveyorBiteActive = false;
        this._conveyorBiteTickCounter = -1;
        
        // Новая физическая система: постоянное движение ленты
        // Базовая скорость ленты (ускоряется через таймер.getSpeedMultiplier()).
        this._beltSpeed = 0.08; // пикселей в миллисекунду (чуть быстрее, чем раньше)
        // Ускорение ленты за каждую съеденную еду (множитель на базовую скорость)
        this._beltEatMultiplier = 1.0;
        this._beltEatGrowth = 1.03; // +3% за каждую еду (настраивается)
        this._foodsEatenForSpeed = 0;
        this._beltPosition = 0; // текущая позиция ленты в пикселях
        this._lastBeltUpdateTime = 0;
        this._beltStartAdjusted = false;
        this._beltPauseStartTime = null; // Время начала паузы ленты (для корректировки при возобновлении)
        this._lastBaseSpeedPxPerMs = this._beltSpeed; // обновляется в updateConveyor

        // Mouth hold (press & hold)
        this._mouthHeld = false;
        this._mouthHoldStartTimeMs = 0;
        this._mouthOpen = false;
        this._mouthHoldMaxMs = 2000;
        
        // Food sprites for strip circles (single type)
        // NOTE: browser can't list /img, so we keep an explicit list.
        this.foodBases = ['f1', 'f2', 'f3', 'f4', 'f5'];
        
        this._lastStreak = 0;
        this._streakAnimTimeoutId = null;

        this.setupFocusZone();
        this.setupEventListeners();
        this.setupFocusZoneAnimation();
        this.autoCalibratePenguinProportions();
        this.setupDebugOverlay();
        this.setupClouds();

        // В debug показываем реальные (ротирующиеся) зубные коллайдеры
        if (this.debug) {
            try {
                const parts = this.getPenguinParts();
                parts?.root?.classList?.add?.('debug-colliders');
            } catch (e) {
                // ignore
            }
        }

        // Ограниченные debug-логи (без спама каждый кадр)
        this._dbg = {
            enabled: this.debug,
            max: 40,
            count: 0,
            lastAtByKey: new Map(),
            lastTrackedValue: null,
            lastTrackedWasColliding: false,
            lastDeathValue: null
        };

        // Debug-only reset button (полный сброс прогресса)
        if (this.debug) {
            try {
                const hudActions = document.getElementById('hud-actions');
                if (hudActions) {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'icon-btn';
                    btn.textContent = 'RST';
                    btn.title = 'Reset local & GamePush progress (debug)';
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (window.gameInstance && typeof window.gameInstance.debugResetProgress === 'function') {
                            window.gameInstance.debugResetProgress();
                        }
                    });
                    hudActions.appendChild(btn);
                }
            } catch (e) {
                // ignore
            }
        }
    }

    dbgLog(key, payload, minIntervalMs = 250) {
        if (!this._dbg?.enabled) return;
        if (this._dbg.count >= this._dbg.max) return;
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const lastAt = this._dbg.lastAtByKey.get(key) || 0;
        if (now - lastAt < minIntervalMs) return;
        this._dbg.lastAtByKey.set(key, now);
        this._dbg.count += 1;
        // eslint-disable-next-line no-console
        console.log(`[DBG:${key}]`, payload);
    }

    // Автокалибровка пропорций головы и челюстей по реальным SVG-ассетам,
    // чтобы размеры челюстей совпадали с оригиналом относительно головы.
    autoCalibratePenguinProportions() {
        const apply = () => {
            const parts = this.getPenguinParts();
            if (!parts?.root) return;
            const head = parts.head || document.getElementById('penguin-head');
            const topJaw = parts.topJawImg || document.getElementById('penguin-top-jaw')?.querySelector?.('img.penguin-jaw-img') || document.getElementById('penguin-top-jaw');
            const botJaw = parts.botJawImg || document.getElementById('penguin-bot-jaw')?.querySelector?.('img.penguin-jaw-img') || document.getElementById('penguin-bot-jaw');
            if (!head || !topJaw || !botJaw) return;

            const ready =
                head.naturalWidth > 0 && head.naturalHeight > 0 &&
                topJaw.naturalWidth > 0 && topJaw.naturalHeight > 0 &&
                botJaw.naturalWidth > 0 && botJaw.naturalHeight > 0;
            if (!ready) return;

            const wHead = head.naturalWidth;
            const hHead = head.naturalHeight;
            if (!wHead || !hHead) return;

            const rootStyle = parts.root.style;
            const setRatios = (jawImg, wVar, hVar) => {
                const rw = jawImg.naturalWidth / wHead;
                const rh = jawImg.naturalHeight / hHead;
                // Пропорции берем напрямую из ассетов; позиции (x/y) не трогаем.
                rootStyle.setProperty(wVar, `${(rw * 100).toFixed(2)}%`);
                rootStyle.setProperty(hVar, `${(rh * 100).toFixed(2)}%`);
            };

            setRatios(topJaw, '--jaw-top-w', '--jaw-top-h');
            setRatios(botJaw, '--jaw-bot-w', '--jaw-bot-h');
        };

        // Пытаемся сразу, если ассеты уже загружены
        apply();

        // Если ещё не загружены — один раз повесим onload
        const parts = this.getPenguinParts();
        const imgs = [
            parts?.head || document.getElementById('penguin-head'),
            parts?.topJawImg || document.getElementById('penguin-top-jaw')?.querySelector?.('img.penguin-jaw-img') || document.getElementById('penguin-top-jaw'),
            parts?.botJawImg || document.getElementById('penguin-bot-jaw')?.querySelector?.('img.penguin-jaw-img') || document.getElementById('penguin-bot-jaw')
        ].filter(Boolean);

        imgs.forEach((img) => {
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                return;
            }
            img.addEventListener('load', apply, { once: true });
        });
    }

    // Анимация "успешного поедания": предмет плавно улетает в рот и растворяется
    animateEatIntoMouth(circleEl, containerEl, containerRect, targetX, targetY) {
        if (!circleEl || !containerEl || !containerRect) return;
        const imgEl = circleEl.querySelector?.('img.food-img');
        if (!imgEl) return;
        const imgRect = imgEl.getBoundingClientRect?.();
        if (!imgRect) return;

        // Получаем левую границу нижней челюсти как точку "поглощения"
        const parts = this.getPenguinParts();
        const jawBotRect = parts?.botJaw?.getBoundingClientRect?.();
        if (!jawBotRect) return;
        const jawLeftX = jawBotRect.left - containerRect.left;

        const startLeft = imgRect.left - containerRect.left;
        const startTop = imgRect.top - containerRect.top;
        const w = imgRect.width;
        const h = imgRect.height;
        const startCx = startLeft + w / 2;
        const startCy = startTop + h / 2;

        // Клонируем картинку поверх сцены, чтобы анимация не зависела от transform ленты
        const fx = document.createElement('img');
        fx.src = imgEl.currentSrc || imgEl.src;
        fx.alt = '';
        fx.draggable = false;
        fx.style.position = 'absolute';
        fx.style.left = `${startLeft}px`;
        fx.style.top = `${startTop}px`;
        fx.style.width = `${w}px`;
        fx.style.height = `${h}px`;
        fx.style.pointerEvents = 'none';
        fx.style.zIndex = '8'; // выше льда (z:5), но ниже челюстей/головы (focus-zone z:20)
        fx.style.willChange = 'transform, opacity, filter';
        fx.style.transformOrigin = '50% 50%';
        fx.style.transform = 'translate(0px, 0px) scale(1)';
        fx.style.opacity = '1';
        fx.style.filter = 'none';
        fx.style.transition = 'transform 350ms cubic-bezier(0.15, 0.7, 0.3, 0.95), opacity 350ms ease-in, filter 350ms ease-in';

        containerEl.appendChild(fx);

        // Прячем оригинал, но оставляем слот (важно для стабильного шага ленты)
        imgEl.style.opacity = '0';
        circleEl.classList.add('passed', 'consumed');

        requestAnimationFrame(() => {
            // Плавное движение к левой границе нижней челюсти (внутрь рта) с постепенным уменьшением и растворением.
            // Предмет "уходит вглубь" рта, переходя за левую границу челюсти.
            const finalX = jawLeftX - (w * 0.3); // чуть левее внутренней границы челюсти (создаёт эффект "внутрь")
            const finalY = (targetY - startCy) * 0.5; // небольшое вертикальное смещение к центру рта
            const finalDx = finalX - startCx;
            const finalDy = finalY;
            fx.style.transform = `translate(${finalDx.toFixed(2)}px, ${finalDy.toFixed(2)}px) scale(0.15)`;
            fx.style.opacity = '0';
            fx.style.filter = 'blur(1px)';
        });

        window.setTimeout(() => {
            try { fx.remove(); } catch (e) { /* ignore */ }
        }, 400);
    }

    // Визуальный фидбек кулдауна на действиях (2 кнопки)
    // progress: 0..1 (0 = только что нажали, 1 = можно жать снова)
    updateActionCooldown(progress) {
        if (!this.controlButtons) return;
        const p = Math.max(0, Math.min(1, Number(progress)));
        const opacity = 0.35 + 0.65 * p;
        const scale = 0.92 + 0.08 * p;

        const btns = this.controlButtons.querySelectorAll('.control-btn');
        btns.forEach((btn) => {
            if (!btn || btn.disabled || btn.classList.contains('inactive')) return;
            btn.style.setProperty('--cd-opacity', opacity.toFixed(3));
            btn.style.setProperty('--cd-scale', scale.toFixed(3));
        });
    }

    // В debug-режиме показываем числа прямо на кружках, чтобы легче отлаживать "ленту"
    applyDebugLabelToCircle(circleEl) {
        if (!circleEl) return;
        const ensureLabel = () => {
            let lbl = circleEl.querySelector('.debug-label');
            if (!lbl) {
                lbl = document.createElement('span');
                lbl.className = 'debug-label';
                circleEl.appendChild(lbl);
            }
            return lbl;
        };

        if (this.debug) {
            circleEl.classList.add('debug-number');
            const v = circleEl.dataset?.value;
            const lbl = ensureLabel();
            lbl.textContent = (v == null ? '' : String(v));
        } else {
            circleEl.classList.remove('debug-number');
            const lbl = circleEl.querySelector('.debug-label');
            if (lbl) lbl.remove();
        }
    }

    // Deterministic "random" food pick by value (stable across frames)
    getFoodBaseForValue(value) {
        const v = Math.max(0, Number(value) || 0);
        const bases = this.foodBases || [];
        if (bases.length === 0) return null;
        // simple LCG-ish hash
        const h = (Math.floor(v) * 9301 + 49297) % 233280;
        const idx = h % bases.length;
        return bases[idx];
    }

    getFoodSrc(base) {
        if (!base) return '';
        return `img/${base}-s.png`;
    }

    ensureFoodCircle(circleEl) {
        if (!circleEl) return;
        let img = circleEl.querySelector('img.food-img');
        if (!img) {
            img = document.createElement('img');
            img.className = 'food-img';
            img.alt = '';
            img.draggable = false;
            img.decoding = 'async';
            img.loading = 'eager';
            
            // После загрузки изображения обновляем размер контейнера под реальные пропорции
            img.addEventListener('load', () => {
                this.updateFoodContainerSize(circleEl, img);
            });
            circleEl.appendChild(img);
        }

        const value = parseInt(circleEl.dataset.value);
        const base = circleEl.dataset.foodBase || this.getFoodBaseForValue(value) || 'f1';
        circleEl.dataset.foodBase = base;

        img.src = this.getFoodSrc(base);
        
        // Если изображение уже загружено, обновляем размер сразу
        if (img.complete && img.naturalWidth > 0) {
            this.updateFoodContainerSize(circleEl, img);
        }
    }

    // Обновление размера под реальные пропорции ассета (в "оригинальных" размерах, с единым масштабом)
    updateFoodContainerSize(circleEl, img) {
        if (!circleEl || !img) return;
        
        const naturalWidth = img.naturalWidth;
        const naturalHeight = img.naturalHeight;
        if (naturalWidth === 0 || naturalHeight === 0) return;

        // Один глобальный коэффициент масштаба для ВСЕХ еды, чтобы относительные размеры совпадали с оригиналом.
        // Подобрано по median высоты f*-s (169,154,149,257,217,137) => 161.5.
        const baseUnit = parseFloat(getComputedStyle(circleEl).getPropertyValue('--circle-size')) || 63;
        const baselineSmallHeight = 161.5;
        // Глобальный масштаб подгоняет всё под circle-size; дополнительный
        // коэффициент 0.5 уменьшает ВСЕ объекты на ленте в 2 раза.
        const globalScale = (baseUnit / baselineSmallHeight) * 0.5;

        const targetWidth = naturalWidth * globalScale;
        const targetHeight = naturalHeight * globalScale;

        // Фиксируем размеры у изображения, а не у элемента слота,
        // иначе ломается "питч" ленты (движение/рецикл завязаны на постоянный шаг).
        img.style.width = `${targetWidth}px`;
        img.style.height = `${targetHeight}px`;

        // Реальные размеры для физики/дебага
        circleEl.dataset.actualWidth = String(targetWidth);
        circleEl.dataset.actualHeight = String(targetHeight);
    }

    // legacy: раньше были разные варианты еды (danger/normal). Теперь тип один.

    setupDebugOverlay() {
        if (!this.debug) return;
        const container = document.getElementById('game-area');
        if (!container) return;
        // не дублируем, если уже есть
        let overlay = container.querySelector('#debug-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'debug-overlay';
            container.appendChild(overlay);
        }

        const ensure = (id, className) => {
            let el = overlay.querySelector(`#${id}`);
            if (!el) {
                el = document.createElement('div');
                el.id = id;
                el.className = className;
                overlay.appendChild(el);
            }
            return el;
        };

        // SVG слой для повернутых полигонов (зубные коллайдеры)
        let svg = overlay.querySelector('#debug-svg');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('id', 'debug-svg');
            svg.style.position = 'absolute';
            svg.style.inset = '0';
            svg.style.pointerEvents = 'none';
            svg.style.zIndex = '1000';
            overlay.appendChild(svg);
        }

        const ensurePoly = (id) => {
            let p = svg.querySelector(`#${id}`);
            if (!p) {
                p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                p.setAttribute('id', id);
                p.setAttribute('fill', 'rgba(255,0,0,0.10)');
                p.setAttribute('stroke', 'rgba(255,0,0,0.95)');
                p.setAttribute('stroke-width', '2');
                svg.appendChild(p);
            }
            return p;
        };

        // Контейнер для границ всех объектов на ленте
        let objectsContainer = overlay.querySelector('#debug-objects-container');
        if (!objectsContainer) {
            objectsContainer = document.createElement('div');
            objectsContainer.id = 'debug-objects-container';
            objectsContainer.style.position = 'absolute';
            objectsContainer.style.inset = '0';
            objectsContainer.style.pointerEvents = 'none';
            overlay.appendChild(objectsContainer);
        }

        this.debugEls = {
            overlay,
            objectsContainer,
            svg,
            teethTopPolyEl: ensurePoly('debug-teeth-top-poly'),
            teethBotPolyEl: ensurePoly('debug-teeth-bot-poly'),
            penguinBox: ensure('debug-penguin-box', 'debug-box debug-penguin'),
            jawTopBox: ensure('debug-jaw-top-box', 'debug-box debug-jaw-top'),
            jawBotBox: ensure('debug-jaw-bot-box', 'debug-box debug-jaw-bot'),
            teethTopBox: ensure('debug-teeth-top-box', 'debug-box debug-teeth-top'),
            teethBotBox: ensure('debug-teeth-bot-box', 'debug-box debug-teeth-bot'),
            dangerBox: ensure('debug-danger-box', 'debug-box debug-danger'),
            biteLine: ensure('debug-bite-line', 'debug-line debug-bite'),
            anchorLine: ensure('debug-anchor-line', 'debug-line debug-anchor'),
            // Дополнительная горизонтальная линия по нижней границе челюсти
            jawBottomLine: ensure('debug-jaw-bottom-line', 'debug-line debug-jaw-bottom')
        };
    }

    // Обновление границ объекта на ленте для debug (один объект: ближайший/в коллизии)
    updateDebugObjectBoxes(trackedCircle, containerRect, isColliding = false) {
        if (!this.debug || !this.debugEls?.objectsContainer) return;
        
        const container = this.debugEls.objectsContainer;
        // Очищаем старые боксы
        container.innerHTML = '';
        
        // Показываем только один "трекаемый" объект (если есть)
        if (!trackedCircle) return;
        
        const img = trackedCircle.querySelector('img.food-img');
        const imgRect = img?.getBoundingClientRect?.() || null;

        // В physics-режиме размеры еды задаются непосредственно img (через updateFoodContainerSize),
        // поэтому самый точный hitbox — это boundingClientRect самой картинки.
        const left = (imgRect ? imgRect.left : trackedCircle.getBoundingClientRect().left) - containerRect.left;
        const top = (imgRect ? imgRect.top : trackedCircle.getBoundingClientRect().top) - containerRect.top;
        const width = imgRect ? imgRect.width : trackedCircle.getBoundingClientRect().width;
        const height = imgRect ? imgRect.height : trackedCircle.getBoundingClientRect().height;
        
        const box = document.createElement('div');
        box.className = 'debug-box';
        box.style.position = 'absolute';
        // Позиционируем по центру изображения
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;
        
        // Цвет: красный = реальная коллизия (смерть при закрытом рте), синий = просто трекинг.
        box.style.borderColor = isColliding ? 'rgba(255, 0, 0, 1)' : 'rgba(0, 150, 255, 0.35)';
        box.style.background = isColliding ? 'rgba(255, 0, 0, 0.10)' : 'rgba(0, 150, 255, 0.04)';
        box.style.borderWidth = isColliding ? '3px' : '1px';
        box.style.borderStyle = 'solid';
        box.style.boxSizing = 'border-box';
        
        container.appendChild(box);
    }

    updateDebugOverlay({ containerRect, penguinRect, jawTopRect, jawBotRect, teethTopRect, teethBotRect, dangerRect, biteX, anchorX }) {
        if (!this.debug || !this.debugEls) return;
        const { jawTopBox, jawBotBox, teethTopBox, teethBotBox, dangerBox, biteLine, penguinBox, anchorLine, jawBottomLine, svg, teethTopPolyEl, teethBotPolyEl } = this.debugEls;

        const placeBox = (box, rect) => {
            if (!rect) {
                box.style.display = 'none';
                return;
            }
            box.style.display = 'block';
            // Поддерживаем как DOMRect, так и объект с left/top/width/height
            const left = rect.left !== undefined ? rect.left : (rect.x !== undefined ? rect.x : 0);
            const top = rect.top !== undefined ? rect.top : (rect.y !== undefined ? rect.y : 0);
            const width = rect.width !== undefined ? rect.width : ((rect.right !== undefined && rect.left !== undefined) ? (rect.right - rect.left) : 0);
            const height = rect.height !== undefined ? rect.height : ((rect.bottom !== undefined && rect.top !== undefined) ? (rect.bottom - rect.top) : 0);
            
            box.style.left = `${left - containerRect.left}px`;
            box.style.top = `${top - containerRect.top}px`;
            box.style.width = `${width}px`;
            box.style.height = `${height}px`;
        };
        
        // Примечание: debug-боксы показывают AABB (boundingClientRect), т.к. это то,
        // что реально используется в физике коллизий (и оно учитывает rotate/transform).

        const placeLine = (line, x) => {
            if (typeof x !== 'number' || !Number.isFinite(x)) {
                line.style.display = 'none';
                return;
            }
            line.style.display = 'block';
            line.style.left = `${x}px`;
            line.style.top = `0px`;
            line.style.height = `${containerRect.height}px`;
        };

        const placeHLine = (line, y) => {
            if (typeof y !== 'number' || !Number.isFinite(y)) {
                line.style.display = 'none';
                return;
            }
            line.style.display = 'block';
            line.style.left = `0px`;
            line.style.top = `${y}px`;
            line.style.width = `${containerRect.width}px`;
            line.style.height = `0px`;
        };

        // Скрываем боксы, которые не участвуют в коллизии
        if (penguinBox) penguinBox.style.display = 'none';
        if (anchorLine) anchorLine.style.display = 'none';
        if (jawBottomLine) jawBottomLine.style.display = 'none';
        
        // 1) Челюсти (для контекста)
        placeBox(jawTopBox, jawTopRect);
        placeBox(jawBotBox, jawBotRect);

        // 1.1) Зубные коллайдеры: реальные DOM-элементы внутри челюстей.
        // Они поворачиваются/смещаются синхронно со спрайтом, поэтому для debug показываем их AABB.
        placeBox(teethTopBox, teethTopRect);
        placeBox(teethBotBox, teethBotRect);
        
        // 2. Объект в коллизии (если есть)
        placeBox(dangerBox, dangerRect);
        
        // 3. Линия укуса (правая граница челюсти - показывает где заканчивается зона коллизии)
        // Game over происходит когда объект пересекается с челюстью (не просто проходит эту линию)
        placeLine(biteLine, biteX);

        // 4. Горизонтальная линия по нижней границе нижней челюсти
        if (jawBotRect && jawBottomLine) {
            const bottomY = (jawBotRect.bottom !== undefined ? jawBotRect.bottom : (jawBotRect.y || 0) + (jawBotRect.height || 0)) - containerRect.top;
            placeHLine(jawBottomLine, bottomY);
        }

        // Старые SVG-полигоны больше не используем
        try {
            if (teethTopPolyEl) teethTopPolyEl.style.display = 'none';
            if (teethBotPolyEl) teethBotPolyEl.style.display = 'none';
            if (svg) svg.style.display = 'none';
        } catch (e) {
            // ignore
        }
    }

    getPenguinParts() {
        const root = this.focusZone?.querySelector('#penguin-root') || this.focusZone?.querySelector('.penguin');
        if (!root) return null;
        const head = root.querySelector('#penguin-head') || root.querySelector('.penguin-head');
        const topJaw = root.querySelector('#penguin-top-jaw') || root.querySelector('.penguin-jaw--top');
        const botJaw = root.querySelector('#penguin-bot-jaw') || root.querySelector('.penguin-jaw--bot');
        const topJawImg = topJaw?.querySelector?.('img.penguin-jaw-img') || (topJaw?.tagName === 'IMG' ? topJaw : null);
        const botJawImg = botJaw?.querySelector?.('img.penguin-jaw-img') || (botJaw?.tagName === 'IMG' ? botJaw : null);
        const topTeeth = topJaw?.querySelector?.('.teeth-collider--top') || null;
        const botTeeth = botJaw?.querySelector?.('.teeth-collider--bot') || null;
        return { root, head, topJaw, botJaw, topJawImg, botJawImg, topTeeth, botTeeth };
    }

    // Правая граница "рта" = правая граница НИЖНЕЙ челюсти (кончик зубов).
    // Использует реальные размеры нижней челюсти для точной коллизии; fallback: правая граница головы.
    getPenguinMouthRightX(containerEl) {
        if (!containerEl) return 0;
        const containerRect = containerEl.getBoundingClientRect();
        const parts = this.getPenguinParts();
        if (!parts) return 0;

        // Важно: используем boundingClientRect, потому что он учитывает rotate/transform челюсти.
        const botRect = parts.botJaw?.getBoundingClientRect?.() || null;
        const rootRect = parts.root?.getBoundingClientRect?.() || null;
        let right = botRect ? botRect.right : (rootRect ? rootRect.right : null);
        if (right == null) return 0;

        return (right - containerRect.left) + (this.biteOffsetX || 0);
    }

    // Анимация укуса (визуальный щелчок). Мы больше не различаем "малый" и "большой" по анимации:
    // для любых укусов используем один и тот же краткий motion.
    triggerBite(kind = 'small', durationSec = null) {
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        if (typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0) {
            parts.root.style.setProperty('--bite-ms', `${Math.round(durationSec * 1000)}ms`);
        } else {
            parts.root.style.removeProperty('--bite-ms');
        }
        // По умолчанию (для разовых укусов) не используем сдвиг фазы
        parts.root.style.setProperty('--bite-delay-ms', `0ms`);
        // Независимо от kind всегда играем один и тот же класс .bite-small
        const cls = 'bite-small';
        parts.root.classList.remove('bite-small', 'bite-big');
        // force reflow to restart animation
        void parts.root.offsetHeight;
        parts.root.classList.add(cls);
        const msFromCss = (() => {
            const v = getComputedStyle(parts.root).getPropertyValue('--bite-ms').trim();
            if (!v) return null;
            const m = v.match(/^(\d+(?:\.\d+)?)ms$/);
            if (!m) return null;
            return Math.max(1, Math.round(parseFloat(m[1])));
        })();
        // Длительность укуса делаем одинаковой для всех типов укусов.
        const ms = msFromCss ?? 160;

        // ВАЖНО: физика ускорения ленты не завязана на время анимации.
        // Ускорение управляется distance-based импульсом из openMouth().
        window.setTimeout(() => {
            parts.root?.classList?.remove(cls);
        }, ms);
    }

    // Дистанция импульса в px: равна ширине "актуального" объекта + 0.5 его ширины (итого 1.5 * width).
    // Это даёт окно успешного нажатия примерно ~0.25 ширины перед объектом.
    getBiteExtraDistancePx() {
        try {
            const container = document.getElementById('game-area');
            if (!container || !this.numberStrip) {
                return 140;
            }
            const containerRect = container.getBoundingClientRect();
            const jawRight = this.getPenguinMouthRightX(container); // в координатах контейнера
            if (!Number.isFinite(jawRight) || jawRight <= 0) {
                return 140;
            }

            const circles = Array.from(this.numberStrip.querySelectorAll('.number-circle:not(.passed)'));
            let bestRect = null;
            let bestDist = Infinity;

            for (const circle of circles) {
                const img = circle.querySelector('img.food-img');
                const rect = (img || circle).getBoundingClientRect();
                const left = rect.left - containerRect.left;
                const right = rect.right - containerRect.left;
                const center = (left + right) / 2;
                // интересует объект, который ЕЩЁ не прошёл челюсть и движется к ней справа
                if (center <= jawRight) continue;
                const distFrontToJaw = left - jawRight;
                if (distFrontToJaw < 0) continue;
                if (distFrontToJaw < bestDist) {
                    bestDist = distFrontToJaw;
                    bestRect = rect;
                }
            }

            if (bestRect) {
                const w = bestRect.width || 100;
                return Math.max(60, Math.round(w * 1.5));
            }

            // Fallback: если ничего не нашли, используем средний размер из circle-size, но поменьше.
            const circleEl = this.numberStrip?.querySelector?.('.number-circle');
            const baseUnit = circleEl
                ? (parseFloat(getComputedStyle(circleEl).getPropertyValue('--circle-size')) || 63)
                : 63;
            return Math.max(60, Math.round(baseUnit * 1.5));
        } catch (e) {
            return 120;
        }
    }

    // Conveyor-bite: синхронизация анимации с фазой тика без таймаута.
    // durationMs: полная длительность окна укуса
    // elapsedMs: сколько "прошло" внутри окна укуса (для отрицательного delay)
    applyConveyorBite(kind, durationMs, elapsedMs, forceResync = false) {
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        // В новой модели есть только один тип укуса — "малый" по анимации.
        const cls = 'bite-small';

        const dMs = Math.max(1, Math.round(Number(durationMs) || 0));
        const eMs = Math.max(0, Math.min(dMs, Math.round(Number(elapsedMs) || 0)));

        // Важно: изменение animation-delay/animation-duration может перезапускать анимацию.
        // Поэтому выставляем фазу ТОЛЬКО при входе в окно (или при принудительной ресинхронизации).
        const hasCls = parts.root.classList.contains(cls);
        if (!hasCls || forceResync) {
            parts.root.style.setProperty('--bite-ms', `${dMs}ms`);
            parts.root.style.setProperty('--bite-delay-ms', `-${eMs}ms`);
            parts.root.classList.remove('bite-small', 'bite-big');
            void parts.root.offsetHeight;
            parts.root.classList.add(cls);
        }
    }

    clearConveyorBite() {
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        parts.root.classList.remove('bite-small', 'bite-big');
        parts.root.style.removeProperty('--bite-delay-ms');
        parts.root.style.removeProperty('--bite-ms');
    }

    // Полностью остановить любые анимации укуса (используется при смерти: нужно "заморозить" момент контакта).
    stopAllBites() {
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        parts.root.classList.remove('bite-small', 'bite-big');
        parts.root.classList.remove('mouth-open');
        parts.root.style.removeProperty('--bite-delay-ms');
        parts.root.style.removeProperty('--bite-ms');
        this._mouthHeld = false;
        this._mouthHoldStartTimeMs = 0;
        this._mouthOpen = false;
    }

    // Переключение изображений пингвина при проигрыше
    setPenguinGameOverState() {
        const parts = this.getPenguinParts();
        const head = document.getElementById('penguin-head');
        const topJaw = document.getElementById('penguin-top-jaw');
        const botJaw = document.getElementById('penguin-bot-jaw');

        // Временно: НЕ смещаем/не вращаем всю конструкцию головы программно.
        // Фиксируем только переход ассетов (head/jaws) в состояние game over.
        if (parts?.root) {
            parts.root.style.transform = '';
        }

        if (head) {
            // Явно сбрасываем transform, чтобы head-2 не смещался относительно челюстей
            head.style.transform = 'none';
            head.style.removeProperty('transform');
            head.src = 'img/head-2.svg';
        }
        const topJawImg = parts?.topJawImg || topJaw?.querySelector?.('img.penguin-jaw-img') || null;
        const botJawImg = parts?.botJawImg || botJaw?.querySelector?.('img.penguin-jaw-img') || null;
        if (topJaw) {
            topJaw.style.transform = 'none';
            topJaw.style.removeProperty('transform');
            topJaw.classList.add('game-over');
        }
        if (botJaw) {
            botJaw.style.transform = 'none';
            botJaw.style.removeProperty('transform');
            // Добавляем класс для CSS-позиционирования (по вертикали при game over)
            botJaw.classList.add('game-over');
        }
        if (topJawImg) topJawImg.src = 'img/top-jaw-2.svg';
        if (botJawImg) botJawImg.src = 'img/bot-jaw-2.svg';
        
        // Анимация вылета зубов при столкновении
        this.animateTeethFlyOut();
    }
    
    // Анимация вылета зубов (tooth-1 и tooth-2) из челюсти при game over
    animateTeethFlyOut() {
        const container = document.getElementById('game-area');
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        const parts = this.getPenguinParts();
        if (!parts?.root || !parts?.botJaw || !parts?.topJaw) return;
        
        const topJawRect = parts.topJaw.getBoundingClientRect();
        const botJawRect = parts.botJaw.getBoundingClientRect();
        
        // Первый зуб стартует от правого верхнего угла верхней челюсти
        const tooth1StartX = topJawRect.right - containerRect.left;
        const tooth1StartY = topJawRect.top - containerRect.top;
        
        // Второй зуб стартует от правого нижнего угла нижней челюсти
        const tooth2StartX = botJawRect.right - containerRect.left;
        const tooth2StartY = botJawRect.bottom - containerRect.top;
        
        // Создаём два зуба с индивидуальными стартовыми позициями
        const teeth = [
            { 
                src: 'img/tooth-1.svg', 
                startX: tooth1StartX, 
                startY: tooth1StartY,
                angle: -35, 
                distance: 120 
            }, // летит влево-вверх
            { 
                src: 'img/tooth-2.svg', 
                startX: tooth2StartX, 
                startY: tooth2StartY,
                angle: 25, 
                distance: 100 
            }  // летит вправо-вниз
        ];
        
        teeth.forEach((tooth, idx) => {
            const toothEl = document.createElement('img');
            toothEl.src = tooth.src;
            toothEl.alt = '';
            toothEl.draggable = false;
            toothEl.style.position = 'absolute';
            toothEl.style.left = `${tooth.startX}px`;
            toothEl.style.top = `${tooth.startY}px`;
            toothEl.style.width = '24px';
            toothEl.style.height = 'auto';
            toothEl.style.pointerEvents = 'none';
            toothEl.style.zIndex = '25'; // выше челюстей, ниже оверлеев
            toothEl.style.transformOrigin = '50% 50%';
            toothEl.style.opacity = '1';
            toothEl.style.transition = 'none';
            container.appendChild(toothEl);
            
            // Небольшая задержка для второго зуба (чтобы не одновременно)
            const delay = idx * 30;
            
            requestAnimationFrame(() => {
                window.setTimeout(() => {
                    const rad = (tooth.angle * Math.PI) / 180;
                    const endX = tooth.startX + Math.cos(rad) * tooth.distance;
                    const endY = tooth.startY + Math.sin(rad) * tooth.distance;
                    
                    toothEl.style.transition = 'transform 400ms cubic-bezier(0.4, 0.2, 0.3, 0.95), opacity 450ms ease-out';
                    toothEl.style.transform = `translate(${endX - tooth.startX}px, ${endY - tooth.startY}px) rotate(${tooth.angle * 1.5}deg) scale(0.6)`;
                    toothEl.style.opacity = '0';
                    
                    window.setTimeout(() => {
                        try { toothEl.remove(); } catch (e) { /* ignore */ }
                    }, 500);
                }, delay);
            });
        });
    }

    // Сброс изображений пингвина в нормальное состояние
    resetPenguinState() {
        const parts = this.getPenguinParts();
        if (parts?.root) {
            // Убираем возможное смещение конструкции головы после game over
            parts.root.style.transform = '';
            parts.root.classList.remove('mouth-open');
        }

        const head = document.getElementById('penguin-head');
        const topJaw = document.getElementById('penguin-top-jaw');
        const botJaw = document.getElementById('penguin-bot-jaw');
        
        if (head) {
            head.style.transform = 'none';
            head.style.removeProperty('transform');
            head.src = 'img/head-1.svg';
        }
        const topJawImg = parts?.topJawImg || topJaw?.querySelector?.('img.penguin-jaw-img') || null;
        const botJawImg = parts?.botJawImg || botJaw?.querySelector?.('img.penguin-jaw-img') || null;
        if (topJaw) {
            topJaw.style.transform = 'none';
            topJaw.style.removeProperty('transform');
            topJaw.classList.remove('game-over');
        }
        if (botJaw) {
            botJaw.style.transform = 'none';
            botJaw.style.removeProperty('transform');
            botJaw.classList.remove('game-over');
        }
        if (topJawImg) topJawImg.src = 'img/top-jaw-1.svg';
        if (botJawImg) botJawImg.src = 'img/bot-jaw-1.svg';

        this._mouthHeld = false;
        this._mouthHoldStartTimeMs = 0;
        this._mouthOpen = false;
    }

    // Полный сброс DOM-окна ленты (нужно при старте новой игры, чтобы current=0 центрировался сразу)
    resetStripWindow() {
        if (!this.numberStrip) return;
        this.stopStripAnimation();
        this.numberStrip.innerHTML = '';
        this.stripMinValue = 0;
        this.stripPitchPx = null;
        this.stripFirstCenterPx = null;
        this.lastCurrentValue = null;
        this.currentStripOffset = 0;
        this.numberStrip.style.transition = 'none';
        this.numberStrip.style.transform = `translateX(0px)`;
        this._deathTriggered = false;
        this._deathTriggeredForStart = null;
        
        // Сброс новой физической системы
        this._beltPosition = 0;
        this._lastBeltUpdateTime = 0;
        this._beltStartAdjusted = false;
        this._beltEatMultiplier = 1.0;
        this._foodsEatenForSpeed = 0;
        this._mouthHeld = false;
        this._mouthHoldStartTimeMs = 0;
        this._mouthOpen = false;
        try {
            const parts = this.getPenguinParts();
            parts?.root?.classList?.remove?.('mouth-open');
        } catch (e) {
            // ignore
        }
        this._lastAutoBiteTime = 0;
        
        // Переинициализация облаков
        this.setupClouds();
    }

    setupFocusZone() {
        // Вычисляем центр экрана
        const container = document.getElementById('game-area');
        // Кэшируем позицию рта в "спокойном" состоянии.
        // Даже если пингвин визуально двигается при укусе, лента должна ориентироваться на этот якорь.
        this._cachedMouthRightX = container ? this.getPenguinMouthRightX(container) : 0;
        // Центр привязки теперь — центр focus-zone (он может быть смещён влево через CSS)
        this.focusZoneCenter = this.getFocusAnchorX(container);
        // При ресайзе могут поменяться размеры кружков/маргины (responsive) — пересчитываем метрики
        this.recomputeStripMetrics();
    }

    // X-координата "якоря" (куда нужно выравнивать текущий шаг ленты).
    // По умолчанию это центр focus-zone; fallback — центр game-area.
    getFocusAnchorX(containerEl) {
        if (!containerEl) return 0;
        try {
            const containerRect = containerEl.getBoundingClientRect();

            // Хотим, чтобы в начале тика кружок был СНАРУЖИ пасти (касался рта),
            // а "въезжал" внутрь по мере прогресса.
            // Поэтому якорь = mouthRightX + radius(circle).
            const mouthRightX = (this._cachedMouthRightX > 0) ? this._cachedMouthRightX : this.getPenguinMouthRightX(containerEl);
            if (mouthRightX > 0) {
                const circleEl = this.numberStrip?.querySelector('.number-circle');
                const circleWidth = circleEl?.offsetWidth || 42;
                const circleRadius = circleWidth / 2;
                return mouthRightX + circleRadius;
            }

            const focusRect = this.focusZone?.getBoundingClientRect();
            if (focusRect) return (focusRect.left - containerRect.left) + (focusRect.width / 2);
        } catch (e) {
            // noop: fallback below
        }
        return containerEl.offsetWidth / 2;
    }

    // Проверка коллизии: левая граница ближайшей danger-точки коснулась правой границы головы.
    // Эмитим событие один раз на окно (по его start-значению).
    checkPenguinDangerCollision(director, current = null, isAuto = false) {
        // В conveyor/physics режиме смерть считается физикой (checkCollisionsAndAutoBite),
        // поэтому legacy-коллизию по danger windows отключаем полностью.
        if (this._conveyorEnabled) return;
        if (this._deathTriggered) return;
        const container = document.getElementById('game-area');
        if (!container || !this.focusZone || !this.numberStrip) return;

        const parts = this.getPenguinParts();
        if (!parts?.root) return;

        const containerRect = container.getBoundingClientRect();
        const penguinRect = parts.root.getBoundingClientRect();
        const jawTopRect = parts.topJaw?.getBoundingClientRect?.() || null;
        const jawBotRect = parts.botJaw?.getBoundingClientRect?.() || null;
        const biteX = this.getPenguinMouthRightX(container);

        // Находим ближайшую danger-точку (минимальный data-value среди .danger)
        const dangerEls = Array.from(this.numberStrip.querySelectorAll('.number-circle.danger'));
        if (dangerEls.length === 0) {
            // все равно обновим дебаг (только пингвин/линия укуса)
            this.updateDebugOverlay({
                containerRect,
                penguinRect,
                jawTopRect,
                jawBotRect,
                dangerRect: null,
                biteX,
                anchorX: this.getFocusAnchorX(container)
            });
            return;
        }

        let firstDangerEl = null;
        let firstDangerValue = Infinity;
        for (const el of dangerEls) {
            const v = parseInt(el.dataset.value);
            if (Number.isFinite(v) && v < firstDangerValue) {
                firstDangerValue = v;
                firstDangerEl = el;
            }
        }
        if (!firstDangerEl || !Number.isFinite(firstDangerValue)) return;

        const dangerRect = firstDangerEl.getBoundingClientRect();
        const dangerLeftX = dangerRect.left - containerRect.left;

        this.updateDebugOverlay({
            containerRect,
            penguinRect,
            jawTopRect,
            jawBotRect,
            dangerRect,
            biteX,
            anchorX: this.getFocusAnchorX(container)
        });

        // legacy (non-conveyor): раньше была логическая коллизия по danger-windows.
        // В новой механике смерть определяется физикой (checkCollisionsAndAutoBite).
        if (isAuto && director && typeof current === 'number' && Number.isFinite(current)) {
            const w = Array.isArray(director.dangerWindows)
                ? director.dangerWindows.find(win => current >= win.start && current < (win.start + win.length))
                : null;
            if (w && typeof w.start === 'number') {
                // один раз на окно
                this._deathTriggered = true;
                this._deathTriggeredForStart = w.start;
                eventBus.emit('PENGUIN_COLLISION', { reason: 'LEGACY_POSITION_COLLISION', current });
            }
        }
    }

    setupEventListeners() {
        // Обновление при изменении размера окна
        window.addEventListener('resize', () => {
            this.setupFocusZone();
        });
        
        // Подписка на события таймера (автоматический шаг)
        eventBus.on('TICK_STEP', (data) => {
            if (!data || !data.stepDuration || !data.timer) return;
            if (this._conveyorEnabled) return; // в conveyor-mode лента управляется из gameLoop через updateConveyor()

            // Director может не успеть добавиться в payload (Renderer подписан раньше Game).
            // Поэтому берем director из gameInstance, если нужно.
            const director = data.director || window.gameInstance?.director || null;

            this.handleStepChange({
                current: data.current,
                timer: data.timer,
                director,
                stepDurationSec: data.stepDuration,
                isAuto: true
            });
        });
        
        // SHIFT/перемотки больше нет: осталась только кнопка "проглотить" (openMouth).

        // Ускоряем ленту за каждую съеденную еду
        eventBus.on('FOOD_EATEN', () => {
            this._foodsEatenForSpeed = (this._foodsEatenForSpeed || 0) + 1;
            const g = Number.isFinite(this._beltEatGrowth) ? this._beltEatGrowth : 1.03;
            this._beltEatMultiplier = (Number.isFinite(this._beltEatMultiplier) ? this._beltEatMultiplier : 1) * g;
        });
        
        // Остановка анимаций при паузе
        eventBus.on('PAUSE', () => {
            this.stopCircleAnimation();
            this.stopStripAnimation();
        });
        
        // Возобновление анимации при резюме
        eventBus.on('RESUME', () => {
            // Анимация возобновится автоматически при следующем TICK_STEP
        });
    }

    // Новая физическая система: постоянное движение ленты
    updateConveyor(timer, director) {
        if (!this._conveyorEnabled) return;
        if (!this.numberStrip) return;

        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        
        // Инициализация времени
        if (this._lastBeltUpdateTime === 0) {
            this._lastBeltUpdateTime = nowMs;
            // Инициализируем окно ленты
            this.ensureStripWindowInitialized(0);
            this.recomputeStripMetrics();
            // Старт ленты: первый объект появляется примерно в центре экрана, а не у пасти.
            // Формула в текущей схеме: x(firstCenterOnScreen) = anchorX - beltPosition (при stripMinValue=0).
            // Значит beltPosition = anchorX - desiredX.
            try {
                const container = document.getElementById('game-area');
                if (container && this.stripPitchPx != null) {
                    const containerRect = container.getBoundingClientRect();
                    const anchorX = this.getFocusAnchorX(container);
                    const desiredX = containerRect.width * 0.5;
                    this._beltPosition = anchorX - desiredX; // может быть отрицательным
                    this._beltStartAdjusted = true;
                }
            } catch (e) {
                // ignore
            }
            return;
        }

        // Вычисляем дельту времени
        const deltaTime = nowMs - this._lastBeltUpdateTime;
        this._lastBeltUpdateTime = nowMs;

        // Автозакрытие рта при удержании > max
        if (this._mouthHeld && this._mouthHoldStartTimeMs) {
            const maxMs = Number.isFinite(this._mouthHoldMaxMs) ? this._mouthHoldMaxMs : 2000;
            if ((nowMs - this._mouthHoldStartTimeMs) >= maxMs) {
                this.endBiteHold();
            }
        }

        // Обновляем позицию ленты (постоянное движение)
        const speedMultiplier = (timer && typeof timer.getSpeedMultiplier === 'function')
            ? timer.getSpeedMultiplier()
            : 1;
        const eatMult = Number.isFinite(this._beltEatMultiplier) ? this._beltEatMultiplier : 1;
        const baseSpeed = this._beltSpeed * (Number.isFinite(speedMultiplier) ? speedMultiplier : 1) * eatMult;
        this._lastBaseSpeedPxPerMs = baseSpeed;
        this._beltPosition += (baseSpeed * deltaTime);

        // Пересчитываем метрики если нужно
        this.recomputeStripMetrics();
        if (this.stripPitchPx == null || this.stripFirstCenterPx == null) return;

        // Обновляем окно ленты на основе текущей позиции
        // Используем позицию в "шагах" для управления окном
        const currentValue = Math.max(0, Math.floor(this._beltPosition / this.stripPitchPx));
        this.ensureStripWindowInitialized(currentValue);
        this.maybeRecycleStripWindow(currentValue);
        this.updateStripClasses(currentValue, director);

        // Обновляем позицию ленты визуально
        const container = document.getElementById('game-area');
        if (!container) return;
        
        const anchorX = this.getFocusAnchorX(container);
        // Вычисляем смещение на основе текущей позиции ленты
        const centerX = this.stripFirstCenterPx + (this._beltPosition - (this.stripMinValue * this.stripPitchPx));
        const targetOffset = anchorX - centerX;
        this.numberStrip.style.transition = 'none';
        this.numberStrip.style.transform = `translateX(${targetOffset}px)`;
        this.currentStripOffset = targetOffset;

        // Debug overlay обновляется в checkCollisionsAndAutoBite, где мы знаем точно, какой объект в коллизии

        // Проверка коллизий
        this.checkCollisionsAndAutoBite(container, director, nowMs);
    }

    // Проверка коллизий и автоматических укусов
    checkCollisionsAndAutoBite(container, director, nowMs) {
        if (!this.numberStrip) return;
        if (this._deathTriggered) return; // Не проверяем коллизии после смерти

        const parts = this.getPenguinParts();
        if (!parts?.root) return;

        const containerRect = container.getBoundingClientRect();
        const penguinRect = parts.root.getBoundingClientRect();
        const jawTopRect = parts.topJaw?.getBoundingClientRect?.() || null;
        const jawBotRect = parts.botJaw?.getBoundingClientRect?.() || null;

        if (!jawTopRect || !jawBotRect) return;

        // Границы "рта" берем из реальных DOMRect (они учитывают rotate/transform).
        // jawRight лучше брать из правого края нижней челюсти (с учётом rotate).
        // Даже если AABB чуть меняется, для "проглочен внутрь" этого достаточно.
        const jawRight = (jawBotRect.right - containerRect.left) + (this.biteOffsetX || 0);
        const jawTop = Math.min(jawTopRect.top, jawBotRect.top) - containerRect.top;
        const jawBottom = Math.max(jawTopRect.bottom, jawBotRect.bottom) - containerRect.top;

        const rectsOverlap = (a, b) => {
            if (!a || !b) return false;
            return (a.left < b.right) && (a.right > b.left) && (a.top < b.bottom) && (a.bottom > b.top);
        };

        // Teeth colliders: реальные DOM-элементы в составе челюстей.
        // Они двигаются/вращаются вместе со спрайтом и с transition, поэтому не "уезжают".
        const teethTopRectPage = parts.topTeeth?.getBoundingClientRect?.() || null;
        const teethBotRectPage = parts.botTeeth?.getBoundingClientRect?.() || null;

        // Находим все видимые объекты на ленте
        const circles = Array.from(this.numberStrip.querySelectorAll('.number-circle:not(.passed)'));
        
        // Для debug: находим ближайший объект к челюсти (для визуализации)
        let nearestCircle = null;
        let nearestDistance = Infinity;
        let collidingCircle = null;

        for (const circle of circles) {
            // Пропускаем уже обработанные объекты
            if (circle.dataset.processed === 'true') continue;

            // В physics-режиме считаем коллизию по реальному boundingClientRect картинки
            // (img получает точные размеры через updateFoodContainerSize).
            const circleRect = circle.getBoundingClientRect();
            const imgEl = circle.querySelector('img.food-img');
            const imgRect = imgEl?.getBoundingClientRect?.() || null;

            const imgLeft = (imgRect ? imgRect.left : circleRect.left) - containerRect.left;
            const imgRight = (imgRect ? imgRect.right : circleRect.right) - containerRect.left;
            const imgTop = (imgRect ? imgRect.top : circleRect.top) - containerRect.top;
            const imgBottom = (imgRect ? imgRect.bottom : circleRect.bottom) - containerRect.top;

            const circleCenterX = (imgLeft + imgRight) / 2;

            // Вычисляем расстояние до линии челюсти для debug
            const distanceToJaw = Math.abs(circleCenterX - jawRight);
            if (distanceToJaw < nearestDistance) {
                nearestDistance = distanceToJaw;
                nearestCircle = circle;
            }

            const foodRectPage = imgRect || circleRect;

            // Условия для "поедания" (рот открыт и еда прошла внутрь пасти по X, оставаясь в вертикали рта)
            const overlapsMouthVert = (imgBottom >= jawTop) && (imgTop <= jawBottom);
            const fullyPastJawLine = overlapsMouthVert && (imgRight <= jawRight);
            const canEatNow = !!this._mouthOpen;

            // Game over: только если коллайдер еды пересёкся с коллайдером ЗУБОВ.
            const teethCollision =
                rectsOverlap(foodRectPage, teethTopRectPage) ||
                rectsOverlap(foodRectPage, teethBotRectPage);
            
            // В debug режиме: помечаем объекты, которые триггерят game over
            if (this.debug) {
                if (teethCollision) {
                    circle.classList.add('game-over-trigger');
                } else {
                    // Убираем класс если объект больше не триггерит game over
                    circle.classList.remove('game-over-trigger');
                }
            }

            if (teethCollision) {
                collidingCircle = circle;
                const value = parseInt(circle.dataset.value) || 0;

                // Обновляем debug overlay - показываем только объект в коллизии
                if (this.debug) {
                    const dangerRect = foodRectPage;
                    
                    this.updateDebugObjectBoxes(circle, containerRect);
                    this.updateDebugOverlay({
                        containerRect,
                        penguinRect: null, // Не показываем
                        jawTopRect,
                        jawBotRect,
                        teethTopRect: teethTopRectPage,
                        teethBotRect: teethBotRectPage,
                        dangerRect,
                        biteX: jawRight,
                        anchorX: null // Не показываем
                    });
                }

                // Проигрыш при физической коллизии зубов и еды.
                if (!this._deathTriggered) {
                    this._deathTriggered = true;
                    this.dbgLog('death', {
                        value,
                        mouthOpen: this._mouthOpen,
                        kind: 'TEETH_COLLISION'
                    }, 0);
                    if (typeof eventBus !== 'undefined' && eventBus?.emit) {
                        eventBus.emit('PENGUIN_COLLISION', {
                            reason: 'TEETH_COLLISION',
                            value
                        });
                    }
                }
                circle.dataset.processed = 'true';
                return;
            }

            // Успешное проглатывание: еда целиком прошла внутрь пасти, пока рот открыт.
            if (fullyPastJawLine && canEatNow) {
                const value = parseInt(circle.dataset.value) || 0;
                const mouthTargetX = jawRight - 20;
                const mouthTargetY = (jawTop + jawBottom) / 2;
                circle.dataset.processed = 'true';
                this.animateEatIntoMouth(circle, container, containerRect, mouthTargetX, mouthTargetY);
                this.dbgLog('eat', { value }, 120);
                if (typeof eventBus !== 'undefined' && eventBus?.emit) {
                    eventBus.emit('FOOD_EATEN', { value });
                }
                return;
            }
        }

        // Debug (без спама): показываем один объект стабильно (ближайший к челюсти),
        // и логируем только изменения состояния.
        if (this.debug) {
            const tracked = collidingCircle || nearestCircle;
            const trackedValue = tracked ? (parseInt(tracked.dataset.value) || null) : null;
            const trackedIsColliding = !!collidingCircle;

            if (trackedValue !== this._dbg.lastTrackedValue) {
                this.dbgLog('track', { value: trackedValue }, 200);
                this._dbg.lastTrackedValue = trackedValue;
                this._dbg.lastTrackedWasColliding = false;
            }

            if (trackedIsColliding !== this._dbg.lastTrackedWasColliding && trackedValue != null) {
                this.dbgLog('collide', {
                    value: trackedValue,
                    isColliding: trackedIsColliding,
                    jawRight,
                    mouthOpen: this._mouthOpen
                }, 120);
                this._dbg.lastTrackedWasColliding = trackedIsColliding;
            }

            // Рисуем бокс для tracked (яркий, если именно коллизия), иначе полупрозрачный
            this.updateDebugObjectBoxes(tracked, containerRect, trackedIsColliding);
            this.updateDebugOverlay({
                containerRect,
                penguinRect: null,
                jawTopRect,
                jawBotRect,
                teethTopRect: teethTopRectPage,
                teethBotRect: teethBotRectPage,
                dangerRect: null,
                biteX: jawRight,
                anchorX: null
            });
        }
    }

    // ===== Mouth hold (press & hold) =====
    // Press: opening animation 100ms (linear via CSS). While held, mouth stays open.
    // Release: closing animation 100ms (linear via CSS).
    // Auto close: after 2s max hold (handled in updateConveyor).
    setMouthHeld(held) {
        const parts = this.getPenguinParts();
        if (!parts?.root) return;

        const nextHeld = !!held;
        if (nextHeld === !!this._mouthHeld) return;

        this._mouthHeld = nextHeld;
        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

        if (nextHeld) {
            this._mouthHoldStartTimeMs = nowMs;
            this._mouthOpen = true;
            // stop any legacy bite animations and switch to held-open state
            parts.root.classList.remove('bite-small', 'bite-big');
            parts.root.classList.add('mouth-open');
        } else {
            this._mouthOpen = false;
            parts.root.classList.remove('mouth-open');
        }
    }

    startBiteHold() {
        this.setMouthHeld(true);
    }

    endBiteHold() {
        this.setMouthHeld(false);
    }

    // Legacy API: "tap to open" (kept for compatibility, but hold-input should call start/end).
    openMouth(durationMs = 500) {
        this.startBiteHold();
        const ms = Math.max(0, Math.min(this._mouthHoldMaxMs || 2000, Math.round(Number(durationMs) || 0)));
        if (ms > 0) {
            window.setTimeout(() => this.endBiteHold(), ms);
        }
    }
    
    setupFocusZoneAnimation() {
        // Получаем базовый размер индикатора из CSS (теперь это пингвин)
        const indicator = this.focusZone?.querySelector('#penguin-head') || this.focusZone?.querySelector('.focus-penguin');
        if (indicator) {
            const computedStyle = window.getComputedStyle(indicator);
            this.focusZoneBaseSize = parseInt(computedStyle.width) || 140;
        }
    }
    
    // Вычисление целевого смещения ленты для указанного current
    calculateTargetOffset(current) {
        if (!this.numberStrip) return 0;
        
        const container = document.getElementById('game-area');
        if (!container) return this.currentStripOffset;
        
        const anchorX = this.getFocusAnchorX(container);

        // Точный расчет через layout-координаты (НЕ зависит от translateX ленты)
        // offsetLeft/offsetWidth не учитывают transform: scale() на active-точке, что нам и нужно.
        const numberEl = this.numberStrip.querySelector(`[data-value="${current}"]`);
        if (numberEl) {
            const centerInStrip = numberEl.offsetLeft + numberEl.offsetWidth / 2;
            return anchorX - centerInStrip;
        }

        // Fallback (если элемента нет в DOM-окне)
        return this.currentStripOffset;
    }
    
    // ========== АНИМАЦИЯ КРУГА (независимая) ==========
    
    // Анимация только круга (расширение и уменьшение)
    animateCircle(stepDurationSec) {
        if (!this.focusZone) return;
        
        const indicator = this.focusZone.querySelector('#penguin-head') || this.focusZone.querySelector('.focus-penguin');
        if (!indicator) return;

        // Пока фиксируем индикатор статичным (позже добавим отдельную анимацию для пингвина)
        return;
        
        // Останавливаем предыдущую анимацию круга
        this.stopCircleAnimation();
        
        const expandDuration = stepDurationSec * 0.9; // 90% времени - увеличение
        const shrinkDuration = stepDurationSec * 0.1; // 10% времени - уменьшение
        
        const startTime = performance.now();
        const expandEndTime = startTime + expandDuration * 1000;
        const totalEndTime = startTime + stepDurationSec * 1000;
        
        const animate = (currentTime) => {
            const elapsed = (currentTime - startTime) / 1000;
            
            if (currentTime < expandEndTime) {
                // Фаза увеличения
                const progress = elapsed / expandDuration;
                const scale = 1 + (this.circleExpandScale - 1) * progress;
                indicator.style.transform = `scale(${scale})`;
                this.circleAnimationId = requestAnimationFrame(animate);
            } else if (currentTime < totalEndTime) {
                // Фаза уменьшения
                const shrinkProgress = (elapsed - expandDuration) / shrinkDuration;
                const scale = this.circleExpandScale - (this.circleExpandScale - 1) * shrinkProgress;
                indicator.style.transform = `scale(${scale})`;
                this.circleAnimationId = requestAnimationFrame(animate);
            } else {
                // Анимация завершена
                indicator.style.transform = 'scale(1)';
                this.circleAnimationId = null;
            }
        };
        
        this.circleAnimationId = requestAnimationFrame(animate);
    }
    
    // Остановка анимации круга
    stopCircleAnimation() {
        if (this.circleAnimationId) {
            cancelAnimationFrame(this.circleAnimationId);
            this.circleAnimationId = null;
        }
        const indicator = this.focusZone?.querySelector('#penguin-head') || this.focusZone?.querySelector('.focus-penguin');
        if (indicator) {
            indicator.style.transform = 'scale(1)';
        }
    }
    
    // ========== АНИМАЦИЯ ЛЕНТЫ (независимая) ==========
    
    // Анимация только ленты к целевому смещению
    // options:
    // - profile: 'linear' | 'bite_30_70_x2'  (30% normal + 70% bite where speed is 2x)
    animateStrip(durationSec, targetOffset, onComplete = null, options = null) {
        if (!this.numberStrip) return;
        
        // Останавливаем предыдущую анимацию ленты
        this.stopStripAnimation();
        
        const startOffset = this.currentStripOffset;
        const deltaOffset = targetOffset - startOffset;
        
        const startTime = performance.now();
        const endTime = startTime + durationSec * 1000;

        const profile = options?.profile || 'linear';
        // timeProgress: 0..1  -> distanceProgress: 0..1
        const easeProgress = (timeProgress) => {
            const p = Math.max(0, Math.min(1, Number(timeProgress)));
            if (profile !== 'bite_30_70_x2') return p;

            // Требование: тик делится на 30% "обычно" и 70% "укус",
            // при этом во время укуса скорость ленты в 2 раза выше.
            const tSlow = 0.30;
            const vSlow = 1.0;
            const vFast = 2.0;
            const denom = vSlow * tSlow + vFast * (1 - tSlow);

            if (p <= tSlow) {
                return (vSlow * p) / denom;
            }
            return (vSlow * tSlow + vFast * (p - tSlow)) / denom;
        };
        
        const animate = (currentTime) => {
            if (currentTime < endTime) {
                // currentTime в ms, durationSec в секундах
                const t = (currentTime - startTime) / (durationSec * 1000);
                const progress = easeProgress(t);
                const currentOffset = startOffset + deltaOffset * progress;
                
                this.numberStrip.style.transition = 'none';
                this.numberStrip.style.transform = `translateX(${currentOffset}px)`;
                this.currentStripOffset = currentOffset;
                
                this.stripAnimationId = requestAnimationFrame(animate);
            } else {
                // Анимация завершена
                this.numberStrip.style.transition = 'none';
                this.numberStrip.style.transform = `translateX(${targetOffset}px)`;
                this.currentStripOffset = targetOffset;
                this.stripAnimationId = null;
                if (typeof onComplete === 'function') onComplete();
            }
        };
        
        this.stripAnimationId = requestAnimationFrame(animate);
    }
    
    // Остановка анимации ленты
    stopStripAnimation() {
        if (this.stripAnimationId) {
            cancelAnimationFrame(this.stripAnimationId);
            this.stripAnimationId = null;
        }
    }
    
    // Пауза обновления ленты (сохраняем текущее время, чтобы не "догонять" при возобновлении)
    pauseBeltUpdate() {
        // Сохраняем текущее время обновления, чтобы при возобновлении скорректировать его
        // Это предотвратит "догоняние" пропущенного времени
        if (this._lastBeltUpdateTime > 0) {
            this._beltPauseStartTime = this._lastBeltUpdateTime;
        }
    }
    
    // Возобновление обновления ленты (корректируем время на длительность паузы)
    resumeBeltUpdate(pauseDurationMs) {
        if (this._beltPauseStartTime && pauseDurationMs > 0) {
            // Корректируем время обновления: добавляем длительность паузы,
            // чтобы следующая дельта времени была правильной
            this._lastBeltUpdateTime = this._beltPauseStartTime + pauseDurationMs;
            this._beltPauseStartTime = null;
        }
    }
    
    // ========== СИНХРОННАЯ АНИМАЦИЯ (при TICK_STEP) ==========

    // Единая обработка смены шага (auto или manual)
    // - Лента всегда реально двигается на pitch * deltaSteps (auto = весь тик, manual = быстро)
    // - После движения мы "пересобираем" окно значений вокруг current без визуального скачка (recycle + компенсация translate)
    // - Круг: только в auto, строго по stepDuration
    handleStepChange({ current, timer, director, stepDurationSec, isAuto }) {
        // Инициализация DOM окна
        this.ensureStripWindowInitialized(current);
        this.recomputeStripMetrics();

        if (this.stripPitchPx == null) return;

        // Первый вызов: просто центрируемся, без анимации
        if (this.lastCurrentValue == null) {
            this.lastCurrentValue = current;
            this.updateStripPosition(current, null);
            if (isAuto) this.animateCircleAuto(stepDurationSec);
            this.updateStripClasses(current, director);
            this.checkPenguinDangerCollision(director, current, isAuto);
            return;
        }

        const deltaSteps = current - this.lastCurrentValue;
        this.lastCurrentValue = current;

        // Если delta=0 — только обновим классы/опасности и (для авто) круг
        if (deltaSteps === 0) {
            this.updateStripClasses(current, director);
            if (isAuto) this.animateCircleAuto(stepDurationSec);
            this.checkPenguinDangerCollision(director, current, isAuto);
            return;
        }

        // ВАЖНО: если пришёл новый step-change во время движения ленты,
        // старая анимация будет отменена (animateStrip -> stopStripAnimation),
        // и её onComplete не выполнится. Поэтому перед новым движением
        // приводим DOM-окно/классы в консистентное состояние под новый current.
        this.maybeRecycleStripWindow(current);
        this.updateStripClasses(current, director);

        // Движение ленты к АБСОЛЮТНОМУ оффсету под current:
        // - auto: весь тик (конвейер без паузы)
        // - manual: короткий "рывок", чтобы сдвиг ощущался
        const moveDuration = isAuto ? stepDurationSec : Math.min(stepDurationSec * 0.35, 0.25);
        const targetOffset = this.calculateTargetOffset(current);

        // В новой механике НЕТ авто-укусов на каждом тике/шаге.
        // Укус проигрывается только при openMouth() (кнопка) и при успешном проглатывании в физике.

        this.animateStrip(
            moveDuration,
            targetOffset,
            () => {
            // Редко и незаметно двигаем DOM-окно, если current приближается к краю буфера
            this.maybeRecycleStripWindow(current);
            // ВАЖНО: после recycle появляются новые элементы → им нужно выставить классы normal/danger
            this.updateStripClasses(current, director);
            // Финальный "snap": гарантируем, что CURRENT STEP ровно в центре круга
            this.updateStripPosition(current, null);
            // ВАЖНО: коллизия/смерть должна срабатывать именно здесь — когда current "half-entered" (центр на mouthRightX)
            this.checkPenguinDangerCollision(director, current, isAuto);
            },
            isAuto ? { profile: 'bite_30_70_x2' } : null
        );

        if (isAuto) this.animateCircleAuto(stepDurationSec);
    }

    // Круговой цикл для авто-шага:
    // - shrink 10% (Smax -> 1)
    // - expand 90% (1 -> Smax)
    // НИКОГДА не трогает ленту.
    animateCircleAuto(stepDurationSec) {
        if (!this.focusZone) return;
        const indicator = this.focusZone.querySelector('#penguin-head') || this.focusZone.querySelector('.focus-penguin');
        if (!indicator) return;

        // Пока фиксируем индикатор статичным (позже добавим отдельную анимацию для пингвина)
        this.stopCircleAnimation();
        return;

        const shrinkDuration = stepDurationSec * 0.1;
        const expandDuration = stepDurationSec * 0.9;

        const startTime = performance.now();
        const shrinkEndTime = startTime + shrinkDuration * 1000;
        const endTime = startTime + stepDurationSec * 1000;

        // предполагаем, что к моменту авто-шага круг находится в расширенном состоянии
        indicator.style.transform = `scale(${this.circleExpandScale})`;

        const animate = (now) => {
            if (now < shrinkEndTime) {
                const p = (now - startTime) / (shrinkDuration * 1000); // 0..1
                const scale = this.circleExpandScale - (this.circleExpandScale - 1) * p;
                indicator.style.transform = `scale(${scale})`;
                this.circleAnimationId = requestAnimationFrame(animate);
                return;
            }

            if (now < endTime) {
                const p = (now - shrinkEndTime) / (expandDuration * 1000); // 0..1
                const scale = 1 + (this.circleExpandScale - 1) * p;
                indicator.style.transform = `scale(${scale})`;
                this.circleAnimationId = requestAnimationFrame(animate);
                return;
            }

            indicator.style.transform = `scale(${this.circleExpandScale})`;
            this.circleAnimationId = null;
        };

        this.circleAnimationId = requestAnimationFrame(animate);
    }
    

    // Рендер ленты чисел
    renderNumberStrip(timer, _unused) {
        if (!this.numberStrip) return;

        const current = timer.current;
        const range = 15; // количество чисел слева и справа от центра
        
        // Конвейерная лента: DOM окно фиксированной длины и обновляется через shiftStripWindow().
        // Здесь — только инициализация (если нужно) и обновление классов.
        this.ensureStripWindowInitialized(current);
        this.updateStripClasses(current, null);
    }

    ensureStripWindowInitialized(current) {
        const existingElements = Array.from(this.numberStrip.children);
        if (existingElements.length > 0) return;

        const half = this.stripHalfWindow ?? 30;
        const minValue = Math.max(0, current - half);
        const maxValue = minValue + half * 2;

            this.numberStrip.innerHTML = '';
            for (let i = minValue; i <= maxValue; i++) {
                const circleEl = document.createElement('div');
                circleEl.className = 'number-circle';
                circleEl.dataset.value = i;
                this.ensureFoodCircle(circleEl);
                this.applyDebugLabelToCircle(circleEl);
            this.numberStrip.appendChild(circleEl);
        }
        this.stripMinValue = minValue;
        this.recomputeStripMetrics();
    }

    // "Подкрутка" окна значений (recycle), чтобы current не упирался в край DOM-буфера.
    // Делается редко и должна быть визуально незаметной (элементы на краях уже вне поля зрения).
    maybeRecycleStripWindow(current) {
        if (!this.numberStrip || this.stripPitchPx == null) return;
        const count = this.numberStrip.children.length;
        if (count === 0) return;

        const min = this.stripMinValue ?? parseInt(this.numberStrip.firstElementChild.dataset.value);
        const max = min + count - 1;

        const margin = this.stripRecycleMargin ?? 10;
        const leftEdge = min + margin;
        const rightEdge = max - margin;

        // Если уже упёрлись в 0, влево не рециклим (иначе появляются отрицательные "шаги")
        if (min === 0 && current <= leftEdge) {
            return;
        }

        // Если current слишком близко к правому краю — сдвигаем окно вправо
        if (current > rightEdge) {
            const shift = current - (min + (count - 1) / 2);
            const steps = Math.max(0, Math.floor(shift));
            this.shiftStripWindowBy(steps);
            return;
        }

        // Если current слишком близко к левому краю — сдвигаем окно влево
        if (current < leftEdge) {
            const shift = (min + (count - 1) / 2) - current;
            const steps = Math.max(0, Math.floor(shift));
            this.shiftStripWindowBy(-steps);
        }
    }

    // Низкоуровневый recycle: сдвигает DOM окно на N шагов и компенсирует translate,
    // чтобы картинка на экране не "скакнула".
    shiftStripWindowBy(deltaSteps) {
        if (!this.numberStrip || deltaSteps === 0) return;
        const count = this.numberStrip.children.length;
        if (count === 0) return;

        let min = this.stripMinValue ?? parseInt(this.numberStrip.firstElementChild.dataset.value);
        let max = min + count - 1;

        // Нельзя уходить в отрицательные значения шагов
        const requestedSteps = Math.abs(deltaSteps);
        const steps = deltaSteps < 0 ? Math.min(requestedSteps, Math.max(0, min)) : requestedSteps;
        if (steps === 0) return;
        if (deltaSteps > 0) {
            for (let i = 0; i < steps; i++) {
                const first = this.numberStrip.firstElementChild;
                this.numberStrip.removeChild(first);
                const nextValue = max + 1;
                const newEl = document.createElement('div');
                newEl.className = 'number-circle';
                // По умолчанию делаем точку видимой, дальше updateStripClasses исправит danger/active.
                newEl.classList.add('normal');
                newEl.dataset.value = nextValue;
                this.ensureFoodCircle(newEl);
                this.applyDebugLabelToCircle(newEl);
                this.numberStrip.appendChild(newEl);
                min += 1;
                max += 1;
            }
            this.currentStripOffset += steps * this.stripPitchPx;
        } else {
            for (let i = 0; i < steps; i++) {
                const last = this.numberStrip.lastElementChild;
                this.numberStrip.removeChild(last);
                const prevValue = min - 1;
                if (prevValue < 0) {
                    // Дальше влево нельзя
                    break;
                }
                const newEl = document.createElement('div');
                newEl.className = 'number-circle';
                newEl.classList.add('normal');
                newEl.dataset.value = prevValue;
                this.ensureFoodCircle(newEl);
                this.applyDebugLabelToCircle(newEl);
                this.numberStrip.insertBefore(newEl, this.numberStrip.firstElementChild);
                min -= 1;
                max -= 1;
            }
            this.currentStripOffset -= steps * this.stripPitchPx;
        }

        this.stripMinValue = min;
        this.numberStrip.style.transition = 'none';
        this.numberStrip.style.transform = `translateX(${this.currentStripOffset}px)`;
    }

    updateStripClasses(current, _unused) {
        const existingElements = Array.from(this.numberStrip.children);
            existingElements.forEach(el => {
                const value = parseInt(el.dataset.value);

                // Пройденные шаги (позади текущего) — подсвечиваем зелёным
                const isPassed = el.classList.contains('passed') || value < current;
                if (isPassed) {
                    el.classList.add('passed');
                    // Фон "passed" должен доминировать, поэтому убираем базовые normal
                    el.classList.remove('normal');
                    el.classList.remove('danger');
                } else {
                    el.classList.remove('passed');
                    // Сбрасываем флаг обработки для новых объектов
                    el.dataset.processed = 'false';
                    el.classList.remove('danger');
                    el.classList.add('normal');
                }

            if (value === current) el.classList.add('active');
            else el.classList.remove('active');
        });
    }

    // Обновление позиции ленты (мгновенное, без анимации)
    // Используется только при инициализации, не останавливает анимации
    updateStripPosition(current, stepDuration = null) {
        if (!this.numberStrip) return;
        
        // Принудительно заставляем браузер пересчитать layout
        void this.numberStrip.offsetHeight;
        
        const targetOffset = this.calculateTargetOffset(current);
        this.currentStripOffset = targetOffset;
        
        // Мгновенное перемещение без анимации
        this.numberStrip.style.transition = 'none';
        this.numberStrip.style.transform = `translateX(${targetOffset}px)`;
    }

    // Пересчет метрик ленты для аналитического расчета оффсета
    recomputeStripMetrics() {
        if (!this.numberStrip) return;
        const first = this.numberStrip.querySelector('.number-circle');
        if (!first) return;

        // Используем реальную ширину контейнера (которая подстроилась под изображение)
        const rect = first.getBoundingClientRect();
        const width = rect.width || parseFloat(getComputedStyle(first).width) || 63;
        const style = window.getComputedStyle(first);
        const marginLeft = parseFloat(style.marginLeft) || 0;
        const marginRight = parseFloat(style.marginRight) || 0;

        // Pitch = ширина объекта + gap слева + gap справа
        // Gap формируется относительно границ объектов (одинаковый для всех)
        this.stripPitchPx = width + marginLeft + marginRight;
        this.stripFirstCenterPx = marginLeft + width / 2;
    }
    

    // legacy: isDangerNumber удалён (теперь нет danger-окон)

    // Рендер кнопок управления: одна кнопка "проглотить" (открыть рот)
    renderControlButtons(_unused) {
        if (!this.controlButtons) {
            return;
        }

        // Проверяем, есть ли уже статическая кнопка BITE в HTML
        const existingBiteBtn = document.getElementById('bite-btn');
        if (existingBiteBtn && existingBiteBtn.parentElement === this.controlButtons) {
            // Кнопка BITE уже есть в HTML, не создаем новую
            return;
        }

        // В новой механике на экране всегда 1 кнопка для открытия рта
        this.controlButtons.innerHTML = '';

        const btn = document.createElement('button');
        btn.className = 'control-btn';
        btn.type = 'button';
        btn.textContent = 'EAT';
        btn.title = 'Eat (Space)';
        btn.disabled = false;
        btn.classList.add('neutral');

        // Клик/тач - открывает рот
        const clickHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.gameInstance) window.gameInstance.userInteracted = true;
            eventBus.emit('MOUTH_BUTTON_CLICKED', {});
        };
        btn.addEventListener('click', clickHandler);
        btn.addEventListener('touchstart', clickHandler);

        this.controlButtons.appendChild(btn);
    }

    // Рендер перков
    renderPerks(perks) {
        if (!this.perksContainer) return;
        
        this.perksContainer.innerHTML = '';
        
        perks.forEach(perk => {
            const btn = document.createElement('button');
            btn.className = 'ui-btn perk-btn';
            btn.textContent = `${perk.uiSpec().icon} ${perk.uiSpec().label}`;
            btn.title = perk.description;
            
            if (!perk.charged) {
                btn.classList.add('disabled');
            } else {
                btn.classList.add('charged');
            }
            
            // Прогресс бар
            const progressBar = document.createElement('div');
            progressBar.className = 'perk-progress';
            progressBar.style.width = `${perk.progress * 100}%`;
            btn.appendChild(progressBar);
            
            // Обработчик клика
            if (perk.charged) {
                btn.addEventListener('click', () => {
                    eventBus.emit('PERK_ACTIVATED', { perkId: perk.id });
                });
            }
            
            this.perksContainer.appendChild(btn);
        });
    }

    // Обновление UI
    updateUI(state) {
        const scoreValueEl = document.getElementById('score-value');
        const bestScoreEl = document.getElementById('best-score');
        const bestRankEl = document.getElementById('best-rank');
        const bestHintEl = document.getElementById('best-hint');
        const streakFillEl = document.getElementById('streak-fill');
        const streakTextEl = document.getElementById('streak-text');
        const streakProgressEl = document.getElementById('streak-progress');
        const slowdownBtn = document.getElementById('slowdown-btn');
        const soundBtn = document.getElementById('sound-btn');

        // Единственный источник счёта — количество съеденных объектов (state.score).
        const score = Math.floor(state?.score ?? 0);
        const best = Math.floor(state?.bestScore ?? 0);
        const streak = Math.max(0, Math.min(50, Math.floor(state?.streakPoints ?? state?.dangerPassedStreak ?? 0)));
        const rank = typeof state?.leaderboardRank === 'number' ? state.leaderboardRank : null;

        if (scoreValueEl) scoreValueEl.textContent = score;
        if (bestScoreEl) bestScoreEl.textContent = best;
        if (bestRankEl) {
            bestRankEl.textContent = rank && rank > 0 ? `#${rank}` : '#—';
        }
        // Делает левый блок (cup) квадратом от высоты родителя
        if (bestHintEl) {
            const iconBox = bestHintEl.querySelector('.hud-chip-icon-large');
            if (iconBox) {
                const h = Math.round(iconBox.getBoundingClientRect().height || 0);
                if (h > 0) {
                    const px = `${h}px`;
                    // фиксируем ширину по высоте (квадрат)
                    iconBox.style.width = px;
                    iconBox.style.minWidth = px;
                    iconBox.style.maxWidth = px;
                    iconBox.style.flexBasis = px;
                }
            }
        }

        if (streakFillEl) {
            streakFillEl.style.width = `${(streak / 50) * 100}%`;
            const fillRadius = Math.min(streak, 8);
            streakFillEl.style.setProperty('--streak-fill-radius', `${fillRadius}px`);
        }
        if (streakTextEl) {
            streakTextEl.textContent = `${streak}/50`;
        }

        if (streakProgressEl) {
            const prev = this._lastStreak ?? 0;
            if (streak > prev) {
                streakProgressEl.classList.remove('streak-loss');
                streakProgressEl.classList.add('streak-hit');
                if (this._streakAnimTimeoutId) {
                    window.clearTimeout(this._streakAnimTimeoutId);
                }
                this._streakAnimTimeoutId = window.setTimeout(() => {
                    streakProgressEl.classList.remove('streak-hit');
                }, 220);
            } else if (streak < prev) {
                streakProgressEl.classList.remove('streak-hit');
                streakProgressEl.classList.add('streak-loss');
                if (this._streakAnimTimeoutId) {
                    window.clearTimeout(this._streakAnimTimeoutId);
                }
                this._streakAnimTimeoutId = window.setTimeout(() => {
                    streakProgressEl.classList.remove('streak-loss');
                }, 280);
            }
            this._lastStreak = streak;
        }

        // Slow down button state
        if (slowdownBtn) {
            const canUse = state?.gameStatus === 'RUNNING' && streak >= 10;
            slowdownBtn.disabled = !canUse;
            slowdownBtn.classList.toggle('ready', canUse);
        }

        // Sound icon state
        if (soundBtn) {
            const icon = soundBtn.querySelector('img');
            if (icon) {
                icon.src = state?.soundMuted ? 'img/ui/sound-off.svg' : 'img/ui/sound-on.svg';
            }
            soundBtn.classList.toggle('is-muted', !!state?.soundMuted);
        }
    }

    // Показ экрана паузы
    showPauseScreen() {
        const pauseScreen = document.getElementById('pause-screen');
        if (pauseScreen) {
            pauseScreen.classList.remove('hidden');
        }
    }

    // Скрытие экрана паузы
    hidePauseScreen() {
        const pauseScreen = document.getElementById('pause-screen');
        if (pauseScreen) {
            pauseScreen.classList.add('hidden');
        }
    }

    // ===== Leaderboard modal =====
    isLeaderboardModalOpen() {
        return !!(this.leaderboardModal && !this.leaderboardModal.classList.contains('hidden'));
    }

    showLeaderboardModal() {
        if (!this.leaderboardModal) return;
        this.leaderboardModal.classList.remove('hidden');
    }

    hideLeaderboardModal() {
        if (!this.leaderboardModal) return;
        this.leaderboardModal.classList.add('hidden');
    }

    _lbGetName(p) {
        return (
            p?.name ||
            p?.nickname ||
            p?.publicName ||
            p?.username ||
            p?.login ||
            p?.id ||
            'Player'
        );
    }

    _lbGetScore(p) {
        const v =
            (typeof p?.score === 'number' ? p.score : null) ??
            (typeof p?.data?.score === 'number' ? p.data.score : null) ??
            (typeof p?.fields?.score === 'number' ? p.fields.score : null) ??
            (typeof p?.player?.score === 'number' ? p.player.score : null) ??
            0;
        return Math.max(0, Math.floor(Number(v) || 0));
    }

    _lbGetRank(p, fallbackRank) {
        const r =
            (typeof p?.rank === 'number' ? p.rank : null) ??
            (typeof p?.place === 'number' ? p.place : null) ??
            (typeof p?.position === 'number' ? p.position : null) ??
            (typeof p?.rating === 'number' ? p.rating : null) ??
            fallbackRank;
        return Math.max(1, Math.floor(Number(r) || fallbackRank || 1));
    }

    _lbMakeRow({ rank, name, score, isMe = false }) {
        const row = document.createElement('div');
        row.className = `leaderboard-row${isMe ? ' leaderboard-row--me' : ''}`;
        row.setAttribute('role', 'row');

        const cRank = document.createElement('div');
        cRank.className = 'lb-col lb-col--rank';
        cRank.setAttribute('role', 'cell');
        cRank.textContent = String(rank);

        const cName = document.createElement('div');
        cName.className = 'lb-col lb-col--name';
        cName.setAttribute('role', 'cell');
        cName.textContent = String(name || '');

        const cScore = document.createElement('div');
        cScore.className = 'lb-col lb-col--score';
        cScore.setAttribute('role', 'cell');
        cScore.textContent = String(score);

        row.appendChild(cRank);
        row.appendChild(cName);
        row.appendChild(cScore);
        return row;
    }

    renderLeaderboardModal(data) {
        if (!this.leaderboardListEl || !this.leaderboardMeEl) return;

        const topPlayers = Array.isArray(data?.topPlayers) ? data.topPlayers : [];
        const me = data?.player || null;
        const error = data?.error || null;
        const overrideName = data?.playerName || null;
        const nameHintSeen = !!data?.nameHintSeen;

        this.leaderboardListEl.innerHTML = '';
        this.leaderboardMeEl.innerHTML = '';

        if (error) {
            const msg = document.createElement('div');
            msg.className = 'leaderboard-empty';
            msg.textContent = 'Leaderboard unavailable';
            this.leaderboardListEl.appendChild(msg);
        } else if (topPlayers.length === 0) {
            const msg = document.createElement('div');
            msg.className = 'leaderboard-empty';
            msg.textContent = 'No results yet';
            this.leaderboardListEl.appendChild(msg);
        } else {
            topPlayers.slice(0, 10).forEach((p, idx) => {
                const rank = this._lbGetRank(p, idx + 1);
                const name = this._lbGetName(p);
                const score = this._lbGetScore(p);
                this.leaderboardListEl.appendChild(this._lbMakeRow({ rank, name, score, isMe: false }));
            });
        }

        if (me) {
            const rank = this._lbGetRank(me, 0);
            const name = overrideName || this._lbGetName(me);
            const score = this._lbGetScore(me);
            this.leaderboardMeEl.appendChild(this._lbMakeRow({ rank, name, score, isMe: true }));
        } else {
            const msg = document.createElement('div');
            msg.className = 'leaderboard-empty';
            msg.textContent = 'Your position is not available yet';
            this.leaderboardMeEl.appendChild(msg);
        }

        // Текст подсказки про ник
        const hintEl = document.getElementById('leaderboard-name-hint');
        if (hintEl) {
            if (!nameHintSeen) {
                hintEl.textContent = 'We gave you a name. You can change it anytime.';
            } else if (overrideName) {
                hintEl.textContent = `Your name is ${overrideName}. You can change it anytime.`;
            } else {
                hintEl.textContent = 'You can change your name anytime.';
            }
        }
    }

    // Показ экрана Game Over
    showGameOverScreen(score, canContinue) {
        const gameOverScreen = document.getElementById('game-over-screen');
        const finalScoreEl = document.getElementById('final-score');
        const continueBtn = document.getElementById('continue-btn');
        
        if (gameOverScreen) {
            gameOverScreen.classList.remove('hidden');
        }
        if (finalScoreEl) {
            finalScoreEl.textContent = `Score: ${Math.floor(score)}`;
        }
        if (continueBtn) {
            continueBtn.disabled = !canContinue;
        }
    }

    // Скрытие экрана Game Over
    hideGameOverScreen() {
        const gameOverScreen = document.getElementById('game-over-screen');
        if (gameOverScreen) {
            gameOverScreen.classList.add('hidden');
        }
    }

    // Показ обратного отсчета
    async showCountdown() {
        const countdownOverlay = document.getElementById('countdown-overlay');
        const countdownText = document.getElementById('countdown-text');
        
        if (!countdownOverlay || !countdownText) return;
        
        countdownOverlay.classList.remove('hidden');
        
        for (let i = 3; i > 0; i--) {
            countdownText.textContent = i;
            countdownText.style.animation = 'none';
            setTimeout(() => {
                // 10x faster countdown (was 1s per tick)
                countdownText.style.animation = 'countdownPulse 0.1s ease-in-out';
            }, 10);
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        countdownText.textContent = 'GO!';
        await new Promise(resolve => setTimeout(resolve, 50));
        
        countdownOverlay.classList.add('hidden');
    }

    // Показ стартового экрана
    showStartScreen() {
        const startScreen = document.getElementById('start-screen');
        if (startScreen) {
            startScreen.classList.remove('hidden');
        }
    }

    // Скрытие стартового экрана
    hideStartScreen() {
        const startScreen = document.getElementById('start-screen');
        if (startScreen) {
            startScreen.classList.add('hidden');
        }
    }

    // Настройка облаков на фоне
    setupClouds() {
        const container = document.getElementById('clouds-container');
        if (!container) return;

        // Очищаем существующие облака
        container.innerHTML = '';

        // Размеры облаков
        const cloudSizes = [
            { name: 'xs', width: '60px', height: '30px', speed: 0.3 },
            { name: 's', width: '100px', height: '50px', speed: 0.2 },
            { name: 'm', width: '150px', height: '75px', speed: 0.15 }
        ];

        // Создаем несколько облаков
        const cloudCount = 8;
        for (let i = 0; i < cloudCount; i++) {
            const cloudSize = cloudSizes[Math.floor(Math.random() * cloudSizes.length)];
            const cloud = document.createElement('div');
            cloud.className = 'cloud';
            
            const img = document.createElement('img');
            img.src = `img/cloud-${cloudSize.name}.png`;
            img.alt = '';
            cloud.appendChild(img);
            
            // Случайная начальная позиция (выше середины экрана)
            const startY = Math.random() * 30 + 5; // 5-35% от верха
            const startX = Math.random() * 120 - 20; // -20% до 100% (чтобы начинались за экраном)
            
            cloud.style.width = cloudSize.width;
            cloud.style.height = cloudSize.height;
            cloud.style.left = `${startX}%`;
            cloud.style.top = `${startY}%`;
            cloud.dataset.speed = cloudSize.speed.toString();
            
            container.appendChild(cloud);
        }

        // Анимация облаков
        this.animateClouds();
    }

    // Анимация движения облаков
    animateClouds() {
        const container = document.getElementById('clouds-container');
        if (!container) return;

        const clouds = Array.from(container.querySelectorAll('.cloud'));
        if (clouds.length === 0) return;
        
        let lastTime = performance.now();
        
        const animate = (currentTime) => {
            const deltaTime = currentTime - lastTime;
            lastTime = currentTime;
            
            // Нормализуем скорость (пикселей в секунду)
            const baseSpeed = 20; // базовая скорость в px/s
            
            clouds.forEach(cloud => {
                const speedMultiplier = parseFloat(cloud.dataset.speed) || 0.2;
                const speed = (baseSpeed * speedMultiplier * deltaTime) / 1000; // px per frame
                
                // Получаем текущую позицию в пикселях
                const containerRect = container.getBoundingClientRect();
                const cloudRect = cloud.getBoundingClientRect();
                const currentLeft = cloudRect.left - containerRect.left;
                
                // Двигаем облако влево
                let newLeft = currentLeft - speed;
                
                // Если облако ушло за левый край, перемещаем его вправо
                if (newLeft + cloudRect.width < 0) {
                    newLeft = containerRect.width + 20; // Начинаем справа за экраном
                    // Меняем высоту для разнообразия
                    cloud.style.top = `${Math.random() * 30 + 5}%`;
                }
                
                cloud.style.left = `${newLeft}px`;
            });
            
            requestAnimationFrame(animate);
        };
        
        requestAnimationFrame(animate);
    }
}

