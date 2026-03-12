class PixiEffects {
    constructor(options = {}) {
        this.layer = options.layer || null;
        this.getScale = options.getScale || (() => 1);
        this.getNowMs = options.getNowMs || (() => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()));
        this.activeEffects = [];
    }

    clear() {
        this.activeEffects.forEach((effect) => {
            try {
                effect.displayObject?.destroy?.({ children: true });
            } catch (e) {
                // ignore
            }
        });
        this.activeEffects = [];
    }

    addEffect(displayObject, durationMs, onUpdate) {
        if (!displayObject || !this.layer) return null;
        this.layer.addChild(displayObject);
        const effect = {
            displayObject,
            startedAt: this.getNowMs(),
            durationMs: Math.max(1, durationMs || 1),
            onUpdate
        };
        this.activeEffects.push(effect);
        return effect;
    }

    showFloatingCoinBonus(x, y, amount) {
        if (!this.layer || typeof PIXI === 'undefined') return;
        const scale = this.getScale();
        const text = new PIXI.Text(`+${Math.max(1, Math.floor(amount || 1))}`, {
            fontFamily: 'Rubik, sans-serif',
            fontSize: Math.round(32 * scale),
            fontWeight: '800',
            fill: 0xffd54f,
            stroke: 0x6c4d00,
            strokeThickness: Math.max(2, Math.round(3 * scale))
        });
        text.anchor.set(0.5);
        text.position.set(Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0);
        this.addEffect(text, 850, (effect, progress) => {
            const t = effect.displayObject;
            t.y = y - (56 * scale * progress);
            t.alpha = 1 - progress;
            const pulse = progress < 0.2 ? (0.75 + (progress / 0.2) * 0.35) : (1.1 - ((progress - 0.2) / 0.8) * 0.1);
            t.scale.set(pulse);
        });
    }

    showEatRipple(x, y, kind = 'food') {
        if (!this.layer || typeof PIXI === 'undefined') return;
        const scale = this.getScale();
        const g = new PIXI.Graphics();
        const isIce = kind === 'ice' || kind === 'reinforced-ice' || kind === 'hard-obstacle';
        const lineColor = isIce ? 0xaee2ff : 0xffffff;
        const fillColor = isIce ? 0xb0e2ff : 0xffffff;
        g.lineStyle(Math.max(2, 2 * scale), lineColor, 0.9);
        g.beginFill(fillColor, isIce ? 0.18 : 0.24);
        g.drawCircle(0, 0, 18 * scale);
        g.endFill();
        g.position.set(Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0);
        this.addEffect(g, 420, (effect, progress) => {
            const obj = effect.displayObject;
            obj.scale.set(0.5 + (1.25 * progress));
            obj.alpha = 0.8 - (0.8 * progress);
        });
    }

    animateEatIntoMouth(textureUrl, startX, startY, targetX, targetY, width, height) {
        if (!this.layer || typeof PIXI === 'undefined' || !textureUrl) return;
        const sprite = PIXI.Sprite.from(textureUrl);
        sprite.anchor.set(0.5);
        sprite.position.set(startX, startY);
        sprite.width = Math.max(8, width || 32);
        sprite.height = Math.max(8, height || 32);
        this.addEffect(sprite, 260, (effect, progress) => {
            const obj = effect.displayObject;
            obj.x = startX + ((targetX - startX) * progress);
            obj.y = startY + ((targetY - startY) * progress * 0.6);
            obj.alpha = 1 - progress;
            obj.scale.set(1 - (0.15 * progress));
        });
    }

    update() {
        if (this.activeEffects.length === 0) return;
        const now = this.getNowMs();
        this.activeEffects = this.activeEffects.filter((effect) => {
            const elapsed = now - effect.startedAt;
            const progress = Math.max(0, Math.min(1, elapsed / effect.durationMs));
            effect.onUpdate?.(effect, progress);
            if (progress < 1) return true;
            try {
                effect.displayObject?.destroy?.({ children: true });
            } catch (e) {
                // ignore
            }
            return false;
        });
    }
}
