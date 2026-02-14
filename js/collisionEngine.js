class CollisionEngine {
    constructor(options) {
        this.getNumberStrip = options.getNumberStrip;
        this.getPenguinParts = options.getPenguinParts;
        this.isMouthOpen = options.isMouthOpen;
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

    buildTopTeethPoly(parts, isMouthOpenNow) {
        const clamp01 = (v) => Math.max(0, Math.min(1, v));
        const lerp = (a, b, t) => a + (b - a) * t;
        const lerpPoint = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
        const parsePercent = (raw) => {
            const s = String(raw || '').trim();
            const m = s.match(/^(-?\d+(?:\.\d+)?)%$/);
            if (!m) return null;
            return parseFloat(m[1]) / 100;
        };
        const parsePx = (raw) => {
            const s = String(raw || '').trim();
            const m = s.match(/^(-?\d+(?:\.\d+)?)px$/);
            if (!m) return null;
            return parseFloat(m[1]);
        };

        const style = window.getComputedStyle(parts.root);
        const getVarPct = (name, fallback) => {
            const v = parsePercent(style.getPropertyValue(name));
            return Number.isFinite(v) ? v : fallback;
        };
        const getVarPx = (name, fallback) => {
            const v = parsePx(style.getPropertyValue(name));
            return Number.isFinite(v) ? v : fallback;
        };

        const rootRect = parts.root.getBoundingClientRect();
        const openShiftX = isMouthOpenNow ? getVarPx('--penguin-open-shift-x', 8) : 0;
        const topExtraShiftX = isMouthOpenNow ? getVarPx('--jaw-top-open-extra-x', 0) : 0;
        const topRotateExtraShiftX = isMouthOpenNow ? getVarPx('--jaw-open-rot-shift-x', 2) : 0;
        const topL = getVarPct('--jaw-top-x', 0.47);
        const topT = getVarPct('--jaw-top-y', 0.235);
        const topW = getVarPct('--jaw-top-w', 0.666);
        const topH = getVarPct('--jaw-top-h', 0.344);

        const makeJawPoly = (cfg) => {
            const left = rootRect.left + cfg.l * rootRect.width;
            const top = rootRect.top + cfg.t * rootRect.height;
            const w = cfg.w * rootRect.width;
            const h = cfg.h * rootRect.height;
            const p1 = { x: left, y: top };
            const p2 = { x: left + w, y: top };
            const p3 = { x: left + w, y: top + h };
            const p4 = { x: left, y: top + h };
            const origin = cfg.origin === 'lb' ? { x: left, y: top + h } : { x: left, y: top };
            const deg = isMouthOpenNow ? cfg.openDeg : 0;
            const dx = isMouthOpenNow ? cfg.openDx : 0;
            const dy = isMouthOpenNow ? cfg.openDy : 0;
            const rad = (deg * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const rot = (p) => {
                const x = p.x - origin.x;
                const y = p.y - origin.y;
                const rx = x * cos - y * sin;
                const ry = x * sin + y * cos;
                return { x: origin.x + rx + dx, y: origin.y + ry + dy };
            };
            return [rot(p1), rot(p2), rot(p3), rot(p4)];
        };

        const topJawPoly = makeJawPoly({
            l: topL,
            t: topT,
            w: topW,
            h: topH,
            origin: 'lb',
            openDx: openShiftX + topExtraShiftX + topRotateExtraShiftX,
            openDy: -3,
            openDeg: -16
        });
        const teethFracW = 0.16;
        const teethFracH = 0.22;
        const [p1, p2, p3, p4] = topJawPoly;
        const tW = clamp01(1 - teethFracW);
        const topStart = lerpPoint(p1, p2, tW);
        const bottomStart = lerpPoint(p4, p3, tW);
        const h = clamp01(teethFracH);
        const tipTopL = lerpPoint(bottomStart, topStart, h);
        const tipTopR = lerpPoint(p3, p2, h);
        // Оффсеты зубного полигона калибруются отдельно для закрытого/открытого рта.
        const teethLocalOffsetX = isMouthOpenNow
            ? getVarPx('--teeth-top-open-offset-x', -36)
            : getVarPx('--teeth-top-offset-x', -30);
        const teethLocalOffsetY = isMouthOpenNow
            ? getVarPx('--teeth-top-open-offset-y', -8)
            : getVarPx('--teeth-top-offset-y', 0);
        return [tipTopL, tipTopR, p3, bottomStart].map((p) => ({ x: p.x + teethLocalOffsetX, y: p.y + teethLocalOffsetY }));
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
        const teethTopPoly = this.buildTopTeethPoly(parts, mouthOpen);

        const circles = Array.from(numberStrip.querySelectorAll('.number-circle:not(.passed)'));
        let nearestCircle = null;
        let nearestDistance = Infinity;
        let collidingCircle = null;

        for (const circle of circles) {
            if (circle.dataset.processed === 'true') continue;

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
            const teethCollision = this.polygonsOverlapSAT(foodPoly, teethTopPoly);

            if (this.isDebug?.()) {
                if (teethCollision) circle.classList.add('game-over-trigger');
                else circle.classList.remove('game-over-trigger');
            }

            if (teethCollision) {
                collidingCircle = circle;
                const value = parseInt(circle.dataset.value, 10) || 0;

                if (this.isDebug?.()) {
                    const dangerRect = foodRectPage;
                    this.updateDebugObjectBoxes?.(circle, containerRect);
                    this.updateDebugOverlay?.({
                        containerRect,
                        jawTopRect,
                        jawBotRect,
                        teethTopPoly,
                        dangerRect,
                        biteX: jawRight
                    });
                }

                if (!this.deathTriggered) {
                    this.deathTriggered = true;
                    this.dbgLog?.('death', {
                        value,
                        mouthOpen,
                        kind: 'TEETH_COLLISION'
                    }, 0);
                    this.emitEvent?.('PENGUIN_COLLISION', { reason: 'TEETH_COLLISION', value });
                }
                circle.dataset.processed = 'true';
                return;
            }

            if (fullyPastJawLine && mouthOpen) {
                const value = parseInt(circle.dataset.value, 10) || 0;
                const mouthTargetX = jawRight - 20;
                const mouthTargetY = (jawTop + jawBottom) / 2;
                circle.dataset.processed = 'true';
                this.animateEatIntoMouth?.(circle, container, containerRect, mouthTargetX, mouthTargetY);
                this.dbgLog?.('eat', { value }, 120);
                this.emitEvent?.('FOOD_EATEN', { value });
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
                teethTopPoly,
                dangerRect: null,
                biteX: jawRight
            });
        }
    }
}
