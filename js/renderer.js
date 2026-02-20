// Система рендеринга
class Renderer {
    constructor() {
        this.numberStrip = document.getElementById('number-strip');
        this.focusZone = document.getElementById('focus-zone');
        
        // Состояние анимаций (разделены для независимой работы)
        this.circleAnimationId = null; // ID анимации круга
        this.stripAnimationId = null;   // ID анимации ленты

        // Debug overlay
        this.debug = (() => {
            try {
                const qs = new URLSearchParams(window.location.search);
                return qs.has('debug') || qs.get('debug') === '1';
            } catch (e) {
                return false;
            }
        })();
        this.debugEls = null;
        // фиксируем "статический" якорь рта, чтобы лента не следовала за transform-анимацией укуса
        this._cachedMouthRightX = 0;
        
        this._mouthHoldMaxMs = 2000;
        
        // Набор "баз" для разнообразия еды на ленте (стабильный выбор по value).
        this.foodBases = ['f1', 'f2', 'f3', 'f4', 'f5'];

        this.stripConveyor = new StripConveyorSystem({
            numberStrip: this.numberStrip,
            getGameArea: () => document.getElementById('game-area'),
            getFocusAnchorX: (container) => this.getFocusAnchorX(container),
            ensureFoodCircle: (circleEl) => this.ensureFoodCircle(circleEl),
            applyDebugLabelToCircle: (circleEl) => this.applyDebugLabelToCircle(circleEl),
            checkCollisionsAndAutoBite: (container) => this.checkCollisionsAndAutoBite(container)
        });
        this.collisionEngine = new CollisionEngine({
            getNumberStrip: () => this.numberStrip,
            getPenguinParts: () => this.penguinRig.getPenguinParts(),
            isMouthOpen: () => this.penguinRig.isMouthOpen(),
            isMouthFullyClosed: () => this.penguinRig.isMouthFullyClosed(),
            triggerTeethHitFx: () => this.penguinRig.triggerTimingTeethHitFx(),
            isDebug: () => this.debug,
            getDebugState: () => this._dbg,
            animateEatIntoMouth: (circleEl, containerEl, containerRect, targetX, targetY) =>
                this.animateEatIntoMouth(circleEl, containerEl, containerRect, targetX, targetY),
            updateDebugObjectBoxes: (trackedCircle, containerRect, isColliding) =>
                this.updateDebugObjectBoxes(trackedCircle, containerRect, isColliding),
            updateDebugOverlay: (payload) => this.updateDebugOverlay(payload),
            dbgLog: (key, payload, minIntervalMs) => this.dbgLog(key, payload, minIntervalMs),
            emitEvent: (eventName, payload) => {
                if (typeof eventBus !== 'undefined' && eventBus?.emit) {
                    eventBus.emit(eventName, payload);
                }
            }
        });
        this.penguinRig = new PenguinRig({
            focusZone: this.focusZone,
            getGameArea: () => document.getElementById('game-area'),
            isDebugEnabled: () => !!this._dbg?.enabled,
            dbgLog: (key, payload, minIntervalMs) => this.dbgLog(key, payload, minIntervalMs)
        });
        this.ui = new RendererUI();
        this.cloudsBackground = new CloudsBackground({
            getContainer: () => document.getElementById('clouds-container')
        });
        // Совместимость с существующим кодом Game, который читает эти поля напрямую.
        this.leaderboardModal = this.ui.leaderboardModal;
        this.leaderboardListEl = this.ui.leaderboardListEl;
        this.leaderboardMeEl = this.ui.leaderboardMeEl;
        this.leaderboardCloseBtn = this.ui.leaderboardCloseBtn;
        
        this.setupFocusZone();
        this.setupEventListeners();
        // Важно: jaw-геометрию держим в CSS как стабильный "риг",
        // чтобы замена head SVG не ломала масштаб/позиции конструкции.
        this.setupDebugOverlay();
        this.setupClouds();

        // Ограниченные debug-логи (без спама каждый кадр)
        this._dbg = {
            enabled: this.debug,
            max: 40,
            count: 0,
            lastAtByKey: new Map(),
            lastTrackedValue: null,
            lastTrackedWasColliding: false
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

        // Клонируем картинку в root пингвина, чтобы она рисовалась
        // между головой (z=1) и челюстями (z=3).
        const penguinRoot = parts?.root || null;
        const penguinRootRect = penguinRoot?.getBoundingClientRect?.() || null;
        if (!penguinRoot || !penguinRootRect) return;

        const rootLeft = penguinRootRect.left - containerRect.left;
        const rootTop = penguinRootRect.top - containerRect.top;
        const localStartLeft = startLeft - rootLeft;
        const localStartTop = startTop - rootTop;

        const fx = document.createElement('img');
        fx.src = imgEl.currentSrc || imgEl.src;
        fx.alt = '';
        fx.draggable = false;
        fx.style.position = 'absolute';
        fx.style.left = `${localStartLeft}px`;
        fx.style.top = `${localStartTop}px`;
        fx.style.width = `${w}px`;
        fx.style.height = `${h}px`;
        fx.style.pointerEvents = 'none';
        fx.style.zIndex = '2'; // между головой (1) и челюстями (3)
        fx.style.willChange = 'transform, opacity, filter';
        fx.style.transformOrigin = '50% 50%';
        fx.style.transform = 'translate(0px, 0px) scale(1)';
        fx.style.opacity = '1';
        fx.style.filter = 'none';
        fx.style.transition = 'transform 260ms cubic-bezier(0.2, 0.75, 0.3, 0.95), opacity 260ms ease-in, filter 260ms ease-in';

        penguinRoot.appendChild(fx);

        // Прячем оригинал, но оставляем слот (важно для стабильного шага ленты)
        imgEl.style.opacity = '0';
        circleEl.classList.add('passed', 'consumed');

        requestAnimationFrame(() => {
            // Короткое "погружение" в рот с гарантированным движением влево:
            // предмет не должен застывать по X и не должен улетать вглубь головы.
            const jawRightX = jawBotRect.right - containerRect.left;
            const jawWidth = Math.max(1, jawRightX - jawLeftX);
            const mouthEntryX = Number.isFinite(targetX) ? targetX : (jawRightX - 20);
            const mouthEntryY = Number.isFinite(targetY)
                ? targetY
                : (((jawBotRect.top + jawBotRect.bottom) / 2) - containerRect.top);

            const desiredCx = mouthEntryX - Math.max(4, w * 0.08);
            const minDivePx = Math.max(10, Math.min(18, w * 0.30)); // минимум сдвига по X влево
            const maxDivePx = Math.max(minDivePx + 8, Math.min(jawWidth * 0.42, w * 0.70)); // максимум, чтобы не улетал глубоко
            // Диапазон допустимого finalCx: [startCx-maxDivePx, startCx-minDivePx]
            const maxLeftTarget = startCx - minDivePx;
            const minLeftTarget = startCx - maxDivePx;
            const finalCx = Math.max(minLeftTarget, Math.min(maxLeftTarget, desiredCx));

            const finalCy = startCy + ((mouthEntryY - startCy) * 0.55);
            const finalDx = finalCx - startCx;
            const finalDy = finalCy - startCy;

            fx.style.transform = `translate(${finalDx.toFixed(2)}px, ${finalDy.toFixed(2)}px) scale(0.42)`;
            fx.style.opacity = '0';
            fx.style.filter = 'blur(0.6px)';
        });

        window.setTimeout(() => {
            try { fx.remove(); } catch (e) { /* ignore */ }
        }, 320);
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

    getFoodSrcCandidates(base) {
        if (!base) return [];
        return [
            `img/${base}-s.png`,
            `img/${base}.png`,
            `img/food/${base}-s.png`,
            `img/food/${base}.png`,
            `img/${base}.webp`,
            `img/${base}.svg`
        ];
    }

    getFallbackFoodSvg(base) {
        const palette = {
            f1: ['#ffb347', '#ff8c42'],
            f2: ['#7dd56f', '#34a853'],
            f3: ['#8ec5ff', '#4d8dff'],
            f4: ['#ffd36e', '#ffb020'],
            f5: ['#caa6ff', '#8e66ff']
        };
        const [c1, c2] = palette[base] || palette.f1;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><defs><radialGradient id="g" cx="35%" cy="30%" r="70%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></radialGradient></defs><circle cx="80" cy="80" r="62" fill="url(#g)"/><circle cx="58" cy="58" r="12" fill="rgba(255,255,255,0.35)"/></svg>`;
        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    getItemTypeForValue(value) {
        // Во время Coin Rush все объекты превращаются в монеты.
        if (window.gameInstance?.isCoinRushActive?.()) return 'coin';
        // В обычном режиме редкие монетки в потоке.
        const v = Math.max(0, Number(value) || 0);
        return (v % 7 === 0) ? 'coin' : 'food';
    }

    getItemSrc(itemType, base) {
        if (itemType === 'coin') return 'img/ui/coin.svg';
        return this.getFoodSrc(base);
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
            img.addEventListener('error', () => {
                const itemType = circleEl?.dataset?.itemType || 'food';
                if (itemType !== 'food') return;
                const base = circleEl?.dataset?.foodBase || 'f1';
                const candidates = this.getFoodSrcCandidates(base);
                const idx = Math.max(0, Number(circleEl.dataset.foodSrcIdx || 0));
                const nextIdx = idx + 1;
                if (nextIdx < candidates.length) {
                    circleEl.dataset.foodSrcIdx = String(nextIdx);
                    img.src = candidates[nextIdx];
                    return;
                }
                img.src = this.getFallbackFoodSvg(base);
            });
            circleEl.appendChild(img);
        }

        const value = parseInt(circleEl.dataset.value);
        const base = circleEl.dataset.foodBase || this.getFoodBaseForValue(value) || 'f1';
        const itemType = this.getItemTypeForValue(value);
        circleEl.dataset.foodBase = base;
        circleEl.dataset.itemType = itemType;
        if (itemType === 'food') {
            circleEl.dataset.foodSrcIdx = '0';
            const candidates = this.getFoodSrcCandidates(base);
            img.src = candidates[0] || this.getFallbackFoodSvg(base);
        } else {
            img.src = this.getItemSrc(itemType, base);
        }
        
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
        const isCoin = circleEl?.dataset?.itemType === 'coin';
        const baselineSmallHeight = isCoin ? 64 : 161.5;
        // Глобальный масштаб подгоняет всё под circle-size; дополнительный
        // коэффициент 0.5 уменьшает ВСЕ объекты на ленте в 2 раза.
        const globalScale = (baseUnit / baselineSmallHeight) * (isCoin ? 0.72 : 0.5);

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

        const ensurePoly = (id, { fill, stroke } = {}) => {
            let p = svg.querySelector(`#${id}`);
            if (!p) {
                p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                p.setAttribute('id', id);
                p.setAttribute('fill', fill || 'rgba(255,0,0,0.10)');
                p.setAttribute('stroke', stroke || 'rgba(255,0,0,0.95)');
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
            teethTopPolyEl: ensurePoly('debug-teeth-top-poly', { fill: 'rgba(255,0,0,0.10)', stroke: 'rgba(255,0,0,0.95)' }),
            teethBotPolyEl: ensurePoly('debug-teeth-bot-poly', { fill: 'rgba(255,165,0,0.10)', stroke: 'rgba(255,165,0,0.95)' }),
            rightColliderPolyEl: ensurePoly('debug-right-collider-poly', { fill: 'rgba(0,120,255,0.10)', stroke: 'rgba(0,120,255,0.95)' }),
            jawTopBox: ensure('debug-jaw-top-box', 'debug-box debug-jaw-top'),
            dangerBox: ensure('debug-danger-box', 'debug-box debug-danger'),
            biteLine: ensure('debug-bite-line', 'debug-line debug-bite'),
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

    updateDebugOverlay({ containerRect, jawTopRect, jawBotRect, teethTopPoly, teethBotPoly, rightColliderPoly, dangerRect, biteX }) {
        if (!this.debug || !this.debugEls) return;
        const { jawTopBox, dangerBox, biteLine, jawBottomLine, svg, teethTopPolyEl, teethBotPolyEl, rightColliderPolyEl } = this.debugEls;

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
        if (jawBottomLine) jawBottomLine.style.display = 'none';
        
        // 1) Верхняя челюсть
        placeBox(jawTopBox, jawTopRect);
        
        // 2. Объект в коллизии (если есть)
        placeBox(dangerBox, dangerRect);
        
        // 3. Линия укуса (legacy) — скрываем, т.к. используем right-collider полигон.
        placeLine(biteLine, biteX);
        if (biteLine) biteLine.style.display = 'none';

        // 4. Горизонтальная линия по нижней границе нижней челюсти
        if (jawBotRect && jawBottomLine) {
            const bottomY = (jawBotRect.bottom !== undefined ? jawBotRect.bottom : (jawBotRect.y || 0) + (jawBotRect.height || 0)) - containerRect.top;
            placeHLine(jawBottomLine, bottomY);
        }

        // 5. Повернутые полигоны зубов
        const setPoly = (polyEl, pts) => {
            if (!polyEl) return;
            if (!Array.isArray(pts) || pts.length < 3) {
                polyEl.setAttribute('points', '');
                polyEl.style.display = 'none';
                return;
            }
            polyEl.style.display = 'block';
            const pointsAttr = pts
                .map(p => `${(p.x - containerRect.left).toFixed(2)},${(p.y - containerRect.top).toFixed(2)}`)
                .join(' ');
            polyEl.setAttribute('points', pointsAttr);
        };

        if (svg) {
            svg.setAttribute('width', String(containerRect.width));
            svg.setAttribute('height', String(containerRect.height));
            svg.setAttribute('viewBox', `0 0 ${containerRect.width} ${containerRect.height}`);
        }
        setPoly(teethTopPolyEl, teethTopPoly);
        setPoly(teethBotPolyEl, teethBotPoly);
        setPoly(rightColliderPolyEl, rightColliderPoly);
    }

    getPenguinParts() {
        return this.penguinRig.getPenguinParts();
    }

    // Полностью остановить любые анимации укуса (используется при смерти: нужно "заморозить" момент контакта).
    stopAllBites() {
        this.penguinRig.stopAllBites();
    }

    // Переключение изображений пингвина при проигрыше
    setPenguinGameOverState() {
        this.penguinRig.setPenguinGameOverState();
    }

    // Сброс изображений пингвина в нормальное состояние
    resetPenguinState() {
        this.penguinRig.resetPenguinState();
    }

    // Полный сброс DOM-окна ленты (нужно при старте новой игры, чтобы current=0 центрировался сразу)
    resetStripWindow() {
        if (!this.numberStrip) return;
        this.stopStripAnimation();
        this.stripConveyor.resetWindow();
        this.collisionEngine.reset();
        try {
            this.penguinRig.stopAllBites();
        } catch (e) {
            // ignore
        }
        
        // Переинициализация облаков
        this.setupClouds();
    }

    setupFocusZone() {
        // Вычисляем центр экрана
        const container = document.getElementById('game-area');
        // Кэшируем позицию рта в "спокойном" состоянии.
        // Даже если пингвин визуально двигается при укусе, лента должна ориентироваться на этот якорь.
        this._cachedMouthRightX = container ? this.penguinRig.getPenguinMouthRightX(container) : 0;
        // При ресайзе могут поменяться размеры кружков/маргины (responsive) — пересчитываем метрики
        this.stripConveyor.recomputeStripMetrics();
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
            const mouthRightX = (this._cachedMouthRightX > 0) ? this._cachedMouthRightX : this.penguinRig.getPenguinMouthRightX(containerEl);
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

    setupEventListeners() {
        // Обновление при изменении размера окна
        window.addEventListener('resize', () => {
            this.setupFocusZone();
        });

        // Ускоряем ленту за каждую съеденную еду
        eventBus.on('FOOD_EATEN', () => {
            this.stripConveyor.onFoodEaten();
        });
        
        // Остановка анимаций при паузе
        eventBus.on('PAUSE', () => {
            this.stopCircleAnimation();
            this.stopStripAnimation();
        });
    }

    // Основной апдейт ленты и коллизий.
    updateConveyor(timer) {
        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

        // Автозакрытие рта при удержании > max
        if (this.penguinRig.isMouthHeld() && this.penguinRig.getMouthHoldStartTimeMs()) {
            const maxMs = Number.isFinite(this._mouthHoldMaxMs) ? this._mouthHoldMaxMs : 2000;
            if ((nowMs - this.penguinRig.getMouthHoldStartTimeMs()) >= maxMs) {
                this.endBiteHold();
            }
        }
        this.stripConveyor.update(timer);
    }

    // Проверка коллизий с зубами и проглатывания.
    checkCollisionsAndAutoBite(container) {
        this.collisionEngine.check(container);
    }

    startBiteHold() {
        this.penguinRig.startBiteHold();
    }

    endBiteHold() {
        this.penguinRig.endBiteHold();
    }

    // ========== АНИМАЦИЯ КРУГА (независимая) ==========
    
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
    
    // Остановка анимации ленты
    stopStripAnimation() {
        if (this.stripAnimationId) {
            cancelAnimationFrame(this.stripAnimationId);
            this.stripAnimationId = null;
        }
    }
    
    // Пауза обновления ленты (сохраняем текущее время, чтобы не "догонять" при возобновлении)
    pauseBeltUpdate() {
        this.stripConveyor.pause();
    }
    
    // Возобновление обновления ленты (корректируем время на длительность паузы)
    resumeBeltUpdate(pauseDurationMs) {
        this.stripConveyor.resume(pauseDurationMs);
    }
    

    // Рендер ленты чисел
    renderNumberStrip(timer) {
        this.stripConveyor.renderNumberStrip(timer);
    }

    refreshVisibleItemTypes() {
        const circles = this.numberStrip?.querySelectorAll?.('.number-circle');
        if (!circles || circles.length === 0) return;
        circles.forEach((circle) => this.ensureFoodCircle(circle));
    }
    
    // Обновление UI
    updateUI(state) {
        this.ui.updateUI(state);
    }

    // Показ экрана паузы
    showPauseScreen() {
        this.ui.showPauseScreen();
    }

    // Скрытие экрана паузы
    hidePauseScreen() {
        this.ui.hidePauseScreen();
    }

    // ===== Leaderboard modal =====
    isLeaderboardModalOpen() {
        return this.ui.isLeaderboardModalOpen();
    }

    showLeaderboardModal() {
        this.ui.showLeaderboardModal();
    }

    hideLeaderboardModal() {
        this.ui.hideLeaderboardModal();
    }

    renderLeaderboardModal(data) {
        this.ui.renderLeaderboardModal(data);
    }

    // Показ экрана Game Over
    showGameOverScreen(score, bestScore = 0, coins = 0) {
        this.ui.showGameOverScreen(score, bestScore, coins);
    }

    // Скрытие экрана Game Over
    hideGameOverScreen() {
        this.ui.hideGameOverScreen();
    }

    // Показ обратного отсчета
    async showCountdown() {
        await this.ui.showCountdown();
    }

    // Показ стартового экрана
    showStartScreen(state) {
        this.ui.showStartScreen();
        if (state) this.ui.updateStartGameScreen(state);
    }

    // Скрытие стартового экрана
    hideStartScreen() {
        this.ui.hideStartScreen();
    }

    // Настройка облаков на фоне
    setupClouds() {
        this.cloudsBackground.setupClouds();
    }
}

