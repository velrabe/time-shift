class CloudsBackground {
    constructor(options) {
        this.getContainer = options.getContainer;
        this.animationFrameId = null;
    }

    setupClouds() {
        const container = this.getContainer?.();
        if (!container) return;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        container.innerHTML = '';
        const cloudSizes = [
            { name: 'xs', width: '60px', height: '30px', speed: 0.3 },
            { name: 's', width: '100px', height: '50px', speed: 0.2 },
            { name: 'm', width: '150px', height: '75px', speed: 0.15 }
        ];

        const cloudCount = 8;
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

            cloud.style.width = cloudSize.width;
            cloud.style.height = cloudSize.height;
            cloud.style.left = `${startX}%`;
            cloud.style.top = `${startY}%`;
            cloud.dataset.speed = cloudSize.speed.toString();
            container.appendChild(cloud);
        }

        this.animateClouds();
    }

    animateClouds() {
        const container = this.getContainer?.();
        if (!container) return;

        const clouds = Array.from(container.querySelectorAll('.cloud'));
        if (clouds.length === 0) return;

        let lastTime = performance.now();
        const animate = (currentTime) => {
            const deltaTime = currentTime - lastTime;
            lastTime = currentTime;
            const baseSpeed = 20;

            clouds.forEach((cloud) => {
                const speedMultiplier = parseFloat(cloud.dataset.speed) || 0.2;
                const speed = (baseSpeed * speedMultiplier * deltaTime) / 1000;
                const containerRect = container.getBoundingClientRect();
                const cloudRect = cloud.getBoundingClientRect();
                const currentLeft = cloudRect.left - containerRect.left;
                let newLeft = currentLeft - speed;
                if (newLeft + cloudRect.width < 0) {
                    newLeft = containerRect.width + 20;
                    cloud.style.top = `${Math.random() * 30 + 5}%`;
                }
                cloud.style.left = `${newLeft}px`;
            });

            this.animationFrameId = requestAnimationFrame(animate);
        };

        this.animationFrameId = requestAnimationFrame(animate);
    }
}
