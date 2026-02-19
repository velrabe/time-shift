// Главный класс игры
class Game {
    constructor() {
        this.timer = new Timer();
        this.perks = new PerkSystem();
        this.audio = new AudioSystem();
        this.storage = new StorageSystem();
        this.gamePush = new GamePushSystem();
        this.renderer = new Renderer();
        this.playerNameManager = new PlayerNameManager(this.gamePush, this.storage);
        
        this.state = 'MENU'; // MENU, RUNNING, PAUSED, GAME_OVER, COUNTDOWN
        this.bestScore = 0;
        this.soundMuted = false;
        this.lastSnapshotTime = 0;
        this.snapshotInterval = 1000; // сохранять каждую секунду

        // Leaderboard cache (top10 + player rating)
        this.leaderboardData = {
            topPlayers: [],
            player: null,
            updatedAt: 0,
            loading: false,
            error: null
        };
        this._leaderboardRefreshInFlight = null;
        this._pausedByLeaderboard = false;
        this._pauseStartTime = null; // Время начала паузы для лидерборда
        
        this.animationFrameId = null;
        this.lastUpdateTime = 0;

        // Отложенная смерть (для анимации столкновения)
        this.deathInProgress = false;
        
        // legacy: раньше была смерть "после приземления" на хоткей-перемотке
        this.pendingShiftDeath = null;

        // Защита от раннего клика PLAY и от повторных стартов.
        this.isInitialized = false;
        this.pendingStart = false;
        this.startInProgress = false;
        this._initPromise = null;
        
        // Убеждаемся, что игра не запущена
        this.state = 'MENU';

        // Счёт: количество съеденных объектов за текущий забег
        this.score = 0;
        
        this.setupEventListeners();
    }

    // Инициализация
    async init() {
        // Инициализируемся строго один раз (на случай повторного вызова извне).
        if (this._initPromise) return this._initPromise;

        this._initPromise = (async () => {
        // Инициализация GamePush
        await this.gamePush.init();
        // Имя игрока (случайный ник, если ещё нет)
        await this.playerNameManager.ensurePlayerNameInitialized();
        
        // Загрузка best score
        const gpBestScore = this.gamePush.getBestScore();
        const localBestScore = this.storage.getLocalBestScore();
        this.bestScore = Math.max(gpBestScore, localBestScore);
        
        // Загрузка снапшота (если есть) - НЕ восстанавливаем автоматически
        // Пользователь должен нажать PLAY для начала новой игры
        // Снапшот можно использовать позже для функции "Continue"
        
        // Убеждаемся, что состояние - MENU (не запущено)
        this.state = 'MENU';
        
        // Инициализация аудио
        this.audio.init();

        // Загрузка настроек звука
        const settings = this.storage.loadSettings() || {};
        const savedVolume = typeof settings.volume === 'number' ? settings.volume : 50;
        this.soundMuted = !!settings.muted;
        this.audio.setVolume(this.soundMuted ? 0 : savedVolume / 100);
        
        // Обновление UI
        this.updateUI();

        // Первичная загрузка лидерборда (топ10 + позиция игрока)
        this.refreshLeaderboard('init');

        this.isInitialized = true;

        // Если пользователь нажал PLAY до завершения init(), запускаем игру сейчас.
        if (this.pendingStart) {
            this.pendingStart = false;
            // Не await'им, чтобы не блокировать внешний init(), но start() сам async/guarded.
            this.start();
        }
        })();

        return this._initPromise;
    }

