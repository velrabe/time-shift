// Система долгосрочного прогресса: Coins + Spells + Perks
class PerkSystem {
    constructor() {
        this.version = 2;
        this.coins = 0;
        this.spells = { slow: 1, shield: 1 };
        this.perks = {
            freeSlow: 0,
            shieldCooldown: 0,
            slowCooldown: 0,
            coinIncome: 0,
            shieldHp: 0,
            slowSafety: 0,
            doubleBite: 0,
            coinRushBoost: 0
        };
        this.spellShopCosts = { slow: 30, shield: 45 };

        // Legacy поля (чтобы старый HUD/код не ломался)
        this.streakPoints = 0;
        this.streak = 0;
    }

    getCatalog() {
        return {
            freeSlow: { id: 'freeSlow', title: 'Free Slow', tier: 1, maxLevel: 1, costs: [80], unlockBy: null },
            shieldCooldown: { id: 'shieldCooldown', title: 'Shield Cooldown', tier: 2, maxLevel: 3, costs: [120, 220, 320], unlockBy: { perkId: 'freeSlow', level: 1 } },
            slowCooldown: { id: 'slowCooldown', title: 'Slow Cooldown', tier: 2, maxLevel: 3, costs: [120, 220, 320], unlockBy: { perkId: 'freeSlow', level: 1 } },
            coinIncome: { id: 'coinIncome', title: 'Coin Income', tier: 2, maxLevel: 5, costs: [100, 200, 300, 400, 500], unlockBy: { perkId: 'freeSlow', level: 1 } },
            shieldHp: { id: 'shieldHp', title: 'Shield HP', tier: 3, maxLevel: 1, costs: [650], unlockBy: { perkId: 'shieldCooldown', level: 3 } },
            slowSafety: { id: 'slowSafety', title: 'Slow Safety', tier: 3, maxLevel: 2, costs: [700, 1200], unlockBy: { perkId: 'slowCooldown', level: 3 } },
            doubleBite: { id: 'doubleBite', title: 'Double Bite', tier: 3, maxLevel: 1, costs: [900], unlockBy: { perkId: 'coinIncome', level: 5 } },
            coinRushBoost: { id: 'coinRushBoost', title: 'Coin Rush Boost', tier: 3, maxLevel: 2, costs: [950, 1450], unlockBy: { perkId: 'coinIncome', level: 5 } }
        };
    }

    getPerkLevel(perkId) { return Math.max(0, this.perks?.[perkId] || 0); }
    getPerkMaxLevel(perkId) { return this.getCatalog()?.[perkId]?.maxLevel || 0; }

    isPerkUnlocked(perkId) {
        const cfg = this.getCatalog()?.[perkId];
        if (!cfg) return false;
        if (!cfg.unlockBy) return true;
        return this.getPerkLevel(cfg.unlockBy.perkId) >= cfg.unlockBy.level;
    }

    getPerkNextCost(perkId) {
        const cfg = this.getCatalog()?.[perkId];
        if (!cfg) return null;
        const lvl = this.getPerkLevel(perkId);
        if (lvl >= cfg.maxLevel) return null;
        return cfg.costs?.[lvl] ?? null;
    }

    canUpgradePerk(perkId) {
        const cfg = this.getCatalog()?.[perkId];
        if (!cfg || !this.isPerkUnlocked(perkId)) return false;
        const lvl = this.getPerkLevel(perkId);
        if (lvl >= cfg.maxLevel) return false;
        const nextCost = this.getPerkNextCost(perkId);
        return Number.isFinite(nextCost) && this.coins >= nextCost;
    }

    upgradePerk(perkId) {
        if (!this.canUpgradePerk(perkId)) return false;
        const nextCost = this.getPerkNextCost(perkId);
        this.coins = Math.max(0, this.coins - nextCost);
        this.perks[perkId] = this.getPerkLevel(perkId) + 1;
        return true;
    }

