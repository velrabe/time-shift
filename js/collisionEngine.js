class CollisionEngine {
    constructor(options) {
        this.perfMode = !!options.perfMode;
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
        this.pathPolyCache = new WeakMap();
        this.pathLengthCache = new WeakMap();
        this.lastLeftColliderKey = null;
        // Базовая оптимизация для всех устройств + более агрессивный режим для слабых.
        this.pathSampleCount = this.perfMode ? 10 : 16;
        this.maxCandidatesPerFrame = this.perfMode ? 4 : 6;
        this.minCheckIntervalMs = this.perfMode ? 33 : 0;
        this.lastCheckAt = 0;
    }

    reset() {
        this.deathTriggered = false;
        this.pathPolyCache = new WeakMap();
        this.pathLengthCache = new WeakMap();
        this.lastLeftColliderKey = null;
        this.lastCheckAt = 0;
    }

    getMouthBounds(containerRect, jawTopRect, jawBotRect) {
        return {
            jawRight: (jawBotRect.right - containerRect.left),
            jawTop: Math.min(jawTopRect.top, jawBotRect.top) - containerRect.top,
            jawBottom: Math.max(jawTopRect.bottom, jawBotRect.bottom) - containerRect.top
        };
    }

    getNowMs() {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }

    getPathPolyCacheKey(pathEl) {
        const cached = this.pathPolyCache.get(pathEl);
        return cached?.key || null;
    }

    getStripTranslateX(stripEl) {
        if (!stripEl) return 0;
        const tr = stripEl.style?.transform || '';
        const m = tr.match(/translateX\(([-\d.]+)px\)/);
        if (m && m[1] != null) {
            const v = parseFloat(m[1]);
            return Number.isFinite(v) ? v : 0;
        }
        return 0;
    }

    getCircleImgEl(circle) {
        if (!circle) return null;
        if (circle._foodImgEl?.isConnected) return circle._foodImgEl;
        const img = circle.querySelector('img.food-img');
        if (img) circle._foodImgEl = img;
        return img || null;
    }

    getCircleColliderPath(circle) {
        if (!circle) return null;
        if (circle._foodColliderPath?.isConnected) return circle._foodColliderPath;
        const path = circle.querySelector('.food-collider path');
        if (path) circle._foodColliderPath = path;
        return path || null;
    }

    getPathPolyOnScreen(pathEl, sampleCount = 20) {
        if (!pathEl || typeof pathEl.getTotalLength !== 'function') return null;
        let len = this.pathLengthCache.get(pathEl);
        if (!Number.isFinite(len) || len <= 0) {
            len = pathEl.getTotalLength();
            if (Number.isFinite(len) && len > 0) {
                this.pathLengthCache.set(pathEl, len);
            }
        }
        if (!Number.isFinite(len) || len <= 0) return null;
        const ctm = pathEl.getScreenCTM?.();
        if (!ctm) return null;

        const steps = Math.max(4, sampleCount);
        const key = [
            steps,
            len.toFixed(3),
            ctm.a.toFixed(6),
            ctm.b.toFixed(6),
            ctm.c.toFixed(6),
            ctm.d.toFixed(6),
            ctm.e.toFixed(3),
            ctm.f.toFixed(3)
        ].join('|');
        const cached = this.pathPolyCache.get(pathEl);
        if (cached && cached.key === key) return cached.points;

        const points = new Array(steps);
        let pointCount = 0;
        for (let i = 0; i < steps; i += 1) {
            const t = (i / (steps - 1)) * len;
            const p = pathEl.getPointAtLength(t);
            if (!p) continue;
            points[pointCount] = {
                x: (p.x * ctm.a) + (p.y * ctm.c) + ctm.e,
                y: (p.x * ctm.b) + (p.y * ctm.d) + ctm.f
            };
            pointCount += 1;
        }
        if (pointCount < 3) return null;
        points.length = pointCount;
        this.pathPolyCache.set(pathEl, { key, points });
        return points;
    }

    polygonsOverlapSAT(polyA, polyB) {
        if (!polyA || !polyB) return false;
        const aabbA = this.getPolyAABB(polyA);
        const aabbB = this.getPolyAABB(polyB);
        if (
            aabbA.maxX < aabbB.minX ||
            aabbB.maxX < aabbA.minX ||
            aabbA.maxY < aabbB.minY ||
            aabbB.maxY < aabbA.minY
        ) return false;

        const testAxes = (axisSourcePoly, pa, pb) => {
            for (let i = 0; i < axisSourcePoly.length; i++) {
                const a = axisSourcePoly[i];
                const b = axisSourcePoly[(i + 1) % axisSourcePoly.length];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const nx = -dy;
                const ny = dx;
                const axisLen = Math.hypot(nx, ny) || 1;
                const ax = nx / axisLen;
                const ay = ny / axisLen;

                let minA = Infinity;
                let maxA = -Infinity;
                for (let j = 0; j < pa.length; j++) {
                    const p = pa[j];
                    const v = p.x * ax + p.y * ay;
                    if (v < minA) minA = v;
                    if (v > maxA) maxA = v;
                }

                let minB = Infinity;
                let maxB = -Infinity;
                for (let j = 0; j < pb.length; j++) {
                    const p = pb[j];
                    const v = p.x * ax + p.y * ay;
                    if (v < minB) minB = v;
                    if (v > maxB) maxB = v;
                }

                if (maxA < minB || maxB < minA) return false;
            }
            return true;
        };
        return testAxes(polyA, polyA, polyB) && testAxes(polyB, polyA, polyB);
    }

    getPolyAABB(poly) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < poly.length; i++) {
            const p = poly[i];
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        return { minX, minY, maxX, maxY };
    }

    aabbToRect(aabb) {
        if (!aabb) return null;
        return {
            left: aabb.minX,
            top: aabb.minY,
            right: aabb.maxX,
            bottom: aabb.maxY
        };
    }

    rectsOverlap(a, b) {
        if (!a || !b) return false;
        return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
    }

    overlapFoodVsTarget(foodPoly, foodRect, targetPoly, targetRect) {
        if (!foodRect || !targetRect) return false;
        if (!this.rectsOverlap(foodRect, targetRect)) return false;
        // Если обе геометрии есть — используем точную SAT-проверку даже в perfMode.
        // Это важно для корректной логики льда (teeth 1-3 crack, 4-5 game over).
        if (foodPoly && targetPoly) {
            return this.polygonsOverlapSAT(foodPoly, targetPoly);
        }
        // Fallback для perfMode: прямоугольники.
        if (this.perfMode) return true;
        return false;
    }

    check(container) {
        const numberStrip = this.getNumberStrip?.();
        if (!numberStrip || this.deathTriggered) return;
        const nowMs = this.getNowMs();
        if (this.minCheckIntervalMs > 0 && (nowMs - this.lastCheckAt) < this.minCheckIntervalMs) {
            return;
        }
        this.lastCheckAt = nowMs;

        const parts = this.getPenguinParts?.();
        if (!parts?.root) return;

        const containerRect = container.getBoundingClientRect();
        const jawTopRect = parts.topJaw?.getBoundingClientRect?.() || null;
        const jawBotRect = parts.botJaw?.getBoundingClientRect?.() || null;
        if (!jawTopRect || !jawBotRect) return;

        const { jawRight, jawTop, jawBottom } = this.getMouthBounds(containerRect, jawTopRect, jawBotRect);
        const mouthOpen = !!this.isMouthOpen?.();
        const mouthFullyClosed = !!this.isMouthFullyClosed?.();
        const sampleCount = this.pathSampleCount || 24;

        let leftColliderPoly = null;
        let rightColliderPoly = null;
        let leftColliderRect = null;
        let rightColliderRect = null;
        const colliderSampleCount = this.perfMode ? Math.max(8, sampleCount) : sampleCount;
        leftColliderPoly = this.getPathPolyOnScreen(parts.leftColliderPath, colliderSampleCount);
        rightColliderPoly = this.getPathPolyOnScreen(parts.rightColliderPath, colliderSampleCount);
        leftColliderRect = this.aabbToRect(leftColliderPoly ? this.getPolyAABB(leftColliderPoly) : null)
            || parts.leftColliderPath?.getBoundingClientRect?.()
            || null;
        rightColliderRect = this.aabbToRect(rightColliderPoly ? this.getPolyAABB(rightColliderPoly) : null)
            || parts.rightColliderPath?.getBoundingClientRect?.()
            || null;
        if (!this.perfMode && this.updateStripMask && leftColliderPoly && leftColliderPoly.length >= 3) {
            const leftKey = this.getPathPolyCacheKey(parts.leftColliderPath);
            if (leftKey !== this.lastLeftColliderKey) {
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
                this.lastLeftColliderKey = leftKey;
            }
        }

        const stripChildren = numberStrip.children;
        const circles = [];
        for (let i = 0; i < stripChildren.length; i++) {
            const child = stripChildren[i];
            if (!child.classList?.contains('number-circle')) continue;
            if (child.classList.contains('passed')) continue;
            circles.push(child);
        }
        let nearestCircle = null;
        let nearestDistance = Infinity;
        let collidingCircle = null;
        const nearbyCandidates = [];
        const prefilterRects = new Map();
        const stripOffsetX = this.getStripTranslateX(numberStrip);

        // Быстрый предфильтр: полную SAT-геометрию считаем только у объектов рядом с пастью.
        // Это убирает пиковые лаги на старте при большом количестве элементов в DOM.
        const forwardRangePx = this.perfMode ? 220 : 260;
        const backwardRangePx = this.perfMode ? 300 : 340;
        for (const circle of circles) {
            if (circle.dataset.processed === 'true') continue;
            const centerPx = parseFloat(circle.dataset.centerPx);
            let centerX;
            if (Number.isFinite(centerPx)) {
                centerX = centerPx + stripOffsetX;
            } else {
                const r = circle.getBoundingClientRect();
                prefilterRects.set(circle, r);
                centerX = ((r.left + r.right) * 0.5) - containerRect.left;
            }
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
        const circlesToProcess = nearbyCandidates
            .slice(0, this.maxCandidatesPerFrame || 8)
            .map((entry) => entry.circle);

        // Коллайдеры зубов: держим индексное соответствие 1..5, без filter(Boolean),
        // иначе можно потерять позиционную семантику (какие зубы "опасные").
        let topToothPolys = [];
        let botToothPolys = [];
        let topToothRects = [];
        let botToothRects = [];
        if (circlesToProcess.length > 0) {
            const topPaths = (parts.topToothColliderPaths || []).slice(0, 5);
            const botPaths = (parts.botToothColliderPaths || []).slice(0, 5);

            topToothPolys = topPaths.map((p) => this.getPathPolyOnScreen(p, sampleCount));
            botToothPolys = botPaths.map((p) => this.getPathPolyOnScreen(p, sampleCount));
            topToothRects = topToothPolys.map((poly, i) =>
                poly ? this.aabbToRect(this.getPolyAABB(poly)) : (topPaths[i]?.getBoundingClientRect?.() || null)
            );
            botToothRects = botToothPolys.map((poly, i) =>
                poly ? this.aabbToRect(this.getPolyAABB(poly)) : (botPaths[i]?.getBoundingClientRect?.() || null)
            );
        }

        for (const circle of circlesToProcess) {
            if (circle.dataset.processed === 'true') continue;
            const itemType = circle.dataset?.itemType || 'food';
            const isCoin = itemType === 'coin';
            const isIce = itemType === 'ice';

            const imgEl = this.getCircleImgEl(circle);
            const colliderPath = this.getCircleColliderPath(circle);
            let foodPoly = null;
            // В perf-режиме считаем точный полигон хотя бы для льда,
            // чтобы не ловить ложный game over от грубого прямоугольника.
            const needsPreciseFoodPoly = !this.perfMode || isIce;
            if (needsPreciseFoodPoly) {
                const foodSampleCount = this.perfMode ? Math.max(8, sampleCount) : sampleCount;
                foodPoly = (colliderPath && this.getPathPolyOnScreen(colliderPath, foodSampleCount)) || null;
            }
            let foodRectPage = null;
            let imgLeft = 0;
            let imgRight = 0;
            let imgTop = 0;
            let imgBottom = 0;

            if (foodPoly && foodPoly.length >= 3) {
                const polyAabb = this.getPolyAABB(foodPoly);
                imgLeft = polyAabb.minX - containerRect.left;
                imgRight = polyAabb.maxX - containerRect.left;
                imgTop = polyAabb.minY - containerRect.top;
                imgBottom = polyAabb.maxY - containerRect.top;
                foodRectPage = {
                    left: polyAabb.minX,
                    right: polyAabb.maxX,
                    top: polyAabb.minY,
                    bottom: polyAabb.maxY
                };
            } else {
                const circleRect = prefilterRects.get(circle) || circle.getBoundingClientRect();
                const imgRect = imgEl?.getBoundingClientRect?.() || null;
                foodRectPage = imgRect || circleRect;
                imgLeft = foodRectPage.left - containerRect.left;
                imgRight = foodRectPage.right - containerRect.left;
                imgTop = foodRectPage.top - containerRect.top;
                imgBottom = foodRectPage.bottom - containerRect.top;
                // Даже в perfMode держим прямоугольный полигон объекта:
                // это даёт корректную SAT с полигоном зуба при минимальной цене.
                foodPoly = [
                    { x: foodRectPage.left, y: foodRectPage.top },
                    { x: foodRectPage.right, y: foodRectPage.top },
                    { x: foodRectPage.right, y: foodRectPage.bottom },
                    { x: foodRectPage.left, y: foodRectPage.bottom }
                ];
            }

            const overlapsMouthVert = (imgBottom >= jawTop) && (imgTop <= jawBottom);
            const foodRectForCollision = foodRectPage || {
                left: imgLeft + containerRect.left,
                right: imgRight + containerRect.left,
                top: imgTop + containerRect.top,
                bottom: imgBottom + containerRect.top
            };
            // Объект начинает исчезать (проглатывание) только при касании left-collider (не лёд)
            const foodTouchesLeftCollider = this.overlapFoodVsTarget(
                foodPoly,
                foodRectForCollision,
                leftColliderPoly,
                leftColliderRect
            );
            const swallowTrigger = mouthOpen && foodTouchesLeftCollider;
            // Еда/монета: коллизия только с 1-м зубом (индекс 0)
            const topTooth1 = topToothPolys[0];
            const botTooth1 = botToothPolys[0];
            const topCollision1 = this.overlapFoodVsTarget(
                foodPoly,
                foodRectForCollision,
                topTooth1,
                topToothRects[0]
            );
            const botCollision1 = this.overlapFoodVsTarget(
                foodPoly,
                foodRectForCollision,
                botTooth1,
                botToothRects[0]
            );
            const teethCollision1 = topCollision1 || botCollision1;
            // Лёд: зубы 4–5 (индексы 3–4) = геймовер; зубы 1–3 (индексы 0–2) = расщелкивание
            const topTooth4 = topToothPolys[3];
            const topTooth5 = topToothPolys[4];
            const botTooth4 = botToothPolys[3];
            const botTooth5 = botToothPolys[4];
            const iceHitTooth4 = this.overlapFoodVsTarget(
                foodPoly,
                foodRectForCollision,
                topTooth4,
                topToothRects[3]
            ) || this.overlapFoodVsTarget(
                foodPoly,
                foodRectForCollision,
                botTooth4,
                botToothRects[3]
            );
            const iceHitTooth5 = this.overlapFoodVsTarget(
                foodPoly,
                foodRectForCollision,
                topTooth5,
                topToothRects[4]
            ) || this.overlapFoodVsTarget(
                foodPoly,
                foodRectForCollision,
                botTooth5,
                botToothRects[4]
            );
            let iceCrack = false;
            if (isIce && !mouthFullyClosed && (!mouthOpen || this.perfMode)) {
                for (let i = 0; i <= 2 && i < topToothRects.length; i++) {
                    if (this.overlapFoodVsTarget(foodPoly, foodRectForCollision, topToothPolys[i], topToothRects[i])) {
                        iceCrack = true;
                        break;
                    }
                }
                if (!iceCrack) {
                    for (let i = 0; i <= 2 && i < botToothRects.length; i++) {
                        if (this.overlapFoodVsTarget(foodPoly, foodRectForCollision, botToothPolys[i], botToothRects[i])) {
                            iceCrack = true;
                            break;
                        }
                    }
                }
            }

            const rightColliderHit = this.overlapFoodVsTarget(
                foodPoly,
                foodRectForCollision,
                rightColliderPoly,
                rightColliderRect
            );
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
            const topCollision = topCollision1;
            const botCollision = botCollision1;
            const coinBothJaws = topCollision && botCollision;
            const coinBiteCollision = coinBothJaws && !mouthFullyClosed;
            const coinDeathCollision = mouthFullyClosed && (rightColliderHit || topCollision || botCollision);
            const isDeathCollision = isIce ? iceDeathCollision : (isCoin ? coinDeathCollision : foodDeathCollision);

            if (this.isDebug?.()) {
                if (isDeathCollision) circle.classList.add('game-over-trigger');
                else circle.classList.remove('game-over-trigger');
            }

            if (isDeathCollision) {
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
                if (imgEl) imgEl.style.opacity = '0';
                this.emitEvent?.('ICE_CRACKED', { circle });
                return;
            }

            if (isCoin && coinBiteCollision) {
                const value = parseInt(circle.dataset.value, 10) || 0;
                circle.dataset.processed = 'true';
                circle.classList.add('passed', 'consumed');
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
                const value = parseInt(circle.dataset.value, 10) || 0;
                circle.dataset.processed = 'true';
                if (isCoin) {
                    circle.classList.add('passed', 'consumed');
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
                const trackedImg = this.getCircleImgEl(tracked);
                const tr = trackedImg?.getBoundingClientRect?.() || tracked.getBoundingClientRect();
                trackedDangerRect = tr;
                const tp = this.getCircleColliderPath(tracked);
                trackedDangerPoly = (tp && this.getPathPolyOnScreen(tp, sampleCount)) || null;
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
