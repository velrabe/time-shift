class PenguinRig {
    constructor(options) {
        this.focusZone = options.focusZone;
        this.getGameArea = options.getGameArea;
        this.isDebugEnabled = options.isDebugEnabled;
        this.dbgLog = options.dbgLog;

        this.mouthHeld = false;
        this.mouthHoldStartTimeMs = 0;
        this.mouthOpen = false;
    }

    isMouthHeld() {
        return !!this.mouthHeld;
    }

    isMouthOpen() {
        return !!this.mouthOpen;
    }

    getMouthHoldStartTimeMs() {
        return this.mouthHoldStartTimeMs;
    }

    getPenguinParts() {
        const root = this.focusZone?.querySelector('#penguin-root') || this.focusZone?.querySelector('.penguin');
        if (!root) return null;
        const head = root.querySelector('#penguin-head') || root.querySelector('.penguin-head');
        const topJaw = root.querySelector('#penguin-top-jaw') || root.querySelector('.penguin-jaw--top');
        const botJaw = root.querySelector('#penguin-bot-jaw') || root.querySelector('.penguin-jaw--bot');
        const topJawImg = topJaw?.querySelector?.('img.penguin-jaw-img') || (topJaw?.tagName === 'IMG' ? topJaw : null);
        const botJawImg = botJaw?.querySelector?.('img.penguin-jaw-img') || (botJaw?.tagName === 'IMG' ? botJaw : null);
        return { root, head, topJaw, botJaw, topJawImg, botJawImg };
    }

    applyMouthPose(open) {
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        const style = window.getComputedStyle(parts.root);
        const shiftX = style.getPropertyValue('--penguin-open-shift-x').trim() || '8px';
        const topExtraX = style.getPropertyValue('--jaw-top-open-extra-x').trim() || '0px';
        const botExtraX = style.getPropertyValue('--jaw-bot-open-extra-x').trim() || '0px';
        const rotateExtraX = style.getPropertyValue('--jaw-open-rot-shift-x').trim() || '2px';
        const addPx = (a, b) => {
            const av = parseFloat(String(a));
            const bv = parseFloat(String(b));
            if (Number.isFinite(av) && Number.isFinite(bv)) return `${av + bv}px`;
            return String(a);
        };
        const topOpenX = addPx(topExtraX, rotateExtraX);
        const botOpenX = addPx(botExtraX, rotateExtraX);
        const setTransform = (el, value) => {
            if (!el) return;
            if (value == null) {
                el.style.removeProperty('transform');
                return;
            }
            el.style.transform = value;
        };

        if (open) {
            setTransform(parts.root, `translateX(${shiftX})`);
            if (parts.head) parts.head.style.transformOrigin = '50% 50%';
            setTransform(parts.head, 'scaleY(1.1)');
            setTransform(parts.topJaw, `translate(${topOpenX}, -3px) rotate(-16deg)`);
            setTransform(parts.botJaw, `translate(${botOpenX}, 3px) rotate(12deg)`);
            return;
        }

        setTransform(parts.root, null);
        setTransform(parts.head, null);
        setTransform(parts.topJaw, null);
        setTransform(parts.botJaw, null);
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
        const parts = this.getPenguinParts();
        if (!parts?.root) return;
        this.mouthHeld = false;
        this.mouthHoldStartTimeMs = 0;
        this.mouthOpen = false;
        this.applyMouthPose(false);
    }

    setPenguinGameOverState() {
        const parts = this.getPenguinParts();
        const head = parts?.head || null;
        const topJaw = parts?.topJaw || null;
        const botJaw = parts?.botJaw || null;

        if (parts?.root) {
            parts.root.style.transform = '';
        }

        if (head) {
            head.style.transform = 'none';
            head.style.removeProperty('transform');
            head.src = 'img/head-2.svg';
        }
        const topJawImg = parts?.topJawImg || topJaw?.querySelector?.('img.penguin-jaw-img') || null;
        const botJawImg = parts?.botJawImg || botJaw?.querySelector?.('img.penguin-jaw-img') || null;
        if (topJaw) {
            topJaw.style.transform = 'none';
            topJaw.style.removeProperty('transform');
            topJaw.classList.add('game-over');
        }
        if (botJaw) {
            botJaw.style.transform = 'none';
            botJaw.style.removeProperty('transform');
            botJaw.classList.add('game-over');
        }
        if (topJawImg) topJawImg.src = 'img/top-jaw-2.svg';
        if (botJawImg) botJawImg.src = 'img/bot-jaw-2.svg';

        this.animateTeethFlyOut();
    }

    animateTeethFlyOut() {
        const container = this.getGameArea?.();
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        const parts = this.getPenguinParts();
        if (!parts?.root || !parts?.botJaw || !parts?.topJaw) return;

        const topJawRect = parts.topJaw.getBoundingClientRect();
        const botJawRect = parts.botJaw.getBoundingClientRect();
        const tooth1StartX = topJawRect.right - containerRect.left;
        const tooth1StartY = topJawRect.top - containerRect.top;
        const tooth2StartX = botJawRect.right - containerRect.left;
        const tooth2StartY = botJawRect.bottom - containerRect.top;

        const teeth = [
            { src: 'img/tooth-1.svg', startX: tooth1StartX, startY: tooth1StartY, angle: -35, distance: 120 },
            { src: 'img/tooth-2.svg', startX: tooth2StartX, startY: tooth2StartY, angle: 25, distance: 100 }
        ];

        teeth.forEach((tooth, idx) => {
            const toothEl = document.createElement('img');
            toothEl.src = tooth.src;
            toothEl.alt = '';
            toothEl.draggable = false;
            toothEl.style.position = 'absolute';
            toothEl.style.left = `${tooth.startX}px`;
            toothEl.style.top = `${tooth.startY}px`;
            toothEl.style.width = '24px';
            toothEl.style.height = 'auto';
            toothEl.style.pointerEvents = 'none';
            toothEl.style.zIndex = '25';
            toothEl.style.transformOrigin = '50% 50%';
            toothEl.style.opacity = '1';
            toothEl.style.transition = 'none';
            container.appendChild(toothEl);

            const delay = idx * 30;
            requestAnimationFrame(() => {
                window.setTimeout(() => {
                    const rad = (tooth.angle * Math.PI) / 180;
                    const endX = tooth.startX + Math.cos(rad) * tooth.distance;
                    const endY = tooth.startY + Math.sin(rad) * tooth.distance;
                    toothEl.style.transition = 'transform 400ms cubic-bezier(0.4, 0.2, 0.3, 0.95), opacity 450ms ease-out';
                    toothEl.style.transform = `translate(${endX - tooth.startX}px, ${endY - tooth.startY}px) rotate(${tooth.angle * 1.5}deg) scale(0.6)`;
                    toothEl.style.opacity = '0';
                    window.setTimeout(() => {
                        try { toothEl.remove(); } catch (_err) { /* ignore */ }
                    }, 500);
                }, delay);
            });
        });
    }

    resetPenguinState() {
        const parts = this.getPenguinParts();
        if (parts?.root) {
            parts.root.style.transform = '';
        }

        const head = parts?.head || null;
        const topJaw = parts?.topJaw || null;
        const botJaw = parts?.botJaw || null;

        if (head) {
            head.style.transform = 'none';
            head.style.removeProperty('transform');
            head.src = 'img/head-1.svg';
        }
        const topJawImg = parts?.topJawImg || topJaw?.querySelector?.('img.penguin-jaw-img') || null;
        const botJawImg = parts?.botJawImg || botJaw?.querySelector?.('img.penguin-jaw-img') || null;
        if (topJaw) {
            topJaw.style.transform = 'none';
            topJaw.style.removeProperty('transform');
            topJaw.classList.remove('game-over');
        }
        if (botJaw) {
            botJaw.style.transform = 'none';
            botJaw.style.removeProperty('transform');
            botJaw.classList.remove('game-over');
        }
        if (topJawImg) topJawImg.src = 'img/top-jaw-1.svg';
        if (botJawImg) botJawImg.src = 'img/bot-jaw-1.svg';

        this.stopAllBites();
    }

    setMouthHeld(held) {
        const parts = this.getPenguinParts();
        if (!parts?.root) return;

        const nextHeld = !!held;
        if (nextHeld === !!this.mouthHeld) return;

        this.mouthHeld = nextHeld;
        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (nextHeld) {
            this.mouthHoldStartTimeMs = nowMs;
            this.mouthOpen = true;
            this.applyMouthPose(true);
        } else {
            this.mouthOpen = false;
            this.applyMouthPose(false);
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
            held: !!this.mouthHeld,
            root: tr(parts.root),
            head: tr(parts.head),
            topJaw: tr(parts.topJaw),
            botJaw: tr(parts.botJaw),
            topShiftXVar: window.getComputedStyle(parts.root).getPropertyValue('--penguin-open-shift-x').trim(),
            topExtraXVar: window.getComputedStyle(parts.root).getPropertyValue('--jaw-top-open-extra-x').trim(),
            botExtraXVar: window.getComputedStyle(parts.root).getPropertyValue('--jaw-bot-open-extra-x').trim()
        }, 0);
    }

    startBiteHold() {
        this.setMouthHeld(true);
    }

    endBiteHold() {
        this.setMouthHeld(false);
    }
}
