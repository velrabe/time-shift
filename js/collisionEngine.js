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
        this.swallowBoostState = new WeakMap();
    }

    reset() {
        this.deathTriggered = false;
        this.swallowBoostState = new WeakMap();
    }

    getMouthBounds(containerRect, jawTopRect, jawBotRect) {
        return {
            jawRight: (jawBotRect.right - containerRect.left),
            jawTop: Math.min(jawTopRect.top, jawBotRect.top) - containerRect.top,
            jawBottom: Math.max(jawTopRect.bottom, jawBotRect.bottom) - containerRect.top
        };
    }

    getPolyRightBoundX(poly, containerLeft) {
        if (!poly || poly.length === 0 || containerLeft == null) return null;
        let maxX = -Infinity;
        for (const p of poly) {
            const x = p.x - containerLeft;
            if (x > maxX) maxX = x;
        }
        return Number.isFinite(maxX) ? maxX : null;
    }

    getNowMs() {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }

    getSwallowBoostState(circle, nowMs) {
        let state = this.swallowBoostState.get(circle);
        if (!state) {
            state = {
                active: false,
                entered: false,
                extraOffsetX: 0,
                targetSpeedPxMs: 0,
                boostStartMs: 0,
                lastTickMs: nowMs,
                prevCenterX: null,
                prevCenterTs: nowMs
            };
            this.swallowBoostState.set(circle, state);
        }
        return state;
    }

    clearSwallowBoost(circle, state) {
        if (!circle) return;
        if (state) {
            state.active = false;
            state.entered = false;
            state.extraOffsetX = 0;
            state.targetSpeedPxMs = 0;
            state.lastTickMs = this.getNowMs();
        }
        circle.dataset.swallowBoost = 'false';
    }

    applySwallowBoostTick(circle, state, nowMs) {
        if (!circle || !state?.active) return;
        const dtMs = Math.max(0, nowMs - (state.lastTickMs || nowMs));
        state.lastTickMs = nowMs;
        const targetSpeed = Number.isFinite(state.targetSpeedPxMs) ? state.targetSpeedPxMs : 0;
        if (targetSpeed <= 0 || dtMs <= 0) return;

        const easeDurationMs = 360;
        const elapsed = Math.max(0, nowMs - (state.boostStartMs || nowMs));
        const t = Math.min(1, elapsed / easeDurationMs);
        const easeIn = t * t;
        const currentSpeed = targetSpeed * easeIn;
        state.extraOffsetX -= currentSpeed * dtMs;
        circle.style.transform = `translateX(${state.extraOffsetX.toFixed(2)}px)`;
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
        const leftColliderPoly = this.getPathPolyOnScreen(parts.leftColliderPath, 24);
        const rightColliderPoly = this.getPathPolyOnScreen(parts.rightColliderPath, 24);
        const topColliderPoly = this.getPathPolyOnScreen(parts.topColliderPath, 24);
        const botColliderPoly = this.getPathPolyOnScreen(parts.botColliderPath, 24);
        const leftColliderRightX = this.getPolyRightBoundX(leftColliderPoly, containerRect.left);
        const nowMs = this.getNowMs();

        const circles = Array.from(numberStrip.querySelectorAll('.number-circle:not(.passed)'));
        let nearestCircle = null;
        let nearestDistance = Infinity;
        let collidingCircle = null;
        const nearbyCandidates = [];

        // Быстрый предфильтр: полную SAT-геометрию считаем только у объектов рядом с пастью.
        // Это убирает пиковые лаги на старте при большом количестве элементов в DOM.
        const forwardRangePx = 260;
        const backwardRangePx = 340;
        for (const circle of circles) {
            if (circle.dataset.processed === 'true') continue;
            const r = circle.getBoundingClientRect();
            const centerX = ((r.left + r.right) * 0.5) - containerRect.left;
            const distanceToJaw = Math.abs(centerX - jawRight);
            if (distanceToJaw < nearestDistance) {
                nearestDistance = distanceToJaw;
                nearestCircle = circle;
            }
            if (centerX >= (jawRight - backwardRangePx) && centerX <= (jawRight + forwardRangePx)) {
                nearbyCandidates.push({ circle, distanceToJaw });
            }
        }
        nearbyCandidates.sort((a, b) => a.distanceToJaw - b.distanceToJaw);
        const circlesToProcess = nearbyCandidates.slice(0, 10).map((entry) => entry.circle);

        for (const circle of circlesToProcess) {
            if (circle.dataset.processed === 'true') continue;
            const itemType = circle.dataset?.itemType || 'food';
            const isCoin = itemType === 'coin';
            const boostState = this.getSwallowBoostState(circle, nowMs);

            const circleRect = circle.getBoundingClientRect();
            const imgEl = circle.querySelector('img.food-img');
            const imgRect = imgEl?.getBoundingClientRect?.() || null;

            const imgLeft = (imgRect ? imgRect.left : circleRect.left) - containerRect.left;
            const imgRight = (imgRect ? imgRect.right : circleRect.right) - containerRect.left;
            const imgTop = (imgRect ? imgRect.top : circleRect.top) - containerRect.top;
            const imgBottom = (imgRect ? imgRect.bottom : circleRect.bottom) - containerRect.top;
            const imgCenterX = (imgLeft + imgRight) / 2;
            const dtObsMs = Math.max(1, nowMs - (boostState.prevCenterTs || nowMs));
            const observedSpeedPxMs = (boostState.prevCenterX != null)
                ? Math.abs((imgCenterX - boostState.prevCenterX) / dtObsMs)
                : 0;
            boostState.prevCenterX = imgCenterX;
            boostState.prevCenterTs = nowMs;

            const foodRectPage = imgRect || circleRect;
            const overlapsMouthVert = (imgBottom >= jawTop) && (imgTop <= jawBottom);
            const swallowDepthPx = Math.max(14, Math.round((jawBottom - jawTop) * 0.22));
            const stomachThresholdX = jawRight - swallowDepthPx;
            const fullyPastJawLine = overlapsMouthVert && (imgCenterX <= stomachThresholdX);
            const hasExitedLeftCollider = leftColliderRightX != null && overlapsMouthVert && (imgRight <= leftColliderRightX);
            const swallowTrigger = hasExitedLeftCollider || (leftColliderRightX == null && fullyPastJawLine);

            const colliderPath = circle.querySelector('.food-collider path');
            let foodPoly = (colliderPath && this.getPathPolyOnScreen(colliderPath, 24)) || null;
            if (!foodPoly) {
                foodPoly = [
                    { x: foodRectPage.left, y: foodRectPage.top },
                    { x: foodRectPage.right, y: foodRectPage.top },
                    { x: foodRectPage.right, y: foodRectPage.bottom },
                    { x: foodRectPage.left, y: foodRectPage.bottom }
                ];
            }
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

            // Фаза 1: как только объект начинает пересекать right-collider, добавляем
            // локальное смещение влево с той же скоростью ленты (итого ≈ x2).
            if (!isCoin && mouthOpen && rightColliderHit && !boostState.active && !boostState.entered) {
                const sampled = Number.isFinite(observedSpeedPxMs) ? observedSpeedPxMs : 0;
                const base = sampled || 0.07;
                const clamped = Math.max(0.03, Math.min(0.9, base * 2));
                boostState.active = true;
                boostState.entered = true;
                boostState.targetSpeedPxMs = clamped;
                boostState.boostStartMs = nowMs;
                boostState.lastTickMs = nowMs;
                circle.dataset.swallowBoost = 'true';
            }
            if (!isCoin && mouthOpen) this.applySwallowBoostTick(circle, boostState, nowMs);

            // Монета:
            // - Коины начисляются только при реальном укусе: обе челюсти захватили монетку и рот ещё не полностью закрыт (момент сжатия).
            // - Если рот уже полностью закрыт и монетка касается рта/зубов — это опасный контакт (смерть или поглощение щитом), коины не даём, монетка просто исчезает.
            // - Проглоченная монетка (прошла вглубь при открытом рте) даёт обычные очки, как еда.
            const coinBothJaws = topCollision && botCollision;
            const coinBiteCollision = coinBothJaws && !mouthFullyClosed;
            const coinDeathCollision = mouthFullyClosed && (rightColliderHit || teethCollision);
            const isDeathCollision = isCoin ? coinDeathCollision : foodDeathCollision;

            if (this.isDebug?.()) {
                if (isDeathCollision) circle.classList.add('game-over-trigger');
                else circle.classList.remove('game-over-trigger');
            }

            if (isDeathCollision) {
                this.clearSwallowBoost(circle, boostState);
                collidingCircle = circle;
                const value = parseInt(circle.dataset.value, 10) || 0;
                const reason = timingJawHit
                    ? (topCollision ? 'TIMING_JAW_HIT_TOP' : 'TIMING_JAW_HIT_BOT')
                    : 'CLOSED_MOUTH_LEFT_HIT';

                if (this.isDebug?.()) {
                    const dangerRect = foodRectPage;
                    const dangerPoly = foodPoly;
                    this.updateDebugObjectBoxes?.(circle, containerRect, true, dangerPoly);
                    this.updateDebugOverlay?.({
                        containerRect,
                        jawTopRect,
                        jawBotRect,
                        teethTopPoly: topColliderPoly,
                        teethBotPoly: botColliderPoly,
                        rightColliderPoly,
                        dangerRect,
                        dangerPoly,
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
                    // Анимация перелома зубов вызывается в game.beginDeath только при реальной смерти (не при щите).
                    this.emitEvent?.('PENGUIN_COLLISION', {
                        reason,
                        value,
                        circle
                    });
                }
                circle.dataset.processed = 'true';
                return;
            }

            if (isCoin && coinBiteCollision) {
                this.clearSwallowBoost(circle, boostState);
                const value = parseInt(circle.dataset.value, 10) || 0;
                circle.dataset.processed = 'true';
                circle.classList.add('passed', 'consumed');
                const imgEl = circle.querySelector('img.food-img');
                if (imgEl) imgEl.style.opacity = '0';
                const centerX = (imgLeft + imgRight) / 2;
                const centerY = (imgTop + imgBottom) / 2;
                this.dbgLog?.('coin', { value, action: 'bitten' }, 120);
                this.emitEvent?.('COIN_BITTEN', { value, x: centerX, y: centerY });
                return;
            }

            if (swallowTrigger && mouthOpen) {
                // Фаза 2: объект покинул left-collider -> безопасен и запускаем анимацию проглатывания.
                boostState.active = false;
                circle.dataset.swallowBoost = 'false';
                circle.dataset.safeAfterLeftCollider = 'true';
                const value = parseInt(circle.dataset.value, 10) || 0;
                circle.dataset.processed = 'true';
                if (isCoin) {
                    circle.classList.add('passed', 'consumed');
                    const imgEl = circle.querySelector('img.food-img');
                    if (imgEl) imgEl.style.opacity = '0';
                    this.dbgLog?.('coin', { value, action: 'swallowed' }, 120);
                    this.emitEvent?.('COIN_SWALLOWED', { value });
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

            let trackedDangerRect = null;
            let trackedDangerPoly = null;
            if (tracked) {
                const tr = tracked.querySelector('img.food-img')?.getBoundingClientRect?.() || tracked.getBoundingClientRect();
                trackedDangerRect = tr;
                const tp = tracked.querySelector('.food-collider path');
                trackedDangerPoly = (tp && this.getPathPolyOnScreen(tp, 24)) || null;
                if (!trackedDangerPoly && tr) {
                    trackedDangerPoly = [
                        { x: tr.left, y: tr.top },
                        { x: tr.right, y: tr.top },
                        { x: tr.right, y: tr.bottom },
                        { x: tr.left, y: tr.bottom }
                    ];
                }
            }
            this.updateDebugObjectBoxes?.(tracked, containerRect, trackedIsColliding, trackedDangerPoly);
            this.updateDebugOverlay?.({
                containerRect,
                jawTopRect,
                jawBotRect,
                teethTopPoly: topColliderPoly,
                teethBotPoly: botColliderPoly,
                rightColliderPoly,
                dangerRect: trackedDangerRect,
                dangerPoly: trackedDangerPoly,
                biteX: jawRight
            });
        }
    }
}
