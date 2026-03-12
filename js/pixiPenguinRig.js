class PixiPenguinRig {
    constructor(options = {}) {
        this.backLayer = options.backLayer || null;
        this.frontLayer = options.frontLayer || null;
        this.getBeltSpeedPxPerSec = options.getBeltSpeedPxPerSec || (() => 220);
        this.getWorldMetrics = options.getWorldMetrics || (() => ({ width: 1440, height: 900 }));

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
        this.actionAnimationActive = false;
        this.swallowPulseActive = false;
        this.biteCrunchActive = false;
        this._actionPhaseTimeoutId = null;
        this._actionEndTimeoutId = null;
        this._swallowPulseTimeoutId = null;
        this._biteCrunchTimeoutId = null;
        this._hitFxTimeoutId = null;

        this.worldWidth = 1440;
        this.worldHeight = 900;
        this.rigWidth = 420;
        this.rigHeight = this.rigWidth * (200 / 546);
        this.rigLeft = 24;
        this.rigCenterY = 500;
        this.rigTop = 0;
        this.gameScale = 1;
        this.stripFrameTop = 0;
        this.stripFrameHeight = 0;
        this.localMouthLeft = 302;
        this.localMouthRight = 496;
        this.localMouthCenterY = 118;
        this.localMouthHeight = 66;
        this.basePose = { head: 0, eye: 0, top: 0, bot: 0 };
        this.currentPose = { head: 0, eye: 0, top: 0, bot: 0 };
        this.poseTween = null;
        this.actionSequence = null;

        this.parts = null;
        this._build();
        this.layout(this.getWorldMetrics());
        this.applyBrokenTeeth();
        this.applyState();
    }

    getNowMs() {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }

    _makeSprite(url, zIndex = 0) {
        const sprite = PIXI.Sprite.from(url);
        sprite.anchor.set(0.5);
        sprite.position.set(273, 100);
        sprite.zIndex = zIndex;
        return sprite;
    }

    _build() {
        if (!this.backLayer || !this.frontLayer || typeof PIXI === 'undefined') return;

        const backRoot = new PIXI.Container();
        const frontRoot = new PIXI.Container();
        backRoot.sortableChildren = true;
        frontRoot.sortableChildren = true;

        const backFrame = new PIXI.Container();
        const frontFrame = new PIXI.Container();
        backFrame.position.set(0, 0);
        frontFrame.position.set(0, 0);
        backRoot.addChild(backFrame);
        frontRoot.addChild(frontFrame);

        const head = this._makeSprite('img/head/head-1.svg', 1);
        const eye = this._makeSprite('img/head/eye-1.svg', 2);
        const topJawBack = this._makeSprite('img/head/top-jaw-1-back.svg', 3);
        const botJawBack = this._makeSprite('img/head/bot-jaw-1-back.svg', 3);
        const topTeethRoot = new PIXI.Container();
        const botTeethRoot = new PIXI.Container();
        topTeethRoot.zIndex = 4;
        botTeethRoot.zIndex = 6;
        const topJaw = this._makeSprite('img/head/top-jaw-1-front.svg', 5);
        const botJaw = this._makeSprite('img/head/bot-jaw-1-front.svg', 7);

        const topTeeth = [
            this._makeSprite('img/head/tooth-top-1.svg', 7),
            this._makeSprite('img/head/tooth-top-2.svg', 8),
            this._makeSprite('img/head/tooth-top-3.svg', 8),
            this._makeSprite('img/head/tooth-top-4.svg', 7),
            this._makeSprite('img/head/tooth-top-5.svg', 7)
        ];
        const botTeeth = [
            this._makeSprite('img/head/tooth-bot-1.svg', 7),
            this._makeSprite('img/head/tooth-bot-2.svg', 8),
            this._makeSprite('img/head/tooth-bot-3.svg', 8),
            this._makeSprite('img/head/tooth-bot-4.svg', 7),
            this._makeSprite('img/head/tooth-bot-5.svg', 7)
        ];

        const autoBiteGlow = new PIXI.Graphics();
        autoBiteGlow.zIndex = 9;
        autoBiteGlow.alpha = 0;
        frontFrame.addChild(autoBiteGlow);

        backFrame.addChild(head, eye, topJawBack, botJawBack);
        topTeeth.forEach((tooth) => topTeethRoot.addChild(tooth));
        botTeeth.forEach((tooth) => botTeethRoot.addChild(tooth));
        frontFrame.addChild(topTeethRoot);
        frontFrame.addChild(topJaw);
        frontFrame.addChild(botTeethRoot);
        frontFrame.addChild(botJaw);

        this.backLayer.addChild(backRoot);
        this.frontLayer.addChild(frontRoot);

        this.parts = {
            root: backRoot,
            backRoot,
            frontRoot,
            backFrame,
            frontFrame,
            head,
            eye,
            topJawBack,
            botJawBack,
            topTeethRoot,
            botTeethRoot,
            topJaw,
            botJaw,
            topTeeth,
            botTeeth,
            autoBiteGlow
        };
    }

    layout(metrics = {}) {
        this.worldWidth = Number.isFinite(metrics.width) ? metrics.width : 1440;
        this.worldHeight = Number.isFinite(metrics.height) ? metrics.height : 900;
        const scaleW = this.worldWidth / 1440;
        const scaleH = this.worldHeight / 900;
        this.gameScale = Math.max(0.48, Math.min(1, Math.min(scaleW, scaleH)));
        this.rigWidth = 360 * this.gameScale;
        this.rigHeight = this.rigWidth * (200 / 546);
        this.rigLeft = -102 * this.gameScale;
        const laneShiftY = (63 * this.gameScale) * 0.25;
        this.rigTop = (this.worldHeight * 0.5) - (this.rigHeight * 0.5) - laneShiftY;
        this.rigCenterY = this.rigTop + (this.rigHeight * 0.5);
        this.stripFrameTop = this.rigTop - (this.rigHeight * 0.08);
        this.stripFrameHeight = this.rigHeight * 1.16;

        const backRoot = this.parts?.backRoot;
        const frontRoot = this.parts?.frontRoot;
        const scale = this.rigWidth / 546;
        if (backRoot) {
            backRoot.position.set(this.rigLeft, this.rigTop);
            backRoot.scale.set(scale);
        }
        if (frontRoot) {
            frontRoot.position.set(this.rigLeft, this.rigTop);
            frontRoot.scale.set(scale);
        }
        this._drawAutoBiteGlow();
    }

    getRigRoots() {
        return [this.parts?.backRoot, this.parts?.frontRoot].filter(Boolean);
    }

    getPenguinParts() {
        return this.parts;
    }

    getMode() {
        return this.mode;
    }

    isTransitioning() {
        return this.getNowMs() < (this.transitionUntil || 0);
    }

    isStunned() {
        return this.getNowMs() < (this.stunUntil || 0);
    }

    isMouthOpen() {
        if (this.mode === 'swallow') return true;
        if (this.jammed) return true;
        if (this.isStunned()) return true;
        return this.getNowMs() < (this.actionUntil || 0);
    }

    setMode(mode) {
        const nextMode = mode === 'bite' ? 'bite' : 'swallow';
        if (this.mode === nextMode && !this.isTransitioning()) {
            this.applyState();
            return;
        }
        this.clearActionAnimation();
        this.mode = nextMode;
        this.transitionUntil = this.getNowMs() + this.transitionDurationMs;
        this.actionUntil = 0;
        this.actionType = null;
        this.applyState();
    }

    setAutoBiteHint(active) {
        this.autoBiteHint = !!active;
        this.applyState();
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
        this.applyState();
    }

    clearActionAnimation() {
        this.actionAnimationActive = false;
        this.actionSequence = null;
        if (this._actionPhaseTimeoutId) {
            window.clearTimeout(this._actionPhaseTimeoutId);
            this._actionPhaseTimeoutId = null;
        }
        if (this._actionEndTimeoutId) {
            window.clearTimeout(this._actionEndTimeoutId);
            this._actionEndTimeoutId = null;
        }
    }

    _setAngles({ head = 0, eye = 0, top = 0, bot = 0 }) {
        if (!this.parts) return;
        this.currentPose = { head, eye, top, bot };
        this.parts.head.rotation = head;
        this.parts.eye.rotation = eye;
        this.parts.topJaw.rotation = top;
        this.parts.topJawBack.rotation = top;
        this.parts.botJaw.rotation = bot;
        this.parts.botJawBack.rotation = bot;
    }

    _deg(value) {
        return (Number(value || 0) * Math.PI) / 180;
    }

    _applyOpenPose() {
        this.basePose = {
            head: this._deg(-10),
            eye: this._deg(-17),
            top: this._deg(-17),
            bot: this._deg(14)
        };
        this._setAngles(this.basePose);
    }

    _applyClosedPose() {
        this.basePose = { head: 0, eye: 0, top: 0, bot: 0 };
        this._setAngles(this.basePose);
    }

    _easeLinear(t) {
        return t;
    }

    _easeInOut(t) {
        return (t < 0.5) ? (2 * t * t) : (1 - Math.pow(-2 * t + 2, 2) * 0.5);
    }

    _startPoseTween(targetPose, durationMs, easing = 'linear') {
        this.poseTween = {
            startedAt: this.getNowMs(),
            durationMs: Math.max(1, durationMs || 1),
            fromPose: { ...this.currentPose },
            toPose: { ...targetPose },
            easing
        };
    }

    _queueActionSequence(steps) {
        this.actionSequence = Array.isArray(steps) ? steps.slice() : [];
        this._runNextActionStep();
    }

    _runNextActionStep() {
        if (!Array.isArray(this.actionSequence) || this.actionSequence.length === 0) {
            this.actionSequence = null;
            return;
        }
        const step = this.actionSequence.shift();
        this._startPoseTween(step.pose, step.durationMs, step.easing || 'linear');
        this._actionPhaseTimeoutId = window.setTimeout(() => {
            this._actionPhaseTimeoutId = null;
            this._runNextActionStep();
        }, Math.max(1, step.durationMs || 1));
    }

    _updatePoseAnimation() {
        if (!this.poseTween) return;
        const now = this.getNowMs();
        const elapsed = now - this.poseTween.startedAt;
        const progress = Math.max(0, Math.min(1, elapsed / this.poseTween.durationMs));
        const ease = this.poseTween.easing === 'ease-in-out' ? this._easeInOut(progress) : this._easeLinear(progress);
        const lerp = (a, b) => a + ((b - a) * ease);
        this._setAngles({
            head: lerp(this.poseTween.fromPose.head, this.poseTween.toPose.head),
            eye: lerp(this.poseTween.fromPose.eye, this.poseTween.toPose.eye),
            top: lerp(this.poseTween.fromPose.top, this.poseTween.toPose.top),
            bot: lerp(this.poseTween.fromPose.bot, this.poseTween.toPose.bot)
        });
        if (progress >= 1) {
            this.poseTween = null;
        }
    }

    getStripFrame() {
        return {
            top: this.stripFrameTop,
            height: this.stripFrameHeight,
            centerY: this.stripFrameTop + (this.stripFrameHeight * 0.5)
        };
    }

    playActionBiteAnimation() {
        if (this.mouthFrozen) return;
        this.actionAnimationActive = true;
        this._queueActionSequence([
            {
                pose: {
                    head: this._deg(-10),
                    eye: this._deg(-17),
                    top: this._deg(-17),
                    bot: this._deg(14)
                },
                durationMs: 200,
                easing: 'linear'
            },
            {
                pose: { head: 0, eye: 0, top: 0, bot: 0 },
                durationMs: 100,
                easing: 'linear'
            }
        ]);
        this._actionEndTimeoutId = window.setTimeout(() => {
            this.actionAnimationActive = false;
            this.applyState();
        }, 310);
    }

    playActionSwallowAnimation() {
        if (this.mouthFrozen) return;
        this.actionAnimationActive = true;
        this._queueActionSequence([
            {
                pose: {
                    head: this._deg(-10),
                    eye: this._deg(-17),
                    top: this._deg(-22),
                    bot: this._deg(19)
                },
                durationMs: 100,
                easing: 'linear'
            },
            {
                pose: {
                    head: this._deg(-10),
                    eye: this._deg(-17),
                    top: this._deg(-17),
                    bot: this._deg(14)
                },
                durationMs: 200,
                easing: 'ease-in-out'
            }
        ]);
        this._actionEndTimeoutId = window.setTimeout(() => {
            this.actionAnimationActive = false;
            this.applyState();
        }, 320);
    }

    triggerSwallowPulse() {
        this.swallowPulseActive = true;
        this.applyState();
        if (this._swallowPulseTimeoutId) window.clearTimeout(this._swallowPulseTimeoutId);
        this._swallowPulseTimeoutId = window.setTimeout(() => {
            this._swallowPulseTimeoutId = null;
            this.swallowPulseActive = false;
            this.applyState();
        }, 180);
    }

    triggerAutoBiteCrunch() {
        this.biteCrunchActive = true;
        this.applyState();
        if (this._biteCrunchTimeoutId) window.clearTimeout(this._biteCrunchTimeoutId);
        this._biteCrunchTimeoutId = window.setTimeout(() => {
            this._biteCrunchTimeoutId = null;
            this.biteCrunchActive = false;
            this.applyState();
        }, 260);
    }

    setStunned(durationMs = 0) {
        const now = this.getNowMs();
        const until = now + Math.max(0, durationMs || 0);
        this.stunUntil = Math.max(this.stunUntil || 0, until);
        this.applyState();
    }

    clearStun() {
        this.stunUntil = 0;
        this.applyState();
    }

    setHealth(hp, maxHp = this.maxHp) {
        this.maxHp = Math.max(1, Math.floor(maxHp || 4));
        this.hp = Math.max(0, Math.min(this.maxHp, Math.floor(hp || 0)));
        this.applyBrokenTeeth();
        this.applyState();
    }

    applyBrokenTeeth() {
        if (!this.parts) return;
        const brokenPairs = Math.max(0, Math.min(3, this.maxHp - this.hp));
        this.parts.topTeeth.forEach((tooth, index) => {
            if (!tooth) return;
            tooth.alpha = index < brokenPairs ? 0 : 1;
            if (index >= brokenPairs) {
                tooth.position.set(273, 100);
                tooth.rotation = 0;
                tooth.scale.set(1);
            }
        });
        this.parts.botTeeth.forEach((tooth, index) => {
            if (!tooth) return;
            tooth.alpha = index < brokenPairs ? 0 : 1;
            if (index >= brokenPairs) {
                tooth.position.set(273, 100);
                tooth.rotation = 0;
                tooth.scale.set(1);
            }
        });
    }

    triggerTimingTeethHitFx(toothPairIndex = null) {
        if (!this.parts || this.hp <= 0) return;
        const derivedIndex = Math.max(0, Math.min(2, (this.maxHp - this.hp) - 1));
        const targetIndex = Number.isFinite(toothPairIndex)
            ? Math.max(0, Math.min(2, Math.floor(toothPairIndex)))
            : derivedIndex;
        const topTooth = this.parts.topTeeth[targetIndex];
        const botTooth = this.parts.botTeeth[targetIndex];
        const animate = (tooth, cfg) => {
            if (!tooth) return;
            tooth.alpha = 1;
            tooth.position.set(273, 100);
            tooth.rotation = 0;
            tooth.scale.set(1);
            tooth.position.x += cfg.dx;
            tooth.position.y += cfg.dy;
            tooth.rotation = this._deg(cfg.angleDeg);
            tooth.scale.y = 0.72;
            tooth.alpha = 0;
        };
        animate(topTooth, { angleDeg: -20, dy: -10, dx: -4 });
        animate(botTooth, { angleDeg: -7, dy: 8, dx: -4 });
        if (this._hitFxTimeoutId) window.clearTimeout(this._hitFxTimeoutId);
        this._hitFxTimeoutId = window.setTimeout(() => {
            this._hitFxTimeoutId = null;
            this.applyBrokenTeeth();
        }, 260);
    }

    freezeMouthInPlace() {
        this.mouthFrozen = true;
        this.jammed = true;
        this.applyState();
    }

    setPenguinGameOverState() {
        this.jammed = true;
        this.applyState();
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
        this.applyState();
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
        this.applyBrokenTeeth();
        this.applyState();
    }

    _drawAutoBiteGlow() {
        const glow = this.parts?.autoBiteGlow;
        if (!glow) return;
        glow.clear();
        const left = this.localMouthLeft;
        const width = this.localMouthRight - this.localMouthLeft;
        const top = this.localMouthCenterY - (this.localMouthHeight * 0.7);
        const height = this.localMouthHeight * 1.4;
        glow.lineStyle(6, 0xffce64, 0.95);
        glow.beginFill(0xffce64, 0.12);
        glow.drawRoundedRect(left, top, width, height, 22);
        glow.endFill();
    }

    applyState() {
        if (!this.parts) return;
        const openMouth = this.isMouthOpen() || this.biteCrunchActive;
        const stunned = this.isStunned();
        const jammed = this.jammed;

        if (!this.actionAnimationActive) {
            const targetPose = openMouth
                ? {
                    head: this._deg(-10),
                    eye: this._deg(-17),
                    top: this._deg(-17),
                    bot: this._deg(14)
                }
                : { head: 0, eye: 0, top: 0, bot: 0 };
            const samePose = ['head', 'eye', 'top', 'bot'].every((key) => Math.abs((this.basePose[key] || 0) - (targetPose[key] || 0)) < 0.0001);
            this.basePose = targetPose;
            if (!samePose && !this.poseTween) {
                this._startPoseTween(targetPose, this.transitionDurationMs, 'linear');
            } else if (!this.poseTween) {
                this._setAngles(targetPose);
            }
        }

        const baseScale = this.swallowPulseActive ? 1.03 : 1;
        this.parts.backRoot.scale.set((this.rigWidth / 546) * baseScale);
        this.parts.frontRoot.scale.set((this.rigWidth / 546) * baseScale);
        this.parts.autoBiteGlow.alpha = (this.autoBiteHint && this.mode === 'bite' && !stunned) ? 0.8 : 0;
        this.parts.head.tint = stunned ? 0xbfd9ff : 0xffffff;
        this.parts.eye.tint = jammed ? 0xffd4d4 : 0xffffff;
        this.parts.topJaw.tint = jammed ? 0xffd9d9 : 0xffffff;
        this.parts.botJaw.tint = jammed ? 0xffd9d9 : 0xffffff;
    }

    update() {
        this._updatePoseAnimation();
    }

    getPenguinMouthRightX() {
        return this.rigLeft + ((this.localMouthRight / 546) * this.rigWidth);
    }

    getInteractionMetrics() {
        const mouthLeftX = this.rigLeft + ((this.localMouthLeft / 546) * this.rigWidth);
        const mouthRightX = this.rigLeft + ((this.localMouthRight / 546) * this.rigWidth);
        const mouthCenterY = (this.rigCenterY - (this.rigHeight * 0.5)) + ((this.localMouthCenterY / 200) * this.rigHeight);
        const mouthHeight = (this.localMouthHeight / 200) * this.rigHeight;
        const mouthWidth = Math.max(28, mouthRightX - mouthLeftX);
        const beltSpeedPxPerSec = Number(this.getBeltSpeedPxPerSec?.() || 220);
        const safeBeltSpeed = Number.isFinite(beltSpeedPxPerSec) && beltSpeedPxPerSec > 0 ? beltSpeedPxPerSec : 220;
        const resolveSwallowX = mouthLeftX + (mouthWidth * 0.8);
        const resolveBiteX = mouthRightX - (18 * (this.rigWidth / 546));
        const actionWindowPx = safeBeltSpeed * 0.2;
        const warningWindowPx = safeBeltSpeed * 0.5;
        const interactionPadPx = 8 * (this.rigWidth / 546);
        const actionGapPx = 10 * (this.rigWidth / 546);
        const warningGapPx = 10 * (this.rigWidth / 546);
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
}
