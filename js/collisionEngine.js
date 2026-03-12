class CollisionEngine {
    constructor(options) {
        this.getItems = options.getItems;
        this.getInteractionMetrics = options.getInteractionMetrics;
        this.getGameplayState = options.getGameplayState;
        this.getBeltSpeedPxPerSec = options.getBeltSpeedPxPerSec;
        this.resolveItem = options.resolveItem;
        this.setAutoBiteHint = options.setAutoBiteHint;
        this.triggerTeethHitFx = options.triggerTeethHitFx;
        this.emitEvent = options.emitEvent;

        this.lastMetrics = null;
        this.lastActionCandidate = null;
        this.warningLeadTimeSec = 0.5;
        this.actionWindowSec = 0.2;
    }

    reset() {
        this.lastMetrics = null;
        this.lastActionCandidate = null;
        this.setAutoBiteHint?.(false);
        this.clearWarningFlags();
    }

    getNowMs() {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }

    isFoodLike(kind) {
        return kind === 'edible' || kind === 'big-edible' || kind === 'coin';
    }

    isObstacle(kind) {
        return kind === 'ice' || kind === 'hard-obstacle' || kind === 'reinforced-ice';
    }

    requiresAction(kind) {
        return kind === 'big-edible' || kind === 'reinforced-ice' || kind === 'hard-obstacle';
    }

    getBeltSpeedPxPerSecSafe() {
        const raw = Number(this.getBeltSpeedPxPerSec?.() || 0);
        return Number.isFinite(raw) && raw > 0 ? raw : 220;
    }

    makePayload(item, extra = {}) {
        return {
            itemId: item?.id,
            itemKind: item?.kind,
            x: Number.isFinite(item?.screenCenterX) ? item.screenCenterX : undefined,
            y: this.lastMetrics?.mouthCenterY,
            ...extra
        };
    }

    emitResult(item, extra = {}) {
        this.emitEvent?.('ITEM_RESOLVED', this.makePayload(item, extra));
    }

    getSortedItems() {
        const items = Array.isArray(this.getItems?.()) ? this.getItems() : [];
        return items
            .filter((item) => item && !item.removed && !item.resolved)
            .sort((a, b) => (a.screenCenterX || 0) - (b.screenCenterX || 0));
    }

    itemOverlapsXRange(item, leftX, rightX) {
        if (!item || !Number.isFinite(leftX) || !Number.isFinite(rightX)) return false;
        const itemLeft = Number.isFinite(item.screenLeft) ? item.screenLeft : ((item.screenCenterX || 0) - ((item.width || 0) * 0.5));
        const itemRight = itemLeft + Math.max(1, item.width || 0);
        return itemRight >= leftX && itemLeft <= rightX;
    }

    itemLeadEdgeInRange(item, leftX, rightX) {
        if (!item || !Number.isFinite(leftX) || !Number.isFinite(rightX)) return false;
        const itemLeft = Number.isFinite(item.screenLeft) ? item.screenLeft : ((item.screenCenterX || 0) - ((item.width || 0) * 0.5));
        return itemLeft >= leftX && itemLeft <= rightX;
    }

    getItemBounds(item) {
        const left = Number.isFinite(item?.screenLeft)
            ? item.screenLeft
            : ((item?.screenCenterX || 0) - ((item?.width || 0) * 0.5));
        const width = Math.max(1, Number(item?.width || 0));
        return {
            left,
            right: left + width
        };
    }

    updateActionCandidate(metrics) {
        const items = this.getSortedItems();
        let best = null;
        let bestDistance = Infinity;
        const nearEdgeX = metrics.actionLeftX;

        items.forEach((item) => {
            if (!this.itemOverlapsXRange(item, metrics.actionLeftX, metrics.actionRightX)) return;
            const bounds = this.getItemBounds(item);
            const distance = Math.abs(bounds.right - nearEdgeX);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = item;
            }
        });

        this.lastActionCandidate = best;
        return best;
    }

    updateAutoBiteHint(state, metrics) {
        if (!state || state.mode !== 'bite' || state.stunned) {
            this.setAutoBiteHint?.(false);
            return;
        }

        const items = this.getSortedItems();
        const active = items.some((item) => {
            return this.itemOverlapsXRange(item, metrics.autoBiteLeftX, metrics.autoBiteRightX);
        });
        this.setAutoBiteHint?.(active);
    }

    clearWarningFlags() {
        const items = this.getSortedItems();
        items.forEach((item) => {
            item?.setWarning?.(false);
            item?.el?.classList?.remove?.('is-warning');
        });
    }

    updateWarningZone(state, metrics) {
        const items = this.getSortedItems();
        const warningLeftX = Number.isFinite(metrics.warningLeftX)
            ? metrics.warningLeftX
            : (metrics.actionRightX + 10);
        const warningRightX = Number.isFinite(metrics.warningRightX)
            ? metrics.warningRightX
            : (warningLeftX + (this.getBeltSpeedPxPerSecSafe() * this.warningLeadTimeSec));

        items.forEach((item) => {
            const inWarning = this.itemOverlapsXRange(item, warningLeftX, warningRightX);
            item?.setWarning?.(inWarning);
            item?.el?.classList?.toggle?.('is-warning', inWarning);
        });
    }

    resolveAutoItem(item, state) {
        const kind = item?.kind;
        if (!kind) return false;

        if (state.mode === 'swallow') {
            if (kind === 'edible') {
                this.resolveItem?.(item, { effect: 'swallow' });
                this.emitResult(item, { scoreDelta: 1, effect: 'swallow' });
                return true;
            }

            if (kind === 'coin') {
                this.resolveItem?.(item, { effect: 'swallow' });
                this.emitResult(item, { coinsDelta: 1, effect: 'swallow' });
                return true;
            }

            if (kind === 'big-edible') {
                this.resolveItem?.(item, { effect: 'swallow-heavy' });
                this.emitResult(item, {
                    scoreDelta: 1,
                    stunMs: 240,
                    effect: 'swallow-heavy',
                    reason: 'MISSED_ACTION_SWALLOW'
                });
                return true;
            }

            if (kind === 'ice') {
                this.resolveItem?.(item, { effect: 'ice-hit' });
                this.emitResult(item, {
                    damage: (state.hp || 0) > 0 ? 1 : 0,
                    effect: 'ice-hit',
                    reason: 'SWALLOW_ICE'
                });
                return true;
            }

            this.resolveItem?.(item, { effect: 'fatal-jam', holdMs: 1000 });
            this.emitResult(item, { fatal: true, effect: 'fatal-jam', fatalReason: 'SWALLOW_BIG_ICE' });
            return true;
        }

        if (kind === 'ice') {
            this.resolveItem?.(item, { effect: 'crush' });
            this.emitResult(item, { effect: 'crush' });
            return true;
        }

        if (kind === 'reinforced-ice') {
            this.resolveItem?.(item, { effect: 'stun' });
            this.emitResult(item, { stunMs: 260, effect: 'stun', reason: 'MISSED_ACTION_BITE_ICE' });
            return true;
        }

        if (kind === 'hard-obstacle') {
            this.resolveItem?.(item, { effect: 'stun' });
            this.emitResult(item, {
                damage: (state.hp || 0) > 0 ? 1 : 0,
                stunMs: 320,
                effect: 'stun',
                reason: 'MISSED_ACTION_BITE_HARD_ICE'
            });
            return true;
        }

        if (kind === 'edible') {
            this.resolveItem?.(item, { effect: 'bite-food' });
            this.emitResult(item, { effect: 'bite-food' });
            return true;
        }

        if (kind === 'coin') {
            this.resolveItem?.(item, { effect: 'bite-coin' });
            this.emitResult(item, { coinsDelta: 1, effect: 'bite-coin' });
            return true;
        }

        if (kind === 'big-edible') {
            this.resolveItem?.(item, { effect: 'clunk' });
            this.emitResult(item, {
                damage: (state.hp || 0) > 0 ? 1 : 0,
                stunMs: 260,
                effect: 'clunk',
                reason: 'MISSED_ACTION_BITE_FOOD'
            });
            return true;
        }

        return false;
    }

    handleAction(container) {
        const metrics = this.getInteractionMetrics?.(container);
        const state = this.getGameplayState?.();
        if (!metrics || !state || state.stunned || state.gameStatus !== 'RUNNING') return false;

        this.lastMetrics = metrics;
        const item = this.updateActionCandidate(metrics);
        if (!item) return false;
        const snapX = state.mode === 'bite'
            ? (metrics.resolveBiteX ?? metrics.mouthRightX)
            : (metrics.resolveSwallowX ?? metrics.mouthRightX);
        const snapY = metrics.mouthCenterY;
        const snapResolution = {
            holdMs: 300,
            snapCapture: true,
            snapX,
            snapY
        };

        if (state.mode === 'bite') {
            this.resolveItem?.(item, { ...snapResolution, effect: 'action-bite' });
            this.emitResult(item, {
                scoreDelta: item.kind === 'big-edible' ? 5 : 0,
                coinsDelta: item.kind === 'coin' ? 1 : 0,
                effect: 'action-bite',
                actionUsed: true
            });
            return true;
        }

        this.resolveItem?.(item, { ...snapResolution, effect: 'action-swallow' });
        this.emitResult(item, {
            scoreDelta: item.kind === 'big-edible' ? 5 : (item.kind === 'edible' ? 1 : 0),
            coinsDelta: item.kind === 'coin' ? 1 : 0,
            effect: 'action-swallow',
            actionUsed: true
        });
        return true;
    }

    check(container) {
        const metrics = this.getInteractionMetrics?.(container);
        const state = this.getGameplayState?.();
        if (!metrics || !state) return;
        this.lastMetrics = metrics;
        this.updateWarningZone(state, metrics);
        this.updateActionCandidate(metrics);
        this.updateAutoBiteHint(state, metrics);
        if (state.stunned || state.gameStatus !== 'RUNNING') return;

        const items = this.getSortedItems();
        const resolveX = state.mode === 'swallow'
            ? (metrics.resolveSwallowX ?? metrics.resolveBiteX ?? metrics.mouthRightX)
            : (metrics.resolveBiteX ?? metrics.resolveSwallowX ?? metrics.mouthRightX);
        for (const item of items) {
            const itemX = item.screenCenterX;
            if (!Number.isFinite(itemX)) continue;
            if (itemX > resolveX) break;
            this.resolveAutoItem(item, state);
            break;
        }
    }
}
