// Pixi-backed gameplay renderer facade
class Renderer {
    constructor() {
        this.debug = (() => {
            try {
                const qs = new URLSearchParams(window.location.search);
                return qs.has('debug') || qs.get('debug') === '1';
            } catch (e) {
                return false;
            }
        })();

        this.circleAnimationId = null;
        this.stripAnimationId = null;
        this.ui = new RendererUI();
        this.stage = new PixiGameplayStage({
            mount: document.getElementById('pixi-stage'),
            onToggleMode: () => window.gameInstance?.toggleMode?.(),
            onAction: () => window.gameInstance?.performAction?.(),
            debug: this.debug
        });
        this.stripConveyor = this.stage?.conveyor || null;
        this.penguinRig = this.stage?.penguinRig || null;
        this.collisionEngine = new CollisionEngine({
            getItems: () => this.stripConveyor?.getActiveItems?.() || [],
            getInteractionMetrics: () => this.penguinRig?.getInteractionMetrics?.() || null,
            getGameplayState: () => window.gameInstance?.getInteractionState?.() || null,
            getBeltSpeedPxPerSec: () => this.stripConveyor?.lastKnownSpeedPxPerSec || 220,
            resolveItem: (item, resolution) => this.stripConveyor?.resolveItem?.(item, resolution),
            setAutoBiteHint: (active) => this.penguinRig?.setAutoBiteHint?.(active),
            triggerTeethHitFx: () => this.penguinRig?.triggerTimingTeethHitFx?.(),
            emitEvent: (eventName, payload) => {
                if (typeof eventBus !== 'undefined' && eventBus?.emit) {
                    eventBus.emit(eventName, payload);
                }
            }
        });
        if (this.stage) {
            this.stage.onCheckCollisions = () => this.checkCollisionsAndAutoBite();
        }

        this.leaderboardModal = this.ui.leaderboardModal;
        this.leaderboardListEl = this.ui.leaderboardListEl;
        this.leaderboardMeEl = this.ui.leaderboardMeEl;
        this.leaderboardCloseBtn = this.ui.leaderboardCloseBtn;

        this.setupEventListeners();
        this.setupDebugResetButton();
    }

    setupDebugResetButton() {
        if (!this.debug) return;
        const hudActions = document.getElementById('hud-actions');
        if (!hudActions) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'icon-btn';
        btn.textContent = 'RST';
        btn.title = 'Reset local & GamePush progress (debug)';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.gameInstance?.debugResetProgress?.();
        });
        hudActions.appendChild(btn);
    }

    setupEventListeners() {
        eventBus.on('FOOD_EATEN', () => {
            this.stripConveyor?.onFoodEaten?.();
        });
        eventBus.on('PAUSE', () => {
            this.stopCircleAnimation();
            this.stopStripAnimation();
        });
        window.addEventListener('resize', () => {
            this.stage?.resize?.();
        });
    }

    getPenguinParts() {
        return this.penguinRig?.getPenguinParts?.() || null;
    }

    stopAllBites() {
        this.penguinRig?.stopAllBites?.();
    }

    setPenguinGameOverState() {
        this.penguinRig?.setPenguinGameOverState?.();
    }

    resetPenguinState() {
        this.penguinRig?.resetPenguinState?.();
    }

    resetStripWindow() {
        this.stopStripAnimation();
        this.stripConveyor?.resetWindow?.();
        this.collisionEngine?.reset?.();
        this.penguinRig?.stopAllBites?.();
    }

    updateConveyor(timer) {
        this.stripConveyor?.update?.(timer);
        this.stage?.update?.();
    }

    checkCollisionsAndAutoBite() {
        this.collisionEngine?.check?.();
        if (this.debug) {
            this.stage?.updateDebug?.(
                this.collisionEngine?.lastMetrics || null,
                this.stripConveyor?.getActiveItems?.() || [],
                window.gameInstance?.getInteractionState?.() || null
            );
        }
    }

    setMode(mode) {
        this.penguinRig?.setMode?.(mode);
    }

    performAction() {
        this.penguinRig?.triggerAction?.(this.penguinRig?.getMode?.() === 'bite' ? 'action-bite' : 'action-swallow');
        return this.collisionEngine?.handleAction?.();
    }

    setHealth(hp, maxHp) {
        this.penguinRig?.setHealth?.(hp, maxHp);
    }

    setStunned(durationMs) {
        if (durationMs > 0) this.penguinRig?.setStunned?.(durationMs);
        else this.penguinRig?.clearStun?.();
    }

    startBiteHold() {
        this.setMode('swallow');
    }

    endBiteHold() {
        this.setMode('bite');
    }

    showFloatingCoinBonus(x, y, amount) {
        this.stage?.showFloatingCoinBonus?.(x, y, amount);
    }

    showEatRipple(x, y, kind = 'food') {
        this.stage?.showEatRipple?.(x, y, kind);
    }

    triggerPixiActionSuccessFx() {
        this.stage?.triggerActionSuccessFx?.();
    }

    stopCircleAnimation() {
        if (this.circleAnimationId) {
            cancelAnimationFrame(this.circleAnimationId);
            this.circleAnimationId = null;
        }
    }

    stopStripAnimation() {
        if (this.stripAnimationId) {
            cancelAnimationFrame(this.stripAnimationId);
            this.stripAnimationId = null;
        }
    }

    pauseBeltUpdate() {
        this.stripConveyor?.pause?.();
    }

    freezeMouthInPlace() {
        this.penguinRig?.freezeMouthInPlace?.();
    }

    resumeBeltUpdate(pauseDurationMs) {
        this.stripConveyor?.resume?.(pauseDurationMs);
    }

    renderNumberStrip() {
        this.stripConveyor?.renderNumberStrip?.();
    }

    refreshVisibleItemTypes() {
        this.stripConveyor?.refreshVisibleItemTypes?.();
    }

    updateUI(state) {
        this.ui.updateUI(state);
        this.stage?.setGameState?.(state);
    }

    showPauseScreen() {
        this.ui.showPauseScreen();
    }

    hidePauseScreen() {
        this.ui.hidePauseScreen();
    }

    isLeaderboardModalOpen() {
        return this.ui.isLeaderboardModalOpen();
    }

    showLeaderboardModal() {
        this.ui.showLeaderboardModal();
    }

    hideLeaderboardModal() {
        this.ui.hideLeaderboardModal();
    }

    renderLeaderboardModal(data) {
        this.ui.renderLeaderboardModal(data);
    }

    showGameOverScreen(score, bestScore = 0, coins = 0) {
        this.ui.showGameOverScreen(score, bestScore, coins);
    }

    hideGameOverScreen() {
        this.ui.hideGameOverScreen();
    }

    async showCountdown() {
        await this.ui.showCountdown();
    }

    showStartScreen(state) {
        this.ui.showStartScreen();
        if (state) this.ui.updateStartGameScreen(state);
    }

    hideStartScreen() {
        this.ui.hideStartScreen();
    }

    setupClouds() {
        this.stage?._createClouds?.();
    }

    isPixiControlHit(clientX, clientY) {
        return !!this.stage?.containsControlPoint?.(clientX, clientY);
    }
}
