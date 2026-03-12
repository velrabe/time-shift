class PixiGameplayStage {
    constructor(options = {}) {
        this.mount = options.mount || null;
        this.onToggleMode = options.onToggleMode || (() => {});
        this.onAction = options.onAction || (() => {});
        this.debug = !!options.debug;
        this.worldWidth = 1440;
        this.worldHeight = 900;
        this.scale = 1;
        this.app = null;
        this.scene = null;
        this.layers = {};
        this.clouds = [];
        this.lastCloudUpdateAt = 0;
        this.debugGraphics = null;
        this.debugText = null;
        this.staticSprites = {};

        if (!this.mount || typeof PIXI === 'undefined') return;
        this._buildApp();
    }

    _buildApp() {
        this.app = new PIXI.Application({
            width: this.worldWidth,
            height: this.worldHeight,
            antialias: true,
            backgroundAlpha: 0,
            autoDensity: true,
            resolution: Math.max(1, Math.min(2, window.devicePixelRatio || 1))
        });
        this.mount.innerHTML = '';
        this.mount.appendChild(this.app.view);
        this.app.view.style.width = '100%';
        this.app.view.style.height = '100%';
        this.app.view.style.display = 'block';
        this.app.view.style.touchAction = 'none';

        this.scene = new PIXI.Container();
        this.scene.sortableChildren = true;
        this.app.stage.addChild(this.scene);

        this.layers.background = this._addLayer(1);
        this.layers.clouds = this._addLayer(2);
        this.layers.lane = this._addLayer(3);
        this.layers.conveyor = this._addLayer(4);
        this.layers.penguinBack = this._addLayer(5);
        this.layers.effects = this._addLayer(6);
        this.layers.penguinFront = this._addLayer(7);
        this.layers.controls = this._addLayer(8);
        this.layers.debug = this._addLayer(9);

        this.effects = new PixiEffects({
            layer: this.layers.effects,
            getScale: () => this.scale
        });

        this.penguinRig = new PixiPenguinRig({
            backLayer: this.layers.penguinBack,
            frontLayer: this.layers.penguinFront,
            getBeltSpeedPxPerSec: () => this.conveyor?.lastKnownSpeedPxPerSec || 220,
            getWorldMetrics: () => ({ width: this.worldWidth, height: this.worldHeight })
        });

        this.controls = new PixiControls({
            layer: this.layers.controls,
            getScale: () => this.scale,
            onToggleMode: () => this.onToggleMode?.(),
            onAction: () => this.onAction?.(),
            renderer: this
        });

        this.conveyor = new PixiConveyor({
            layer: this.layers.conveyor,
            effects: this.effects,
            getViewportMetrics: () => this.getViewportMetrics(),
            getInteractionMetrics: () => this.penguinRig?.getInteractionMetrics?.(),
            checkCollisionsAndAutoBite: () => this.onCheckCollisions?.()
        });

        this._buildStaticScene();
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    _addLayer(zIndex) {
        const layer = new PIXI.Container();
        layer.sortableChildren = true;
        layer.zIndex = zIndex;
        this.scene.addChild(layer);
        return layer;
    }

    _buildStaticScene() {
        if (!this.layers.background || !this.layers.lane) return;

        const hills = PIXI.Sprite.from('img/hills.svg');
        hills.anchor.set(0.5, 1);
        this.layers.background.addChild(hills);

        const iceBot = PIXI.Sprite.from('img/ice-bot.svg');
        iceBot.anchor.set(0.5, 1);
        this.layers.lane.addChild(iceBot);

        const iceTop = PIXI.Sprite.from('img/ice-top.svg');
        iceTop.anchor.set(0.5, 0.5);
        this.layers.lane.addChild(iceTop);

        this.staticSprites = { hills, iceBot, iceTop };

        if (this.debug) {
            this.debugGraphics = new PIXI.Graphics();
            this.debugText = new PIXI.Text('', {
                fontFamily: 'monospace',
                fontSize: 14,
                fill: 0xffffff,
                stroke: 0x0b0f18,
                strokeThickness: 3
            });
            this.debugText.position.set(16, 120);
            this.layers.debug.addChild(this.debugGraphics);
            this.layers.debug.addChild(this.debugText);
        }

        this._createClouds();
        this._layoutStaticScene();
    }

    _createClouds() {
        const textures = ['img/cloud-xs.png', 'img/cloud-s.png', 'img/cloud-m.png'];
        this.clouds.forEach((cloud) => cloud.destroy?.());
        this.clouds = [];
        for (let i = 0; i < 8; i += 1) {
            const sprite = PIXI.Sprite.from(textures[i % textures.length]);
            sprite.anchor.set(0.5);
            sprite.alpha = 0.72;
            sprite.x = Math.random() * this.worldWidth;
            sprite.y = this.worldHeight * (0.12 + (Math.random() * 0.28));
            const size = this.worldWidth * (0.06 + (Math.random() * 0.05));
            sprite.width = size * (1.1 + Math.random() * 0.9);
            sprite.height = size * (0.58 + Math.random() * 0.22);
            sprite.speed = 10 + (Math.random() * 18);
            this.layers.clouds.addChild(sprite);
            this.clouds.push(sprite);
        }
    }

    resize() {
        if (!this.mount || !this.app) return;
        const rect = this.mount.getBoundingClientRect();
        this.app.renderer.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)));
        this.worldWidth = Math.max(1, Math.round(rect.width));
        this.worldHeight = Math.max(1, Math.round(rect.height));
        this.scale = Math.max(0.48, Math.min(1, Math.min(this.worldWidth / 1440, this.worldHeight / 900)));
        this.scene.scale.set(1);
        this.scene.position.set(0, 0);
        this._layoutStaticScene();
        this.penguinRig?.layout?.({ width: this.worldWidth, height: this.worldHeight });
        this.controls?.layout?.(this.worldWidth, this.worldHeight);
        this._createClouds();
    }

    _layoutStaticScene() {
        const hills = this.staticSprites?.hills;
        const iceBot = this.staticSprites?.iceBot;
        const iceTop = this.staticSprites?.iceTop;
        if (hills) {
            hills.position.set(this.worldWidth * 0.5, this.worldHeight * 0.54);
            hills.width = this.worldWidth * 1.2;
            hills.height = this.worldHeight * 0.4;
        }
        if (iceBot) {
            iceBot.position.set(this.worldWidth * 0.5, this.worldHeight * 1.08);
            iceBot.width = this.worldWidth * 1.2;
            iceBot.height = this.worldHeight * 0.5;
        }
        if (iceTop) {
            iceTop.position.set(this.worldWidth * 0.5, this.worldHeight * 0.55);
            iceTop.width = this.worldWidth * 1.2;
            iceTop.height = this.worldHeight * 0.2;
        }
    }

    getViewportMetrics() {
        const interaction = this.penguinRig?.getInteractionMetrics?.();
        const stripFrame = this.penguinRig?.getStripFrame?.();
        const anchorX = interaction?.mouthRightX ? interaction.mouthRightX + 18 : (this.worldWidth * 0.28);
        return {
            width: this.worldWidth,
            height: this.worldHeight,
            anchorX,
            lookaheadDistance: Math.max(420, this.worldWidth - anchorX - 32),
            stripCenterY: stripFrame?.centerY || (this.worldHeight * 0.5),
            stripTop: stripFrame?.top || 0,
            stripHeight: stripFrame?.height || this.worldHeight
        };
    }

    setGameState(state) {
        this.controls?.updateState?.(state || {});
    }

    triggerActionSuccessFx() {
        this.controls?.triggerActionSuccessFx?.();
    }

    showFloatingCoinBonus(x, y, amount) {
        this.effects?.showFloatingCoinBonus?.(x, y, amount);
    }

    showEatRipple(x, y, kind) {
        this.effects?.showEatRipple?.(x, y, kind);
    }

    update() {
        const now = Date.now();
        const last = this.lastCloudUpdateAt || now;
        const deltaMs = Math.max(0, now - last);
        this.lastCloudUpdateAt = now;
        this.clouds.forEach((cloud) => {
            cloud.x -= (cloud.speed * (deltaMs / 1000));
            if ((cloud.x + (cloud.width * 0.6)) < 0) {
                cloud.x = this.worldWidth + (Math.random() * 120);
                cloud.y = this.worldHeight * (0.12 + (Math.random() * 0.28));
            }
        });
        this.penguinRig?.update?.();
        this.controls?.update?.();
        this.effects?.update?.();
    }

    updateDebug(metrics, items = [], state = null) {
        if (!this.debug || !this.debugGraphics || !metrics) return;
        const g = this.debugGraphics;
        g.clear();

        const top = metrics.mouthCenterY - (metrics.mouthHeight * 0.9);
        const height = metrics.mouthHeight * 1.8;
        const zone = (leftX, rightX, color, alpha = 0.12) => {
            if (!Number.isFinite(leftX) || !Number.isFinite(rightX)) return;
            g.lineStyle(2, color, 0.95);
            g.beginFill(color, alpha);
            g.drawRect(leftX, top, Math.max(2, rightX - leftX), height);
            g.endFill();
        };

        zone(metrics.resolveSwallowX - 3, metrics.resolveSwallowX + 3, 0x51b6ff, 0.16);
        zone(metrics.resolveBiteX - 3, metrics.resolveBiteX + 3, 0x51b6ff, 0.16);
        zone(metrics.actionLeftX, metrics.actionRightX, 0xffe23b, 0.14);
        zone(metrics.warningLeftX, metrics.warningRightX, 0xff4646, 0.1);
        zone(metrics.autoBiteLeftX, metrics.autoBiteRightX, 0xffce64, 0.07);

        g.lineStyle(2, 0x00c878, 0.95);
        g.drawRect(metrics.mouthLeftX, metrics.mouthCenterY - (metrics.mouthHeight * 0.5), metrics.mouthWidth, metrics.mouthHeight);

        const nearest = Array.isArray(items) ? items.find((item) => !item.removed && !item.resolved) : null;
        if (nearest) {
            g.lineStyle(2, 0x0096ff, 0.95);
            g.beginFill(0x0096ff, 0.08);
            g.drawRect(nearest.screenLeft, nearest.screenTop, nearest.width, nearest.height);
            g.endFill();
        }

        if (this.debugText) {
            this.debugText.text = [
                `mode=${state?.mode || '-'}`,
                `mouth=[${metrics.mouthLeftX.toFixed(0)}..${metrics.mouthRightX.toFixed(0)}]`,
                `resolve=${metrics.resolveSwallowX.toFixed(0)}/${metrics.resolveBiteX.toFixed(0)}`,
                `action=[${metrics.actionLeftX.toFixed(0)}..${metrics.actionRightX.toFixed(0)}]`,
                `warning=[${metrics.warningLeftX.toFixed(0)}..${metrics.warningRightX.toFixed(0)}]`
            ].join('\n');
        }
    }

    containsControlPoint(clientX, clientY) {
        return !!this.controls?.containsGlobalPoint?.(clientX, clientY);
    }
}
