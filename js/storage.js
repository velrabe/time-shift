// Система локального хранения
class StorageSystem {
    constructor() {
        this.SNAPSHOT_KEY = 'timeshift_snapshot';
        this.SETTINGS_KEY = 'timeshift_settings';
    }

    // Сохранение снапшота
    saveSnapshot(snapshot) {
        try {
            localStorage.setItem(this.SNAPSHOT_KEY, JSON.stringify(snapshot));
        } catch (e) {
            console.warn('Failed to save snapshot:', e);
        }
    }

    // Загрузка снапшота
    loadSnapshot() {
        try {
            const data = localStorage.getItem(this.SNAPSHOT_KEY);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.warn('Failed to load snapshot:', e);
            return null;
        }
    }

    // Удаление снапшота
    clearSnapshot() {
        try {
            localStorage.removeItem(this.SNAPSHOT_KEY);
        } catch (e) {
            console.warn('Failed to clear snapshot:', e);
        }
    }

    // Сохранение настроек
    saveSettings(settings) {
        try {
            localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(settings));
        } catch (e) {
            console.warn('Failed to save settings:', e);
        }
    }

    // Загрузка настроек
    loadSettings() {
        try {
            const data = localStorage.getItem(this.SETTINGS_KEY);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.warn('Failed to load settings:', e);
            return null;
        }
    }

    // Получение best score из локального хранилища
    getLocalBestScore() {
        const settings = this.loadSettings();
        return settings?.bestScore || 0;
    }

    // Сохранение best score локально
    saveLocalBestScore(score) {
        const settings = this.loadSettings() || {};
        settings.bestScore = score;
        this.saveSettings(settings);
    }
}

