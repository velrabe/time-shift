// Система перков
class PerkSystem {
    constructor() {
        // Streak points: 0..50 (cap)
        this.streakPoints = 0;
        this.maxStreakPoints = 50;
        // legacy alias (некоторые части игры ожидают поле streak)
        this.streak = 0;

        this.setupEventListeners();
    }

    setupEventListeners() {
        // NOTE: streak начисляется напрямую из Director.update() через perks.addStreak().
        // Событие DANGER_PASSED оставляем для UI/аналитики, но здесь НЕ увеличиваем streak,
        // иначе легко получить двойное начисление.

        eventBus.on('DEATH', () => {
            // Если second life не накоплена — стрик сгорает на смерти
            if (this.streakPoints < this.maxStreakPoints) {
                this.streakPoints = 0;
            }
        });
    }

    addStreak(points) {
        this.streakPoints = Math.min(this.maxStreakPoints, Math.max(0, this.streakPoints + points));
        this.streak = this.streakPoints;
    }

    getStreakPoints() {
        return this.streakPoints;
    }

    hasSecondLife() {
        return this.streakPoints >= this.maxStreakPoints;
    }

    canUseSlowDown() {
        return this.streakPoints >= 10;
    }

    useSlowDown() {
        if (!this.canUseSlowDown()) return false;
        this.streakPoints = Math.max(0, this.streakPoints - 10);
        return true;
    }

    consumeSecondLife() {
        if (!this.hasSecondLife()) return false;
        this.streakPoints = 0;
        return true;
    }

    // Сброс
    reset() {
        this.streakPoints = 0;
        this.streak = 0;
    }

    // Сериализация для снапшота
    toSnapshot() {
        return {
            streakPoints: this.streakPoints
        };
    }

    // Восстановление из снапшота
    fromSnapshot(snapshot) {
        this.streakPoints = Math.min(this.maxStreakPoints, Math.max(0, snapshot?.streakPoints || 0));
        this.streak = this.streakPoints;
    }

    // Legacy API: в старой архитектуре PerkSystem обновлялся из gameLoop
    update() {
        // no-op (streak обновляется событиями)
    }
}

