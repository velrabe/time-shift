class PenguinRig {
    constructor(options) {
        this.focusZone = options.focusZone;
        this.getGameArea = options.getGameArea;
        this.isDebugEnabled = options.isDebugEnabled;
        this.dbgLog = options.dbgLog;

        this.mode = 'swallow';
        this.transitionDurationMs = 100;
        this.transitionUntil = 0;
        this.actionUntil = 0;
        this.actionType = null;
        this.autoBiteHint = false;
        this.stunUntil = 0;
        this.hp = 4;
        this.maxHp = 4;
        this.mouthFrozen = false;
        this.jammed = false;
        this._hitFxTimeoutId = null;
        this._swallowPulseTimeoutId = null;
        this._biteCrunchTimeoutId = null;
        this._actionPhaseTimeoutId = null;
        this._actionEndTimeoutId = null;
        this.actionAnimationActive = false;
        this.swallowPulseActive = false;
        this.biteCrunchActive = false;
    }

    getNowMs() {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }

    getPenguinParts() {
        const zone = this.focusZone;
        if (!zone) return null;
        const backRoot = zone.querySelector('#penguin-root');
        const frontRoot = zone.querySelector('#penguin-jaws-root');
        const root = backRoot || frontRoot;
        if (!root) return null;

        const topJaw = zone.querySelector('#penguin-top-jaw');
        const botJaw = zone.querySelector('#penguin-bot-jaw');
        const topJawBack = zone.querySelector('#penguin-top-jaw-back');
        const botJawBack = zone.querySelector('#penguin-bot-jaw-back');
        const head = zone.querySelector('#penguin-head-layer');
        const eye = zone.querySelector('#penguin-eye-layer');
        const leftColliderPath = zone.querySelector('#penguin-left-collider-path');
        const rightColliderPath = zone.querySelector('#penguin-right-collider-path');

        const topTeeth = Array.from(zone.querySelectorAll('#penguin-top-jaw .penguin-tooth')).slice(0, 5);
        const botTeeth = Array.from(zone.querySelectorAll('#penguin-bot-jaw .penguin-tooth')).slice(0, 5);

        return {
            root,
            backRoot,
            frontRoot,
            head,
            eye,
            topJaw,
            botJaw,
            topJawBack,
            botJawBack,
            leftColliderPath,
            rightColliderPath,
            topTeeth,
            botTeeth,
            topToothColliderPaths: [],
            botToothColliderPaths: []
        };
    }

    getRigRoots() {
        return Array.from(this.focusZone?.querySelectorAll?.('.focus-penguin') || []);
    }

    isTransitioning() {
        return this.getNowMs() < (this.transitionUntil || 0);
    }

    isStunned() {
        return this.getNowMs() < (this.stunUntil || 0);
    }

    isMouthHeld() {
        return this.isMouthOpen();
    }

    getMouthHoldStartTimeMs() {
        return 0;
    }

    isMouthOpen() {
        if (this.mode === 'swallow') return true;
        if (this.jammed) return true;
        if (this.isStunned()) return true;
        return this.getNowMs() < (this.actionUntil || 0);
    }

    isMouthFullyClosed() {
        return !this.isMouthOpen();
    }

    getMode() {
        return this.mode;
    }

    setMode(mode) {
        const nextMode = mode === 'bite' ? 'bite' : 'swallow';
        if (this.mode === nextMode && !this.isTransitioning()) {
            this.applyStateClasses();
            return;
        }
        this.clearActionAnimation();
        this.mode = nextMode;
        this.transitionUntil = this.getNowMs() + this.transitionDurationMs;
        this.actionUntil = 0;
        this.actionType = null;
        this.applyStateClasses();
    }

    setAutoBiteHint(active) {
        this.autoBiteHint = !!active;
        this.applyStateClasses();
    }

    triggerAction(actionType) {
        this.clearActionAnimation();
        this.actionType = actionType || null;
        const now = this.getNowMs();
        if (this.actionType === 'action-bite') {
            this.actionUntil = now + 300;
            this.playActionBiteAnimation();
            return;
        }
        if (this.actionType === 'action-swallow') {
            this.actionUntil = now + 300;
            this.playActionSwallowAnimation();
            return;
        }
        this.actionUntil = now + 200;
        this.applyStateClasses();
    }

    clearActionAnimation() {
        this.actionAnimationActive = false;
        if (this._actionPhaseTimeoutId) {
            window.clearTimeout(this._actionPhaseTimeoutId);
            this._actionPhaseTimeoutId = null;
        }
        if (this._actionEndTimeoutId) {
            window.clearTimeout(this._actionEndTimeoutId);
            this._actionEndTimeoutId = null;
        }
    }

    withMouthTransition(parts, durationMs, easing = 'linear') {
        const layers = [
            parts?.head,
            parts?.eye,
            parts?.topJawBack,
            parts?.botJawBack,
            parts?.topJaw,
            parts?.botJaw
        ];
        layers.forEach((el) => {
            if (!el) return;
            el.style.transition = `transform ${Math.max(0, durationMs)}ms ${easing}`;
            el.style.transformOrigin = '50% 50%';
        });
    }

    applyMouthAngles(parts, { head, eye, top, bot }) {
        const set = (el, angleDeg) => {
            if (!el) return;
            if (angleDeg == null || Math.abs(Number(angleDeg) || 0) < 0.001) {
                el.style.removeProperty('transform');
            } else {
                el.style.transform = `rotate(${angleDeg}deg)`;
            }
        };
        set(parts?.head, head);
        set(parts?.eye, eye);
        set(parts?.topJaw, top);
        set(parts?.topJawBack, top);
        set(parts?.botJaw, bot);
        set(parts?.botJawBack, bot);
    }

    playActionBiteAnimation() {
        if (this.mouthFrozen) return;
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        this.actionAnimationActive = true;

        // Big bite: open in 0.2s, snap close in 0.1s.
        this.withMouthTransition(parts, 200, 'ease');
        this.applyMouthAngles(parts, { head: -10, eye: -17, top: -17, bot: 14 });

        this._actionPhaseTimeoutId = window.setTimeout(() => {
            if (this.mouthFrozen) return;
            const next = this.getPenguinParts();
            if (!next?.root) return;
            this.withMouthTransition(next, 100, 'linear');
            this.applyMouthAngles(next, { head: 0, eye: 0, top: 0, bot: 0 });
        }, 200);

        this._actionEndTimeoutId = window.setTimeout(() => {
            this.actionAnimationActive = false;
            this.applyStateClasses();
        }, 310);
    }

    playActionSwallowAnimation() {
        if (this.mouthFrozen) return;
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        this.actionAnimationActive = true;

        // Big swallow: additional +5deg for 0.1s, then return in 0.2s.
        this.withMouthTransition(parts, 100, 'ease-out');
        this.applyMouthAngles(parts, { head: -10, eye: -17, top: -22, bot: 19 });

        this._actionPhaseTimeoutId = window.setTimeout(() => {
            if (this.mouthFrozen) return;
            const next = this.getPenguinParts();
            if (!next?.root) return;
            this.withMouthTransition(next, 200, 'ease-in-out');
            this.applyMouthAngles(next, { head: -10, eye: -17, top: -17, bot: 14 });
        }, 100);

        this._actionEndTimeoutId = window.setTimeout(() => {
            this.actionAnimationActive = false;
            this.applyStateClasses();
        }, 320);
    }

    triggerSwallowPulse() {
        this.swallowPulseActive = true;
        this.applyStateClasses();
        if (this._swallowPulseTimeoutId) window.clearTimeout(this._swallowPulseTimeoutId);
        this._swallowPulseTimeoutId = window.setTimeout(() => {
            this._swallowPulseTimeoutId = null;
            this.swallowPulseActive = false;
            this.applyStateClasses();
        }, 180);
    }

    triggerAutoBiteCrunch() {
        this.biteCrunchActive = true;
        this.applyStateClasses();
        if (this._biteCrunchTimeoutId) window.clearTimeout(this._biteCrunchTimeoutId);
        this._biteCrunchTimeoutId = window.setTimeout(() => {
            this._biteCrunchTimeoutId = null;
            this.biteCrunchActive = false;
            this.applyStateClasses();
        }, 260);
    }

    setStunned(durationMs = 0) {
        const now = this.getNowMs();
        const until = now + Math.max(0, durationMs || 0);
        this.stunUntil = Math.max(this.stunUntil || 0, until);
        this.applyStateClasses();
    }

    clearStun() {
        this.stunUntil = 0;
        this.applyStateClasses();
    }

    setHealth(hp, maxHp = this.maxHp) {
        this.maxHp = Math.max(1, Math.floor(maxHp || 4));
        this.hp = Math.max(0, Math.min(this.maxHp, Math.floor(hp || 0)));
        this.applyBrokenTeeth();
        this.applyStateClasses();
    }

    applyBrokenTeeth() {
        const parts = this.getPenguinParts();
        if (!parts) return;
        const brokenPairs = Math.max(0, Math.min(3, this.maxHp - this.hp));
        parts.topTeeth.forEach((tooth, index) => {
            if (!tooth) return;
            if (index < brokenPairs) {
                tooth.style.opacity = '0';
            } else {
                tooth.style.removeProperty('opacity');
                tooth.style.removeProperty('transform');
                tooth.style.removeProperty('transition');
                tooth.style.removeProperty('transform-origin');
            }
        });
        parts.botTeeth.forEach((tooth, index) => {
            if (!tooth) return;
            if (index < brokenPairs) {
                tooth.style.opacity = '0';
            } else {
                tooth.style.removeProperty('opacity');
                tooth.style.removeProperty('transform');
                tooth.style.removeProperty('transition');
                tooth.style.removeProperty('transform-origin');
            }
        });
    }

    triggerTimingTeethHitFx(toothPairIndex = null) {
        const parts = this.getPenguinParts();
        if (!parts) return;
        if (this.hp <= 0) return;

        const derivedIndex = Math.max(0, Math.min(2, (this.maxHp - this.hp) - 1));
        const targetIndex = Number.isFinite(toothPairIndex)
            ? Math.max(0, Math.min(2, Math.floor(toothPairIndex)))
            : derivedIndex;
        const topTooth = parts.topTeeth[targetIndex];
        const botTooth = parts.botTeeth[targetIndex];
        const animate = (tooth, cfg) => {
            if (!tooth) return;
            tooth.style.transition = 'none';
            tooth.style.transformOrigin = '50% 50%';
            tooth.style.transform = 'translate(0px, 0px) rotate(0deg) scaleY(1)';
            tooth.style.opacity = '1';
            requestAnimationFrame(() => {
                tooth.style.transition = 'transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 260ms ease-out';
                tooth.style.transform = `translate(${cfg.dx}px, ${cfg.dyPx}px) rotate(${cfg.angleDeg}deg) scaleY(0.7)`;
                tooth.style.opacity = '0';
            });
        };
        animate(topTooth, { angleDeg: -20, dyPx: -10, dx: -4 });
        animate(botTooth, { angleDeg: -7, dyPx: 8, dx: -4 });
        if (this._hitFxTimeoutId) window.clearTimeout(this._hitFxTimeoutId);
        this._hitFxTimeoutId = window.setTimeout(() => {
            this._hitFxTimeoutId = null;
            [topTooth, botTooth].forEach((tooth) => {
                if (!tooth) return;
                tooth.style.opacity = '0';
                tooth.style.removeProperty('transition');
            });
        }, 260);
    }

    resetTimingTeethFx() {
        const parts = this.getPenguinParts();
        if (!parts) return;
        [...parts.topTeeth, ...parts.botTeeth].forEach((tooth) => {
            if (!tooth) return;
            tooth.style.removeProperty('transition');
            tooth.style.removeProperty('transform');
            tooth.style.removeProperty('opacity');
            tooth.style.removeProperty('transform-origin');
        });
        if (this._hitFxTimeoutId) {
            window.clearTimeout(this._hitFxTimeoutId);
            this._hitFxTimeoutId = null;
        }
    }

    freezeMouthInPlace() {
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        this.mouthFrozen = true;
        this.jammed = true;
        const freeze = (el) => {
            if (!el) return;
            const t = window.getComputedStyle(el).transform;
            el.style.transition = 'none';
            el.style.transform = t || 'none';
        };
        freeze(parts.head);
        freeze(parts.eye);
        freeze(parts.topJawBack);
        freeze(parts.topJaw);
        freeze(parts.botJawBack);
        freeze(parts.botJaw);
        this.applyStateClasses();
    }

    setPenguinGameOverState() {
        this.jammed = true;
        this.applyStateClasses();
    }

    stopAllBites() {
        this.clearActionAnimation();
        this.actionUntil = 0;
        this.actionType = null;
        this.autoBiteHint = false;
        this.mouthFrozen = false;
        this.jammed = false;
        this.swallowPulseActive = false;
        this.biteCrunchActive = false;
        this.clearStun();
        this.restoreMouthLayerTransitions();
        this.applyStateClasses();
    }

    resetPenguinState() {
        this.mode = 'swallow';
        this.transitionUntil = 0;
        this.actionUntil = 0;
        this.actionType = null;
        this.autoBiteHint = false;
        this.stunUntil = 0;
        this.mouthFrozen = false;
        this.jammed = false;
        this.swallowPulseActive = false;
        this.biteCrunchActive = false;
        this.hp = this.maxHp;
        this.resetTimingTeethFx();
        this.applyBrokenTeeth();
        this.applyStateClasses();
    }

    applyStateClasses() {
        const openMouth = this.isMouthOpen() || this.biteCrunchActive;
        const roots = this.getRigRoots();
        const modeClass = this.mode === 'bite' ? 'penguin--mode-bite' : 'penguin--mode-swallow';
        const actionClass = this.mode === 'bite' ? 'penguin--action-bite' : 'penguin--action-swallow';
        const actionActive = this.getNowMs() < (this.actionUntil || 0);
        const stunned = this.isStunned();
        const transitioning = this.isTransitioning();

        roots.forEach((root) => {
            root.classList.toggle('penguin--mode-swallow', modeClass === 'penguin--mode-swallow');
            root.classList.toggle('penguin--mode-bite', modeClass === 'penguin--mode-bite');
            root.classList.toggle('penguin--transitioning', transitioning);
            root.classList.toggle('penguin--action-bite', actionActive && actionClass === 'penguin--action-bite');
            root.classList.toggle('penguin--action-swallow', actionActive && actionClass === 'penguin--action-swallow');
            root.classList.toggle('penguin--auto-bite', this.autoBiteHint && this.mode === 'bite' && !stunned);
            root.classList.toggle('penguin--swallow-pulse', this.swallowPulseActive);
            root.classList.toggle('penguin--bite-crunch', this.biteCrunchActive);
            root.classList.toggle('penguin--stunned', stunned);
            root.classList.toggle('penguin--jammed', this.jammed);
        });

        if (this.isDebugEnabled?.()) {
            this.dbgLog?.('penguin-state', {
                mode: this.mode,
                transitioning,
                actionType: this.actionType,
                actionActive,
                autoBiteHint: this.autoBiteHint,
                stunned,
                hp: this.hp,
                jammed: this.jammed
            }, 160);
        }
        if (!this.actionAnimationActive) {
            this.applyMouthPose(openMouth);
        }
    }

    applyMouthPose(open) {
        if (this.mouthFrozen) return;
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        const setTransform = (el, value) => {
            if (!el) return;
            if (value == null) {
                el.style.removeProperty('transform');
            } else {
                el.style.transform = value;
            }
        };

        if (open) {
            setTransform(parts.head, 'rotate(-10deg)');
            setTransform(parts.eye, 'rotate(-17deg)');
            setTransform(parts.topJaw, 'rotate(-17deg)');
            setTransform(parts.topJawBack, 'rotate(-17deg)');
            setTransform(parts.botJaw, 'rotate(14deg)');
            setTransform(parts.botJawBack, 'rotate(14deg)');
            return;
        }

        setTransform(parts.head, null);
        setTransform(parts.eye, null);
        setTransform(parts.topJaw, null);
        setTransform(parts.topJawBack, null);
        setTransform(parts.botJaw, null);
        setTransform(parts.botJawBack, null);
    }

    restoreMouthLayerTransitions(partsInput = null) {
        const parts = partsInput || this.getPenguinParts();
        if (!parts?.root) return;
        const layers = [
            parts.head,
            parts.eye,
            parts.topJawBack,
            parts.botJawBack,
            parts.topJaw,
            parts.botJaw
        ];
        layers.forEach((el) => {
            if (!el) return;
            el.style.removeProperty('transition');
            el.style.removeProperty('transform-origin');
        });
    }

    getPenguinMouthRightX(containerEl) {
        if (!containerEl) return 0;
        const containerRect = containerEl.getBoundingClientRect();
        const parts = this.getPenguinParts();
        const botRect = parts?.botJaw?.getBoundingClientRect?.();
        const rootRect = parts?.frontRoot?.getBoundingClientRect?.() || parts?.root?.getBoundingClientRect?.();
        const right = botRect?.right ?? rootRect?.right;
        return Number.isFinite(right) ? (right - containerRect.left) : 0;
    }

    getInteractionMetrics(containerEl) {
        if (!containerEl) return null;
        const containerRect = containerEl.getBoundingClientRect();
        const parts = this.getPenguinParts();
        if (!parts?.topJaw || !parts?.botJaw) return null;

        const topRect = parts.topJaw.getBoundingClientRect();
        const botRect = parts.botJaw.getBoundingClientRect();
        const mouthRightX = Math.max(topRect.right, botRect.right) - containerRect.left;
        const mouthLeftX = Math.min(topRect.left, botRect.left) - containerRect.left;
        const mouthCenterY = (((topRect.top + topRect.bottom) * 0.5) + ((botRect.top + botRect.bottom) * 0.5)) * 0.5 - containerRect.top;
        const mouthHeight = Math.max(topRect.bottom, botRect.bottom) - Math.min(topRect.top, botRect.top);
        const mouthWidth = Math.max(28, mouthRightX - mouthLeftX);
        const beltSpeedPxPerSec = Number(window.gameInstance?.renderer?.stripConveyor?.lastKnownSpeedPxPerSec || 220);
        const safeBeltSpeed = Number.isFinite(beltSpeedPxPerSec) && beltSpeedPxPerSec > 0 ? beltSpeedPxPerSec : 220;
        const resolveSwallowX = mouthLeftX + (mouthWidth * 0.8);
        const resolveBiteX = mouthRightX - 18;
        const actionWindowPx = safeBeltSpeed * 0.2;
        const warningWindowPx = safeBeltSpeed * 0.5;
        const interactionPadPx = 8;
        const actionGapPx = 10;
        const warningGapPx = 10;
        const activeResolveX = this.mode === 'swallow' ? resolveSwallowX : resolveBiteX;
        const interactionLeftX = activeResolveX - interactionPadPx;
        const interactionRightX = activeResolveX + interactionPadPx;
        const actionLeftX = interactionRightX + actionGapPx;
        const actionRightX = actionLeftX + actionWindowPx;
        const warningLeftX = actionRightX + warningGapPx;
        const warningRightX = warningLeftX + warningWindowPx;

        return {
            mouthLeftX,
            mouthRightX,
            mouthCenterY,
            mouthHeight,
            mouthWidth,
            resolveSwallowX,
            resolveBiteX,
            interactionLeftX,
            interactionRightX,
            actionLeftX,
            actionRightX,
            warningLeftX,
            warningRightX,
            autoBiteLeftX: actionLeftX,
            autoBiteRightX: warningRightX
        };
    }

    startBiteHold() {
        this.setMode('swallow');
    }

    endBiteHold() {
        this.setMode('bite');
    }
}
