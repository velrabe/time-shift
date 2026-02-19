// Система перков
class PerkSystem {
    constructor() {
        // Streak points: 0..20 (cap)
        this.streakPoints = 0;
        this.maxStreakPoints = 20;
        // legacy alias (некоторые части игры ожидают поле streak)
        this.streak = 0;

        // Spell counts (slow, shield) — закупаются перед раундом
        this.slowSpellCount = 1;
        this.shieldSpellCount = 1;

        // Монеты (для покупки спеллов)
        this.coins = 50;

        this.setupEventListeners();
    }

    setupEventListeners() {
        // NOTE: streak начисляется из события FOOD_EATEN (см. Game),
        // поэтому здесь ничего не добавляем, только обнуляем по смерти при необходимости.

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
        return this.slowSpellCount > 0 && this.streakPoints >= 10;
    }

    useSlowDown() {
        if (!this.canUseSlowDown()) return false;
        this.slowSpellCount = Math.max(0, this.slowSpellCount - 1);
        this.streakPoints = Math.max(0, this.streakPoints - 10);
        return true;
    }

    canUseShield() {
        return this.shieldSpellCount > 0;
    }

    useShield() {
        if (!this.canUseShield()) return false;
        this.shieldSpellCount = Math.max(0, this.shieldSpellCount - 1);
        return true;
    }

    buySlow() {
        const cost = 10;
        if (this.coins < cost) return false;
        this.coins -= cost;
        this.slowSpellCount += 1;
        return true;
    }

    buyShield() {
        const cost = 5;
        if (this.coins < cost) return false;
        this.coins -= cost;
        this.shieldSpellCount += 1;
        return true;
    }

    addCoins(amount) {
        this.coins = Math.max(0, this.coins + (amount || 0));
    }

    consumeSecondLife() {
        if (!this.hasSecondLife()) return false;
        this.streakPoints = 0;
        return true;
    }

    // Сброс (монеты не сбрасываются)
    reset() {
        this.streakPoints = 0;
        this.streak = 0;
        this.slowSpellCount = 1;
        this.shieldSpellCount = 1;
    }

    // Сериализация для снапшота
    toSnapshot() {
        return {
            streakPoints: this.streakPoints,
            slowSpellCount: this.slowSpellCount,
            shieldSpellCount: this.shieldSpellCount,
            coins: this.coins
        };
    }

    // Восстановление из снапшота
    fromSnapshot(snapshot) {
        this.streakPoints = Math.min(this.maxStreakPoints, Math.max(0, snapshot?.streakPoints || 0));
        this.streak = this.streakPoints;
        this.slowSpellCount = Math.max(0, snapshot?.slowSpellCount ?? 1);
        this.shieldSpellCount = Math.max(0, snapshot?.shieldSpellCount ?? 1);
        this.coins = Math.max(0, snapshot?.coins ?? this.coins);
    }

    // Legacy API: в старой архитектуре PerkSystem обновлялся из gameLoop
    update() {
        // no-op (streak обновляется событиями)
    }
}

