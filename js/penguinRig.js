class PenguinRig {
    constructor(options) {
        this.focusZone = options.focusZone;
        this.getGameArea = options.getGameArea;
        this.isDebugEnabled = options.isDebugEnabled;
        this.dbgLog = options.dbgLog;

        this.mode = 'swallow';
        this.transitionDurationMs = 200;
        this.transitionUntil = 0;
        this.actionUntil = 0;
        this.actionType = null;
        this.autoBiteHint = false;
        this.stunUntil = 0;
        this.hp = 3;
        this.maxHp = 3;
        this.mouthFrozen = false;
        this.jammed = false;
        this._hitFxTimeoutId = null;
        this._swallowPulseTimeoutId = null;
        this._biteCrunchTimeoutId = null;
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
        return !!this.autoBiteHint || this.getNowMs() < (this.actionUntil || 0);
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
        this.actionType = actionType || null;
        this.actionUntil = this.getNowMs() + 220;
        this.applyStateClasses();
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
        this.maxHp = Math.max(1, Math.floor(maxHp || 3));
        this.hp = Math.max(0, Math.min(this.maxHp, Math.floor(hp || 0)));
        this.applyBrokenTeeth();
        this.applyStateClasses();
    }

    applyBrokenTeeth() {
        const parts = this.getPenguinParts();
        if (!parts) return;
        const brokenPairs = Math.max(0, Math.min(3, this.maxHp - this.hp));
        parts.topTeeth.forEach((tooth, index) => {
            tooth.classList.toggle('penguin-tooth--broken', index < brokenPairs);
        });
        parts.botTeeth.forEach((tooth, index) => {
            tooth.classList.toggle('penguin-tooth--broken', index < brokenPairs);
        });
    }

    triggerTimingTeethHitFx() {
        const parts = this.getPenguinParts();
        if (!parts) return;
        const brokenPairs = Math.max(0, Math.min(3, this.maxHp - this.hp));
        const topTooth = parts.topTeeth[brokenPairs] || parts.topTeeth[0];
        const botTooth = parts.botTeeth[brokenPairs] || parts.botTeeth[0];
        [topTooth, botTooth].forEach((tooth) => tooth?.classList.add('penguin-tooth--hit'));
        if (this._hitFxTimeoutId) window.clearTimeout(this._hitFxTimeoutId);
        this._hitFxTimeoutId = window.setTimeout(() => {
            this._hitFxTimeoutId = null;
            [topTooth, botTooth].forEach((tooth) => tooth?.classList.remove('penguin-tooth--hit'));
        }, 260);
    }

    resetTimingTeethFx() {
        const parts = this.getPenguinParts();
        if (!parts) return;
        [...parts.topTeeth, ...parts.botTeeth].forEach((tooth) => {
            tooth.classList.remove('penguin-tooth--hit');
        });
        if (this._hitFxTimeoutId) {
            window.clearTimeout(this._hitFxTimeoutId);
            this._hitFxTimeoutId = null;
        }
    }

    freezeMouthInPlace() {
        this.mouthFrozen = true;
        this.jammed = true;
        this.applyStateClasses();
    }

    setPenguinGameOverState() {
        this.jammed = true;
        this.applyStateClasses();
    }

    stopAllBites() {
        this.actionUntil = 0;
        this.actionType = null;
        this.autoBiteHint = false;
        this.mouthFrozen = false;
        this.jammed = false;
        this.swallowPulseActive = false;
        this.biteCrunchActive = false;
        this.clearStun();
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

        return {
            mouthLeftX,
            mouthRightX,
            mouthCenterY,
            mouthHeight,
            mouthWidth,
            resolveSwallowX: mouthLeftX + (mouthWidth * 0.8),
            resolveBiteX: mouthRightX - 18,
            actionLeftX: mouthLeftX - 170,
            actionRightX: mouthRightX + 170,
            autoBiteLeftX: mouthLeftX - 180,
            autoBiteRightX: mouthRightX + 26
        };
    }

    startBiteHold() {
        this.setMode('swallow');
    }

    endBiteHold() {
        this.setMode('bite');
    }
}
