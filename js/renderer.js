// Система рендеринга
class Renderer {
    constructor() {
        this.numberStrip = document.getElementById('number-strip');
        this.focusZone = document.getElementById('focus-zone');
        this.mobilePerfMode = this.detectMobilePerfMode();
        if (this.mobilePerfMode) {
            document.documentElement.classList.add('mobile-perf');
        } else {
            document.documentElement.classList.remove('mobile-perf');
        }
        
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
        this._floatingBonusPool = [];
        this._eatFxPool = [];
        
        this._mouthHoldMaxMs = 2000;
        
        // Набор "баз" для еды на ленте (используем только реальные ассеты из img/food).
        this.foodBases = ['f1', 'f2', 'f3'];
        // Кэш данных коллайдера из масок SVG (viewBox + path d).
        this._foodColliderCache = {};
        // In-flight fetch cache: убирает дубликаты тяжелых запросов к одним и тем же SVG.
        this._foodColliderPromiseCache = {};
        // Кэш реальных размеров ассетов (naturalWidth/Height), чтобы не было скачков размера при загрузке.
        this._foodAssetSizeCache = Object.create(null);
        // Стабильная (не зависящая от transform-анимации укуса) высота "головы" для масштаба еды.
        this._cachedHeadHeightPx = null;
        this._relayoutRafId = 0;

        this.stripConveyor = new StripConveyorSystem({
            numberStrip: this.numberStrip,
            perfMode: this.mobilePerfMode,
            getGameArea: () => document.getElementById('game-area'),
            getFocusAnchorX: (container) => this.getFocusAnchorX(container),
            ensureFoodCircle: (circleEl) => this.ensureFoodCircle(circleEl),
            applyDebugLabelToCircle: (circleEl) => this.applyDebugLabelToCircle(circleEl),
            checkCollisionsAndAutoBite: (container) => this.checkCollisionsAndAutoBite(container)
        });
        this.collisionEngine = new CollisionEngine({
            perfMode: this.mobilePerfMode,
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
            updateStripMask: (pathD) => this.updateStripMask(pathD),
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
            perfMode: this.mobilePerfMode,
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
        this.preloadFoodAssets();

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

    detectMobilePerfMode() {
        try {
            const qs = new URLSearchParams(window.location.search || '');
            const forced = qs.get('perf');
            if (forced === '0' || forced === 'off' || forced === 'false') return false;
            if (forced === '1' || forced === 'on' || forced === 'true') return true;
        } catch (e) {
            // ignore
        }

        const coarse = typeof window.matchMedia === 'function'
            && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
        const smallViewport = Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 480;
        const lowCpu = Number.isFinite(navigator.hardwareConcurrency) && navigator.hardwareConcurrency <= 6;
        const lowMem = Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory <= 6;
        const saveData = !!navigator?.connection?.saveData;
        return !!(coarse || smallViewport || lowCpu || lowMem || saveData);
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

        const fx = this.acquireEatFxEl();
        const fxToken = (fx._poolToken || 0) + 1;
        fx._poolToken = fxToken;
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

            // Убираем уменьшение объекта при «погружении» в рот: оставляем масштаб 1
            fx.style.transform = `translate(${finalDx.toFixed(2)}px, ${finalDy.toFixed(2)}px) scale(1)`;
            fx.style.opacity = '0';
            fx.style.filter = 'blur(0.6px)';
        });

        window.setTimeout(() => {
            if (fx._poolToken !== fxToken) return;
            this.releaseEatFxEl(fx);
        }, 320);
    }

    acquireEatFxEl() {
        const fx = this._eatFxPool.pop() || document.createElement('img');
        fx.className = '';
        fx.style.position = 'absolute';
        fx.style.pointerEvents = 'none';
        fx.style.zIndex = '2';
        fx.style.willChange = 'transform, opacity, filter';
        fx.style.transformOrigin = '50% 50%';
        fx.style.transition = 'transform 260ms cubic-bezier(0.2, 0.75, 0.3, 0.95), opacity 260ms ease-in, filter 260ms ease-in';
        return fx;
    }

    releaseEatFxEl(fx) {
        if (!fx) return;
        try { fx.remove(); } catch (e) { /* ignore */ }
        fx.style.transform = 'translate(0px, 0px) scale(1)';
        fx.style.opacity = '1';
        fx.style.filter = 'none';
        if (this._eatFxPool.length < 24) {
            this._eatFxPool.push(fx);
        }
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

    getRandomFoodBase() {
        const bases = this.foodBases || [];
        if (bases.length === 0) return null;
        const idx = Math.floor(Math.random() * bases.length);
        return bases[idx] || bases[0];
    }

    getFoodSrc(base) {
        if (!base) return '';
        if (base === 'ice') return 'img/food/ice.svg';
        if (base === 'coin') return 'img/food/coin.svg';
        return `img/food/${base}-s.svg`;
    }

    getFoodSrcCandidates(base) {
        if (!base) return [];
        if (base === 'ice') return ['img/food/ice.svg'];
        if (base === 'coin') return ['img/food/coin.svg'];
        return [
            `img/food/${base}-s.svg`
        ];
    }

    /** Загружает из img/food/{base}-s.svg маску и возвращает { viewBox, pathD }. Результат кэшируется. */
    async fetchFoodColliderData(base) {
        if (this._foodColliderCache[base]) return this._foodColliderCache[base];
        if (this._foodColliderPromiseCache[base]) return this._foodColliderPromiseCache[base];

        this._foodColliderPromiseCache[base] = (async () => {
            try {
                const url = this.getFoodSrc(base);
                const res = await fetch(url);
                if (!res.ok) throw new Error(`Failed to fetch collider source: ${res.status}`);
                const text = await res.text();
                const viewBoxMatch = text.match(/viewBox="([^"]+)"/);
                // Новый протокол: используем только новый формат ассетов.
                // 1) Если есть <path data-collider="true"> или id="collider" — берём его.
                // 2) Иначе берём *последний* <path> в SVG как нижний слой-коллайдер.
                const colliderAttr =
                    text.match(/<path[^>]*\bdata-collider="true"[^>]*\bd="([^"]+)"/i)
                    || text.match(/<path[^>]*\bid="collider"[^>]*\bd="([^"]+)"/i);
                let lastRootPath = null;
                const allRootPaths = [...text.matchAll(/<path\s[^>]*\bd="([^"]+)"[^>]*>/g)];
                if (allRootPaths.length > 0) {
                    lastRootPath = allRootPaths[allRootPaths.length - 1][1];
                }
                const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 200 200';
                const pathD = (colliderAttr ? colliderAttr[1] : null) || lastRootPath;
                const data = { viewBox, pathD };
                this._foodColliderCache[base] = data;
                return data;
            } catch (e) {
                const fallback = { viewBox: '0 0 200 200', pathD: null };
                this._foodColliderCache[base] = fallback;
                return fallback;
            } finally {
                delete this._foodColliderPromiseCache[base];
            }
        })();