    // Настройка обработчиков событий
    setupEventListeners() {
        // События таймера
        eventBus.on('TICK_STEP', (data) => {
            // Обрабатываем только если игра запущена
            if (this.state === 'RUNNING') {
                this.onTickStep(data);
            }
        });

        // Mouth hold управляется напрямую из input (pointer/key down/up)
        
        // Делаем экземпляр игры доступным глобально для обработчиков
        window.gameInstance = this;

        // События паузы/резюма
        eventBus.on('PAUSE', () => {
            this.pause();
        });

        eventBus.on('RESUME', () => {
            this.resume();
        });

        // Game over по физической коллизии (любой объект касается челюсти при закрытом рте)
        eventBus.on('PENGUIN_COLLISION', (_data) => {
            if (this.state !== 'RUNNING') return;
            this.beginDeath({ reason: 'PENGUIN_COLLISION' });
        });

        // Счёт и streak от реально съеденных объектов
        eventBus.on('FOOD_EATEN', (data) => {
            if (this.state !== 'RUNNING') return;
            const value = Number.isFinite(data?.value) ? data.value : null;

            // +1 очко за ЛЮБОЙ съеденный объект
            this.score = (this.score || 0) + 1;

            // В новой механике streak = серия проглоченных объектов (+5 за укус)
            if (this.perks && typeof this.perks.addStreak === 'function') {
                this.perks.addStreak(5);
            }

            // При желании score/streak можно логировать для дебага
            // console.debug('FOOD_EATEN', kind, this.score, this.perks.streakPoints);

            this.updateUI();
        });

        // Горячие клавиши
        document.addEventListener('keydown', (e) => {
            const key = e.key;
            if (key === 'Escape') {
                // Если открыта таблица лидеров — закрываем её и продолжаем игру
                if (this.renderer?.isLeaderboardModalOpen?.()) {
                    e.preventDefault();
                    this.closeLeaderboardModal();
                    return;
                }
                if (this.state === 'RUNNING') {
                    e.preventDefault();
                    this.pause();
                }
                return;
            }

            if (this.state !== 'RUNNING') return;

            if (key === ' ' || key === 'Spacebar') {
                // Не даём автоповтору клавиши превращать укус в "авто-режим"
                if (e.repeat) return;
                e.preventDefault();
                // Удержание: открылся рот (дальше закроется по keyup или автозакрытию через 2s)
                this.renderer?.startBiteHold?.();
            }
        });

        document.addEventListener('keyup', (e) => {
            const key = e.key;
            if (key === ' ' || key === 'Spacebar') {
                e.preventDefault();
                this.renderer?.endBiteHold?.();
            }
        });

        // Кнопки UI
        const pauseBtn = document.getElementById('pause-btn');
        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => this.pause());
        }

        const soundBtn = document.getElementById('sound-btn');
        if (soundBtn) {
            soundBtn.addEventListener('click', () => this.toggleSound());
        }

        const resumeBtn = document.getElementById('resume-btn');
        if (resumeBtn) {
            resumeBtn.addEventListener('click', () => this.resume());
        }

        const pauseRestartBtn = document.getElementById('pause-restart-btn');
        if (pauseRestartBtn) {
            pauseRestartBtn.addEventListener('click', () => {
                this.renderer?.hidePauseScreen?.();
                this.restart();
            });
        }

        const pauseSoundBtn = document.getElementById('pause-sound-btn');
        if (pauseSoundBtn) {
            pauseSoundBtn.addEventListener('click', () => this.toggleSound());
        }

        const pauseLanguageBtn = document.getElementById('pause-language-btn');
        if (pauseLanguageBtn) {
            pauseLanguageBtn.addEventListener('click', () => {
                this.renderer?.showLanguageScreen?.();
            });
        }

        const languageBackBtn = document.getElementById('language-back-btn');
        if (languageBackBtn) {
            languageBackBtn.addEventListener('click', () => {
                this.renderer?.hideLanguageScreen?.();
            });
        }

        ['lang-en', 'lang-ru', 'lang-es'].forEach((id) => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.pause-btn--lang').forEach((b) => b.classList.remove('pause-btn--lang-active'));
                    btn.classList.add('pause-btn--lang-active');
                    /* Локализация — позже */
                });
            }
        });

        const restartBtn = document.getElementById('restart-btn');
        if (restartBtn) {
            restartBtn.addEventListener('click', () => this.restart());
        }

        const continueBtn = document.getElementById('continue-btn');
        if (continueBtn) {
            continueBtn.addEventListener('click', () => this.continueAfterDeath());
        }

        // Кнопка PLAY на стартовом экране
        const playBtn = document.getElementById('play-btn');
        if (playBtn) {
            playBtn.addEventListener('click', () => this.start());
        }

        // Buy Slow / Buy Shield на стартовом экране
        document.querySelectorAll('.start-buy-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const spell = btn.dataset?.spell;
                if (spell === 'slow' && this.perks?.buySlow?.()) {
                    this.updateUI();
                    this.renderer?.ui?.updateStartGameScreen?.(this.getGameState());
                } else if (spell === 'shield' && this.perks?.buyShield?.()) {
                    this.updateUI();
                    this.renderer?.ui?.updateStartGameScreen?.(this.getGameState());
                }
            });
        });

        const slowDownBtn = document.getElementById('slowdown-btn');
        if (slowDownBtn) {
            slowDownBtn.addEventListener('click', () => this.useSlowDown());
        }

        const biteBtn = document.getElementById('bite-btn');
        if (biteBtn) {
            let holding = false;
            let holdPointerId = null;

            const startHold = (e) => {
                e?.preventDefault?.();
                if (this.state !== 'RUNNING') return;
                if (holding) return;
                holding = true;
                holdPointerId = (e && Number.isFinite(e.pointerId)) ? e.pointerId : null;
                if (holdPointerId != null && typeof biteBtn.setPointerCapture === 'function') {
                    try { biteBtn.setPointerCapture(holdPointerId); } catch (_err) { /* ignore */ }
                }
                this.renderer?.startBiteHold?.();
            };

            const endHold = (e) => {
                if (!holding) return;
                const eventPointerId = (e && Number.isFinite(e.pointerId)) ? e.pointerId : null;
                if (holdPointerId != null && eventPointerId != null && eventPointerId !== holdPointerId) {
                    return;
                }
                e?.preventDefault?.();
                holding = false;
                if (holdPointerId != null && typeof biteBtn.releasePointerCapture === 'function') {
                    try { biteBtn.releasePointerCapture(holdPointerId); } catch (_err) { /* ignore */ }
                }
                holdPointerId = null;
                this.renderer?.endBiteHold?.();
            };

            // Pointer events (мышь + тач)
            biteBtn.addEventListener('pointerdown', startHold);
            biteBtn.addEventListener('pointerup', endHold);
            biteBtn.addEventListener('pointercancel', endHold);
            biteBtn.addEventListener('lostpointercapture', endHold);
            window.addEventListener('blur', endHold);
        }

        // Открытие таблицы лидеров по клику на BEST
        const bestHint = document.getElementById('best-hint');
        if (bestHint) {
            bestHint.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openLeaderboardModal();
            });
            bestHint.addEventListener('keydown', (e) => {
                const k = e.key;
                if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openLeaderboardModal();
                }
            });
        }

        // Закрытие таблицы лидеров
        const lbCloseBtn = this.renderer?.leaderboardCloseBtn || document.getElementById('leaderboard-close-btn');
        if (lbCloseBtn) {
            lbCloseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.closeLeaderboardModal();
            });
        }

        // Клик по фону модалки — тоже закрывает
        const lbModal = this.renderer?.leaderboardModal || document.getElementById('leaderboard-modal');
        if (lbModal) {
            lbModal.addEventListener('click', (e) => {
                if (e.target === lbModal) {
                    this.closeLeaderboardModal();
                }
            });
        }

        // Клик по строке «You» в лидерборде — редактирование имени
        const lbMe = document.getElementById('leaderboard-me');
        if (lbMe) {
            lbMe.addEventListener('click', async (e) => {
                e.preventDefault();
                const current = this.playerNameManager.getCurrentName() || '';
                const next = window.prompt('Enter your name', current);
                if (next == null) return;
                try {
                    await this.playerNameManager.setCustomName(next);
                    this.playerNameManager.markHintSeen();
                    this.refreshLeaderboard('edit');
                } catch (err) {
                    if (err && err.code === 'INVALID_NAME') {
                        window.alert('Name must be 2-20 letters/numbers.');
                    }
                }
            });
        }

        // Ползунок громкости
        const volumeSlider = document.getElementById('volume-slider');
        const volumeValue = document.getElementById('volume-value');
        const pauseVolumeSlider = document.getElementById('pause-volume-slider');
        const pauseVolumeValue = document.getElementById('pause-volume-value');

        const applyVolumeToUI = (volume) => {
            if (volumeSlider) volumeSlider.value = volume;
            if (volumeValue) volumeValue.textContent = `${volume}%`;
            if (pauseVolumeSlider) pauseVolumeSlider.value = volume;
            if (pauseVolumeValue) pauseVolumeValue.textContent = `${volume}%`;
        };

        const onVolumeInput = (raw) => {
            const volume = Math.max(0, Math.min(100, parseInt(raw, 10) || 0));
            applyVolumeToUI(volume);

            const settings = this.storage.loadSettings() || {};
            settings.volume = volume;
            this.storage.saveSettings(settings);

            if (!this.soundMuted) {
                this.audio.setVolume(volume / 100);
            }
        };

        // Инициализация UI громкости из сохраненных настроек
        const savedVolume = this.storage.loadSettings()?.volume ?? 50;
        applyVolumeToUI(savedVolume);

        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => onVolumeInput(e.target.value));
        }
        if (pauseVolumeSlider) {
            pauseVolumeSlider.addEventListener('input', (e) => onVolumeInput(e.target.value));
        }

        // Обработка видимости вкладки
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (this.state === 'RUNNING') {
                    this.pause();
                }
            }
        });
    }

    // Запуск игры
    async start() {
        // Нельзя стартовать до завершения init(): иначе позже init() может "догрузиться"
        // и перерисовать меню поверх игры, а также запустить повторный start.
        if (!this.isInitialized) {
            this.pendingStart = true;
            return;
        }

        // Старт возможен только из меню. Любые повторные клики во время countdown/running игнорируем.
        if (this.state !== 'MENU') return;

        // Доп. защита от двойного старта (например, два события клика подряд).
        if (this.startInProgress) return;
        this.startInProgress = true;
        try {
            // Скрываем стартовый экран
            this.renderer.hideStartScreen();

            // Обновляем лидерборд при старте новой игры (стартовый синк)
            this.refreshLeaderboard('start');

            // Сбрасываем изображения пингвина в нормальное состояние
            this.renderer?.resetPenguinState?.();

            // Сбрасываем счёт забега
            this.score = 0;
            this.updateUI();

            this.state = 'COUNTDOWN';
            this.timer.reset();
            this.perks.reset();
            this.audio.reset();

        // ВАЖНО: при новой игре пересоздаем DOM-окно ленты,
        // иначе там остаются значения из прошлой сессии и current=0 не центрируется до первого шага.
        if (this.renderer && typeof this.renderer.resetStripWindow === 'function') {
            this.renderer.resetStripWindow();
        }
        
        // Обратный отсчет
        await this.renderer.showCountdown();
        
        this.state = 'RUNNING';
        this.lastUpdateTime = performance.now();
        this.lastSnapshotTime = Date.now();
        this.userInteracted = true; // Помечаем как взаимодействовал (клик на PLAY)

        // Сброс состояния смерти для новой сессии
        this.deathInProgress = false;
        
        // Кнопка BITE уже есть в HTML, не создаем динамически
        
        // Запуск аудио при старте таймера (после взаимодействия пользователя)
        this.audio.play();
        
        // Сбрасываем состояние рендера перед новой сессией
        if (this.renderer) {
            if (typeof this.renderer.stopStripAnimation === 'function') this.renderer.stopStripAnimation();
            if (typeof this.renderer.stopCircleAnimation === 'function') this.renderer.stopCircleAnimation();
        }

        // Рендерим ленту для начального состояния
        this.renderer.renderNumberStrip(this.timer);
        
            // Запуск игрового цикла
            this.gameLoop();
        } finally {
            this.startInProgress = false;
        }
    }

    // Игровой цикл
    gameLoop() {
        // Цикл продолжается в состояниях RUNNING и DYING.
        // В DYING мы даём ленте и объекту доехать до финальной позиции перед показом модалки.
        if (this.state !== 'RUNNING' && this.state !== 'DYING') {
            // Отменяем анимацию если она была запланирована
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
            return;
        }

        const currentTime = performance.now();
        
        // Обновление таймера
        this.timer.update(currentTime);
        if (this.state !== 'RUNNING') return;
        
        // Проверка инверсии
        this.timer.checkInversion();
        
        const gameState = this.getGameState();

        // Обновление перков
        this.perks.update(gameState);
        
        // Обновление аудио
        const speedMultiplier = this.timer.getSpeedMultiplier();
        this.audio.updatePlaybackRate(speedMultiplier);
        
        // Рендеринг
        this.render();
        
        // Сохранение снапшота
        const now = Date.now();
        if (now - this.lastSnapshotTime >= this.snapshotInterval) {
            this.saveSnapshot();
            this.lastSnapshotTime = now;
        }
        
        // Следующий кадр
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
    }

    // Рендеринг
    render() {
        // Лента обновляется в Renderer (physics/conveyor) каждый кадр из gameLoop.

        // UI
        this.updateUI();

        // Конвейер: позиция ленты обновляется каждый кадр
        if (this.renderer && typeof this.renderer.updateConveyor === 'function') {
            this.renderer.updateConveyor(this.timer);
        }
    }

    // Запуск "смерти" с задержкой (чтобы показать анимацию столкновения)
    beginDeath(meta = null) {
        if (this.deathInProgress) return;
        if (this.state !== 'RUNNING') return;
        this.deathInProgress = true;
        this.state = 'DYING';
        // Важно: при Game Over укус НЕ проигрываем, но даём ленте и объекту
        // продолжить движение ещё немного. Останавливаем только анимации укуса
        // и сразу переключаем пингвина в состояние проигрыша.
        try {
            this.renderer?.stopAllBites?.();
            // Переключаем изображения пингвина на состояние проигрыша
            this.renderer?.setPenguinGameOverState?.();
        } catch (e) {
            // ignore
        }

        // Даём игре доехать до финальной позы: через секунду показываем экран Game Over.
        window.setTimeout(() => {
            // Разрешаем gameOver из состояния DYING
            this.gameOver(meta);
        }, 1000);
    }

    // Обновление UI
    updateUI() {
        const gameState = this.getGameState();
        this.renderer.updateUI(gameState);
    }

    // Получение состояния игры
    getGameState() {
        return {
            timer: this.timer,
            perks: this.perks,
            streak: this.perks?.getStreakPoints ? this.perks.getStreakPoints() : (this.perks?.streakPoints || 0),
            streakPoints: this.perks.getStreakPoints ? this.perks.getStreakPoints() : (this.perks?.streakPoints || 0),
            slowSpellCount: this.perks?.slowSpellCount ?? 1,
            shieldSpellCount: this.perks?.shieldSpellCount ?? 1,
            coins: this.perks?.coins ?? 0,
            score: this.score || 0,
            bestScore: this.bestScore,
            gameStatus: this.state,
            soundMuted: this.soundMuted,
            leaderboardRank: this._getLeaderboardRankForHUD()
        };
    }

    _getLeaderboardRankForHUD() {
        const player = this.leaderboardData?.player;
        if (!player) return null;
        const rawRank =
            (typeof player.rank === 'number' ? player.rank : null) ??
            (typeof player.place === 'number' ? player.place : null) ??
            (typeof player.position === 'number' ? player.position : null) ??
            (typeof player.rating === 'number' ? player.rating : null) ??
            null;
        if (!Number.isFinite(rawRank)) return null;
        const r = Math.max(1, Math.floor(rawRank));
        return r;
    }

        // Обработка шага таймера (legacy, оставлена для совместимости событийной модели)
        // В conveyor/physics-режиме логика смертей и streak перенесена в Renderer/PerkSystem.
        onTickStep(_data) {
            // Ничего не делаем — оставлено намеренно, чтобы не дублировать логику.
            return;
        }

    // legacy: старые обработчики shift/кнопок больше не используются
    onShiftUsed(_data) { return; }
    onButtonClicked(_delta) { return; }

    toggleSound() {
        const settings = this.storage.loadSettings() || {};
        const savedVolume = typeof settings.volume === 'number' ? settings.volume : 50;

        this.soundMuted = !this.soundMuted;
        settings.muted = this.soundMuted;
        this.storage.saveSettings(settings);

        this.audio.setVolume(this.soundMuted ? 0 : savedVolume / 100);
        this.updateUI();
    }

    useSlowDown() {
        if (this.state !== 'RUNNING') return;
        if (!this.perks || typeof this.perks.useSlowDown !== 'function') return;
        const ok = this.perks.useSlowDown();
        if (!ok) return;
        if (this.timer && typeof this.timer.activateSlowDown === 'function') {
            this.timer.activateSlowDown(10);
        }
        this.updateUI();
    }

    // Пауза
    pause() {
        if (this.state !== 'RUNNING') return;
        
        this.state = 'PAUSED';
        // Важно: чтобы после паузы таймер не "догонял" пропущенные тики пачкой
        if (this.timer) this.timer.lastStepTime = 0;
        // Паузим музыку
        this.audio.pause();
        
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        this.renderer.showPauseScreen();
        eventBus.emit('PAUSE');
    }

    // Резюм
    async resume() {
        if (this.state !== 'PAUSED') return;
        
        this.renderer.hidePauseScreen();
        
        // Обратный отсчет
        this.state = 'COUNTDOWN';
        await this.renderer.showCountdown();
        
        this.state = 'RUNNING';
        // Важно: чтобы после countdown таймер не "догонял" время, проведённое в паузе
        if (this.timer) this.timer.lastStepTime = 0;
        this.lastUpdateTime = performance.now();
        this.deathInProgress = false;
        // Возобновляем музыку
        this.audio.play();
        this.gameLoop();
        eventBus.emit('RESUME');
    }

    // Game Over
    gameOver(meta = null) {
        if (this.state !== 'RUNNING' && this.state !== 'DYING') return;
        
        this.state = 'GAME_OVER';
        this.deathInProgress = false;
        this.audio.pause();

        // В новой механике нет danger-zones/окон угроз.
        this.lastDeathDangerWindow = null;

        // Останавливаем анимации ленты/круга, чтобы экран Game Over был "заморожен"
        if (this.renderer && typeof this.renderer.stopStripAnimation === 'function') {
            this.renderer.stopStripAnimation();
        }
        if (this.renderer && typeof this.renderer.stopCircleAnimation === 'function') {
            this.renderer.stopCircleAnimation();
        }
        
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        // Единственный источник счёта — количество съеденных объектов (this.score).
        const score = this.score;
        if (score > this.bestScore) {
            this.bestScore = score;
            this.storage.saveLocalBestScore(score);
            // Сохраняем рекорд в GamePush и сразу обновляем лидерборд
            Promise.resolve(this.gamePush.saveBestScore(score)).then(() => this.refreshLeaderboard('bestScore'));
        }
        
        // Проверка доступности Continue
        const canContinue = !!(this.perks && typeof this.perks.hasSecondLife === 'function' && this.perks.hasSecondLife());
        
        this.renderer.showGameOverScreen(score, this.bestScore, 0);
        eventBus.emit('DEATH');
        
        // Очистка снапшота
        this.storage.clearSnapshot();
    }

    // Продолжение после смерти
    continueAfterDeath() {
        if (this.state !== 'GAME_OVER') return;

        // "Second life" можно потратить только если было накоплено 50/50
        if (!this.perks || typeof this.perks.consumeSecondLife !== 'function' || !this.perks.consumeSecondLife()) {
            return;
        }
        
        // В новой механике "Continue" просто перезапускает забег.
        // (Second life тратится, но угроз/окон больше нет.)
        this.renderer.hideGameOverScreen();
        this.restart();
        this.start();
    }

    // Рестарт
    restart() {
        this.state = 'MENU';
        this.timer.reset();
        this.perks.reset();
        this.audio.reset();
        this.storage.clearSnapshot();

        // Сброс состояния смерти
        this.deathInProgress = false;
        this.score = 0;
        this.updateUI();
        
        this.renderer.hideGameOverScreen();
        this.renderer.hidePauseScreen();
        
        // Показываем стартовый экран
        this.renderer.showStartScreen(this.getGameState());
    }

    // Сохранение снапшота
    saveSnapshot() {
        const snapshot = {
            timer: this.timer.toSnapshot(),
            perks: this.perks.toSnapshot(),
            timestamp: Date.now()
        };
        
        this.storage.saveSnapshot(snapshot);
        
        // Синхронизация с GamePush (редко)
        if (Math.random() < 0.1) { // 10% шанс
            this.gamePush.saveSnapshot(snapshot);
        }
    }

    // Загрузка снапшота
    loadSnapshot() {
        // Сначала пробуем GamePush
        const gpSnapshot = this.gamePush.getSnapshot();
        if (gpSnapshot) {
            return gpSnapshot;
        }
        
        // Потом локальный
        return this.storage.loadSnapshot();
    }

    // Восстановление из снапшота
    restoreFromSnapshot(snapshot) {
        if (!snapshot) return;
        
        // Проверка актуальности (не старше 24 часов)
        const age = Date.now() - (snapshot.timestamp || 0);
        if (age > 24 * 60 * 60 * 1000) {
            this.storage.clearSnapshot();
            return;
        }
        
        // Восстанавливаем данные, но НЕ запускаем игру
        this.timer.fromSnapshot(snapshot.timer);
        this.perks.fromSnapshot(snapshot.perks);
        
        // Обновление best score из снапшота
        if (snapshot.timer && snapshot.timer.maxReached) {
            this.gamePush.updateBestScoreFromSnapshot(snapshot.timer.maxReached);
        }
        
        // НЕ запускаем игру автоматически - пользователь должен нажать PLAY
        // НЕ отображаем кнопки - они появятся только после старта игры
    }

    // ===== Leaderboard =====
    async refreshLeaderboard(reason = 'manual') {
        // если уже в процессе — не стартуем параллельный запрос
        if (this._leaderboardRefreshInFlight) return this._leaderboardRefreshInFlight;

        this.leaderboardData.loading = true;
        this.leaderboardData.error = null;

        this._leaderboardRefreshInFlight = (async () => {
            try {
                // Если SDK недоступен — просто помечаем ошибку (модалка покажет fallback)
                if (!this.gamePush?.isLeaderboardsAvailable?.()) {
                    this.leaderboardData.topPlayers = [];
                    this.leaderboardData.player = null;
                    this.leaderboardData.updatedAt = Date.now();
                    this.leaderboardData.error = 'Leaderboards not available';
                    return;
                }

                const snap = await this.gamePush.fetchLeaderboardSnapshot(10);
                this.leaderboardData.topPlayers = Array.isArray(snap?.topPlayers) ? snap.topPlayers : [];
                this.leaderboardData.player = snap?.player || null;
                const name = await this.playerNameManager.ensurePlayerNameInitialized();
                const meta = this.playerNameManager.getMeta();
                this.leaderboardData.playerName = name;
                this.leaderboardData.nameHintSeen = meta.hintSeen;
                this.leaderboardData.playerNameEdited = meta.edited;
                this.leaderboardData.updatedAt = Date.now();
                this.leaderboardData.error = null;
            } catch (e) {
                this.leaderboardData.topPlayers = [];
                this.leaderboardData.player = null;
                this.leaderboardData.updatedAt = Date.now();
                this.leaderboardData.error = 'Failed to load leaderboard';
            } finally {
                this.leaderboardData.loading = false;
                this._leaderboardRefreshInFlight = null;

                // Если модалка сейчас открыта — перерисуем её свежими данными
                if (this.renderer?.isLeaderboardModalOpen?.()) {
                    this.renderer.renderLeaderboardModal(this.leaderboardData);
                }
            }
        })();

        return this._leaderboardRefreshInFlight;
    }

    pauseForLeaderboard() {
        if (this.state !== 'RUNNING') return;
        this._pausedByLeaderboard = true;
        this._pauseStartTime = performance.now(); // Сохраняем время начала паузы
        this.state = 'PAUSED';

        // Останавливаем игровой цикл (таймер/лента/коллизии)
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Стопаем активные анимации и звук
        try {
            if (this.timer) this.timer.lastStepTime = 0;
            this.audio.pause();
            this.renderer?.stopCircleAnimation?.();
            this.renderer?.stopStripAnimation?.();
            // Сохраняем текущее время обновления ленты, чтобы не "догонять" пропущенное время
            if (this.renderer && typeof this.renderer.pauseBeltUpdate === 'function') {
                this.renderer.pauseBeltUpdate();
            }
        } catch (e) {
            // ignore
        }

        // Уведомляем другие системы о паузе
        eventBus.emit('PAUSE');
    }

    resumeFromLeaderboard() {
        if (this.state !== 'PAUSED') return;
        if (!this._pausedByLeaderboard) return;

        this._pausedByLeaderboard = false;
        // Не показываем countdown — игра продолжается сразу
        this.state = 'RUNNING';
        if (this.timer) this.timer.lastStepTime = 0;
        this.lastUpdateTime = performance.now();
        
        // Корректируем время обновления ленты, чтобы не "догонять" пропущенное время
        if (this.renderer && typeof this.renderer.resumeBeltUpdate === 'function' && this._pauseStartTime) {
            const pauseDuration = performance.now() - this._pauseStartTime;
            this.renderer.resumeBeltUpdate(pauseDuration);
        }
        this._pauseStartTime = null;
        
        this.audio.play();
        this.gameLoop();
    }

    openLeaderboardModal() {
        // Ставим игру на паузу СРАЗУ, если она шла (до асинхронных операций)
        if (this.state === 'RUNNING') {
            this.pauseForLeaderboard();
        }

        // Подтягиваем свежие данные (не блокируем открытие)
        this.refreshLeaderboard('open');

        // Рендерим то, что есть в кеше (или fallback)
        this.renderer?.renderLeaderboardModal?.(this.leaderboardData);
        this.renderer?.showLeaderboardModal?.();
    }

    closeLeaderboardModal() {
        this.renderer?.hideLeaderboardModal?.();

        // Если пауза была именно из-за лидерборда — продолжаем игру
        if (this._pausedByLeaderboard) {
            this.resumeFromLeaderboard();
        }
    }

    // Debug: полный сброс прогресса (локально + GamePush)
    async debugResetProgress() {
        try {
            this.storage?.clearAll?.();
        } catch (e) {
            // ignore
        }
        try {
            await this.gamePush?.resetBestScore?.();
        } catch (e) {
            // ignore
        }

        this.bestScore = 0;
        this.score = 0;
        this.updateUI();

        // Обновим лидерборд, чтобы подтянуть обнулённый счёт
        this.refreshLeaderboard('debugReset');

        // Небольшой визуальный фидбек в консоли
        // eslint-disable-next-line no-console
        console.log('[DEBUG] Progress has been reset (local + GamePush)');
    }
}

