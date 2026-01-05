// Система перков
class PerkSystem {
    constructor() {
        this.perks = new Map();
        this.streak = 0;
        this.dangerPassedStreak = 0;
        
        this.registerPerks();
        this.setupEventListeners();
    }

    registerPerks() {
        // Continue perk
        this.perks.set('continue', {
            id: 'continue',
            name: 'Continue',
            description: 'Продолжить после смерти',
            requiredStreak: 10,
            isAvailable: (state) => true,
            isCharged: (state) => state.dangerPassedStreak >= 10,
            activate: (state) => {
                // Логика активации в game.js
                return { type: 'continue' };
            },
            onEvent: (event, state) => {
                if (event === 'DANGER_PASSED') {
                    // Streak увеличивается в game.js
                }
            },
            uiSpec: () => ({
                label: 'Continue',
                icon: '↩️'
            })
        });

        // Inversion perk
        this.perks.set('inversion', {
            id: 'inversion',
            name: 'Inversion',
            description: 'Инверсия времени на 60 сек',
            requiredStreak: 15,
            isAvailable: (state) => state.timer.maxReached >= 20,
            isCharged: (state) => state.dangerPassedStreak >= 15,
            activate: (state) => {
                return { type: 'inversion', duration: 60 };
            },
            onEvent: (event, state) => {
                // Обработка событий
            },
            uiSpec: () => ({
                label: 'Inversion',
                icon: '⏮'
            })
        });
    }

    setupEventListeners() {
        eventBus.on('DANGER_PASSED', () => {
            this.dangerPassedStreak++;
        });

        eventBus.on('DEATH', () => {
            this.dangerPassedStreak = 0;
        });
    }

    // Получение всех доступных перков
    getAvailablePerks(state) {
        const available = [];
        for (const [id, perk] of this.perks) {
            if (perk.isAvailable(state)) {
                available.push({
                    ...perk,
                    charged: perk.isCharged(state),
                    progress: this.getPerkProgress(id, state)
                });
            }
        }
        return available;
    }

    // Получение прогресса перка
    getPerkProgress(id, state) {
        const perk = this.perks.get(id);
        if (!perk) return 0;
        
        if (perk.isCharged(state)) return 1.0;
        return Math.min(state.dangerPassedStreak / perk.requiredStreak, 1.0);
    }

    // Активация перка
    activatePerk(id, state) {
        const perk = this.perks.get(id);
        if (!perk || !perk.isAvailable(state) || !perk.isCharged(state)) {
            return null;
        }

        const result = perk.activate(state);
        
        // Сброс стрика после использования
        if (id === 'continue') {
            this.dangerPassedStreak = Math.max(0, this.dangerPassedStreak - 5);
        } else if (id === 'inversion') {
            this.dangerPassedStreak = 0;
        }

        return result;
    }

    // Обновление состояния
    update(state) {
        // Обновление стриков происходит через события
    }

    // Сброс
    reset() {
        this.streak = 0;
        this.dangerPassedStreak = 0;
    }

    // Сериализация для снапшота
    toSnapshot() {
        return {
            streak: this.streak,
            dangerPassedStreak: this.dangerPassedStreak
        };
    }

    // Восстановление из снапшота
    fromSnapshot(snapshot) {
        this.streak = snapshot.streak || 0;
        this.dangerPassedStreak = snapshot.dangerPassedStreak || 0;
    }
}

