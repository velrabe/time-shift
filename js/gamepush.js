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

    // Сброс best score до 0 (debug)
    async resetBestScore() {
        if (!this.ready || !this.gp || !this.gp.player) return;
        try {
            this.gp.player.set('score', 0);
            await this.gp.player.sync();
            if (!this.playerData) this.playerData = {};
            this.playerData.score = 0;
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('Failed to reset best score in GamePush:', e);
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

    // ===== Player name helpers =====
    getPlayerName() {
        if (!this.ready || !this.playerData) return null;
        const p = this.playerData;
        return (
            p.name ||
            p.nickname ||
            p.publicName ||
            p.username ||
            p.login ||
            null
        );
    }

    async savePlayerName(name) {
        if (!this.ready || !this.gp || !this.gp.player) return;
        if (typeof name !== 'string' || !name.trim()) return;
        try {
            this.gp.player.set('name', name);
            await this.gp.player.sync();
            if (!this.playerData) this.playerData = {};
            this.playerData.name = name;
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('Failed to save player name to GamePush:', e);
        }
    }

    // ===== Leaderboards =====
    // Общая таблица лидеров по полю игрока `score`
    // Документация: https://docs.gamepush.com/ru/docs/leaderboards/

    isLeaderboardsAvailable() {
        return !!(this.ready && this.gp && this.gp.leaderboard && typeof this.gp.leaderboard.fetch === 'function');
    }

    // top 10 игроков (сортировка по score по убыванию)
    async fetchTopLeaderboard(limit = 10) {
        if (!this.isLeaderboardsAvailable()) return { topPlayers: [] };
        try {
            const res = await this.gp.leaderboard.fetch({
                orderBy: ['score'],
                order: 'DESC',
                limit: Math.max(1, Math.min(50, Number(limit) || 10)),
                includeFields: ['rank']
            });
            const topPlayers = res?.topPlayers || res?.players || [];
            return { topPlayers: Array.isArray(topPlayers) ? topPlayers : [] };
        } catch (e) {
            console.warn('Failed to fetch leaderboard top players:', e);
            return { topPlayers: [] };
        }
    }

    // Позиция игрока в рейтинге (без "соседей", только сам игрок)
    async fetchMyLeaderboardRating() {
        if (!this.ready || !this.gp?.leaderboard || typeof this.gp.leaderboard.fetchPlayerRating !== 'function') {
            return { player: null };
        }
        try {
            const res = await this.gp.leaderboard.fetchPlayerRating({
                orderBy: ['score'],
                order: 'DESC',
                showNearest: 0,
                includeFields: ['rank']
            });
            return { player: res?.player || null };
        } catch (e) {
            console.warn('Failed to fetch leaderboard player rating:', e);
            return { player: null };
        }
    }

    // Единый "снимок" лидерборда: топ-10 + позиция игрока
    async fetchLeaderboardSnapshot(limit = 10) {
        if (!this.ready) return { topPlayers: [], player: null };
        const [top, rating] = await Promise.all([
            this.fetchTopLeaderboard(limit),
            this.fetchMyLeaderboardRating()
        ]);
        return {
            topPlayers: Array.isArray(top?.topPlayers) ? top.topPlayers : [],
            player: rating?.player || null
        };
    }
}

