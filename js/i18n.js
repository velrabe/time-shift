/* Simple global i18n module for RU / EN UI texts */

(function () {
    const DICT = {
        en: {
            PAUSE_TITLE: 'Pause',
            PAUSE_RESUME: 'RESUME',
            PAUSE_RESTART: 'RESTART',
            PAUSE_SOUND_ON: 'SOUND: ON',
            PAUSE_SOUND_OFF: 'SOUND: OFF',
            PAUSE_LANGUAGE: 'LANGUAGE',

            LANG_TITLE: 'Language',
            LANG_BACK: 'BACK',
            LANG_EN: 'English',
            LANG_RU: 'русский',

            HUD_SLOW: 'SLOW',
            HUD_SHIELD: 'SHIELD',
            HUD_BITE: 'BITE',
            HUD_SWALLOW: 'SWALLOW',
            HUD_CHOMP: 'CHOMP',
            HUD_MEGA: 'MEGA',
            HUD_STATUS_BITE: 'Crush ice, chomp rewards',
            HUD_STATUS_SWALLOW: 'Swallow food, action big bites',
            HUD_STATUS_STUN: 'Stun',
            HUD_BEST_SCORE_LABEL: 'Best Score',
            HUD_PERKS_LABEL: 'Perks',

            PERKS_TITLE: 'Perks',

            LEADERBOARD_TITLE: 'Leaderboard',
            LEADERBOARD_COL_NAME: 'Name',
            LEADERBOARD_COL_SCORE: 'Score',
            LEADERBOARD_YOU_SUFFIX: ' (You)',

            RENAME_TITLE: 'Change name',
            RENAME_LABEL: 'Name in leaderboard',
            RENAME_SAVE: 'Save',

            GAMEOVER_TITLE: 'Game Over',
            GAMEOVER_FINAL_SCORE: 'Final Score',
            GAMEOVER_BEST_SCORE: 'Best Score',
            GAMEOVER_COINS_EARNED: 'Coins earned',
            GAMEOVER_RESTART: 'Restart',

            START_TITLE: 'Start Game',
            START_SLOW_NAME: 'SLOW',
            START_SLOW_DESC: 'slows down food by 5 seconds',
            START_SLOW_BUY: 'Buy',
            START_SHIELD_NAME: 'SHIELD',
            START_SHIELD_DESC: 'protects against one mistake',
            START_SHIELD_BUY: 'Buy',
            START_PLAY: 'PLAY',
            START_LOADING: 'Loading'
        },
        ru: {
            PAUSE_TITLE: 'Пауза',
            PAUSE_RESUME: 'ПРОДОЛЖИТЬ',
            PAUSE_RESTART: 'ЗАНОВО',
            PAUSE_SOUND_ON: 'Звук: ВКЛ',
            PAUSE_SOUND_OFF: 'Звук: ВЫКЛ',
            PAUSE_LANGUAGE: 'ЯЗЫК',

            LANG_TITLE: 'Язык',
            LANG_BACK: 'НАЗАД',
            LANG_EN: 'English',
            LANG_RU: 'русский',

            HUD_SLOW: 'ЗАМЕДЛЕНИЕ',
            HUD_SHIELD: 'ЩИТ',
            HUD_BITE: 'КУСЬ',
            HUD_SWALLOW: 'ГЛОТЬ',
            HUD_CHOMP: 'ЧОМП',
            HUD_MEGA: 'МЕГА',
            HUD_STATUS_BITE: 'Кроши лёд, жми action на награды',
            HUD_STATUS_SWALLOW: 'Глотай еду, жми action на крупную',
            HUD_STATUS_STUN: 'Оглушение',
            HUD_BEST_SCORE_LABEL: 'Лучший счет',
            HUD_PERKS_LABEL: 'Навыки',

            PERKS_TITLE: 'Перки',

            LEADERBOARD_TITLE: 'Таблица лидеров',
            LEADERBOARD_COL_NAME: 'Имя',
            LEADERBOARD_COL_SCORE: 'Очки',
            LEADERBOARD_YOU_SUFFIX: ' (Вы)',

            RENAME_TITLE: 'Изменить имя',
            RENAME_LABEL: 'Имя в таблице лидеров',
            RENAME_SAVE: 'Сохранить',

            GAMEOVER_TITLE: 'Конец игры',
            GAMEOVER_FINAL_SCORE: 'Итоговый счёт',
            GAMEOVER_BEST_SCORE: 'Лучший счёт',
            GAMEOVER_COINS_EARNED: 'Получено монет',
            GAMEOVER_RESTART: 'Новая игра',

            START_TITLE: 'Новая игра',
            START_SLOW_NAME: 'Замедление',
            START_SLOW_DESC: 'замедляет еду на 5 секунд',
            START_SLOW_BUY: 'Купить',
            START_SHIELD_NAME: 'Щит',
            START_SHIELD_DESC: 'защищает от одной ошибки',
            START_SHIELD_BUY: 'Купить',
            START_PLAY: 'Играть',
            START_LOADING: 'Загрузка'
        }
    };

    const STORAGE_KEY = 'timeshift_lang';
    let currentLang = 'en';

    function detectInitialLanguage() {
        try {
            const saved = window.localStorage && window.localStorage.getItem(STORAGE_KEY);
            if (saved && DICT[saved]) return saved;
        } catch (e) {
            // ignore
        }
        const nav = (navigator && (navigator.language || navigator.userLanguage)) || 'en';
        if (String(nav).toLowerCase().startsWith('ru')) return 'ru';
        return 'en';
    }

    function applyStaticTexts() {
        const dict = DICT[currentLang] || DICT.en;
        const q = (sel) => document.querySelector(sel);

        // Pause screen
        const pauseTitle = q('#pause-screen .pause-title');
        if (pauseTitle) pauseTitle.textContent = dict.PAUSE_TITLE;
        const resumeLabel = q('#resume-btn span:last-child');
        if (resumeLabel) resumeLabel.textContent = dict.PAUSE_RESUME;
        const pauseRestart = q('#pause-restart-btn span:last-child');
        if (pauseRestart) pauseRestart.textContent = dict.PAUSE_RESTART;
        const pauseSoundText = document.getElementById('pause-sound-text');
        if (pauseSoundText) {
            const isOff = /\bOFF\b/i.test(pauseSoundText.textContent || '');
            pauseSoundText.textContent = isOff ? dict.PAUSE_SOUND_OFF : dict.PAUSE_SOUND_ON;
        }
        const pauseLangBtn = q('#pause-language-btn span:last-child');
        if (pauseLangBtn) pauseLangBtn.textContent = dict.PAUSE_LANGUAGE;

        // Language overlay
        const langTitle = q('#language-screen .pause-title');
        if (langTitle) langTitle.textContent = dict.LANG_TITLE;
        const langBack = q('#language-back-btn span:last-child');
        if (langBack) langBack.textContent = dict.LANG_BACK;
        const langEn = q('#lang-en span');
        if (langEn) langEn.textContent = dict.LANG_EN;
        const langRu = q('#lang-ru span');
        if (langRu) langRu.textContent = dict.LANG_RU;

        // HUD buttons
        const slowHud = q('#slowdown-btn span:not(.action-hotkey)');
        if (slowHud) slowHud.textContent = dict.HUD_SLOW;
        const shieldHud = q('#shield-btn span:not(.action-hotkey)');
        if (shieldHud) shieldHud.textContent = dict.HUD_SHIELD;
        const biteLabel = q('#mode-bite-btn .mode-toggle-label');
        if (biteLabel) biteLabel.textContent = dict.HUD_BITE;
        const swallowLabel = q('#mode-swallow-btn .mode-toggle-label');
        if (swallowLabel) swallowLabel.textContent = dict.HUD_SWALLOW;

        const bestScoreLabel = q('.score-best-label');
        if (bestScoreLabel && dict.HUD_BEST_SCORE_LABEL) {
            bestScoreLabel.textContent = dict.HUD_BEST_SCORE_LABEL;
        }

        const perksBtn = document.getElementById('perks-btn');
        const perksHudLabel = perksBtn?.querySelector?.('.hud-perks-label');
        if (perksHudLabel && dict.HUD_PERKS_LABEL) {
            perksHudLabel.textContent = dict.HUD_PERKS_LABEL;
        }
        if (perksBtn && dict.HUD_PERKS_LABEL) {
            perksBtn.setAttribute('aria-label', dict.HUD_PERKS_LABEL);
            perksBtn.setAttribute('title', dict.HUD_PERKS_LABEL);
        }

        // Perks
        const perksTitle = q('.perks-title');
        if (perksTitle) perksTitle.textContent = dict.PERKS_TITLE;

        // Leaderboard
        const lbTitle = q('.lb-title');
        if (lbTitle) lbTitle.textContent = dict.LEADERBOARD_TITLE;
        const lbColName = q('.lb-col--name');
        if (lbColName) lbColName.textContent = dict.LEADERBOARD_COL_NAME;
        const lbColScore = q('.lb-col--score');
        if (lbColScore) lbColScore.textContent = dict.LEADERBOARD_COL_SCORE;

        // Rename modal
        const renameModal = document.getElementById('rename-modal');
        if (renameModal) renameModal.setAttribute('aria-label', dict.RENAME_TITLE);
        const renameTitle = q('.rename-title');
        if (renameTitle) renameTitle.textContent = dict.RENAME_TITLE;
        const renameLabel = q('.rename-label');
        if (renameLabel) renameLabel.textContent = dict.RENAME_LABEL;
        const renameSave = q('#rename-save-btn span');
        if (renameSave) renameSave.textContent = dict.RENAME_SAVE;

        // Game over
        const goTitle = q('.game-over-title');
        if (goTitle) goTitle.textContent = dict.GAMEOVER_TITLE;
        const goFinal = q('.game-over-score-label');
        if (goFinal) goFinal.textContent = dict.GAMEOVER_FINAL_SCORE;
        const goBest = q('.game-over-best-label');
        if (goBest) goBest.textContent = dict.GAMEOVER_BEST_SCORE;
        const goCoins = q('.game-over-coins-label');
        if (goCoins) goCoins.textContent = dict.GAMEOVER_COINS_EARNED;
        const goRestart = q('#restart-btn span:last-child');
        if (goRestart) goRestart.textContent = dict.GAMEOVER_RESTART;

        // Start screen
        const startTitle = q('.start-game-title');
        if (startTitle) startTitle.textContent = dict.START_TITLE;
        const startSlowName = q('#start-buy-slow .start-spell-name');
        if (startSlowName) startSlowName.textContent = dict.START_SLOW_NAME;
        const startSlowDesc = q('#start-buy-slow .start-spell-desc');
        if (startSlowDesc) startSlowDesc.textContent = dict.START_SLOW_DESC;
        const startSlowBuy = q('#start-buy-slow .start-buy-text');
        if (startSlowBuy) startSlowBuy.textContent = dict.START_SLOW_BUY;
        const startShieldName = q('#start-buy-shield .start-spell-name');
        if (startShieldName) startShieldName.textContent = dict.START_SHIELD_NAME;
        const startShieldDesc = q('#start-buy-shield .start-spell-desc');
        if (startShieldDesc) startShieldDesc.textContent = dict.START_SHIELD_DESC;
        const startShieldBuy = q('#start-buy-shield .start-buy-text');
        if (startShieldBuy) startShieldBuy.textContent = dict.START_SHIELD_BUY;
        const startPlay = document.getElementById('play-btn');
        if (startPlay) startPlay.textContent = dict.START_PLAY;

        // Mark active language button
        document.querySelectorAll('.pause-btn--lang').forEach((btn) => {
            const lang = btn.dataset.lang;
            btn.classList.toggle('pause-btn--lang-active', lang === currentLang);
        });

        document.documentElement.setAttribute('data-lang', currentLang);
    }

    const I18N = {
        getLanguage() {
            return currentLang;
        },
        setLanguage(lang) {
            if (!DICT[lang]) lang = 'en';
            if (lang === currentLang) return;
            currentLang = lang;
            try {
                if (window.localStorage) {
                    window.localStorage.setItem(STORAGE_KEY, lang);
                }
            } catch (e) {
                // ignore
            }
            applyStaticTexts();
        },
        t(key) {
            const dict = DICT[currentLang] || DICT.en;
            if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
            const fallback = DICT.en;
            if (Object.prototype.hasOwnProperty.call(fallback, key)) return fallback[key];
            return key;
        },
        init() {
            currentLang = detectInitialLanguage();
            applyStaticTexts();
        },
        _applyStaticTexts: applyStaticTexts,
        _DICT: DICT
    };

    window.I18N = I18N;

    const readyState = document.readyState;
    if (readyState === 'complete' || readyState === 'interactive') {
        I18N.init();
    } else {
        document.addEventListener('DOMContentLoaded', () => I18N.init(), { once: true });
    }
}());