    canBuySpell(spellId) {
        const cost = this.spellShopCosts?.[spellId];
        return Number.isFinite(cost) && this.coins >= cost;
    }

    buySpell(spellId) {
        if (!this.canBuySpell(spellId)) return false;
        this.coins = Math.max(0, this.coins - this.spellShopCosts[spellId]);
        if (spellId === 'slow') this.spells.slow += 1;
        if (spellId === 'shield') this.spells.shield += 1;
        return true;
    }

    buySlow() { return this.buySpell('slow'); }
    buyShield() { return this.buySpell('shield'); }
    canUseSlowDown() { return this.getSpellCount('slow') > 0; }
    useSlowDown() { return this.consumeSpell('slow'); }
    canUseShield() { return this.getSpellCount('shield') > 0; }
    useShield() { return this.consumeSpell('shield'); }

    consumeSpell(spellId) {
        const count = this.getSpellCount(spellId);
        if (count <= 0) return false;
        this.spells[spellId] = count - 1;
        return true;
    }

    grantSpell(spellId, amount = 1) {
        const add = Math.max(0, Math.floor(amount || 0));
        this.spells[spellId] = Math.max(0, this.getSpellCount(spellId) + add);
    }

    getSpellCount(spellId) {
        return Math.max(0, this.spells?.[spellId] || 0);
    }

    addCoins(amount) {
        this.coins = Math.max(0, this.coins + Math.max(0, Math.floor(amount || 0)));
    }

    applyStartOfRunBonuses() {
        if (this.getPerkLevel('freeSlow') >= 1 && this.getSpellCount('slow') < 1) {
            this.spells.slow = 1;
        }
    }

    getSlowCooldownMultiplier() {
        return Math.max(0.1, 1 - (this.getPerkLevel('slowCooldown') * 0.1));
    }

    getShieldCooldownMultiplier() {
        return Math.max(0.1, 1 - (this.getPerkLevel('shieldCooldown') * 0.1));
    }

    getCoinIncomeBonusPer10Score() { return this.getPerkLevel('coinIncome'); }
    getShieldExtraHits() { return this.getPerkLevel('shieldHp') >= 1 ? 1 : 0; }
    hasDoubleBite() { return this.getPerkLevel('doubleBite') >= 1; }

    getSlowSafetyMultiplier() {
        const lvl = this.getPerkLevel('slowSafety');
        if (lvl <= 0) return 0;
        return lvl === 1 ? 1 : 2;
    }

    getCoinRushBoostMultiplier() {
        const lvl = this.getPerkLevel('coinRushBoost');
        if (lvl <= 0) return 0;
        return lvl === 1 ? 0.5 : 1.0;
    }

    // legacy stubs
    hasSecondLife() { return false; }
    consumeSecondLife() { return false; }
    addStreak(_points) {}
    getStreakPoints() { return 0; }

    reset() {
        this.streakPoints = 0;
        this.streak = 0;
        this.applyStartOfRunBonuses();
    }

    toSnapshot() {
        return {
            version: this.version,
            coins: this.coins,
            spells: {
                slow: this.getSpellCount('slow'),
                shield: this.getSpellCount('shield')
            },
            perks: { ...this.perks },
            updatedAt: Date.now()
        };
    }

    fromSnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return;
        this.coins = Math.max(0, Math.floor(snapshot?.coins ?? this.coins));
        const spells = snapshot?.spells || snapshot;
        const perks = snapshot?.perks || snapshot;
        this.spells.slow = Math.max(0, Math.floor(spells?.slow ?? spells?.slowSpellCount ?? this.spells.slow));
        this.spells.shield = Math.max(0, Math.floor(spells?.shield ?? spells?.shieldSpellCount ?? this.spells.shield));

        Object.keys(this.perks).forEach((perkId) => {
            const maxLevel = this.getPerkMaxLevel(perkId);
            this.perks[perkId] = Math.max(0, Math.min(maxLevel, Math.floor(perks?.[perkId] ?? this.perks[perkId])));
        });
    }

    update() {}
}

