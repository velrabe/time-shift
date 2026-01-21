// Генератор и менеджер никнейма игрока
class PlayerNameManager {
    constructor(gamePush, storage) {
        this.gamePush = gamePush;
        this.storage = storage;

        this.currentName = null;
        this._settingsKey = null; // используем общий settings через StorageSystem
    }

    // ===== Вспомогательные методы работы с настройками =====
    _loadSettings() {
        return (this.storage && typeof this.storage.loadSettings === 'function')
            ? (this.storage.loadSettings() || {})
            : {};
    }

    _saveSettings(next) {
        if (!this.storage || typeof this.storage.saveSettings !== 'function') return;
        this.storage.saveSettings(next);
    }

    // ===== Публичные геттеры метаданных =====
    getCurrentName() {
        return this.currentName;
    }

    getMeta() {
        const s = this._loadSettings();
        return {
            playerName: this.currentName || s.playerName || null,
            hintSeen: !!s.playerNameHintSeen,
            edited: !!s.playerNameEdited
        };
    }

    isHintSeen() {
        const s = this._loadSettings();
        return !!s.playerNameHintSeen;
    }

    markHintSeen() {
        const s = this._loadSettings();
        if (s.playerNameHintSeen) return;
        s.playerNameHintSeen = true;
        this._saveSettings(s);
    }

    // ===== Инициализация имени =====
    async ensurePlayerNameInitialized() {
        if (this.currentName) return this.currentName;

        const settings = this._loadSettings();
        let name = settings.playerName;

        if (!name && this.gamePush && typeof this.gamePush.getPlayerName === 'function') {
            name = this.gamePush.getPlayerName();
        }

        if (!name) {
            name = this.generateRandomName();
            await this._saveToGamePush(name);
        }

        this.currentName = name;
        settings.playerName = name;
        this._saveSettings(settings);
        return name;
    }

    async _saveToGamePush(name) {
        if (!this.gamePush || typeof this.gamePush.savePlayerName !== 'function') return;
        try {
            await this.gamePush.savePlayerName(name);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('Failed to sync player name to GamePush:', e);
        }
    }

    _normalizeName(raw) {
        if (typeof raw !== 'string') return '';
        let name = raw.trim();
        // заменяем множественные пробелы на один
        name = name.replace(/\s+/g, ' ');
        // убираем экзотические символы, оставляем буквы/цифры/пробел/подчёркивание/дефис
        name = name.replace(/[^0-9a-zA-Zа-яА-ЯёЁ _-]/g, '');

        // длина 2..20 символов
        if (name.length < 2) return '';
        if (name.length > 20) {
            name = name.slice(0, 20).trim();
        }
        return name;
    }

    async setCustomName(raw) {
        const normalized = this._normalizeName(raw);
        if (!normalized) {
            const err = new Error('INVALID_NAME');
            err.code = 'INVALID_NAME';
            throw err;
        }
        await this._applyName(normalized, { edited: true });
        return normalized;
    }

    async rerollName() {
        const name = this.generateRandomName();
        await this._applyName(name, { edited: false });
        return name;
    }

    async _applyName(name, { edited }) {
        this.currentName = name;
        const settings = this._loadSettings();
        settings.playerName = name;
        if (edited) settings.playerNameEdited = true;
        this._saveSettings(settings);
        await this._saveToGamePush(name);
    }

    // ===== Словарный генератор имён =====
    generateRandomName() {
        const rng = Math.random;

        const nouns = [
            'Penguin', 'Biter', 'Eater', 'Snapper', 'Chomper',
            'Beak', 'Jaw', 'Fang', 'Bite', 'Snap', 'Crunch',
            'Freeze', 'Frost', 'Ice', 'Chill', 'Storm',
            'Shard', 'Glacier', 'Blizzard', 'Drift',
            'Risk', 'Timing', 'Edge', 'Blink'
        ];

        const modifiers = [
            // холод
            'Frozen', 'Icy', 'Cold', 'Chill', 'Glacial', 'Frosty',
            'Snowy', 'Arctic', 'Polar', 'Crystal',
            // тайминг
            'Late', 'Early', 'Last', 'Final', 'Perfect', 'Sharp',
            'Quick', 'Slow', 'Tiny', 'Silent',
            // характер
            'Greedy', 'Patient', 'Hungry', 'Nervous', 'Calm',
            'Lucky', 'Brave', 'Risky'
        ];

        const verbs = [
            'Snap', 'Bite', 'Crunch', 'Freeze', 'Wait',
            'Miss', 'Hold', 'Chill', 'Drift', 'Slide'
        ];

        const suffixes = ['Jr', 'X', 'Prime', 'Zero', 'One', 'v2', 'Mk II'];

        const pick = (arr) => arr[Math.floor(rng() * arr.length)];

        // Выбор формулы
        const roll = rng();
        let parts = [];

        if (roll < 0.50) {
            // A: Modifier + Noun
            parts = [pick(modifiers), pick(nouns)];
        } else if (roll < 0.75) {
            // B: Noun + Modifier
            parts = [pick(nouns), pick(modifiers)];
        } else if (roll < 0.90) {
            // C: Verb + Noun
            parts = [pick(verbs), pick(nouns)];
        } else {
            // D: Modifier + Verb + Noun
            parts = [pick(modifiers), pick(verbs), pick(nouns)];
        }

        let name = parts.join(' ');

        // Редкий суффикс (10–20% случаев)
        if (rng() < 0.18) {
            name += ' ' + pick(suffixes);
        }

        return name;
    }
}

