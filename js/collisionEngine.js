class CollisionEngine {
    constructor(options) {
        this.getNumberStrip = options.getNumberStrip;
        this.getPenguinParts = options.getPenguinParts;
        this.isMouthOpen = options.isMouthOpen;
        this.isMouthFullyClosed = options.isMouthFullyClosed;
        this.triggerTeethHitFx = options.triggerTeethHitFx;
        this.isDebug = options.isDebug;
        this.getDebugState = options.getDebugState;
        this.animateEatIntoMouth = options.animateEatIntoMouth;
        this.updateDebugObjectBoxes = options.updateDebugObjectBoxes;
        this.updateDebugOverlay = options.updateDebugOverlay;
        this.dbgLog = options.dbgLog;
        this.emitEvent = options.emitEvent;

        this.deathTriggered = false;
    }

    reset() {
        this.deathTriggered = false;
    }

    getMouthBounds(containerRect, jawTopRect, jawBotRect) {
        return {
            jawRight: (jawBotRect.right - containerRect.left),
            jawTop: Math.min(jawTopRect.top, jawBotRect.top) - containerRect.top,
            jawBottom: Math.max(jawTopRect.bottom, jawBotRect.bottom) - containerRect.top
        };
    }

    getPathPolyOnScreen(pathEl, sampleCount = 20) {
        if (!pathEl || typeof pathEl.getTotalLength !== 'function') return null;
        const len = pathEl.getTotalLength();
        if (!Number.isFinite(len) || len <= 0) return null;
        const ctm = pathEl.getScreenCTM?.();
        if (!ctm) return null;

        const points = [];
        const steps = Math.max(4, sampleCount);
        for (let i = 0; i < steps; i += 1) {
            const t = (i / (steps - 1)) * len;
            const p = pathEl.getPointAtLength(t);
            if (!p) continue;
            const screenPt = (typeof DOMPoint === 'function')
                ? new DOMPoint(p.x, p.y).matrixTransform(ctm)
                : { x: (p.x * ctm.a) + (p.y * ctm.c) + ctm.e, y: (p.x * ctm.b) + (p.y * ctm.d) + ctm.f };
            points.push({ x: screenPt.x, y: screenPt.y });
        }
        return points.length >= 3 ? points : null;
    }

    polygonsOverlapSAT(polyA, polyB) {
        if (!polyA || !polyB) return false;
        const axes = [];
        const addAxes = (poly) => {
            for (let i = 0; i < poly.length; i++) {
                const a = poly[i];
                const b = poly[(i + 1) % poly.length];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const nx = -dy;
                const ny = dx;
                const len = Math.hypot(nx, ny) || 1;
                axes.push({ x: nx / len, y: ny / len });
            }
        };
        addAxes(polyA);
        addAxes(polyB);

        const project = (poly, axis) => {
            let min = Infinity;
            let max = -Infinity;
            for (const p of poly) {
                const v = p.x * axis.x + p.y * axis.y;
                if (v < min) min = v;
                if (v > max) max = v;
            }
            return { min, max };
        };

        for (const axis of axes) {
            const pa = project(polyA, axis);
            const pb = project(polyB, axis);
            if (pa.max < pb.min || pb.max < pa.min) return false;
        }
        return true;
    }

    check(container) {
        const numberStrip = this.getNumberStrip?.();
        if (!numberStrip || this.deathTriggered) return;

        const parts = this.getPenguinParts?.();
        if (!parts?.root) return;

        const containerRect = container.getBoundingClientRect();
        const jawTopRect = parts.topJaw?.getBoundingClientRect?.() || null;
        const jawBotRect = parts.botJaw?.getBoundingClientRect?.() || null;
        if (!jawTopRect || !jawBotRect) return;

        const { jawRight, jawTop, jawBottom } = this.getMouthBounds(containerRect, jawTopRect, jawBotRect);
        const mouthOpen = !!this.isMouthOpen?.();
        const mouthFullyClosed = !!this.isMouthFullyClosed?.();
        const rightColliderPoly = this.getPathPolyOnScreen(parts.rightColliderPath, 24);
        const topColliderPoly = this.getPathPolyOnScreen(parts.topColliderPath, 24);
        const botColliderPoly = this.getPathPolyOnScreen(parts.botColliderPath, 24);

        const circles = Array.from(numberStrip.querySelectorAll('.number-circle:not(.passed)'));
        let nearestCircle = null;
        let nearestDistance = Infinity;
        let collidingCircle = null;

        for (const circle of circles) {
            if (circle.dataset.processed === 'true') continue;
            const itemType = circle.dataset?.itemType || 'food';
            const isCoin = itemType === 'coin';

            const circleRect = circle.getBoundingClientRect();
            const imgEl = circle.querySelector('img.food-img');
            const imgRect = imgEl?.getBoundingClientRect?.() || null;

            const imgLeft = (imgRect ? imgRect.left : circleRect.left) - containerRect.left;
            const imgRight = (imgRect ? imgRect.right : circleRect.right) - containerRect.left;
            const imgTop = (imgRect ? imgRect.top : circleRect.top) - containerRect.top;
            const imgBottom = (imgRect ? imgRect.bottom : circleRect.bottom) - containerRect.top;

            const circleCenterX = (imgLeft + imgRight) / 2;
            const distanceToJaw = Math.abs(circleCenterX - jawRight);
            if (distanceToJaw < nearestDistance) {
                nearestDistance = distanceToJaw;
                nearestCircle = circle;
            }

            const foodRectPage = imgRect || circleRect;
            const overlapsMouthVert = (imgBottom >= jawTop) && (imgTop <= jawBottom);
            const imgCenterX = (imgLeft + imgRight) / 2;
            const swallowDepthPx = Math.max(14, Math.round((jawBottom - jawTop) * 0.22));
            const stomachThresholdX = jawRight - swallowDepthPx;
            const fullyPastJawLine = overlapsMouthVert && (imgCenterX <= stomachThresholdX);

            const foodPoly = [
                { x: foodRectPage.left, y: foodRectPage.top },
                { x: foodRectPage.right, y: foodRectPage.top },
                { x: foodRectPage.right, y: foodRectPage.bottom },
                { x: foodRectPage.left, y: foodRectPage.bottom }
            ];
            const topCollision = this.polygonsOverlapSAT(foodPoly, topColliderPoly);
            const botCollision = this.polygonsOverlapSAT(foodPoly, botColliderPoly);
            const teethCollision = topCollision || botCollision;
            const rightColliderHit = this.polygonsOverlapSAT(foodPoly, rightColliderPoly);
            // В полностью закрытом состоянии приоритет у right-collider:
            // даже если геометрически есть пересечение с зубным collider, это уже "closed mouth left hit".
            const closedMouthLeftHit = mouthFullyClosed && overlapsMouthVert && rightColliderHit;
            // "Невовремя захлопнулась" = рот уже не открыт, но ещё не полностью закрылся.
            const timingJawHit = (!mouthOpen) && (!mouthFullyClosed) && teethCollision;
            const foodDeathCollision = timingJawHit || closedMouthLeftHit;

            // Монета:
            // - засчитывается только при "укусе" двумя челюстями;
            // - если врезалась при закрытом рте — это game over;
            // - если проглотили при открытом рте — ничего не начисляем.
            const coinBiteCollision = (!mouthFullyClosed) && topCollision && botCollision;
            const coinDeathCollision = mouthFullyClosed && (rightColliderHit || teethCollision);
            const isDeathCollision = isCoin ? coinDeathCollision : foodDeathCollision;

            if (this.isDebug?.()) {
                if (isDeathCollision) circle.classList.add('game-over-trigger');
                else circle.classList.remove('game-over-trigger');
            }

            if (isDeathCollision) {
                collidingCircle = circle;
                const value = parseInt(circle.dataset.value, 10) || 0;
                const reason = timingJawHit
                    ? (topCollision ? 'TIMING_JAW_HIT_TOP' : 'TIMING_JAW_HIT_BOT')
                    : 'CLOSED_MOUTH_LEFT_HIT';

                if (this.isDebug?.()) {
                    const dangerRect = foodRectPage;
                    this.updateDebugObjectBoxes?.(circle, containerRect);
                    this.updateDebugOverlay?.({
                        containerRect,
                        jawTopRect,
                        jawBotRect,
                        teethTopPoly: topColliderPoly,
                        teethBotPoly: botColliderPoly,
                        rightColliderPoly,
                        dangerRect,
                        biteX: jawRight
                    });
                }

                if (!this.deathTriggered) {
                    this.deathTriggered = true;
                    this.dbgLog?.('death', {
                        value,
                        mouthOpen,
                        kind: reason
                    }, 0);
                    if (timingJawHit) {
                        this.triggerTeethHitFx?.();
                    }
                    this.emitEvent?.('PENGUIN_COLLISION', {
                        reason,
                        value
                    });
                }
                circle.dataset.processed = 'true';
                return;
            }

            if (isCoin && coinBiteCollision) {
                const value = parseInt(circle.dataset.value, 10) || 0;
                circle.dataset.processed = 'true';
                circle.classList.add('passed', 'consumed');
                const imgEl = circle.querySelector('img.food-img');
                if (imgEl) imgEl.style.opacity = '0';
                this.dbgLog?.('coin', { value, action: 'bitten' }, 120);
                this.emitEvent?.('COIN_BITTEN', { value });
                return;
            }

            if (fullyPastJawLine && mouthOpen) {
                const value = parseInt(circle.dataset.value, 10) || 0;
                circle.dataset.processed = 'true';
                if (isCoin) {
                    circle.classList.add('passed', 'consumed');
                    const imgEl = circle.querySelector('img.food-img');
                    if (imgEl) imgEl.style.opacity = '0';
                    this.dbgLog?.('coin', { value, action: 'swallowed' }, 120);
                } else {
                    const mouthTargetX = jawRight - 20;
                    const mouthTargetY = (jawTop + jawBottom) / 2;
                    this.animateEatIntoMouth?.(circle, container, containerRect, mouthTargetX, mouthTargetY);
                    this.dbgLog?.('eat', { value }, 120);
                    this.emitEvent?.('FOOD_EATEN', { value });
                }
                return;
            }
        }

        if (this.isDebug?.()) {
            const dbg = this.getDebugState?.();
            const tracked = collidingCircle || nearestCircle;
            const trackedValue = tracked ? (parseInt(tracked.dataset.value, 10) || null) : null;
            const trackedIsColliding = !!collidingCircle;

            if (dbg && trackedValue !== dbg.lastTrackedValue) {
                this.dbgLog?.('track', { value: trackedValue }, 200);
                dbg.lastTrackedValue = trackedValue;
                dbg.lastTrackedWasColliding = false;
            }

            if (dbg && trackedIsColliding !== dbg.lastTrackedWasColliding && trackedValue != null) {
                this.dbgLog?.('collide', {
                    value: trackedValue,
                    isColliding: trackedIsColliding,
                    jawRight,
                    mouthOpen
                }, 120);
                dbg.lastTrackedWasColliding = trackedIsColliding;
            }

            this.updateDebugObjectBoxes?.(tracked, containerRect, trackedIsColliding);
            this.updateDebugOverlay?.({
                containerRect,
                jawTopRect,
                jawBotRect,
                teethTopPoly: topColliderPoly,
                teethBotPoly: botColliderPoly,
                rightColliderPoly,
                dangerRect: null,
                biteX: jawRight
            });
        }
    }
}
