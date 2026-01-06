// GamePush интеграция
class GamePushSystem {
    constructor() {
        this.gp = null;
        this.ready = false;
        this.playerData = null;
    }

    // Инициализация
    async init() {
        return new Promise((resolve, reject) => {
            if (window.onGPInit) {
                const originalCallback = window.onGPInit;
                window.onGPInit = (gp) => {
                    this.gp = gp;
                    this.setupGP();
                    originalCallback(gp);
                    this.waitForReady().then(resolve).catch(reject);
                };
            } else {
                window.onGPInit = (gp) => {
                    this.gp = gp;
                    this.setupGP();
                    this.waitForReady().then(resolve).catch(reject);
                };
            }

            // Если SDK уже загружен
            if (window.gp) {
                this.gp = window.gp;
                this.setupGP();
                this.waitForReady().then(resolve).catch(reject);
            }
        });
    }

    setupGP() {
        if (!this.gp) return;
        
        // Настройка обработчиков паузы/резюма
        if (this.gp.game && this.gp.game.on) {
            this.gp.game.on('pause', () => {
                eventBus.emit('PAUSE');
            });
            
            this.gp.game.on('resume', () => {
                eventBus.emit('RESUME');
            });
        }
    }

    async waitForReady() {
        if (!this.gp || !this.gp.player) {
            this.ready = true; // Продолжаем без GamePush
            return;
        }

        try {
            // Проверяем наличие метода ready
            if (typeof this.gp.player.ready === 'function') {
                await this.gp.player.ready();
                this.playerData = this.gp.player.data || {};
            } else {
                // Если метода нет, просто получаем данные
                this.playerData = this.gp.player.data || {};
            }
            this.ready = true;
        } catch (e) {
            // Продолжаем без GamePush
            this.ready = true;
        }
    }

    // Получение best score
    getBestScore() {
        if (!this.ready || !this.playerData) return 0;
        return this.playerData.score || 0;
    }

    // Сохранение best score
    async saveBestScore(score) {
        if (!this.ready || !this.gp || !this.gp.player) return;
        
        try {
            this.gp.player.set('score', score);
            await this.gp.player.sync();
            this.playerData.score = score;
        } catch (e) {
            console.warn('Failed to save best score to GamePush:', e);
        }
    }

    // Сохранение снапшота
    async saveSnapshot(snapshot) {
        if (!this.ready || !this.gp || !this.gp.player) return;
        
        try {
            this.gp.player.set('snapshot', JSON.stringify(snapshot));
            await this.gp.player.sync();
        } catch (e) {
            console.warn('Failed to save snapshot to GamePush:', e);
        }
    }

    // Загрузка снапшота
    getSnapshot() {
        if (!this.ready || !this.playerData) return null;
        
        try {
            const snapshotStr = this.playerData.snapshot;
            return snapshotStr ? JSON.parse(snapshotStr) : null;
        } catch (e) {
            console.warn('Failed to parse snapshot from GamePush:', e);
            return null;
        }
    }

    // Обновление best score из снапшота
    async updateBestScoreFromSnapshot(snapshotScore) {
        const currentBest = this.getBestScore();
        if (snapshotScore > currentBest) {
            await this.saveBestScore(snapshotScore);
        }
    }
}