        return this._foodColliderPromiseCache[base];
    }

    /** Добавляет в круг коллайдер-SVG по маске из img/food/{base}-s.svg (асинхронно). */
    ensureFoodCollider(circleEl, base) {
        if (!circleEl || !base) return;
        if (circleEl._foodColliderPath?.isConnected) return;
        const existingPath = circleEl.querySelector('.food-collider path');
        if (existingPath) {
            circleEl._foodColliderPath = existingPath;
            return;
        }
        this.fetchFoodColliderData(base).then((data) => {
            if (!data.pathD || !circleEl.isConnected) return;
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'food-collider');
            svg.setAttribute('viewBox', data.viewBox);
            svg.setAttribute('aria-hidden', 'true');
            svg.style.position = 'absolute';
            // Коллайдер строго совпадает с контейнером еды.
            svg.style.left = '0';
            svg.style.top = '0';
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.transform = 'none';
            svg.style.pointerEvents = 'none';
            svg.style.overflow = 'visible';
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', data.pathD);
            path.setAttribute('fill', 'none');
            svg.appendChild(path);
            circleEl.appendChild(svg);
            circleEl._foodColliderPath = path;
        });
    }

    getItemTypeForValue(value) {
        // Во время Coin Rush все объекты превращаются в монеты.
        if (window.gameInstance?.isCoinRushActive?.()) return 'coin';
        // В обычном режиме редкие монетки в потоке.
        const v = Math.max(0, Number(value) || 0);
        return (v % 7 === 0) ? 'coin' : 'food';
    }

    getItemSrc(itemType, base) {
        if (itemType === 'coin') return 'img/food/coin.svg';
        if (itemType === 'ice') return 'img/food/ice.svg';
        return this.getFoodSrc(base);
    }

    preloadFoodAssets() {
        const sources = [];
        const bases = Array.isArray(this.foodBases) ? this.foodBases : [];
        for (let i = 0; i < bases.length; i++) {
            const base = bases[i];
            const src = this.getFoodSrc(base);
            if (src) sources.push(src);
        }
        sources.push(this.getItemSrc('coin', 'coin'));
        sources.push(this.getItemSrc('ice', 'ice'));

        for (let i = 0; i < sources.length; i++) {
            this.preloadFoodAsset(sources[i]);
        }
    }

    preloadFoodAsset(src) {
        if (!src || this._foodAssetSizeCache[src]) return;
        const img = new Image();
        img.decoding = 'async';
        const onReady = () => {
            this.cacheFoodAssetSizeFromImage(src, img);
        };
        img.addEventListener('load', onReady, { once: true });
        img.src = src;
        if (img.complete) onReady();
    }

    cacheFoodAssetSizeFromImage(src, img) {
        if (!src || !img) return;
        const w = Number(img.naturalWidth);
        const h = Number(img.naturalHeight);
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
        this._foodAssetSizeCache[src] = { width: w, height: h };
    }

    getCachedFoodAspectRatio(src) {
        if (!src) return null;
        const cached = this._foodAssetSizeCache[src];
        if (!cached) return null;
        const w = Number(cached.width);
        const h = Number(cached.height);
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
        return w / h;
    }

    setImageSrcIfChanged(img, src) {
        if (!img || !src) return;
        const current = img.getAttribute('src') || '';
        if (current === src) return;
        this.preloadFoodAsset(src);
        img.src = src;
    }

    getSizeScaleForCircle(circleEl) {
        if (!circleEl) return 1;
        const explicit = Number(circleEl.dataset?.sizeScale);
        if (Number.isFinite(explicit) && explicit > 0) return explicit;
        const cls = circleEl.dataset?.sizeClass || 'M';
        // Стабильные размеры: одинаковые объекты всегда рендерятся в одном масштабе.
        const byClass = { S: 1, M: 1, L: 1 };
        return byClass[cls] || 1;
    }

    /** Текущая высота головы пингвина в пикселях (rig-слой головы внутри focus-zone). */
    getPenguinHeadHeight() {
        if (Number.isFinite(this._cachedHeadHeightPx) && this._cachedHeadHeightPx > 0) {
            return this._cachedHeadHeightPx;
        }
        try {
            const parts = this.getPenguinParts?.();
            const headLayer = parts?.head || null;
            const layoutHeight = Number(headLayer?.offsetHeight || headLayer?.clientHeight || 0);
            if (Number.isFinite(layoutHeight) && layoutHeight > 0) {
                this._cachedHeadHeightPx = layoutHeight;
                return layoutHeight;
            }
            const rect = headLayer?.getBoundingClientRect?.();
            const h = Number(rect?.height || 0);
            if (!Number.isFinite(h) || h <= 0) return null;
            this._cachedHeadHeightPx = h;
            return h;
        } catch (e) {
            return null;
        }
    }

    ensureFoodCircle(circleEl) {
        if (!circleEl) return;
        circleEl.style.removeProperty('transform');
        let img = circleEl._foodImgEl;
        if (!img || !img.isConnected) {
            img = circleEl.querySelector('img.food-img');
            if (img) circleEl._foodImgEl = img;
        }
        if (!img) {
            img = document.createElement('img');
            img.className = 'food-img';
            img.alt = '';
            img.draggable = false;
            img.decoding = 'async';
            // eager — картинки появляются сразу. При тяжёлых SVG даёт лаги; с чистыми SVG без base64 — ок.
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
                    this.setImageSrcIfChanged(img, candidates[nextIdx]);
                    return;
                }
                // Фолбэк только на существующие food-ассеты в папке, без генерации SVG-шариков.
                const nextBase = (this.foodBases || []).find((b) => b && b !== base) || 'f1';
                const nextCandidates = this.getFoodSrcCandidates(nextBase);
                if (nextCandidates.length > 0) {
                    circleEl.dataset.foodBase = nextBase;
                    circleEl.dataset.foodSrcIdx = '0';
                    this.setImageSrcIfChanged(img, nextCandidates[0]);
                }
            });
            circleEl.appendChild(img);
            circleEl._foodImgEl = img;
        }

        const value = parseInt(circleEl.dataset.value, 10);
        const rushActive = !!window.gameInstance?.isCoinRushActive?.();
        const storedType = circleEl?.dataset?.itemType;
        const hasStoredType = storedType === 'food' || storedType === 'coin' || storedType === 'ice';
        const itemType = rushActive
            ? 'coin'
            : (hasStoredType ? storedType : this.getItemTypeForValue(value));
        const base = circleEl.dataset.foodBase || (itemType === 'ice' ? 'ice' : this.getRandomFoodBase() || this.getFoodBaseForValue(value) || 'f1');

        circleEl.dataset.foodBase = base;
        circleEl.dataset.itemType = itemType;
        if (itemType === 'food') {
            circleEl.dataset.foodSrcIdx = '0';
            const candidates = this.getFoodSrcCandidates(base);
            this.setImageSrcIfChanged(img, candidates[0] || '');
            this.ensureFoodCollider(circleEl, base);
            this.setFoodPlaceholderSize(circleEl, img);
        } else if (itemType === 'ice') {
            circleEl.dataset.foodBase = 'ice';
            this.setImageSrcIfChanged(img, this.getItemSrc('ice', 'ice'));
            this.ensureFoodCollider(circleEl, 'ice');
            this.setFoodPlaceholderSize(circleEl, img);
        } else {
            // При Coin Rush круги могут менять тип: сбрасываем старый коллайдер еды
            // и добавляем коллайдер монеты при необходимости.
            const oldCollider = circleEl.querySelector('.food-collider');
            if (oldCollider) oldCollider.remove();
            circleEl._foodColliderPath = null;
            this.setImageSrcIfChanged(img, this.getItemSrc(itemType, base));
            if (itemType === 'coin') {
                this.ensureFoodCollider(circleEl, 'coin');
            }
            this.setFoodPlaceholderSize(circleEl, img);
        }
        
        if (img.complete && img.naturalWidth > 0) {
            this.updateFoodContainerSize(circleEl, img);
        }
    }

    /** Задаёт размер img до загрузки, чтобы не было "прыжка" с исходных размеров SVG. */
    setFoodPlaceholderSize(circleEl, img) {
        if (!circleEl || !img) return;
        const headHeight = this.getPenguinHeadHeight() || 0;
        const sizeScale = this.getSizeScaleForCircle(circleEl);
        const src = img.currentSrc || img.getAttribute('src') || '';
        const ratio = this.getCachedFoodAspectRatio(src) || 1;

        let placeholderH;
        let placeholderW;

        if (headHeight > 0) {
            // Основной путь: высота слота пропорциональна высоте головы пингвина.
            placeholderH = headHeight * sizeScale;
            placeholderW = placeholderH * ratio;
        } else {
            // Fallback: старый режим через circle-size, если почему-то недоступна голова.
            const baseUnit = parseFloat(getComputedStyle(circleEl).getPropertyValue('--circle-size')) || 63;
            placeholderH = baseUnit * 1.6 * sizeScale;
            placeholderW = placeholderH * ratio;
        }

        // Слот по ширине/высоте объекта (контейнер совпадает по кадру с пингвином).
        circleEl.style.width = `${placeholderW}px`;
        circleEl.style.height = `${placeholderH}px`;
        img.style.width = `${placeholderW}px`;
        img.style.height = `${placeholderH}px`;
        this.stripConveyor?.markMetricsDirty?.();
    }

    // Обновление размера под реальные пропорции ассета (в "оригинальных" размерах, с единым масштабом)
    updateFoodContainerSize(circleEl, img) {
        if (!circleEl || !img) return;
        
        const naturalWidth = img.naturalWidth;
        const naturalHeight = img.naturalHeight;
        if (naturalWidth === 0 || naturalHeight === 0) return;
        const resolvedSrc = img.currentSrc || img.getAttribute('src') || '';
        if (resolvedSrc) {
            this._foodAssetSizeCache[resolvedSrc] = { width: naturalWidth, height: naturalHeight };
        }

        const sizeScale = this.getSizeScaleForCircle(circleEl);
        const headHeight = this.getPenguinHeadHeight();

        let globalScale;
        if (headHeight && headHeight > 0) {
            // Нормируем весь спрайт по высоте головы пингвина:
            // итоговая высота объекта = высота головы * sizeScale.
            globalScale = (headHeight / naturalHeight) * sizeScale;
        } else {
            // Fallback: если по какой-то причине высота головы недоступна, используем прежнюю логику.
            const baseUnit = parseFloat(getComputedStyle(circleEl).getPropertyValue('--circle-size')) || 63;
            const baselineSmallHeight = naturalHeight || 1;
            globalScale = (baseUnit / baselineSmallHeight) * sizeScale;
        }

        const targetWidth = naturalWidth * globalScale;
        const targetHeight = naturalHeight * globalScale;

        // Фиксируем размеры у изображения, а не у элемента слота,
        // иначе ломается "питч" ленты (движение/рецикл завязаны на постоянный шаг).
        img.style.width = `${targetWidth}px`;
        img.style.height = `${targetHeight}px`;
        // Контейнер ленты по кадру совпадает с объектом.
        circleEl.style.width = `${targetWidth}px`;
        circleEl.style.height = `${targetHeight}px`;
        this.stripConveyor?.markMetricsDirty?.();

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

        const teethTopPolyEls = [];
        const teethBotPolyEls = [];
        for (let i = 0; i < 5; i += 1) {
            teethTopPolyEls.push(ensurePoly(`debug-teeth-top-poly-${i + 1}`, { fill: 'rgba(255,0,0,0.10)', stroke: 'rgba(255,0,0,0.95)' }));
            teethBotPolyEls.push(ensurePoly(`debug-teeth-bot-poly-${i + 1}`, { fill: 'rgba(255,165,0,0.10)', stroke: 'rgba(255,165,0,0.95)' }));
        }

        this.debugEls = {
            overlay,
            objectsContainer,
            svg,
            teethTopPolyEls,
            teethBotPolyEls,
            rightColliderPolyEl: ensurePoly('debug-right-collider-poly', { fill: 'rgba(0,120,255,0.10)', stroke: 'rgba(0,120,255,0.95)' }),
            dangerPolyEl: ensurePoly('debug-danger-poly', { fill: 'rgba(0,150,255,0.08)', stroke: 'rgba(0,150,255,0.9)' }),
            jawTopBox: ensure('debug-jaw-top-box', 'debug-box debug-jaw-top'),
            dangerBox: ensure('debug-danger-box', 'debug-box debug-danger'),
            biteLine: ensure('debug-bite-line', 'debug-line debug-bite'),
            jawBottomLine: ensure('debug-jaw-bottom-line', 'debug-line debug-jaw-bottom')
        };
    }

    // Обновление границ объекта на ленте для debug (один объект: ближайший/в коллизии)
    updateDebugObjectBoxes(trackedCircle, containerRect, isColliding = false, dangerPoly = null) {
        if (!this.debug || !this.debugEls?.objectsContainer) return;
        
        const container = this.debugEls.objectsContainer;
        container.innerHTML = '';
        
        if (!trackedCircle) return;
        
        const img = trackedCircle.querySelector('img.food-img');
        const imgRect = img?.getBoundingClientRect?.() || null;
        const rect = imgRect || trackedCircle.getBoundingClientRect();
        const left = rect.left - containerRect.left;
        const top = rect.top - containerRect.top;
        const width = rect.width;
        const height = rect.height;

        if (Array.isArray(dangerPoly) && dangerPoly.length >= 3) {
            const pts = dangerPoly.map((p) => `${p.x - containerRect.left},${p.y - containerRect.top}`).join(' ');
            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', pts);
            poly.setAttribute('fill', isColliding ? 'rgba(255,0,0,0.12)' : 'rgba(0,150,255,0.06)');
            poly.setAttribute('stroke', isColliding ? 'rgba(255,0,0,1)' : 'rgba(0,150,255,0.5)');
            poly.setAttribute('stroke-width', isColliding ? '3' : '1.5');
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'debug-box');
            svg.style.position = 'absolute';
            svg.style.left = '0';
            svg.style.top = '0';
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.pointerEvents = 'none';
            svg.style.overflow = 'visible';
            svg.appendChild(poly);
            container.appendChild(svg);
        } else {
            const box = document.createElement('div');
            box.className = 'debug-box';
            box.style.position = 'absolute';
            box.style.left = `${left}px`;
            box.style.top = `${top}px`;
            box.style.width = `${width}px`;
            box.style.height = `${height}px`;
            box.style.borderColor = isColliding ? 'rgba(255, 0, 0, 1)' : 'rgba(0, 150, 255, 0.35)';
            box.style.background = isColliding ? 'rgba(255, 0, 0, 0.10)' : 'rgba(0, 150, 255, 0.04)';
            box.style.borderWidth = isColliding ? '3px' : '1px';
            box.style.borderStyle = 'solid';
            box.style.boxSizing = 'border-box';
            container.appendChild(box);
        }
    }

    updateDebugOverlay({ containerRect, jawTopRect, jawBotRect, teethTopPoly, teethBotPoly, teethTopPolys, teethBotPolys, rightColliderPoly, dangerRect, dangerPoly, biteX }) {
        if (!this.debug || !this.debugEls) return;
        const { jawTopBox, dangerBox, dangerPolyEl, biteLine, jawBottomLine, svg, teethTopPolyEls, teethBotPolyEls, rightColliderPolyEl } = this.debugEls;

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
        
        // 2. Объект в коллизии: полигон из маски SVG или AABB
        if (dangerPolyEl) {
            if (Array.isArray(dangerPoly) && dangerPoly.length >= 3) {
                const pts = dangerPoly.map((p) => `${p.x - containerRect.left},${p.y - containerRect.top}`).join(' ');
                dangerPolyEl.setAttribute('points', pts);
                dangerPolyEl.style.display = 'block';
                if (dangerBox) dangerBox.style.display = 'none';
            } else {
                dangerPolyEl.setAttribute('points', '');
                dangerPolyEl.style.display = 'none';
                placeBox(dangerBox, dangerRect);
            }
        } else {
            placeBox(dangerBox, dangerRect);
        }
        
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
        const topPolys = Array.isArray(teethTopPolys)
            ? teethTopPolys
            : (teethTopPoly ? [teethTopPoly] : []);
        const botPolys = Array.isArray(teethBotPolys)
            ? teethBotPolys
            : (teethBotPoly ? [teethBotPoly] : []);

        if (Array.isArray(teethTopPolyEls)) {
            teethTopPolyEls.forEach((el, idx) => {
                const pts = topPolys[idx] || null;
                setPoly(el, pts);
            });
        }
        if (Array.isArray(teethBotPolyEls)) {
            teethBotPolyEls.forEach((el, idx) => {
                const pts = botPolys[idx] || null;
                setPoly(el, pts);
            });
        }
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
        this._cachedHeadHeightPx = null;
        const stableHeadHeight = this.getPenguinHeadHeight();
        if (Number.isFinite(stableHeadHeight) && stableHeadHeight > 0) {
            this._cachedHeadHeightPx = stableHeadHeight;
        }
        // Кэшируем позицию рта в "спокойном" состоянии.
        // Даже если пингвин визуально двигается при укусе, лента должна ориентироваться на этот якорь.
        this._cachedMouthRightX = container ? this.penguinRig.getPenguinMouthRightX(container) : 0;

        // Вертикально выравниваем "ленту" по тому же кадру, что и голова пингвина:
        // top/height number-strip-container = top/height слоя головы.
        this.updateStripVerticalFrame();

        // При ресайзе могут поменяться размеры кружков/маргины (responsive) — пересчитываем метрики
        this.stripConveyor.recomputeStripMetrics();
    }

    /** Делает так, чтобы лента еды жила в том же вертикальном кадре, что и голова пингвина. */
    updateStripVerticalFrame() {
        try {
            const focusZone = this.focusZone;
            const stripContainer = document.getElementById('number-strip-container');
            if (!focusZone || !stripContainer) return;

            const focusRect = focusZone.getBoundingClientRect();
            const parts = this.getPenguinParts();
            const headLayer = parts?.head || null;
            const headRect = headLayer?.getBoundingClientRect?.();
            if (!headRect) return;

            const top = headRect.top - focusRect.top;
            const height = this.getPenguinHeadHeight() || headRect.height;

            stripContainer.style.top = `${top}px`;
            stripContainer.style.bottom = 'auto';
            stripContainer.style.height = `${height}px`;
        } catch (e) {
            // silent fallback: в худшем случае останется старое центрирование по высоте.
        }
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
        const relayout = () => {
            this._relayoutRafId = 0;
            this.setupFocusZone();
            this.stripConveyor?.refreshVisibleCircleSizing?.();
            this.setupClouds();
        };
        const scheduleRelayout = () => {
            if (this._relayoutRafId) return;
            const delay = this.mobilePerfMode ? 120 : 0;
            if (delay > 0) {
                this._relayoutRafId = window.setTimeout(relayout, delay);
                return;
            }
            this._relayoutRafId = requestAnimationFrame(relayout);
        };

        // Обновление при изменении viewport (resize + mobile browser bars + orientation).
        window.addEventListener('resize', scheduleRelayout);
        window.addEventListener('orientationchange', scheduleRelayout);
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', scheduleRelayout);
        }

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

    // Анимация "+1" / "+2" при засчитанном укусе монетки
    showFloatingCoinBonus(x, y, amount) {
        const container = document.getElementById('game-area');
        if (!container) return;
        const num = Math.max(1, Math.min(99, Math.floor(amount || 1)));
        const text = `+${num}`;
        const el = this.acquireFloatingBonusEl();
        const token = (el._poolToken || 0) + 1;
        el._poolToken = token;
        el.textContent = text;
        if (typeof x === 'number' && typeof y === 'number') {
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
        } else {
            const rect = container.getBoundingClientRect();
            el.style.left = `${rect.width / 2}px`;
            el.style.top = `${rect.height / 2}px`;
        }
        // Перезапускаем CSS-анимацию для реюза элемента.
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
        container.appendChild(el);
        window.setTimeout(() => {
            if (el._poolToken !== token) return;
            this.releaseFloatingBonusEl(el);
        }, 850);
    }

    acquireFloatingBonusEl() {
        const el = this._floatingBonusPool.pop() || document.createElement('div');
        el.className = 'floating-coin-bonus';
        el.setAttribute('aria-hidden', 'true');
        return el;
    }

    releaseFloatingBonusEl(el) {
        if (!el) return;
        try { el.remove(); } catch (e) { /* ignore */ }
        el.textContent = '';
        el.style.left = '0px';
        el.style.top = '0px';
        el.style.animation = '';
        if (this._floatingBonusPool.length < 32) {
            this._floatingBonusPool.push(el);
        }
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

    /** Заморозка челюсти в текущей позе (геймовер по льду на 5-м зубе). */
    freezeMouthInPlace() {
        this.penguinRig?.freezeMouthInPlace?.();
    }

    /** Обновляет маску ленты: дырка по left-collider, чтобы еда обрезалась при входе в рот. */
    updateStripMask(pathD) {
        const hole = document.getElementById('strip-mask-hole');
        if (hole && pathD) hole.setAttribute('d', pathD);
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
