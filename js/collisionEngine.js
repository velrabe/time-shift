class CollisionEngine {
    constructor(options) {
        this.getItems = options.getItems;
        this.getInteractionMetrics = options.getInteractionMetrics;
        this.getGameplayState = options.getGameplayState;
        this.resolveItem = options.resolveItem;
        this.setAutoBiteHint = options.setAutoBiteHint;
        this.triggerTeethHitFx = options.triggerTeethHitFx;
        this.emitEvent = options.emitEvent;

        this.lastMetrics = null;
        this.lastActionCandidate = null;
    }

    reset() {
        this.lastMetrics = null;
        this.lastActionCandidate = null;
        this.setAutoBiteHint?.(false);
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

    updateActionCandidate(metrics) {
        const items = this.getSortedItems();
        let best = null;
        let bestDistance = Infinity;
        const centerX = (metrics.actionLeftX + metrics.actionRightX) * 0.5;

        items.forEach((item) => {
            const itemX = item.screenCenterX;
            if (!Number.isFinite(itemX)) return;
            if (!this.itemLeadEdgeInRange(item, metrics.actionLeftX, metrics.actionRightX)) return;
            const distance = Math.abs(itemX - centerX);
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
                this.resolveItem?.(item, { effect: 'stun' });
                this.emitResult(item, { stunMs: 300, effect: 'stun', reason: 'MISSED_MEGA_SWALLOW' });
                return true;
            }

            this.resolveItem?.(item, { effect: 'fatal-jam', holdMs: 1000 });
            this.emitResult(item, { fatal: true, effect: 'fatal-jam', fatalReason: 'SWALLOW_STUCK' });
            return true;
        }

        if (this.isObstacle(kind) && (state.hp || 0) <= 0) {
            this.resolveItem?.(item, { effect: 'fatal-jam', holdMs: 1000 });
            this.emitResult(item, { fatal: true, effect: 'fatal-jam', fatalReason: 'TEETH_JAMMED' });
            return true;
        }

        if (kind === 'ice') {
            this.resolveItem?.(item, { effect: 'crush' });
            this.emitResult(item, { scoreDelta: 1, effect: 'crush' });
            return true;
        }

        if (kind === 'reinforced-ice') {
            this.resolveItem?.(item, { effect: 'fatal-jam', holdMs: 1000 });
            this.emitResult(item, { fatal: true, effect: 'fatal-jam', fatalReason: 'MISSED_CHOMP' });
            return true;
        }

        if (kind === 'hard-obstacle') {
            this.resolveItem?.(item, { effect: 'clunk' });
            this.emitResult(item, {
                damage: (state.hp || 0) > 0 ? 1 : 0,
                stunMs: 300,
                effect: 'clunk',
                reason: 'HARD_OBSTACLE'
            });
            return true;
        }

        if (this.isFoodLike(kind)) {
            this.resolveItem?.(item, { effect: 'clunk' });
            this.emitResult(item, {
                damage: (state.hp || 0) > 0 ? 1 : 0,
                stunMs: 100,
                effect: 'clunk',
                reason: 'WRONG_BITE_FOOD'
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

        if (state.mode === 'bite') {
            if (this.isObstacle(item.kind) && (state.hp || 0) <= 0) {
                this.resolveItem?.(item, { effect: 'fatal-jam', holdMs: 1000 });
                this.emitResult(item, {
                    fatal: true,
                    effect: 'fatal-jam',
                    actionUsed: true,
                    fatalReason: 'TEETH_JAMMED'
                });
                return true;
            }

            if (item.kind === 'reinforced-ice') {
                this.resolveItem?.(item, { effect: 'action-chomp' });
                this.emitResult(item, { coinsDelta: 5, effect: 'action-chomp', actionUsed: true });
                return true;
            }

            this.resolveItem?.(item, { effect: 'clunk' });
            this.triggerTeethHitFx?.();
            this.emitResult(item, {
                damage: (state.hp || 0) > 0 ? 1 : 0,
                stunMs: 100,
                effect: 'clunk',
                actionUsed: true,
                reason: 'BAD_CHOMP'
            });
            return true;
        }

        if (item.kind === 'big-edible') {
            this.resolveItem?.(item, { effect: 'action-swallow' });
            this.emitResult(item, { scoreDelta: 5, effect: 'action-swallow', actionUsed: true });
            return true;
        }

        if (item.kind === 'ice' || item.kind === 'hard-obstacle' || item.kind === 'reinforced-ice') {
            this.resolveItem?.(item, { effect: 'fatal-crash', holdMs: 1000 });
            this.emitResult(item, {
                fatal: true,
                effect: 'fatal-crash',
                actionUsed: true,
                fatalReason: 'MEGA_SWALLOW_DANGER'
            });
            return true;
        }

        return false;
    }

    check(container) {
        const metrics = this.getInteractionMetrics?.(container);
        const state = this.getGameplayState?.();
        if (!metrics || !state) return;
        this.lastMetrics = metrics;
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
