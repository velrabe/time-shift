class PixiControls {
    constructor(options = {}) {
        this.layer = options.layer || null;
        this.getScale = options.getScale || (() => 1);
        this.onToggleMode = options.onToggleMode || (() => {});
        this.onAction = options.onAction || (() => {});
        this.renderer = options.renderer || null;

        this.mode = 'swallow';
        this.disabled = true;
        this.actionSuccessUntil = 0;
        this.modeButton = null;
        this.actionButton = null;
        this.actionGlow = null;
        this._build();
    }

    _makeButton({ label, fillColor }) {
        const root = new PIXI.Container();
        root.eventMode = 'static';
        root.cursor = 'pointer';

        const plate = new PIXI.Graphics();
        const rim = new PIXI.Graphics();
        const shadow = new PIXI.Graphics();
        const text = new PIXI.Text(label, {
            fontFamily: 'Rubik, sans-serif',
            fontWeight: '800',
            fontSize: 34,
            fill: 0xffffff,
            letterSpacing: 1
        });
        text.anchor.set(0.5);

        root.addChild(shadow);
        root.addChild(plate);
        root.addChild(rim);
        root.addChild(text);

        return {
            root,
            shadow,
            plate,
            rim,
            text,
            fillColor
        };
    }

    _drawButton(button, radius, fillColor, accentColor) {
        button.shadow.clear();
        button.shadow.beginFill(0x3e71b5, 0.2);
        button.shadow.drawCircle(0, 10, radius + 6);
        button.shadow.endFill();

        button.plate.clear();
        button.plate.beginFill(fillColor, 1);
        button.plate.drawCircle(0, 0, radius);
        button.plate.endFill();

        button.rim.clear();
        button.rim.lineStyle(Math.max(3, radius * 0.06), 0xffffff, 0.35);
        button.rim.beginFill(accentColor, 0.18);
        button.rim.drawCircle(0, 0, radius - 6);
        button.rim.endFill();
    }

    _build() {
        if (!this.layer || typeof PIXI === 'undefined') return;
        this.modeButton = this._makeButton({ label: 'MODE', fillColor: 0x5ea2ff });
        this.actionButton = this._makeButton({ label: 'ACT', fillColor: 0xff8726 });
        this.actionGlow = new PIXI.Graphics();
        this.actionGlow.alpha = 0;
        this.actionButton.root.addChildAt(this.actionGlow, 0);

        this.modeButton.root.on('pointertap', () => {
            if (this.disabled) return;
            this.onToggleMode?.();
        });
        this.actionButton.root.on('pointertap', () => {
            if (this.disabled) return;
            this.onAction?.();
        });

        this.layer.addChild(this.modeButton.root);
        this.layer.addChild(this.actionButton.root);
        this.layout(1440, 900);
        this.updateState({});
    }

    layout(width, height) {
        if (!this.modeButton || !this.actionButton) return;
        const scale = this.getScale();
        const radius = 62 * scale;
        this._drawButton(this.modeButton, radius, this.mode === 'swallow' ? 0x2f84ff : 0x6b8298, 0xffffff);
        this._drawButton(this.actionButton, radius, 0xff8726, 0xffc871);
        this.modeButton.root.position.set(120 * scale, height - (120 * scale));
        this.actionButton.root.position.set(width - (120 * scale), height - (120 * scale));
        this.modeButton.text.style.fontSize = Math.round(28 * scale);
        this.actionButton.text.style.fontSize = Math.round(34 * scale);
    }

    updateState(state = {}) {
        const mode = state.mode === 'bite' ? 'bite' : 'swallow';
        this.mode = mode;
        this.disabled = state.gameStatus !== 'RUNNING' || !!state.inputLocked || !!state.stunned;

        if (!this.modeButton || !this.actionButton) return;
        this.layout(this.renderer?.worldWidth || 1440, this.renderer?.worldHeight || 900);
        this.modeButton.text.text = mode === 'bite' ? 'BITE' : 'SWAL';
        this.modeButton.root.alpha = this.disabled ? 0.45 : 1;
        this.actionButton.root.alpha = this.disabled ? 0.45 : 1;
    }

    triggerActionSuccessFx() {
        this.actionSuccessUntil = Date.now() + 220;
    }

    update() {
        if (!this.actionGlow || !this.actionButton) return;
        const active = Date.now() < (this.actionSuccessUntil || 0);
        this.actionGlow.clear();
        if (!active) {
            this.actionGlow.alpha = 0;
            return;
        }
        const scale = this.getScale();
        const radius = 70 * scale;
        this.actionGlow.alpha = 1;
        this.actionGlow.beginFill(0xffc265, 0.22);
        this.actionGlow.drawCircle(0, 0, radius);
        this.actionGlow.endFill();
    }

    containsGlobalPoint(clientX, clientY) {
        const app = this.renderer?.app;
        const scene = this.renderer?.scene;
        if (!app || !app.view || !scene || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
        const rect = app.view.getBoundingClientRect();
        const stageX = ((clientX - rect.left) / Math.max(1, rect.width)) * app.screen.width;
        const stageY = ((clientY - rect.top) / Math.max(1, rect.height)) * app.screen.height;
        const x = (stageX - scene.position.x) / Math.max(0.001, scene.scale.x || 1);
        const y = (stageY - scene.position.y) / Math.max(0.001, scene.scale.y || 1);
        return this.containsWorldPoint(x, y);
    }

    containsWorldPoint(x, y) {
        const hitCircle = (button) => {
            if (!button) return false;
            const dx = x - button.root.x;
            const dy = y - button.root.y;
            const radius = 68 * this.getScale();
            return ((dx * dx) + (dy * dy)) <= (radius * radius);
        };
        return hitCircle(this.modeButton) || hitCircle(this.actionButton);
    }
}
