// Система рендеринга
class Renderer {
    constructor() {
        this.numberStrip = document.getElementById('number-strip');
        this.focusZone = document.getElementById('focus-zone');
        this.controlButtons = document.getElementById('control-buttons');
        this.perksContainer = document.getElementById('perks-container'); // legacy (может быть null)
        
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
        this._lastBiteAt = 0;
        
        this.setupFocusZone();
        this.setupEventListeners();
        this.setupFocusZoneAnimation();
        this.setupDebugOverlay();
    }

    // В debug-режиме показываем числа прямо на кружках, чтобы легче отлаживать "ленту"
    applyDebugLabelToCircle(circleEl) {
        if (!circleEl) return;
        if (this.debug) {
            circleEl.classList.add('debug-number');
            const v = circleEl.dataset?.value;
            circleEl.textContent = (v == null ? '' : String(v));
        } else {
            circleEl.classList.remove('debug-number');
            // Не трогаем текст, если не мы его ставили — но у нас сейчас кружки без контента.
            circleEl.textContent = '';
        }
    }

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

        this.debugEls = {
            overlay,
            penguinBox: ensure('debug-penguin-box', 'debug-box debug-penguin'),
            jawTopBox: ensure('debug-jaw-top-box', 'debug-box debug-jaw-top'),
            jawBotBox: ensure('debug-jaw-bot-box', 'debug-box debug-jaw-bot'),
            dangerBox: ensure('debug-danger-box', 'debug-box debug-danger'),
            biteLine: ensure('debug-bite-line', 'debug-line debug-bite'),
            anchorLine: ensure('debug-anchor-line', 'debug-line debug-anchor')
        };
    }

    updateDebugOverlay({ containerRect, penguinRect, jawTopRect, jawBotRect, dangerRect, biteX, anchorX }) {
        if (!this.debug || !this.debugEls) return;
        const { penguinBox, jawTopBox, jawBotBox, dangerBox, biteLine, anchorLine } = this.debugEls;

        const placeBox = (box, rect) => {
            if (!rect) {
                box.style.display = 'none';
                return;
            }
            box.style.display = 'block';
            box.style.left = `${rect.left - containerRect.left}px`;
            box.style.top = `${rect.top - containerRect.top}px`;
            box.style.width = `${rect.width}px`;
            box.style.height = `${rect.height}px`;
        };

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

        placeBox(penguinBox, penguinRect);
        placeBox(jawTopBox, jawTopRect);
        placeBox(jawBotBox, jawBotRect);
        placeBox(dangerBox, dangerRect);
        placeLine(biteLine, biteX);
        placeLine(anchorLine, anchorX);
    }

    getPenguinParts() {
        const root = this.focusZone?.querySelector('#penguin-root') || this.focusZone?.querySelector('.penguin');
        if (!root) return null;
        const head = root.querySelector('#penguin-head') || root.querySelector('.penguin-head');
        const topJaw = root.querySelector('#penguin-top-jaw') || root.querySelector('.penguin-jaw--top');
        const botJaw = root.querySelector('#penguin-bot-jaw') || root.querySelector('.penguin-jaw--bot');
        return { root, head, topJaw, botJaw };
    }

    // Правая граница "рта" = max(right) верхней/нижней челюсти. Fallback: правая граница контейнера пингвина.
    getPenguinMouthRightX(containerEl) {
        if (!containerEl) return 0;
        const containerRect = containerEl.getBoundingClientRect();
        const parts = this.getPenguinParts();
        if (!parts) return 0;

        const topRect = parts.topJaw?.getBoundingClientRect?.();
        const botRect = parts.botJaw?.getBoundingClientRect?.();
        const rootRect = parts.root?.getBoundingClientRect?.();

        let right = null;
        if (topRect) right = right == null ? topRect.right : Math.max(right, topRect.right);
        if (botRect) right = right == null ? botRect.right : Math.max(right, botRect.right);
        if (right == null && rootRect) right = rootRect.right;
        if (right == null) return 0;

        return (right - containerRect.left) + (this.biteOffsetX || 0);
    }

    triggerBite(kind = 'small', durationSec = null) {
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        const now = performance.now();
        // Don't block "big bite" (user action) with debounce from frequent small bites
        if (kind !== 'big') {
            if (now - (this._lastBiteAt || 0) < 70) return; // debounce
            this._lastBiteAt = now;
        }
        if (typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0) {
            parts.root.style.setProperty('--bite-ms', `${Math.round(durationSec * 1000)}ms`);
        } else {
            parts.root.style.removeProperty('--bite-ms');
        }
        const cls = kind === 'big' ? 'bite-big' : 'bite-small';
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
        const ms = msFromCss ?? (kind === 'big' ? 200 : 160);
        window.setTimeout(() => {
            parts.root?.classList?.remove(cls);
        }, ms);
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
    }

    setupFocusZone() {
        // Вычисляем центр экрана
        const container = document.getElementById('game-area');
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
            // Хотим, чтобы "активный" кружок был сразу СПРАВА от "рта" (правой границы челюстей):
            // anchorX = mouthRightX + radius(circle)
            const circleEl = this.numberStrip?.querySelector('.number-circle');
            const circleWidth = circleEl?.offsetWidth || 42;
            const circleRadius = circleWidth / 2;
            const mouthRightX = this.getPenguinMouthRightX(containerEl);
            if (mouthRightX > 0) return mouthRightX + circleRadius;

            const focusRect = this.focusZone?.getBoundingClientRect();
            if (focusRect) return (focusRect.left - containerRect.left) + (focusRect.width / 2);
        } catch (e) {
            // noop: fallback below
        }
        return containerEl.offsetWidth / 2;
    }

    // Проверка коллизии: левая граница ближайшей danger-точки коснулась правой границы головы.
    // Эмитим событие один раз на окно (по его start-значению).
    checkPenguinDangerCollision(director) {
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

        // NOTE:
        // Раньше здесь была DOM-коллизия (danger дошёл до линии укуса) и мы эмитили game over отсюда.
        // Сейчас game over считается логически в Game.onTickStep() через Director.dangerWindows,
        // чтобы поведение не зависело от прерванных анимаций/DOM-состояния.
    }

    setupEventListeners() {
        // Обновление при изменении размера окна
        window.addEventListener('resize', () => {
            this.setupFocusZone();
        });
        
        // Подписка на события таймера (автоматический шаг)
        eventBus.on('TICK_STEP', (data) => {
            if (!data || !data.stepDuration || !data.timer) return;

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
        
        // Подписка на события сдвига (принудительный шаг через кнопки)
        eventBus.on('SHIFT_USED', (data) => {
            if (data && typeof data.current === 'number' && data.timer) {
                // Круг НЕ останавливаем - он работает независимо!
                // Только анимируем ленту к новому current
                
                const director = window.gameInstance?.director || null;
                // Big bite should play on user-initiated shift
                this.triggerBite('big', data.timer.calculateStepDuration() * 0.3);
                this.handleStepChange({
                    current: data.current,
                    timer: data.timer,
                    director,
                    stepDurationSec: data.timer.calculateStepDuration(),
                    isAuto: false
                });
            }
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
    animateStrip(durationSec, targetOffset, onComplete = null) {
        if (!this.numberStrip) return;
        
        // Останавливаем предыдущую анимацию ленты
        this.stopStripAnimation();
        
        const startOffset = this.currentStripOffset;
        const deltaOffset = targetOffset - startOffset;
        
        const startTime = performance.now();
        const endTime = startTime + durationSec * 1000;
        
        const animate = (currentTime) => {
            if (currentTime < endTime) {
                // currentTime в ms, durationSec в секундах
                const progress = (currentTime - startTime) / (durationSec * 1000);
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
    
    // ========== СИНХРОННАЯ АНИМАЦИЯ (при TICK_STEP) ==========

    // Единая обработка смены шага (auto или manual)
    // - Лента всегда реально двигается на pitch * deltaSteps в 30% окна
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
            this.checkPenguinDangerCollision(director);
            // Пока: "кусаем" на каждом шаге, чтобы визуально проверить работу анимации
            if (isAuto) this.triggerBite('small');
            return;
        }

        const deltaSteps = current - this.lastCurrentValue;
        this.lastCurrentValue = current;

        // Если delta=0 — только обновим классы/опасности и (для авто) круг
        if (deltaSteps === 0) {
            this.updateStripClasses(current, director);
            if (isAuto) this.animateCircleAuto(stepDurationSec);
            this.checkPenguinDangerCollision(director);
            return;
        }

        // ВАЖНО: если пришёл новый step-change во время движения ленты,
        // старая анимация будет отменена (animateStrip -> stopStripAnimation),
        // и её onComplete не выполнится. Поэтому перед новым движением
        // приводим DOM-окно/классы в консистентное состояние под новый current.
        this.maybeRecycleStripWindow(current);
        this.updateStripClasses(current, director);

        // Движение ленты к АБСОЛЮТНОМУ оффсету под current за 30% времени шага
        const moveDuration = stepDurationSec * 0.3;
        const targetOffset = this.calculateTargetOffset(current);

        // Укус должен совпадать со СТАРТОМ перемотки (как и при ручном SHIFT_USED)
        if (isAuto) this.triggerBite('small', moveDuration);

        this.animateStrip(moveDuration, targetOffset, () => {
            // Редко и незаметно двигаем DOM-окно, если current приближается к краю буфера
            this.maybeRecycleStripWindow(current);
            // ВАЖНО: после recycle появляются новые элементы → им нужно выставить классы normal/danger
            this.updateStripClasses(current, director);
            // Финальный "snap": гарантируем, что CURRENT STEP ровно в центре круга
            this.updateStripPosition(current, null);
            this.checkPenguinDangerCollision(director);
        });

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
    renderNumberStrip(timer, dangerWindows) {
        if (!this.numberStrip) return;

        const current = timer.current;
        const range = 15; // количество чисел слева и справа от центра
        
        // Получаем все опасные окна (активные + пройденные)
        const allDangerWindows = dangerWindows.getAllDangerWindows ? 
            dangerWindows.getAllDangerWindows() : dangerWindows;
        
        // Конвейерная лента: DOM окно фиксированной длины и обновляется через shiftStripWindow().
        // Здесь — только инициализация (если нужно) и обновление классов.
        this.ensureStripWindowInitialized(current);
        this.updateStripClasses(current, allDangerWindows);
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

    updateStripClasses(current, allDangerWindows) {
        const existingElements = Array.from(this.numberStrip.children);
            existingElements.forEach(el => {
                const value = parseInt(el.dataset.value);

                // Пройденные шаги (позади текущего) — подсвечиваем зелёным
                const isPassed = value < current;
                if (isPassed) {
                    el.classList.add('passed');
                    // Фон "passed" должен доминировать, поэтому убираем базовые normal/danger
                    el.classList.remove('normal');
                    el.classList.remove('danger');
                } else {
                    el.classList.remove('passed');

                    const isDanger = this.isDangerNumber(value, allDangerWindows);
                    if (isDanger) {
                        el.classList.remove('normal');
                        el.classList.add('danger');
                    } else {
                        el.classList.remove('danger');
                        el.classList.add('normal');
                    }
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

        const style = window.getComputedStyle(first);
        const width = parseFloat(style.width) || 40;
        const marginLeft = parseFloat(style.marginLeft) || 0;
        const marginRight = parseFloat(style.marginRight) || 0;

        this.stripPitchPx = width + marginLeft + marginRight;
        this.stripFirstCenterPx = marginLeft + width / 2;
    }
    

    // Проверка, является ли число опасным
    isDangerNumber(value, dangerWindows) {
        // Нормализация: dangerWindows может быть Director, массивом или null
        const windows = (dangerWindows && typeof dangerWindows.getAllDangerWindows === 'function')
            ? dangerWindows.getAllDangerWindows()
            : (Array.isArray(dangerWindows) ? dangerWindows : []);

        for (const window of windows) {
            if (value >= window.start && value < window.start + window.length) {
                return true;
            }
        }
        return false;
    }

    // Рендер кнопок управления
    renderControlButtons(buttons) {
        if (!this.controlButtons || !buttons || buttons.length === 0) {
            return;
        }
        
        // Очищаем только если количество кнопок изменилось
        const existingButtons = this.controlButtons.querySelectorAll('.control-btn');
        if (existingButtons.length !== buttons.length) {
            this.controlButtons.innerHTML = '';
        }
        
        // Создаем или обновляем кнопки
        buttons.forEach((button, index) => {
            if (!button || button.delta === undefined) {
                return;
            }
            
            // Ищем существующую кнопку по delta
            let btn = Array.from(existingButtons).find(b => b.dataset.delta == button.delta);
            
            if (!btn) {
                // Создаем новую кнопку
                btn = document.createElement('button');
                btn.className = 'control-btn';
                btn.dataset.delta = button.delta;
                btn.type = 'button';
                this.controlButtons.appendChild(btn);
            }
            
            // Обновляем содержимое и состояние
            btn.textContent = button.label || (button.delta > 0 ? `+${button.delta}` : `${button.delta}`);
            
            // Удаляем все классы типов
            btn.classList.remove('solution', 'trap', 'neutral', 'inactive');
            
            // Добавляем классы по типу и активности
            if (button.active) {
                if (button.type === 'solution') {
                    btn.classList.add('solution');
                } else if (button.type === 'trap') {
                    btn.classList.add('trap');
                } else {
                    btn.classList.add('neutral');
                }
                btn.disabled = false;
            } else {
                btn.classList.add('inactive');
                btn.disabled = true;
            }
            
            // Удаляем старые обработчики
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            btn = newBtn;
            
            // Добавляем обработчик клика только для активных кнопок
            if (button.active) {
                const clickHandler = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Помечаем, что пользователь взаимодействовал (для аудио)
                    if (window.gameInstance) {
                        window.gameInstance.userInteracted = true;
                    }
                    eventBus.emit('BUTTON_CLICKED', { delta: button.delta });
                };
                
                btn.addEventListener('click', clickHandler);
                btn.addEventListener('touchstart', clickHandler);
            }
            
            // Горячие клавиши только для активных кнопок
            if (button.active && index < 4) {
                const key = (index + 1).toString();
                btn.title = `Hotkey: ${key}`;
            } else {
                btn.title = '';
            }
        });
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
        const streakFillEl = document.getElementById('streak-fill');
        const streakTextEl = document.getElementById('streak-text');
        const slowdownBtn = document.getElementById('slowdown-btn');
        const soundBtn = document.getElementById('sound-btn');

        const score = Math.floor(state?.timer?.maxReached ?? 0);
        const best = Math.floor(state?.bestScore ?? 0);
        const streak = Math.max(0, Math.min(50, Math.floor(state?.streakPoints ?? state?.dangerPassedStreak ?? 0)));

        if (scoreValueEl) scoreValueEl.textContent = score;
        if (bestScoreEl) bestScoreEl.textContent = best;

        if (streakFillEl) {
            streakFillEl.style.width = `${(streak / 50) * 100}%`;
        }
        if (streakTextEl) {
            streakTextEl.textContent = `${streak}/50`;
        }

        // Slow down button state
        if (slowdownBtn) {
            const canUse = state?.gameStatus === 'RUNNING' && streak >= 10;
            slowdownBtn.disabled = !canUse;
            slowdownBtn.classList.toggle('ready', canUse);
        }

        // Sound icon state
        if (soundBtn) {
            // Keep UI consistent with reference-style (no emoji)
            soundBtn.textContent = state?.soundMuted ? 'MUT' : 'SND';
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
}

