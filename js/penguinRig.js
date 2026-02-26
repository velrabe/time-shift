class PenguinRig {
    constructor(options) {
        this.focusZone = options.focusZone;
        this.getGameArea = options.getGameArea;
        this.isDebugEnabled = options.isDebugEnabled;
        this.dbgLog = options.dbgLog;

        this.mouthHeld = false;
        this.mouthHoldStartTimeMs = 0;
        this.mouthOpen = false;
        this.mouthFullyClosed = true;
        this.mouthCloseSettleTimeoutId = null;
        this.mouthFrozen = false;
    }

    isMouthHeld() {
        return !!this.mouthHeld;
    }

    isMouthOpen() {
        return !!this.mouthOpen;
    }

    isMouthFullyClosed() {
        return !!this.mouthFullyClosed;
    }

    getMouthHoldStartTimeMs() {
        return this.mouthHoldStartTimeMs;
    }

    getPenguinParts() {
        const root = this.focusZone;
        if (!root) return null;
        const head = root.querySelector('#penguin-head-layer');
        const eye = root.querySelector('#penguin-eye-layer');
        const rightColliderLayer = root.querySelector('#penguin-right-collider-layer');
        const topJawBack = root.querySelector('#penguin-top-jaw-back');
        const botJawBack = root.querySelector('#penguin-bot-jaw-back');
        const topJaw = root.querySelector('#penguin-top-jaw');
        const botJaw = root.querySelector('#penguin-bot-jaw');
        const topJawImg = topJaw?.querySelector?.('.penguin-jaw-base') || null;
        const botJawImg = botJaw?.querySelector?.('.penguin-jaw-base') || null;
        const leftColliderLayer = root.querySelector('#penguin-left-collider-layer');
        const rightColliderPath = rightColliderLayer?.querySelector?.('#penguin-right-collider-path') || null;
        const leftColliderPath = leftColliderLayer?.querySelector?.('#penguin-left-collider-path') || null;
        // Коллайдеры зубов 1–5: для еды — только зуб 1 (индекс 0); для льда — зубы 1–4 crack, зуб 5 (индекс 4) геймовер
        const topToothCols = Array.from(topJaw?.querySelectorAll?.('.penguin-tooth-col') || []);
        const botToothCols = Array.from(botJaw?.querySelectorAll?.('.penguin-tooth-col') || []);
        const topToothColliderPaths = topToothCols.map((svg) => svg.querySelector('path')).filter(Boolean).slice(0, 5);
        const botToothColliderPaths = botToothCols.map((svg) => svg.querySelector('path')).filter(Boolean).slice(0, 5);
        return {
            root, head, eye, topJawBack, botJawBack, topJaw, botJaw, topJawImg, botJawImg,
            leftColliderPath, rightColliderPath,
            topToothColliderPaths, botToothColliderPaths
        };
    }

    applyMouthPose(open) {
        if (this.mouthFrozen) return;
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        const setTransform = (el, value) => {
            if (!el) return;
            if (value == null) {
                el.style.removeProperty('transform');
                return;
            }
            el.style.transform = value;
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

    getPenguinMouthRightX(containerEl) {
        if (!containerEl) return 0;
        const containerRect = containerEl.getBoundingClientRect();
        const parts = this.getPenguinParts();
        if (!parts) return 0;

        const botRect = parts.botJaw?.getBoundingClientRect?.() || null;
        const rootRect = parts.root?.getBoundingClientRect?.() || null;
        const right = botRect ? botRect.right : (rootRect ? rootRect.right : null);
        if (right == null) return 0;
        return (right - containerRect.left);
    }

    stopAllBites() {
        this.mouthFrozen = false;
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        if (this.mouthCloseSettleTimeoutId) {
            window.clearTimeout(this.mouthCloseSettleTimeoutId);
            this.mouthCloseSettleTimeoutId = null;
        }
        this.mouthHeld = false;
        this.mouthHoldStartTimeMs = 0;
        this.mouthOpen = false;
        this.mouthFullyClosed = true;
        this.applyMouthPose(false);
    }

    /** Замораживает челюсть в текущей позе (для геймовера по льду на 5-м зубе). */
    freezeMouthInPlace() {
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        this.mouthFrozen = true;
        const freeze = (el) => {
            if (!el) return;
            const t = el ? window.getComputedStyle(el).transform : 'none';
            el.style.transition = 'none';
            el.style.transform = t || 'none';
        };
        freeze(parts.head);
        freeze(parts.eye);
        freeze(parts.topJawBack);
        freeze(parts.topJaw);
        freeze(parts.botJawBack);
        freeze(parts.botJaw);
    }

    setPenguinGameOverState() {
        // Новый риг головы: пока без отдельной game-over механики.
        this.stopAllBites();
    }

    resetPenguinState() {
        this.stopAllBites();
        this.resetTimingTeethFx();
    }

    triggerTimingTeethHitFx() {
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        const topTeeth = Array.from(parts.topJaw?.querySelectorAll?.('.penguin-tooth') || []).slice(0, 1);
        const botTeeth = Array.from(parts.botJaw?.querySelectorAll?.('.penguin-tooth') || []).slice(0, 1);

        const runFx = (teeth, configs) => {
            teeth.forEach((tooth, idx) => {
                const cfg = configs[idx] || configs[configs.length - 1] || { angleDeg: 0, dyPx: 0, dx: -4 };
                // Фаза 1: явно фиксируем стартовое состояние.
                // Иначе браузер может схлопнуть старт/финиш в один кадр и "съесть" анимацию.
                tooth.style.transition = 'none';
                tooth.style.transformOrigin = '50% 50%';
                tooth.style.transform = 'translate(0px, 0px) rotate(0deg) scaleY(1)';
                tooth.style.opacity = '1';

                requestAnimationFrame(() => {
                    tooth.style.transition = 'transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 260ms ease-out';
                    tooth.style.transform = `translate(${cfg.dx}px, ${cfg.dyPx}px) rotate(${cfg.angleDeg}deg) scaleY(0.7)`;
                    tooth.style.opacity = '0';
                });
            });
        };

        runFx(topTeeth, [
            { angleDeg: -20, dyPx: -10, dx: -4 }
        ]);
        runFx(botTeeth, [
            { angleDeg: -7, dyPx: 8, dx: -4 }
        ]);
    }

    resetTimingTeethFx() {
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        const allTeeth = Array.from(parts.root.querySelectorAll('.penguin-tooth'));
        allTeeth.forEach((tooth) => {
            tooth.style.removeProperty('transition');
            tooth.style.removeProperty('transform');
            tooth.style.removeProperty('opacity');
            tooth.style.removeProperty('transform-origin');
        });
    }

    setMouthHeld(held) {
        const parts = this.getPenguinParts();
        if (!parts?.root) return;

        const nextHeld = !!held;
        if (nextHeld === !!this.mouthHeld) return;

        this.mouthHeld = nextHeld;
        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (nextHeld) {
            if (this.mouthCloseSettleTimeoutId) {
                window.clearTimeout(this.mouthCloseSettleTimeoutId);
                this.mouthCloseSettleTimeoutId = null;
            }
            this.mouthHoldStartTimeMs = nowMs;
            this.mouthOpen = true;
            this.mouthFullyClosed = false;
            this.applyMouthPose(true);
        } else {
            this.mouthOpen = false;
            this.mouthFullyClosed = false;
            this.applyMouthPose(false);
            // Челюсть считается "полностью закрытой" после завершения CSS transition.
            this.mouthCloseSettleTimeoutId = window.setTimeout(() => {
                this.mouthCloseSettleTimeoutId = null;
                if (!this.mouthHeld && !this.mouthOpen) {
                    this.mouthFullyClosed = true;
                }
            }, 120);
        }

        if (this.isDebugEnabled?.()) {
            const stage = nextHeld ? 'open' : 'close';
            requestAnimationFrame(() => this.logMouthTransformSnapshot(`${stage}:raf`));
            window.setTimeout(() => this.logMouthTransformSnapshot(`${stage}:settled`), 120);
        }
    }

    logMouthTransformSnapshot(stage) {
        if (!this.isDebugEnabled?.()) return;
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        const tr = (el) => (el ? window.getComputedStyle(el).transform : null);
        this.dbgLog?.('mouth-transform', {
            stage,
            mouthOpen: !!this.mouthOpen,
            mouthFullyClosed: !!this.mouthFullyClosed,
            held: !!this.mouthHeld,
            root: tr(parts.root),
            head: tr(parts.head),
            eye: tr(parts.eye),
            topJaw: tr(parts.topJaw),
            botJaw: tr(parts.botJaw)
        }, 0);
    }

    startBiteHold() {
        this.setMouthHeld(true);
    }

    endBiteHold() {
        this.setMouthHeld(false);
    }
}
