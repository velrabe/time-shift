class StripConveyorSystem {
    constructor(options) {
        this.numberStrip = options.numberStrip || null;
        this.getGameArea = options.getGameArea;
        this.getFocusAnchorX = options.getFocusAnchorX;
        this.ensureFoodCircle = options.ensureFoodCircle;
        this.applyDebugLabelToCircle = options.applyDebugLabelToCircle;
        this.checkCollisionsAndAutoBite = options.checkCollisionsAndAutoBite;

        this.items = [];
        this.patternQueue = [];
        this.itemIdCounter = 0;
        this.patternCounter = 0;

        this.lookaheadTimeSec = 2.95;
        this.spawnPaddingPx = 180;
        this.despawnPaddingPx = 220;
        this.baseSpeedPxMs = 0.22;
        this.beltBoost = 1;
        this.beltBoostTarget = 1;
        this.beltBoostSmoothing = 4.5;
        this.beltPosition = 0;
        this.spawnCursorX = 0;
        this.distanceTravelledPx = 0;
        this.lastBeltUpdateTime = 0;
        this.beltPauseStartTime = null;
        this.lastKnownSpeedPxPerSec = 220;
    }

    resetWindow() {
        if (this.numberStrip) {
            this.numberStrip.innerHTML = '';
            this.numberStrip.style.transform = 'none';
        }
        this.items = [];
        this.patternQueue = [];
        this.itemIdCounter = 0;
        this.patternCounter = 0;
        this.beltPosition = 0;
        this.spawnCursorX = 0;
        this.distanceTravelledPx = 0;
        this.lastBeltUpdateTime = 0;
        this.beltPauseStartTime = null;
        this.beltBoost = 1;
        this.beltBoostTarget = 1;
        this.lastKnownSpeedPxPerSec = 220;
    }

    recomputeStripMetrics() {
        this.updateItemLayouts();
    }

    onFoodEaten() {
        this.beltBoostTarget = Math.min(1.45, Math.max(1, this.beltBoostTarget) * 1.018);
    }

    pause() {
        if (this.lastBeltUpdateTime > 0) {
            this.beltPauseStartTime = this.lastBeltUpdateTime;
        }
    }

    resume(pauseDurationMs) {
        if (this.beltPauseStartTime != null) {
            this.lastBeltUpdateTime = this.beltPauseStartTime + Math.max(0, pauseDurationMs || 0);
            this.beltPauseStartTime = null;
        }
    }

    renderNumberStrip(_timer) {
        this.ensurePopulation();
        this.updateItemLayouts();
    }

    getActiveItems() {
        return this.items.filter((item) => !item.removed);
    }

    getViewportMetrics() {
        const container = this.getGameArea?.();
        if (!container) return null;
        const width = container.clientWidth || container.getBoundingClientRect?.().width || 0;
        const height = container.clientHeight || container.getBoundingClientRect?.().height || 0;
        const anchorX = this.getFocusAnchorX?.(container) || Math.round(width * 0.28);
        const lookaheadDistance = Math.max(420, width - anchorX - 32);
        return { container, width, height, anchorX, lookaheadDistance };
    }

    getBaseSpeedPxMs(timer) {
        const metrics = this.getViewportMetrics();
        const speedMultiplier = (timer && typeof timer.getSpeedMultiplier === 'function')
            ? timer.getSpeedMultiplier()
            : 1;
        const baseLookaheadSpeed = (metrics?.lookaheadDistance || 520) / (this.lookaheadTimeSec * 1000);
        const boosted = baseLookaheadSpeed * Math.max(1, Number.isFinite(speedMultiplier) ? speedMultiplier : 1);
        return Math.max(0.16, boosted);
    }

    getDifficultyStage() {
        if (this.patternCounter < 1) return 0;
        const progress = this.distanceTravelledPx;
        if (progress < 1800) return 1;
        if (progress < 4200) return 2;
        if (progress < 7600) return 3;
        return 4;
    }

    randomBetween(min, max) {
        return min + (Math.random() * Math.max(0, max - min));
    }

    choose(list) {
        if (!Array.isArray(list) || list.length === 0) return null;
        return list[Math.floor(Math.random() * list.length)] || list[0];
    }

    makeIntroPattern() {
        const count = 4 + Math.floor(Math.random() * 2);
        return Array.from({ length: count }, (_, index) => ({
            kind: 'edible',
            gapSec: index === 0 ? 0.58 : this.randomBetween(0.5, 0.66)
        }));
    }

    makeSwallowRun(stage) {
        const count = 3 + Math.floor(Math.random() * 3);
        const events = [];
        const bonusIndex = stage >= 2 && Math.random() < 0.45 ? Math.floor(Math.random() * count) : -1;

        for (let i = 0; i < count; i += 1) {
            let kind = 'edible';
            if (i === bonusIndex) {
                kind = 'big-edible';
            } else if (stage >= 1 && Math.random() < 0.18) {
                kind = 'coin';
            }
            events.push({
                kind,
                gapSec: kind === 'big-edible'
                    ? this.randomBetween(0.82, 0.98)
                    : this.randomBetween(0.46, 0.66)
            });
        }

        return events;
    }

    makeBiteRun(stage) {
        const count = 3 + Math.floor(Math.random() * 3);
        const events = [];
        const reinforcedIndex = stage >= 2 && Math.random() < 0.5 ? Math.floor(Math.random() * count) : -1;
        const hardIndex = stage >= 3 && Math.random() < 0.35 ? Math.floor(Math.random() * count) : -1;

        for (let i = 0; i < count; i += 1) {
            let kind = 'ice';
            if (i === reinforcedIndex) kind = 'reinforced-ice';
            else if (i === hardIndex) kind = 'hard-obstacle';

            events.push({
                kind,
                gapSec: kind === 'reinforced-ice'
                    ? this.randomBetween(0.84, 1.02)
                    : this.randomBetween(0.48, 0.68)
            });
        }

        return events;
    }

    makeSwitchPattern(stage) {
        const forward = Math.random() < 0.5;
        const first = forward ? 'edible' : 'ice';
        const second = forward ? 'ice' : 'edible';
        const third = forward ? 'edible' : 'ice';

        const events = [
            { kind: first, gapSec: this.randomBetween(0.52, 0.64) },
            { kind: first === 'edible' && stage >= 1 && Math.random() < 0.25 ? 'coin' : first, gapSec: this.randomBetween(0.5, 0.64) },
            { kind: second, gapSec: this.randomBetween(0.86, 1.02) },
            { kind: third, gapSec: this.randomBetween(0.88, 1.04) }
        ];

        if (stage >= 2 && Math.random() < 0.35) {
            events.splice(3, 0, {
                kind: third === 'edible' ? 'big-edible' : 'reinforced-ice',
                gapSec: this.randomBetween(0.92, 1.08)
            });
        }

        return events;
    }

    makeRewardPattern(stage) {
        if (stage >= 2 && Math.random() < 0.5) {
            return [
                { kind: 'ice', gapSec: this.randomBetween(0.52, 0.64) },
                { kind: 'reinforced-ice', gapSec: this.randomBetween(0.92, 1.08) },
                { kind: 'ice', gapSec: this.randomBetween(0.54, 0.68) }
            ];
        }

        return [
            { kind: 'edible', gapSec: this.randomBetween(0.5, 0.62) },
            { kind: 'big-edible', gapSec: this.randomBetween(0.94, 1.12) },
            { kind: stage >= 1 && Math.random() < 0.35 ? 'coin' : 'edible', gapSec: this.randomBetween(0.5, 0.66) }
        ];
    }

    buildNextPattern() {
        const stage = this.getDifficultyStage();
        this.patternCounter += 1;

        if (stage === 0) return this.makeIntroPattern();

        const pool = [
            () => this.makeSwallowRun(stage),
            () => this.makeBiteRun(stage),
            () => this.makeSwitchPattern(stage)
        ];
        if (stage >= 2) pool.push(() => this.makeRewardPattern(stage));

        return this.choose(pool)?.() || this.makeSwallowRun(stage);
    }

    ensurePatternQueue() {
        if (this.patternQueue.length > 0) return;
        const next = this.buildNextPattern();
        this.patternQueue.push(...next);
    }

    buildItemMeta(spec = {}) {
        const kind = spec.kind || 'edible';
        const sizeScale = {
            edible: 1.0,
            'big-edible': 1.32,
            coin: 0.82,
            ice: 1.0,
            'reinforced-ice': 1.08,
            'hard-obstacle': 1.04
        }[kind] || 1;

        const base = {
            edible: this.choose(['f2', 'f3']) || 'f2',
            'big-edible': 'f1',
            coin: 'coin',
            ice: 'ice',
            'reinforced-ice': 'hard-ice',
            'hard-obstacle': 'hard-ice'
        }[kind] || 'f2';

        const itemType = {
            edible: 'food',
            'big-edible': 'food',
            coin: 'coin',
            ice: 'ice',
            'reinforced-ice': 'ice',
            'hard-obstacle': 'ice'
        }[kind] || 'food';

        return {
            kind,
            base,
            itemType,
            sizeScale,
            gapSec: Math.max(0.32, Number(spec.gapSec) || 0.52)
        };
    }

    createItem(spec) {
        if (!this.numberStrip) return null;
        const meta = this.buildItemMeta(spec);
        const el = document.createElement('div');
        el.className = 'number-circle';
        el.style.position = 'absolute';
        el.style.left = '0';
        el.style.top = '0';
        el.dataset.value = String(this.itemIdCounter);
        el.dataset.itemKind = meta.kind;
        el.dataset.itemType = meta.itemType;
        el.dataset.foodBase = meta.base;
        el.dataset.sizeScale = String(meta.sizeScale);
        el.dataset.processed = 'false';
        el.dataset.rewardCoins = meta.kind === 'reinforced-ice' ? '5' : '0';
        this.itemIdCounter += 1;

        this.ensureFoodCircle?.(el);
        this.applyDebugLabelToCircle?.(el);
        this.numberStrip.appendChild(el);

        const width = parseFloat(el.dataset.actualWidth || el.style.width || '112') || 112;
        const height = parseFloat(el.dataset.actualHeight || el.style.height || '112') || 112;

        const item = {
            id: this.itemIdCounter,
            el,
            kind: meta.kind,
            base: meta.base,
            worldX: this.spawnCursorX,
            width,
            height,
            resolved: false,
            removed: false,
            cleanupAt: 0,
            holdMs: 0
        };

        this.items.push(item);
        return item;
    }

    ensurePopulation() {
        const metrics = this.getViewportMetrics();
        if (!metrics || !this.numberStrip) return;

        if (this.spawnCursorX <= 0) {
            this.spawnCursorX = this.beltPosition + metrics.width + this.spawnPaddingPx;
        }

        const speedPxPerMs = this.getBaseSpeedPxMs(window.gameInstance?.timer) * Math.max(1, this.beltBoost);
        const speedPxPerSec = speedPxPerMs * 1000;

        while ((this.spawnCursorX - this.beltPosition) < (metrics.width + this.spawnPaddingPx + 220)) {
            this.ensurePatternQueue();
            const nextSpec = this.patternQueue.shift() || { kind: 'edible', gapSec: 0.56 };
            const gapPx = Math.max(72, nextSpec.gapSec * speedPxPerSec);
            const bodyPx = nextSpec.kind === 'big-edible' ? 158 : (nextSpec.kind === 'coin' ? 88 : 118);
            this.spawnCursorX += gapPx + bodyPx;
            this.createItem(nextSpec);
        }
    }

    syncItemSize(item) {
        if (!item?.el) return;
        const width = parseFloat(item.el.dataset.actualWidth || item.el.style.width || '0');
        const height = parseFloat(item.el.dataset.actualHeight || item.el.style.height || '0');
        if (Number.isFinite(width) && width > 0) item.width = width;
        if (Number.isFinite(height) && height > 0) item.height = height;
    }

    updateResolvedItems(nowMs) {
        this.items.forEach((item) => {
            if (!item?.resolved || item.removed) return;
            if (item.cleanupAt > 0 && nowMs < item.cleanupAt) return;
            if (item.el?.isConnected) item.el.remove();
            item.removed = true;
        });
        this.items = this.items.filter((item) => !item.removed);
    }

    updateItemLayouts() {
        const metrics = this.getViewportMetrics();
        if (!metrics) return;
        const stripHeight = this.numberStrip?.clientHeight || metrics.height || 0;

        this.items.forEach((item) => {
            if (!item?.el || item.removed) return;
            if (item.resolved) return;
            this.syncItemSize(item);
            const screenCenterX = item.worldX - this.beltPosition;
            const left = screenCenterX - (item.width / 2);
            const top = Math.max(0, (stripHeight - item.height) * 0.5);
            item.screenCenterX = screenCenterX;
            item.screenLeft = left;
            item.screenTop = top;
            item.el.style.setProperty('--item-x', `${left.toFixed(1)}px`);
            item.el.style.setProperty('--item-y', `${top.toFixed(1)}px`);
            item.el.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
        });
    }

    removeOffscreenItems() {
        this.items.forEach((item) => {
            if (item.removed || item.resolved) return;
            if ((item.worldX - this.beltPosition) < -this.despawnPaddingPx) {
                if (item.el?.isConnected) item.el.remove();
                item.removed = true;
            }
        });
        this.items = this.items.filter((item) => !item.removed);
    }

    update(timer) {
        if (!this.numberStrip) return;
        const nowMs = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();

        if (this.lastBeltUpdateTime === 0) {
            this.lastBeltUpdateTime = nowMs - 16;
            this.ensurePopulation();
            this.updateItemLayouts();
            return;
        }

        if (this.beltPauseStartTime != null) {
            this.lastBeltUpdateTime = nowMs;
            return;
        }

        const deltaMs = Math.max(0, nowMs - this.lastBeltUpdateTime);
        this.lastBeltUpdateTime = nowMs;

        const alpha = 1 - Math.exp(-this.beltBoostSmoothing * (deltaMs / 1000));
        this.beltBoost += (this.beltBoostTarget - this.beltBoost) * alpha;

        const baseSpeedPxMs = this.getBaseSpeedPxMs(timer);
        const effectiveSpeedPxMs = baseSpeedPxMs * Math.max(1, this.beltBoost);
        this.lastKnownSpeedPxPerSec = effectiveSpeedPxMs * 1000;

        if (!window.gameInstance?.isStunned?.()) {
            this.beltPosition += effectiveSpeedPxMs * deltaMs;
            this.distanceTravelledPx += effectiveSpeedPxMs * deltaMs;
        }

        this.ensurePopulation();
        this.updateResolvedItems(nowMs);
        this.removeOffscreenItems();
        this.updateItemLayouts();
        this.checkCollisionsAndAutoBite?.(this.getGameArea?.());
    }

    findNearestItemInWindow(leftX, rightX) {
        let best = null;
        let bestDistance = Infinity;
        this.items.forEach((item) => {
            if (!item || item.removed || item.resolved) return;
            const centerX = item.screenCenterX;
            if (!Number.isFinite(centerX)) return;
            if (centerX < leftX || centerX > rightX) return;
            const distance = Math.abs(((leftX + rightX) * 0.5) - centerX);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = item;
            }
        });
        return best;
    }

    resolveItem(item, resolution = {}) {
        if (!item || item.resolved || item.removed) return false;
        const nowMs = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();

        item.resolved = true;
        item.holdMs = Math.max(0, resolution.holdMs || 220);
        item.cleanupAt = nowMs + item.holdMs;
        item.el.dataset.processed = 'true';
        item.el.classList.add('passed', 'item-resolved');
        if (resolution.effect) {
            item.el.classList.add(`item-effect--${resolution.effect}`);
        }

        if (resolution.snapCapture) {
            const fromLeft = Number.isFinite(item.screenLeft) ? item.screenLeft : 0;
            const fromTop = Number.isFinite(item.screenTop) ? item.screenTop : 0;
            const toCenterX = Number.isFinite(resolution.snapX) ? resolution.snapX : item.screenCenterX;
            const toCenterY = Number.isFinite(resolution.snapY) ? resolution.snapY : ((fromTop + (item.height * 0.5)));
            const toLeft = toCenterX - (item.width * 0.5);
            const toTop = toCenterY - (item.height * 0.5);
            const dx = toLeft - fromLeft;
            const dy = toTop - fromTop;
            item.el.classList.add('item-snap-captured');
            item.el.style.willChange = 'transform, opacity, filter';
            item.el.style.transition = 'transform 90ms ease-out, opacity 120ms ease-out, filter 120ms ease-out';
            item.el.style.transform = `translate3d(${fromLeft.toFixed(1)}px, ${fromTop.toFixed(1)}px, 0)`;
            window.requestAnimationFrame(() => {
                item.el.style.transform = `translate3d(${(fromLeft + dx).toFixed(1)}px, ${(fromTop + dy).toFixed(1)}px, 0)`;
                item.el.style.filter = 'drop-shadow(0 0 10px rgba(255,255,255,0.55))';
            });
            window.setTimeout(() => {
                item.el.classList.add('consumed');
            }, Math.max(110, item.holdMs - 120));
        } else {
            item.el.classList.add('consumed');
        }

        if (resolution.effect === 'fatal-jam') {
            item.cleanupAt = nowMs + Math.max(900, item.holdMs || 0);
        }
        return true;
    }
}
