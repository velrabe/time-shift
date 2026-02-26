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
        this.updateStripMask = options.updateStripMask;

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
        if (this.updateStripMask && leftColliderPoly && leftColliderPoly.length >= 3) {
            const w = containerRect.width || 1;
            const h = containerRect.height || 1;
            const left = containerRect.left;
            const top = containerRect.top;
            const norm = leftColliderPoly.map((p) => {
                const x = Math.max(0, Math.min(1, (p.x - left) / w));
                const y = Math.max(0, Math.min(1, (p.y - top) / h));
                return `${x},${y}`;
            });
            const pathD = `M${norm.join(' L')} Z`;
            this.updateStripMask(pathD);
        }
        // Полигоны всех 5 зубов: еда — только зуб 1 (индекс 0); лёд — зубы 1–4 crack, зуб 5 (индекс 4) геймовер
        const topToothPolys = (parts.topToothColliderPaths || []).map((p) => this.getPathPolyOnScreen(p, 24)).filter(Boolean);
        const botToothPolys = (parts.botToothColliderPaths || []).map((p) => this.getPathPolyOnScreen(p, 24)).filter(Boolean);
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
            const isIce = itemType === 'ice';
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
            // Объект начинает исчезать (проглатывание) только при касании left-collider (не лёд)
            const foodTouchesLeftCollider = leftColliderPoly && this.polygonsOverlapSAT(foodPoly, leftColliderPoly);
            const swallowTrigger = mouthOpen && foodTouchesLeftCollider;
            // Еда/монета: коллизия только с 1-м зубом (индекс 0)
            const topTooth1 = topToothPolys[0];
            const botTooth1 = botToothPolys[0];
            const topCollision1 = topTooth1 && this.polygonsOverlapSAT(foodPoly, topTooth1);
            const botCollision1 = botTooth1 && this.polygonsOverlapSAT(foodPoly, botTooth1);
            const teethCollision1 = topCollision1 || botCollision1;
            // Лёд: зубы 4–5 (индексы 3–4) = геймовер; зубы 1–3 (индексы 0–2) = расщелкивание
            const topTooth4 = topToothPolys[3];
            const topTooth5 = topToothPolys[4];
            const botTooth4 = botToothPolys[3];
            const botTooth5 = botToothPolys[4];
            const iceHitTooth4 = (topTooth4 && this.polygonsOverlapSAT(foodPoly, topTooth4))
                || (botTooth4 && this.polygonsOverlapSAT(foodPoly, botTooth4));
            const iceHitTooth5 = (topTooth5 && this.polygonsOverlapSAT(foodPoly, topTooth5))
                || (botTooth5 && this.polygonsOverlapSAT(foodPoly, botTooth5));
            let iceCrack = false;
            if (isIce && !mouthOpen && !mouthFullyClosed) {
                for (let i = 0; i <= 2 && i < topToothPolys.length; i++) {
                    if (topToothPolys[i] && this.polygonsOverlapSAT(foodPoly, topToothPolys[i])) { iceCrack = true; break; }
                }
                if (!iceCrack) {
                    for (let i = 0; i <= 2 && i < botToothPolys.length; i++) {
                        if (botToothPolys[i] && this.polygonsOverlapSAT(foodPoly, botToothPolys[i])) { iceCrack = true; break; }
                    }
                }
            }

            const rightColliderHit = this.polygonsOverlapSAT(foodPoly, rightColliderPoly);
            const closedMouthLeftHit = mouthFullyClosed && overlapsMouthVert && rightColliderHit;
            const timingJawHit = (!mouthOpen) && (!mouthFullyClosed) && teethCollision1;
            const foodDeathCollision = timingJawHit || closedMouthLeftHit;

            // Лёд: геймовер при контакте с зубами 4–5, пока рот не полностью закрыт,
            // либо при касании правого коллайдера в полностью закрытом состоянии.
            const iceDeathFromTeeth45 = isIce && !mouthFullyClosed && (iceHitTooth4 || iceHitTooth5);
            const iceDeathFromRightCollider = isIce && mouthFullyClosed && closedMouthLeftHit;
            const iceDeathCollision = iceDeathFromTeeth45 || iceDeathFromRightCollider;

            // Ускорение при входе в right-collider отключено: объект движется только со скоростью ленты.

            // Монета:
            // - Коины начисляются только при реальном укусе: обе челюсти захватили монетку и рот ещё не полностью закрыт (момент сжатия).
            // - Если рот уже полностью закрыт и монетка касается рта/зубов — это опасный контакт (смерть или поглощение щитом), коины не даём, монетка просто исчезает.
            // - Проглоченная монетка (прошла вглубь при открытом рте) даёт обычные очки, как еда.
            const topCollision = topTooth1 && this.polygonsOverlapSAT(foodPoly, topTooth1);
            const botCollision = botTooth1 && this.polygonsOverlapSAT(foodPoly, botTooth1);
            const coinBothJaws = topCollision && botCollision;
            const coinBiteCollision = coinBothJaws && !mouthFullyClosed;
            const coinDeathCollision = mouthFullyClosed && (rightColliderHit || (topTooth1 && this.polygonsOverlapSAT(foodPoly, topTooth1)) || (botTooth1 && this.polygonsOverlapSAT(foodPoly, botTooth1)));
            const isDeathCollision = isIce ? iceDeathCollision : (isCoin ? coinDeathCollision : foodDeathCollision);

            if (this.isDebug?.()) {
                if (isDeathCollision) circle.classList.add('game-over-trigger');
                else circle.classList.remove('game-over-trigger');
            }

            if (isDeathCollision) {
                this.clearSwallowBoost(circle, boostState);
                collidingCircle = circle;
                const value = parseInt(circle.dataset.value, 10) || 0;
                const reason = iceDeathCollision
                    ? 'ICE_TOOTH5_HIT'
                    : (timingJawHit ? (topCollision ? 'TIMING_JAW_HIT_TOP' : 'TIMING_JAW_HIT_BOT') : 'CLOSED_MOUTH_LEFT_HIT');

                if (this.isDebug?.()) {
                    const dangerRect = foodRectPage;
                    const dangerPoly = foodPoly;
                    this.updateDebugObjectBoxes?.(circle, containerRect, true, dangerPoly);
                    this.updateDebugOverlay?.({
                        containerRect,
                        jawTopRect,
                        jawBotRect,
                        teethTopPolys: topToothPolys,
                        teethBotPolys: botToothPolys,
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
                        circle,
                        freezeMouth: iceDeathCollision
                    });
                }
                circle.dataset.processed = 'true';
                return;
            }

            // Лёд: расщелкивание при контакте с зубами 1–4 (после проверки геймовера по 5-му зубу)
            if (iceCrack) {
                circle.dataset.processed = 'true';
                circle.classList.add('passed', 'consumed');
                const imgEl = circle.querySelector('img.food-img');
                if (imgEl) imgEl.style.opacity = '0';
                this.emitEvent?.('ICE_CRACKED', { circle });
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

            // Лёд не исчезает при проходе вглубь — только при расщелкивании (зубы 1–4) или геймовере (зуб 5)
            if (swallowTrigger && !isIce) {
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
                teethTopPolys: topToothPolys,
                teethBotPolys: botToothPolys,
                rightColliderPoly,
                dangerRect: trackedDangerRect,
                dangerPoly: trackedDangerPoly,
                biteX: jawRight
            });
        }
    }
}
