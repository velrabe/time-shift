class StripConveyorSystem {
    constructor(options) {
        this.numberStrip = options.numberStrip || null;
        this.getGameArea = options.getGameArea;
        this.getFocusAnchorX = options.getFocusAnchorX;
        this.ensureFoodCircle = options.ensureFoodCircle;
        this.applyDebugLabelToCircle = options.applyDebugLabelToCircle;
        this.checkCollisionsAndAutoBite = options.checkCollisionsAndAutoBite;

        this.stripHalfWindow = 30;
        this.stripRecycleMargin = 10;
        this.stripMinValue = 0;
        this.stripPitchPx = null;
        this.stripFirstCenterPx = null;
        this.currentStripOffset = 0;

        this.beltSpeed = 0.08;
        this.beltEatGrowth = 1.03;
        this.beltEatMultiplier = 1.0;
        this.beltPosition = 0;
        this.lastBeltUpdateTime = 0;
        this.beltPauseStartTime = null;
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

        this.beltPosition = 0;
        this.lastBeltUpdateTime = 0;
        this.beltPauseStartTime = null;
        this.beltEatMultiplier = 1.0;
    }

    onFoodEaten() {
        const growth = Number.isFinite(this.beltEatGrowth) ? this.beltEatGrowth : 1.03;
        const base = Number.isFinite(this.beltEatMultiplier) ? this.beltEatMultiplier : 1;
        this.beltEatMultiplier = base * growth;
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
            this.lastBeltUpdateTime = nowMs;
            this.ensureStripWindowInitialized(0);
            this.recomputeStripMetrics();
            this.adjustInitialBeltPosition();
            return;
        }

        const deltaTime = nowMs - this.lastBeltUpdateTime;
        this.lastBeltUpdateTime = nowMs;

        const speedMultiplier = (timer && typeof timer.getSpeedMultiplier === 'function')
            ? timer.getSpeedMultiplier()
            : 1;
        const eatMult = Number.isFinite(this.beltEatMultiplier) ? this.beltEatMultiplier : 1;
        const baseSpeed = this.beltSpeed * (Number.isFinite(speedMultiplier) ? speedMultiplier : 1) * eatMult;
        this.beltPosition += (baseSpeed * deltaTime);

        this.recomputeStripMetrics();
        if (this.stripPitchPx == null || this.stripFirstCenterPx == null) return;

        const currentValue = Math.max(0, Math.floor(this.beltPosition / this.stripPitchPx));
        this.ensureStripWindowInitialized(currentValue);
        this.maybeRecycleStripWindow(currentValue);
        this.updateStripClasses(currentValue);

        const container = this.getGameArea?.();
        if (!container) return;

        const anchorX = this.getFocusAnchorX(container);
        const centerX = this.stripFirstCenterPx + (this.beltPosition - (this.stripMinValue * this.stripPitchPx));
        const targetOffset = anchorX - centerX;
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
                const desiredX = containerRect.width * 0.5;
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
            this.ensureFoodCircle(circleEl);
            this.applyDebugLabelToCircle(circleEl);
            this.numberStrip.appendChild(circleEl);
        }
        this.stripMinValue = minValue;
        this.recomputeStripMetrics();
    }

    maybeRecycleStripWindow(current) {
        if (!this.numberStrip || this.stripPitchPx == null) return;
        const count = this.numberStrip.children.length;
        if (count === 0) return;

        const min = this.stripMinValue ?? parseInt(this.numberStrip.firstElementChild.dataset.value, 10);
        const max = min + count - 1;

        const margin = this.stripRecycleMargin ?? 10;
        const leftEdge = min + margin;
        const rightEdge = max - margin;

        if (min === 0 && current <= leftEdge) {
            return;
        }

        if (current > rightEdge) {
            const shift = current - (min + (count - 1) / 2);
            const steps = Math.max(0, Math.floor(shift));
            this.shiftStripWindowBy(steps);
        }
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
                this.ensureFoodCircle(newEl);
                this.applyDebugLabelToCircle(newEl);
                this.numberStrip.appendChild(newEl);
                min += 1;
                max += 1;
            }
            this.currentStripOffset += steps * this.stripPitchPx;
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
                this.ensureFoodCircle(newEl);
                this.applyDebugLabelToCircle(newEl);
                this.numberStrip.insertBefore(newEl, this.numberStrip.firstElementChild);
                min -= 1;
                max -= 1;
            }
            this.currentStripOffset -= steps * this.stripPitchPx;
        }

        this.stripMinValue = min;
        this.numberStrip.style.transition = 'none';
        this.numberStrip.style.transform = `translateX(${this.currentStripOffset}px)`;
    }

    updateStripClasses(current) {
        const existingElements = Array.from(this.numberStrip.children);
        existingElements.forEach((el) => {
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
        });
    }

    recomputeStripMetrics() {
        if (!this.numberStrip) return;
        const first = this.numberStrip.querySelector('.number-circle');
        if (!first) return;

        const rect = first.getBoundingClientRect();
        const width = rect.width || parseFloat(getComputedStyle(first).width) || 63;
        const style = window.getComputedStyle(first);
        const marginLeft = parseFloat(style.marginLeft) || 0;
        const marginRight = parseFloat(style.marginRight) || 0;

        this.stripPitchPx = width + marginLeft + marginRight;
        this.stripFirstCenterPx = marginLeft + width / 2;
    }
}
