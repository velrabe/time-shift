class PixiConveyor {
    constructor(options = {}) {
        this.layer = options.layer || null;
        this.effects = options.effects || null;
        this.getViewportMetrics = options.getViewportMetrics || (() => null);
        this.getInteractionMetrics = options.getInteractionMetrics || (() => null);
        this.checkCollisionsAndAutoBite = options.checkCollisionsAndAutoBite || (() => {});

        this.items = [];
        this.patternQueue = [];
        this.itemIdCounter = 0;
        this.patternCounter = 0;

        this.lookaheadTimeSec = 2.95;
        this.spawnPaddingPx = 180;
        this.despawnPaddingPx = 220;
        this.beltBoost = 1;
        this.beltBoostTarget = 1;
        this.beltBoostSmoothing = 4.5;
        this.beltPosition = 0;
        this.spawnCursorX = 0;
        this.distanceTravelledPx = 0;
        this.lastBeltUpdateTime = 0;
        this.beltPauseStartTime = null;
        this.lastKnownSpeedPxPerSec = 220;

        this.sizeByKind = {
            edible: { width: 116, height: 116 },
            'big-edible': { width: 156, height: 156 },
            coin: { width: 88, height: 88 },
            ice: { width: 118, height: 118 },
            'reinforced-ice': { width: 132, height: 132 },
            'hard-obstacle': { width: 128, height: 128 }
        };
    }

    getGameScale() {
        const metrics = this.getViewportMetrics?.();
        const scaleW = (metrics?.width || 1440) / 1440;
        const scaleH = (metrics?.height || 900) / 900;
        return Math.max(0.48, Math.min(1, Math.min(scaleW, scaleH)));
    }

    resetWindow() {
        this.items.forEach((item) => {
            try {
                item.container?.destroy?.({ children: true });
            } catch (e) {
                // ignore
            }
        });
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

    renderNumberStrip() {
        this.ensurePopulation();
        this.updateItemLayouts();
    }

    getActiveItems() {
        return this.items.filter((item) => !item.removed);
    }

    getBaseSpeedPxMs(timer) {
        const metrics = this.getViewportMetrics?.();
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
            if (i === bonusIndex) kind = 'big-edible';
            else if (stage >= 1 && Math.random() < 0.18) kind = 'coin';
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
        const base = {
            edible: this.choose(['f2', 'f3']) || 'f2',
            'big-edible': 'f1',
            coin: 'coin',
            ice: 'ice',
            'reinforced-ice': 'hard-ice',
            'hard-obstacle': 'hard-ice'
        }[kind] || 'f2';
        return {
            kind,
            base,
            gapSec: Math.max(0.32, Number(spec.gapSec) || 0.52)
        };
    }

    getTextureUrl(item) {
        if (!item) return 'img/food/f2-s.svg';
        if (window.gameInstance?.isCoinRushActive?.() && item.kind !== 'ice' && item.kind !== 'reinforced-ice' && item.kind !== 'hard-obstacle') {
            return 'img/food/coin.svg';
        }
        if (item.kind === 'coin') return 'img/food/coin.svg';
        if (item.kind === 'ice') return 'img/food/ice.svg';
        if (item.kind === 'reinforced-ice' || item.kind === 'hard-obstacle') return 'img/food/hard-ice.svg';
        return `img/food/${item.base || 'f2'}-s.svg`;
    }

    createMarker(kind, width, height) {
        const marker = new PIXI.Graphics();
        const isIce = kind === 'ice' || kind === 'reinforced-ice' || kind === 'hard-obstacle';
        const markerWidth = width * (kind === 'big-edible' ? 0.82 : 0.68);
        const markerHeight = height * (kind === 'big-edible' ? 0.82 : 0.68);
        marker.beginFill(isIce ? 0xa2d7ff : 0xffffff, isIce ? 0.32 : 0.22);
        if (isIce) {
            marker.drawRoundedRect(-(markerWidth * 0.5), -(markerHeight * 0.5), markerWidth, markerHeight, 10);
        } else {
            marker.drawCircle(0, 0, Math.max(markerWidth, markerHeight) * 0.5);
        }
        marker.endFill();
        return marker;
    }

    createItem(spec) {
        if (!this.layer || typeof PIXI === 'undefined') return null;
        const meta = this.buildItemMeta(spec);
        const baseSize = this.sizeByKind[meta.kind] || this.sizeByKind.edible;
        const gameScale = this.getGameScale();
        const size = {
            width: baseSize.width * gameScale,
            height: baseSize.height * gameScale
        };
        const textureUrl = this.getTextureUrl(meta);

        const container = new PIXI.Container();
        container.sortableChildren = true;

        const warningHalo = new PIXI.Graphics();
        warningHalo.visible = false;
        warningHalo.alpha = 0.45;
        warningHalo.lineStyle(4, 0xff6a6a, 0.95);
        warningHalo.drawRoundedRect(-(size.width * 0.55), -(size.height * 0.55), size.width * 1.1, size.height * 1.1, 18);
        container.addChild(warningHalo);

        const marker = this.createMarker(meta.kind, size.width, size.height);
        marker.zIndex = 1;
        container.addChild(marker);

        const sprite = PIXI.Sprite.from(textureUrl);
        sprite.anchor.set(0.5);
        sprite.width = size.width;
        sprite.height = size.height;
        sprite.zIndex = 2;
        container.addChild(sprite);

        this.layer.addChild(container);

        const item = {
            id: this.itemIdCounter + 1,
            kind: meta.kind,
            base: meta.base,
            width: size.width,
            height: size.height,
            worldX: this.spawnCursorX,
            container,
            marker,
            sprite,
            warningHalo,
            resolved: false,
            removed: false,
            cleanupAt: 0,
            holdMs: 0,
            itemTextureUrl: textureUrl,
            setWarning: (active) => {
                warningHalo.visible = !!active;
                sprite.scale.set(active ? 1.05 : 1);
            }
        };
        this.itemIdCounter += 1;
        this.items.push(item);
        return item;
    }

    ensurePopulation() {
        const metrics = this.getViewportMetrics?.();
        if (!metrics || !this.layer) return;
        if (this.spawnCursorX <= 0) {
            this.spawnCursorX = this.beltPosition + metrics.width + this.spawnPaddingPx;
        }

        const speedPxPerMs = this.getBaseSpeedPxMs(window.gameInstance?.timer) * Math.max(1, this.beltBoost);
        const speedPxPerSec = speedPxPerMs * 1000;
        const gameScale = this.getGameScale();

        while ((this.spawnCursorX - this.beltPosition) < (metrics.width + this.spawnPaddingPx + 220)) {
            this.ensurePatternQueue();
            const nextSpec = this.patternQueue.shift() || { kind: 'edible', gapSec: 0.56 };
            const gapPx = Math.max(72 * gameScale, nextSpec.gapSec * speedPxPerSec);
            const bodySizeBase = this.sizeByKind[nextSpec.kind] || this.sizeByKind.edible;
            const bodySize = {
                width: bodySizeBase.width * gameScale,
                height: bodySizeBase.height * gameScale
            };
            this.spawnCursorX += gapPx + Math.max(bodySize.width, bodySize.height);
            this.createItem(nextSpec);
        }
    }

    updateResolvedItems(nowMs) {
        this.items.forEach((item) => {
            if (!item || item.removed) return;
            if (item.resolved && item.capture) {
                const duration = Math.max(1, item.capture.durationMs || 1);
                const progress = Math.max(0, Math.min(1, (nowMs - item.capture.startedAt) / duration));
                item.container.x = item.capture.fromX + ((item.capture.toX - item.capture.fromX) * progress);
                item.container.y = item.capture.fromY + ((item.capture.toY - item.capture.fromY) * progress);
                item.container.alpha = 1 - (0.6 * progress);
                item.container.scale.set(1 - (0.1 * progress));
            }
            if (!item.resolved) return;
            if (item.cleanupAt > 0 && nowMs < item.cleanupAt) return;
            item.container?.destroy?.({ children: true });
            item.removed = true;
        });
        this.items = this.items.filter((item) => !item.removed);
    }

    updateItemLayouts() {
        const metrics = this.getViewportMetrics?.();
        const interaction = this.getInteractionMetrics?.() || null;
        if (!metrics) return;
        const laneY = metrics.stripCenterY || interaction?.mouthCenterY || metrics.height * 0.55;
        this.items.forEach((item) => {
            if (!item || item.removed || item.resolved) return;
            const screenCenterX = item.worldX - this.beltPosition;
            const left = screenCenterX - (item.width * 0.5);
            const top = laneY - (item.height * 0.5);
            item.screenCenterX = screenCenterX;
            item.screenLeft = left;
            item.screenTop = top;
            item.container.position.set(screenCenterX, top + (item.height * 0.5));
            item.container.alpha = 1;
            item.container.scale.set(1);
        });
    }

    removeOffscreenItems() {
        this.items.forEach((item) => {
            if (!item || item.removed || item.resolved) return;
            if ((item.worldX - this.beltPosition) < -this.despawnPaddingPx) {
                item.container?.destroy?.({ children: true });
                item.removed = true;
            }
        });
        this.items = this.items.filter((item) => !item.removed);
    }

    refreshVisibleItemTypes() {
        this.items.forEach((item) => {
            if (!item || item.removed) return;
            const nextUrl = this.getTextureUrl(item);
            if (item.itemTextureUrl === nextUrl) return;
            item.itemTextureUrl = nextUrl;
            item.sprite.texture = PIXI.Texture.from(nextUrl);
        });
    }

    update(timer) {
        if (!this.layer) return;
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

        this.beltPosition += effectiveSpeedPxMs * deltaMs;
        this.distanceTravelledPx += effectiveSpeedPxMs * deltaMs;

        this.ensurePopulation();
        this.updateResolvedItems(nowMs);
        this.removeOffscreenItems();
        this.refreshVisibleItemTypes();
        this.updateItemLayouts();
        this.checkCollisionsAndAutoBite?.();
    }

    resolveItem(item, resolution = {}) {
        if (!item || item.resolved || item.removed) return false;
        const nowMs = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
        item.resolved = true;
        item.holdMs = Math.max(0, resolution.holdMs || 220);
        item.cleanupAt = nowMs + item.holdMs;

        if (resolution.effect === 'fatal-jam') {
            item.cleanupAt = nowMs + Math.max(900, item.holdMs || 0);
            item.sprite.tint = 0x86d8ff;
            item.marker.alpha = 0.7;
        } else if (resolution.effect && String(resolution.effect).includes('bite')) {
            item.sprite.tint = 0xffe3b8;
        }

        if (resolution.snapCapture) {
            const fromX = Number.isFinite(item.screenCenterX) ? item.screenCenterX : item.container.x;
            const fromY = Number.isFinite(item.container?.y) ? item.container.y : 0;
            const toX = Number.isFinite(resolution.snapX) ? resolution.snapX : fromX;
            const toY = Number.isFinite(resolution.snapY) ? resolution.snapY : fromY;
            item.capture = {
                startedAt: nowMs,
                durationMs: Math.max(90, item.holdMs || 120),
                fromX,
                fromY,
                toX,
                toY
            };
            if (this.effects && item.itemTextureUrl) {
                this.effects.animateEatIntoMouth(item.itemTextureUrl, fromX, fromY, toX, toY, item.width, item.height);
                item.container.alpha = 0;
            }
        } else {
            item.container.alpha = 0.25;
        }

        return true;
    }
}
