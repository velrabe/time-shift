class StripConveyorSystem {
    constructor(options) {
        this.numberStrip = options.numberStrip || null;
        this.perfMode = !!options.perfMode;
        this.getGameArea = options.getGameArea;
        this.getFocusAnchorX = options.getFocusAnchorX;
        this.ensureFoodCircle = options.ensureFoodCircle;
        this.applyDebugLabelToCircle = options.applyDebugLabelToCircle;
        this.checkCollisionsAndAutoBite = options.checkCollisionsAndAutoBite;

        // Меньшее окно снижает пиковую нагрузку при старте (DOM + SVG decode + коллизии).
        this.stripHalfWindow = this.perfMode ? 12 : 18;
        this.stripRecycleMargin = 6;
        this.stripMinValue = 0;
        this.stripPitchPx = null;
        this.stripFirstCenterPx = null;
        this.currentStripOffset = 0;
        this.metricsDirty = true;
        this.lastClassUpdateValue = null;

        this.beltSpeed = 0.08;
        this.beltEatGrowth = 1.03;
        this.beltEatMultiplier = 1.0;
        this.beltEatMultiplierTarget = 1.0;
        this.beltEatSmoothingK = 10.0;
        this.beltPosition = 0;
        this.lastBeltUpdateTime = 0;
        this.beltPauseStartTime = null;

        // Рандом-спавн с "играбельными" ограничениями:
        // - минимум еды между монетами;
        // - максимум еды подряд (гарантируем монету, если монет давно не было).
        this.coinSpawnChance = 0.2;
        this.minFoodGapBetweenCoins = 2;
        this.maxFoodGapBetweenCoins = 6;
        this.foodsSinceLastCoin = this.minFoodGapBetweenCoins;

        // Gap-планирование в секундах (перевод в px через текущую скорость ленты).
        this.gapTimeMinSec = 0.25;
        this.gapTimeMaxSec = 0.9;
        this.biteResolveTimeSec = 0.12;
        this.inputBufferSec = 0.07;
        this.safetyMarginSec = 0.08;
        this.objectGapBaseLeftPx = 4;
        // Базовый множитель отступов: > 1 = реже/просторнее, < 1 = плотнее. Регулирует плотность в начале и в целом.
        this.gapBaseMultiplier = 1.4;

        // Runtime state для генератора чанков.
        this.lastKnownSpeedPxPerSec = Math.max(1, this.beltSpeed * 1000);
        this.currentDifficulty = 1;
        this.spawnMetaQueue = [];
        this.forceEasyAfterHard = false;
        this.prevSpawnSizeClass = null;
        this.prevGapTimeSec = null;
        this.denseRunCount = 0;
        this.chunksSinceCoin = 0;
        this.chunksUntilCoin = this.rollChunksUntilCoin();

        this.applyResponsiveSizing();
    }

    resetWindow() {
        if (this.numberStrip) {
            this.numberStrip.innerHTML = '';
            this.numberStrip.style.transition = 'none';
            this.numberStrip.style.transform = 'translateX(0px)';
        }
        this.stripMinValue = 0;
        this.stripPitchPx = null;
        this.stripFirstCenterPx = null;
        this.currentStripOffset = 0;
        this.metricsDirty = true;
        this.lastClassUpdateValue = null;

        this.beltPosition = 0;
        this.lastBeltUpdateTime = 0;
        this.beltPauseStartTime = null;
        this.beltEatMultiplier = 1.0;
        this.beltEatMultiplierTarget = 1.0;
        this.foodsSinceLastCoin = this.minFoodGapBetweenCoins;
        this.lastKnownSpeedPxPerSec = Math.max(1, this.beltSpeed * 1000);
        this.currentDifficulty = 1;
        this.spawnMetaQueue = [];
        this.forceEasyAfterHard = false;
        this.prevSpawnSizeClass = null;
        this.prevGapTimeSec = null;
        this.denseRunCount = 0;
        this.chunksSinceCoin = 0;
        this.chunksUntilCoin = this.rollChunksUntilCoin();
    }

    rollChunksUntilCoin() {
        return 3 + Math.floor(Math.random() * 5); // 3..7
    }

    rollItemTypeForSpawn() {
        if (window.gameInstance?.isCoinRushActive?.()) {
            this.foodsSinceLastCoin = 0;
            return 'coin';
        }

        const minGap = Math.max(0, Math.floor(this.minFoodGapBetweenCoins ?? 2));
        const maxGap = Math.max(minGap + 1, Math.floor(this.maxFoodGapBetweenCoins ?? 6));
        const chance = Math.min(1, Math.max(0, Number(this.coinSpawnChance ?? 0.2)));
        const foodsSince = Math.max(0, Math.floor(this.foodsSinceLastCoin || 0));

        const forceCoin = foodsSince >= maxGap;
        const canSpawnCoin = foodsSince >= minGap;
        const isCoin = forceCoin || (canSpawnCoin && Math.random() < chance);

        if (isCoin) this.foodsSinceLastCoin = 0;
        else this.foodsSinceLastCoin = foodsSince + 1;

        return isCoin ? 'coin' : 'food';
    }

    applySpawnMeta(circleEl) {
        if (!circleEl) return;
        const meta = this.consumeSpawnMeta();
        const speedPxPerSec = Math.max(1, Number(this.lastKnownSpeedPxPerSec) || (this.beltSpeed * 1000));
        const mult = Number.isFinite(this.gapBaseMultiplier) && this.gapBaseMultiplier > 0 ? this.gapBaseMultiplier : 1;
        const rightGapPx = Math.max(2, Math.round(meta.gapTimeSec * speedPxPerSec * mult));
        const leftGapPx = Math.max(0, Math.floor(this.objectGapBaseLeftPx ?? 4));
        circleEl.dataset.itemType = meta.itemType;
        circleEl.dataset.sizeClass = meta.sizeClass;
        circleEl.dataset.sizeScale = String(meta.sizeScale);
        circleEl.dataset.gapTimeSec = String(meta.gapTimeSec);
        circleEl.dataset.spawnGapPx = String(rightGapPx);
        circleEl.dataset.marginLeftPx = String(leftGapPx);
        circleEl.style.marginLeft = `${leftGapPx}px`;
        circleEl.style.marginRight = `${rightGapPx}px`;
        this.markMetricsDirty();
    }

    markMetricsDirty() {
        this.metricsDirty = true;
    }

    getGameScale() {
        try {
            const rootStyle = window.getComputedStyle(document.documentElement);
            const value = parseFloat(rootStyle.getPropertyValue('--game-scale'));
            if (Number.isFinite(value) && value > 0) return value;
        } catch (e) {
            // ignore
        }
        return 1;
    }

    applyResponsiveSizing() {
        const scale = this.getGameScale();
        this.objectGapBaseLeftPx = Math.max(2, Math.round(4 * scale));
    }

    refreshVisibleCircleSizing() {
        if (!this.numberStrip) return;
        this.applyResponsiveSizing();
        const leftGapPx = Math.max(0, Math.floor(this.objectGapBaseLeftPx ?? 4));
        const children = this.numberStrip.children;
        for (let i = 0; i < children.length; i++) {
            const el = children[i];
            el.dataset.marginLeftPx = String(leftGapPx);
            el.style.marginLeft = `${leftGapPx}px`;
        }
        this.markMetricsDirty();
    }

    getMinGapTimeSec() {
        const computed = (this.biteResolveTimeSec || 0) + (this.inputBufferSec || 0) + (this.safetyMarginSec || 0);
        return Math.max(0.22, computed);
    }

    updateDirectorState(timer) {
        const speedMultiplier = (timer && typeof timer.getSpeedMultiplier === 'function')
            ? timer.getSpeedMultiplier()
            : 1;
        const eatMult = Number.isFinite(this.beltEatMultiplier) ? this.beltEatMultiplier : 1;
        const pxPerMs = this.beltSpeed * (Number.isFinite(speedMultiplier) ? speedMultiplier : 1) * eatMult;
        this.lastKnownSpeedPxPerSec = Math.max(1, pxPerMs * 1000);

        const speedRatio = this.lastKnownSpeedPxPerSec / Math.max(1, this.beltSpeed * 1000);
        const progressFactor = Math.min(2.5, (this.beltPosition / 9000));
        const rawDifficulty = 1 + ((speedRatio - 1) * 1.8) + progressFactor;
        this.currentDifficulty = Math.max(1, Math.min(5, Math.round(rawDifficulty)));
    }

    getChunkTemplates() {
        return [
            {
                key: 'single',
                difficulty: 1,
                items: [{ type: 'food', sizeClass: 'M', gapRange: [0.45, 0.9] }]
            },
            {
                key: 'pair',
                difficulty: 2,
                items: [
                    { type: 'food', sizeClass: 'S', gapRange: [0.30, 0.55] },
                    { type: 'food', sizeClass: 'M', gapRange: [0.42, 0.75] }
                ]
            },
            {
                key: 'triplet',
                difficulty: 3,
                items: [
                    { type: 'food', sizeClass: 'S', gapRange: [0.28, 0.42] },
                    { type: 'food', sizeClass: 'M', gapRange: [0.28, 0.42] },
                    { type: 'food', sizeClass: 'L', gapRange: [0.35, 0.55] }
                ]
            },
            {
                key: 'coin-run',
                difficulty: 4,
                items: [
                    { type: 'coin', sizeClass: 'S', gapRange: [0.25, 0.36] },
                    { type: 'coin', sizeClass: 'S', gapRange: [0.25, 0.36] },
                    { type: 'coin', sizeClass: 'S', gapRange: [0.26, 0.38] },
                    { type: 'coin', sizeClass: 'M', gapRange: [0.32, 0.48] }
                ]
            },
            {
                key: 'feint',
                difficulty: 4,
                items: [
                    { type: 'food', sizeClass: 'L', gapRange: [0.30, 0.48] },
                    { type: 'food', sizeClass: 'S', gapRange: [0.27, 0.40] },
                    { type: 'food', sizeClass: 'L', gapRange: [0.40, 0.62] }
                ]
            },
            {
                key: 'breather',
                difficulty: 1,
                items: [{ type: 'food', sizeClass: 'M', gapRange: [0.85, 1.25] }]
            }
        ];
    }

    pickWeightedChunk() {
        const templates = this.getChunkTemplates();
        const d = this.currentDifficulty || 1;
        const desiredBand = d <= 1 ? 'easy' : d <= 3 ? 'medium' : 'hard';

        const byBand = (tpl) => {
            if (tpl.difficulty <= 2) return 'easy';
            if (tpl.difficulty === 3) return 'medium';
            return 'hard';
        };

        const weightsByBand = {
            1: { easy: 0.70, medium: 0.25, hard: 0.05 },
            2: { easy: 0.50, medium: 0.38, hard: 0.12 },
            3: { easy: 0.35, medium: 0.45, hard: 0.20 },
            4: { easy: 0.20, medium: 0.50, hard: 0.30 },
            5: { easy: 0.12, medium: 0.46, hard: 0.42 }
        };
        const table = weightsByBand[Math.max(1, Math.min(5, d))];
        const weighted = templates.map((tpl) => {
            const band = byBand(tpl);
            let w = table[band] || 0.1;
            if (this.forceEasyAfterHard && band !== 'easy') w *= 0.08;
            if (desiredBand === band) w *= 1.15;
            if (tpl.key === 'breather' && !this.forceEasyAfterHard && d <= 2) w *= 0.75;
            return { tpl, w };
        });

        const sum = weighted.reduce((acc, e) => acc + e.w, 0);
        let r = Math.random() * (sum || 1);
        for (const entry of weighted) {
            r -= entry.w;
            if (r <= 0) return entry.tpl;
        }
        return weighted[weighted.length - 1]?.tpl || templates[0];
    }

    realizeChunk(template) {
        const minGap = this.getMinGapTimeSec();
        const out = [];
        for (const item of (template.items || [])) {
            const [g0, g1] = item.gapRange || [this.gapTimeMinSec, this.gapTimeMaxSec];
            const jitter = 0.9 + (Math.random() * 0.2);
            let gapTimeSec = (g0 + Math.random() * Math.max(0, g1 - g0)) * jitter;
            gapTimeSec = Math.max(minGap, Math.min(1.35, gapTimeSec));

            // Фиксированные классы размеров без jitter: размер стабилен и не "прыгает".
            const sizeClass = (item.sizeClass === 'S' || item.sizeClass === 'L') ? item.sizeClass : 'M';
            const classScale = { S: 1.0, M: 1.0, L: 1.0 };
            const sizeScale = classScale[sizeClass] || 1.0;

            let itemType = 'food';
            const inCoinRush = !!window.gameInstance?.isCoinRushActive?.();
            if (inCoinRush) {
                itemType = 'coin';
                this.foodsSinceLastCoin = 0;
            } else if (item.type === 'coin') {
                itemType = 'coin';
                this.foodsSinceLastCoin = 0;
            } else if (item.type === 'any') {
                itemType = this.rollItemTypeForSpawn();
            } else if (item.type === 'food') {
                // Иногда вместо еды спавним лёд (расщелкивается зубами 1–4, зуб 5 = геймовер)
                itemType = (Math.random() < 0.15) ? 'ice' : 'food';
                this.foodsSinceLastCoin = Math.max(0, Math.floor(this.foodsSinceLastCoin || 0)) + 1;
            } else {
                itemType = 'food';
                this.foodsSinceLastCoin = Math.max(0, Math.floor(this.foodsSinceLastCoin || 0)) + 1;
            }
            out.push({ itemType, sizeClass, sizeScale, gapTimeSec });
        }
        return out;
    }

    validateChunk(events) {
        if (!Array.isArray(events) || events.length === 0) return false;
        const minGap = this.getMinGapTimeSec();
        let prevSize = this.prevSpawnSizeClass;
        let denseRun = this.denseRunCount || 0;

        for (const e of events) {
            if ((e.gapTimeSec || 0) < minGap) return false;
            if (prevSize === 'L' && e.sizeClass === 'L') return false;

            const dense = e.gapTimeSec <= (minGap + 0.06);
            denseRun = dense ? (denseRun + 1) : 0;
            if (denseRun > 3) return false;
            prevSize = e.sizeClass;
        }
        return true;
    }

    ensureSpawnQueue() {
        if (this.spawnMetaQueue.length > 0) return;

        let chosen = null;
        let events = null;
        for (let i = 0; i < 20; i++) {
            const tpl = this.pickWeightedChunk();
            const realized = this.realizeChunk(tpl);
            if (this.validateChunk(realized)) {
                chosen = tpl;
                events = realized;
                break;
            }
        }

        if (!events) {
            events = [{
                itemType: this.rollItemTypeForSpawn(),
                sizeClass: 'M',
                sizeScale: 1.0,
                gapTimeSec: Math.max(this.getMinGapTimeSec(), 0.45)
            }];
            chosen = { difficulty: 1 };
        }

        events = this.applyCoinCadenceToChunk(events);

        this.spawnMetaQueue.push(...events);
        const last = events[events.length - 1];
        this.prevSpawnSizeClass = last?.sizeClass || this.prevSpawnSizeClass;
        this.prevGapTimeSec = last?.gapTimeSec || this.prevGapTimeSec;
        let denseRunTail = this.denseRunCount || 0;
        const denseThreshold = this.getMinGapTimeSec() + 0.06;
        for (const e of events) {
            const dense = (e.gapTimeSec || 0) <= denseThreshold;
            denseRunTail = dense ? (denseRunTail + 1) : 0;
        }
        this.denseRunCount = denseRunTail;
        this.forceEasyAfterHard = (chosen?.difficulty || 1) >= 4;
    }

    applyCoinCadenceToChunk(eventsInput) {
        const events = Array.isArray(eventsInput) ? eventsInput.map((e) => ({ ...e })) : [];
        if (events.length === 0) return events;

        const inCoinRush = !!window.gameInstance?.isCoinRushActive?.();
        if (inCoinRush) return events;

        const due = this.chunksSinceCoin >= this.chunksUntilCoin;
        if (due) {
            const hasCoin = events.some((e) => e.itemType === 'coin');
            if (!hasCoin) {
                const foodIndices = [];
                for (let i = 0; i < events.length; i++) {
                    if (events[i].itemType === 'food') foodIndices.push(i);
                }
                if (foodIndices.length > 0) {
                    const pick = foodIndices[Math.floor(Math.random() * foodIndices.length)];
                    events[pick].itemType = 'coin';
                }
            }
        }

        const hasCoinAfter = events.some((e) => e.itemType === 'coin');
        if (hasCoinAfter) {
            this.chunksSinceCoin = 0;
            this.chunksUntilCoin = this.rollChunksUntilCoin();
        } else {
            this.chunksSinceCoin += 1;
        }

        return events;
    }

    consumeSpawnMeta() {
        this.ensureSpawnQueue();
        return this.spawnMetaQueue.shift() || {
            itemType: this.rollItemTypeForSpawn(),
            sizeClass: 'M',
            sizeScale: 1.0,
            gapTimeSec: Math.max(this.getMinGapTimeSec(), 0.45)
        };
    }

    onFoodEaten() {
        const growth = Number.isFinite(this.beltEatGrowth) ? this.beltEatGrowth : 1.03;
        const baseTarget = Number.isFinite(this.beltEatMultiplierTarget) ? this.beltEatMultiplierTarget : 1;
        this.beltEatMultiplierTarget = baseTarget * growth;
    }

    pause() {
        if (this.lastBeltUpdateTime > 0) {
            this.beltPauseStartTime = this.lastBeltUpdateTime;
        }
    }

    resume(pauseDurationMs) {
        if (this.beltPauseStartTime && pauseDurationMs > 0) {
            this.lastBeltUpdateTime = this.beltPauseStartTime + pauseDurationMs;
            this.beltPauseStartTime = null;
        }
    }

    renderNumberStrip(timer) {
        if (!this.numberStrip) return;
        const current = Number.isFinite(timer?.current) ? timer.current : 0;
        this.ensureStripWindowInitialized(current);
        this.updateStripClasses(current);
    }

    update(timer) {
        if (!this.numberStrip) return;

        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (this.lastBeltUpdateTime === 0) {
            this.ensureStripWindowInitialized(0);
            if (this.metricsDirty) this.recomputeStripMetrics();
            this.adjustInitialBeltPosition();
            this.lastBeltUpdateTime = nowMs - 16;
        }

        if (this.beltPauseStartTime != null) {
            this.lastBeltUpdateTime = nowMs;
            return;
        }

        const deltaTime = nowMs - this.lastBeltUpdateTime;
        this.lastBeltUpdateTime = nowMs;

        const speedMultiplier = (timer && typeof timer.getSpeedMultiplier === 'function')
            ? timer.getSpeedMultiplier()
            : 1;
        const deltaSec = Math.max(0, deltaTime / 1000);
        const smoothK = Number.isFinite(this.beltEatSmoothingK) ? this.beltEatSmoothingK : 10;
        const alpha = 1 - Math.exp(-smoothK * deltaSec);
        const target = Number.isFinite(this.beltEatMultiplierTarget) ? this.beltEatMultiplierTarget : 1;
        const current = Number.isFinite(this.beltEatMultiplier) ? this.beltEatMultiplier : 1;
        this.beltEatMultiplier = current + ((target - current) * alpha);

        this.updateDirectorState(timer);

        const eatMult = Number.isFinite(this.beltEatMultiplier) ? this.beltEatMultiplier : 1;
        const baseSpeed = this.beltSpeed * (Number.isFinite(speedMultiplier) ? speedMultiplier : 1) * eatMult;
        this.beltPosition += (baseSpeed * deltaTime);

        if (this.metricsDirty) this.recomputeStripMetrics();
        if (this.stripPitchPx == null || this.stripFirstCenterPx == null) return;

        let segment = this.getWorldSegmentByBeltPosition(this.beltPosition);
        if (!segment) return;
        let currentValue = segment.currentValue;

        this.ensureStripWindowInitialized(currentValue);
        const recycled = this.maybeRecycleStripWindow(currentValue);
        if (recycled || this.metricsDirty) {
            this.recomputeStripMetrics();
            segment = this.getWorldSegmentByBeltPosition(this.beltPosition);
            if (!segment) return;
            currentValue = segment.currentValue;
        }
        this.updateStripClasses(currentValue);

        const container = this.getGameArea?.();
        if (!container) return;

        const anchorX = this.getFocusAnchorX(container);
        const interpolatedCenter = segment.currentCenter + ((segment.nextCenter - segment.currentCenter) * segment.progress);
        const targetOffset = anchorX - interpolatedCenter;
        this.numberStrip.style.transition = 'none';
        this.numberStrip.style.transform = `translateX(${targetOffset}px)`;
        this.currentStripOffset = targetOffset;

        this.checkCollisionsAndAutoBite?.(container);
    }

    adjustInitialBeltPosition() {
        try {
            const container = this.getGameArea?.();
            if (container && this.stripPitchPx != null) {
                const containerRect = container.getBoundingClientRect();
                const anchorX = this.getFocusAnchorX(container);
                const desiredX = containerRect.width * 0.55;
                this.beltPosition = anchorX - desiredX;
            }
        } catch (_err) {
            // ignore
        }
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
            this.applySpawnMeta(circleEl);
            this.ensureFoodCircle(circleEl);
            this.applyDebugLabelToCircle(circleEl);
            this.numberStrip.appendChild(circleEl);
        }
        this.stripMinValue = minValue;
        this.lastClassUpdateValue = null;
        this.markMetricsDirty();
        this.recomputeStripMetrics();
    }

    maybeRecycleStripWindow(current) {
        if (!this.numberStrip || this.stripPitchPx == null) return false;
        const count = this.numberStrip.children.length;
        if (count === 0) return false;

        const min = this.stripMinValue ?? parseInt(this.numberStrip.firstElementChild.dataset.value, 10);
        const max = min + count - 1;

        const margin = this.stripRecycleMargin ?? 10;
        const leftEdge = min + margin;
        const rightEdge = max - margin;

        if (min === 0 && current <= leftEdge) {
            return false;
        }

        if (current > rightEdge) {
            const shift = current - (min + (count - 1) / 2);
            const steps = Math.max(0, Math.floor(shift));
            this.shiftStripWindowBy(steps);
            return steps > 0;
        }
        return false;
    }

    shiftStripWindowBy(deltaSteps) {
        if (!this.numberStrip || deltaSteps === 0) return;
        const count = this.numberStrip.children.length;
        if (count === 0) return;

        let min = this.stripMinValue ?? parseInt(this.numberStrip.firstElementChild.dataset.value, 10);
        let max = min + count - 1;

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
                newEl.classList.add('normal');
                newEl.dataset.value = nextValue;
                this.applySpawnMeta(newEl);
                this.ensureFoodCircle(newEl);
                this.applyDebugLabelToCircle(newEl);
                this.numberStrip.appendChild(newEl);
                min += 1;
                max += 1;
            }
            // При переменной ширине объектов не корректируем offset "по шагу":
            // актуальный transform будет выставлен в update() по реальным центрам.
        } else {
            for (let i = 0; i < steps; i++) {
                const last = this.numberStrip.lastElementChild;
                this.numberStrip.removeChild(last);
                const prevValue = min - 1;
                if (prevValue < 0) {
                    break;
                }
                const newEl = document.createElement('div');
                newEl.className = 'number-circle';
                newEl.classList.add('normal');
                newEl.dataset.value = prevValue;
                this.applySpawnMeta(newEl);
                this.ensureFoodCircle(newEl);
                this.applyDebugLabelToCircle(newEl);
                this.numberStrip.insertBefore(newEl, this.numberStrip.firstElementChild);
                min -= 1;
                max -= 1;
            }
            // См. комментарий выше: offset стабилизируется в update().
        }

        this.stripMinValue = min;
        this.numberStrip.style.transition = 'none';
        this.numberStrip.style.transform = `translateX(${this.currentStripOffset}px)`;
        this.lastClassUpdateValue = null;
        this.markMetricsDirty();
    }

    updateStripClasses(current) {
        if (this.lastClassUpdateValue === current) return;
        const existingElements = this.numberStrip.children;
        for (let i = 0; i < existingElements.length; i++) {
            const el = existingElements[i];
            const value = parseInt(el.dataset.value, 10);
            const isPassed = el.classList.contains('passed') || value < current;
            if (isPassed) {
                el.classList.add('passed');
                el.classList.remove('normal');
                el.classList.remove('danger');
            } else {
                el.classList.remove('passed');
                el.dataset.processed = 'false';
                el.classList.remove('danger');
                el.classList.add('normal');
            }

            if (value === current) el.classList.add('active');
            else el.classList.remove('active');
        }
        this.lastClassUpdateValue = current;
    }

    recomputeStripMetrics() {
        if (!this.numberStrip) return;
        const circles = this.numberStrip.children;
        const count = circles.length;
        if (count === 0) return;

        const centers = this.rebuildWorldCoordinates(circles);
        this.stripFirstCenterPx = centers[0];
        if (count < 2) {
            if (!Number.isFinite(this.stripPitchPx) || this.stripPitchPx <= 0) this.stripPitchPx = 96;
            this.metricsDirty = false;
            return;
        }

        let distancesSum = 0;
        let distancesCount = 0;
        for (let i = 0; i < count - 1; i++) {
            const a = centers[i];
            const b = centers[i + 1];
            const d = b - a;
            if (Number.isFinite(d) && d > 1) {
                distancesSum += d;
                distancesCount += 1;
            }
        }

        if (distancesCount > 0) {
            this.stripPitchPx = distancesSum / distancesCount;
        } else if (!Number.isFinite(this.stripPitchPx) || this.stripPitchPx <= 0) {
            this.stripPitchPx = 96;
        }
        this.metricsDirty = false;
    }

    rebuildWorldCoordinates(circlesInput) {
        const circles = circlesInput || this.numberStrip?.children;
        const count = circles?.length || 0;
        if (count === 0) return [];

        const centers = new Array(count);
        for (let i = 0; i < count; i++) {
            centers[i] = this.getCircleCenterInStrip(circles[i]);
            circles[i].dataset.centerPx = String(centers[i]);
        }
        let anchorIndex = -1;
        for (let i = 0; i < count; i++) {
            if (Number.isFinite(parseFloat(circles[i].dataset.worldX))) {
                anchorIndex = i;
                break;
            }
        }
        if (anchorIndex < 0) anchorIndex = 0;

        let anchorWorld = parseFloat(circles[anchorIndex].dataset.worldX);
        if (!Number.isFinite(anchorWorld)) {
            const basePitch = Number.isFinite(this.stripPitchPx) ? this.stripPitchPx : 96;
            const baseValue = parseInt(circles[anchorIndex].dataset.value, 10) || 0;
            anchorWorld = baseValue * basePitch;
        }
        circles[anchorIndex].dataset.worldX = String(anchorWorld);

        let world = anchorWorld;
        for (let i = anchorIndex + 1; i < count; i++) {
            const dist = Math.max(1, centers[i] - centers[i - 1]);
            world += dist;
            circles[i].dataset.worldX = String(world);
        }

        world = anchorWorld;
        for (let i = anchorIndex - 1; i >= 0; i--) {
            const dist = Math.max(1, centers[i + 1] - centers[i]);
            world -= dist;
            circles[i].dataset.worldX = String(world);
        }
        return centers;
    }

    getWorldSegmentByBeltPosition(positionWorld) {
        if (!this.numberStrip) return null;
        const circles = this.numberStrip.children;
        const count = circles.length;
        if (count === 0) return null;

        const nodes = new Array(count);
        let hasInvalidWorld = false;
        for (let i = 0; i < count; i++) {
            const el = circles[i];
            const world = parseFloat(el.dataset.worldX);
            nodes[i] = {
                el,
                value: parseInt(el.dataset.value, 10) || 0,
                world,
                center: Number.isFinite(parseFloat(el.dataset.centerPx))
                    ? parseFloat(el.dataset.centerPx)
                    : this.getCircleCenterInStrip(el)
            };
            if (!Number.isFinite(world)) hasInvalidWorld = true;
        }
        if (hasInvalidWorld) {
            this.rebuildWorldCoordinates(circles);
            for (let i = 0; i < nodes.length; i++) {
                nodes[i].world = parseFloat(nodes[i].el.dataset.worldX);
                const c = parseFloat(nodes[i].el.dataset.centerPx);
                if (Number.isFinite(c)) nodes[i].center = c;
            }
        }
        if (nodes.length === 1) {
            return {
                currentValue: nodes[0].value,
                currentCenter: nodes[0].center,
                nextCenter: nodes[0].center,
                progress: 0
            };
        }

        const first = nodes[0];
        const second = nodes[1];
        if (positionWorld <= first.world) {
            const dist = Math.max(1, second.world - first.world);
            const progress = (positionWorld - first.world) / dist;
            return {
                currentValue: first.value,
                currentCenter: first.center,
                nextCenter: second.center,
                progress
            };
        }

        for (let i = 0; i < nodes.length - 1; i++) {
            const a = nodes[i];
            const b = nodes[i + 1];
            if (positionWorld < b.world) {
                const dist = Math.max(1, b.world - a.world);
                const progress = (positionWorld - a.world) / dist;
                return {
                    currentValue: a.value,
                    currentCenter: a.center,
                    nextCenter: b.center,
                    progress
                };
            }
        }

        const penultimate = nodes[nodes.length - 2];
        const last = nodes[nodes.length - 1];
        const tailDist = Math.max(1, last.world - penultimate.world);
        const tailProgress = 1 + ((positionWorld - last.world) / tailDist);
        return {
            currentValue: last.value,
            currentCenter: last.center,
            nextCenter: last.center + (last.center - penultimate.center),
            progress: tailProgress
        };
    }

    getCircleByValue(value) {
        if (!this.numberStrip) return null;
        return this.numberStrip.querySelector(`.number-circle[data-value="${value}"]`);
    }

    getCircleCenterInStrip(circleEl) {
        if (!circleEl) return 0;
        const ml = parseFloat(circleEl.dataset.marginLeftPx) || 0;
        return circleEl.offsetLeft + ml + (circleEl.offsetWidth / 2);
    }
}
