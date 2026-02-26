class CloudsBackground {
    constructor(options) {
        this.perfMode = !!options.perfMode;
        this.getContainer = options.getContainer;
        this.animationFrameId = null;
        this.cloudState = [];
        this.containerWidthPx = 1;
        this.lastContainerMeasureAt = 0;
        this.lastVisualUpdateAt = 0;
    }

    getGameScale() {
        try {
            const rootStyle = window.getComputedStyle(document.documentElement);
            const value = parseFloat(rootStyle.getPropertyValue('--game-scale'));
            if (Number.isFinite(value) && value > 0) return value;
        } catch (e) {
            // ignore
        }
        return 1;
    }

    setupClouds() {
        const container = this.getContainer?.();
        if (!container) return;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        container.innerHTML = '';
        this.cloudState = [];
        const gameScale = this.getGameScale();
        const cloudSizes = [
            { name: 'xs', width: 60, height: 30, speed: 0.3 },
            { name: 's', width: 100, height: 50, speed: 0.2 },
            { name: 'm', width: 150, height: 75, speed: 0.15 }
        ];

        const cloudCount = this.perfMode ? 5 : 8;
        const containerWidth = Math.max(1, container.clientWidth || 1);
        this.containerWidthPx = containerWidth;
        this.lastContainerMeasureAt = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();
        for (let i = 0; i < cloudCount; i++) {
            const cloudSize = cloudSizes[Math.floor(Math.random() * cloudSizes.length)];
            const cloud = document.createElement('div');
            cloud.className = 'cloud';

            const img = document.createElement('img');
            img.src = `img/cloud-${cloudSize.name}.png`;
            img.alt = '';
            cloud.appendChild(img);

            const startY = Math.random() * 30 + 5;
            const startX = Math.random() * 120 - 20;
            const widthPx = Math.max(24, (cloudSize.width || 100) * gameScale);
            const heightPx = Math.max(12, (cloudSize.height || 50) * gameScale);
            const xPx = (startX / 100) * containerWidth;

            cloud.style.width = `${widthPx}px`;
            cloud.style.height = `${heightPx}px`;
            cloud.style.left = '0px';
            cloud.style.top = `${startY}%`;
            cloud.style.transform = `translate3d(${xPx.toFixed(2)}px, 0, 0)`;
            container.appendChild(cloud);
            this.cloudState.push({
                el: cloud,
                speedMultiplier: cloudSize.speed,
                xPx,
                widthPx
            });
        }

        this.animateClouds();
    }

    animateClouds() {
        const container = this.getContainer?.();
        if (!container) return;

        const clouds = this.cloudState;
        if (!clouds || clouds.length === 0) return;

        let lastTime = performance.now();
        const animate = (currentTime) => {
            const deltaTime = currentTime - lastTime;
            lastTime = currentTime;
            const minFrameMs = this.perfMode ? (1000 / 30) : 0;
            if (minFrameMs > 0 && (currentTime - this.lastVisualUpdateAt) < minFrameMs) {
                this.animationFrameId = requestAnimationFrame(animate);
                return;
            }
            this.lastVisualUpdateAt = currentTime;
            const baseSpeed = 20;
            if ((currentTime - this.lastContainerMeasureAt) >= 500) {
                this.containerWidthPx = Math.max(1, container.clientWidth || 1);
                this.lastContainerMeasureAt = currentTime;
            }
            const containerWidth = this.containerWidthPx;

            for (let i = 0; i < clouds.length; i++) {
                const cloud = clouds[i];
                const speed = (baseSpeed * (cloud.speedMultiplier || 0.2) * deltaTime) / 1000;
                cloud.xPx -= speed;
                if (cloud.xPx + cloud.widthPx < 0) {
                    cloud.xPx = containerWidth + 20;
                    cloud.el.style.top = `${Math.random() * 30 + 5}%`;
                }
                cloud.el.style.transform = `translate3d(${cloud.xPx.toFixed(2)}px, 0, 0)`;
            }

            this.animationFrameId = requestAnimationFrame(animate);
        };

        this.animationFrameId = requestAnimationFrame(animate);
    }
}
