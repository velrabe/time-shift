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
        this.cloudSnapshotSyncInterval = 15000;
        this.lastCloudSnapshotSyncAt = 0;
        this.progressionSyncDebounceTimer = null;

        // Leaderboard cache (top10 + player rating)
        this.leaderboardData = {
            topPlayers: [],
            player: null,
            updatedAt: 0,
            loading: false,
            error: null
        };
        this._leaderboardRefreshInFlight = null;
        this.middleOverlayId = null; // start | gameover
        this.topOverlayId = null; // pause | leaderboard | perks | language
        this._pauseStartTime = null;
        this._pausedByOverlay = false;
        
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
        this.runCoinsEarned = 0;
        this.slowCooldownBaseMs = 30000;
        this.shieldCooldownBaseMs = 30000;
        this.slowCooldownUntil = 0;
        this.shieldCooldownUntil = 0;
        this.shieldActive = false;
        this.shieldHitsRemaining = 0;
        this.shieldExpiresAt = 0;
        this.shieldStartedBySlowSafety = false;
        this.coinRushProgress = 0;
        this.coinRushTarget = 10;
        this.coinRushStep = 10;
        this.coinRushDurationMs = 5000;
        this.coinRushActive = false;
        this.coinRushEndsAt = 0;
        this.maxHp = 4;
        this.hp = this.maxHp;
        this.currentMode = 'swallow';
        this.stunUntil = 0;
        
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
        
        // Загрузка best score: берём максимум из облака и локального хранилища
        const gpBestScore = this.gamePush.getBestScore();
        const localBestScore = this.storage.getLocalBestScore();
        this.bestScore = Math.max(gpBestScore, localBestScore);
        // Если локальный рекорд выше облачного — синхронизируем в облако, чтобы ранг и лидерборд были корректны
        if (localBestScore > gpBestScore && this.bestScore > 0) {
            await this.gamePush.saveBestScore(this.bestScore);
        }

        const localProgression = this.storage.loadProgression();
        const cloudProgression = this.gamePush.getProgression();
        const mergedProgression = this.mergeProgression(localProgression, cloudProgression);
        if (mergedProgression) {
            this.perks.fromSnapshot(mergedProgression);
            this.storage.saveProgression(this.perks.toSnapshot());
            this.gamePush.saveProgression(this.perks.toSnapshot());
        }

        const snapshot = this.loadSnapshot();
        this.restoreFromSnapshot(snapshot);
        
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
        this.renderer?.ui?.updateStartGameScreen?.(this.getGameState());

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
        eventBus.on('PAUSE', (meta) => {
            if (meta?.source === 'game') return;
            this.openPauseOverlay();
        });

        eventBus.on('RESUME', (meta) => {
            if (meta?.source === 'game') return;
            if (this.getActiveOverlayId() === 'pause') {
                this.closePauseOverlay();
            }
        });

        eventBus.on('ITEM_RESOLVED', (data) => {
            if (this.state !== 'RUNNING') return;
            this.handleResolvedItem(data);
        });

        // Горячие клавиши
        document.addEventListener('keydown', (e) => {
            const key = e.key;
            if (key === 'Escape') {
                const activeOverlay = this.getActiveOverlayId();
                if (activeOverlay) {
                    e.preventDefault();
                    if (['pause', 'language', 'leaderboard', 'perks'].includes(activeOverlay)) {
                        this.closeTopOverlay();
                    }
                    return;
                }
                if (this.state === 'RUNNING') {
                    e.preventDefault();
                    this.openPauseOverlay();
                }
                return;
            }

            if (this.state !== 'RUNNING') return;

            if (key === 'Shift') {
                if (e.repeat) return;
                e.preventDefault();
                this.toggleMode();
                return;
            }

            if (key === 'w' || key === 'W' || key === 'ArrowUp') {
                e.preventDefault();
                this.setMode('swallow');
                return;
            }

            if (key === 's' || key === 'S' || key === 'ArrowDown') {
                e.preventDefault();
                this.setMode('bite');
                return;
            }

            if (key === 'd' || key === 'D' || key === 'ArrowRight' || key === ' ' || key === 'Spacebar' || key === 'Space') {
                if (e.repeat) return;
                e.preventDefault();
                this.performAction();
                return;
            }
        });

        // Кнопки UI
        const pauseBtn = document.getElementById('pause-btn');
        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => {
                if (this.audio && typeof this.audio.playPress === 'function') {
                    this.audio.playPress();
                }
                this.pause();
            });
        }

        const soundBtn = document.getElementById('sound-btn');
        if (soundBtn) {
            soundBtn.addEventListener('click', () => this.toggleSound());
        }

        const resumeBtn = document.getElementById('resume-btn');
        if (resumeBtn) {
            resumeBtn.addEventListener('click', () => {
                if (this.audio && typeof this.audio.playPress === 'function') {
                    this.audio.playPress();
                }
                this.resume();
            });
        }

        const pauseRestartBtn = document.getElementById('pause-restart-btn');
        if (pauseRestartBtn) {
            pauseRestartBtn.addEventListener('click', () => {
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
                if (this.audio && typeof this.audio.playPress === 'function') {
                    this.audio.playPress();
                }
                this.openLanguageOverlay();
            });
        }

        const languageBackBtn = document.getElementById('language-back-btn');
        if (languageBackBtn) {
            languageBackBtn.addEventListener('click', () => {
                if (this.audio && typeof this.audio.playPress === 'function') {
                    this.audio.playPress();
                }
                this.closeLanguageOverlay();
            });
        }

        ['lang-en', 'lang-ru'].forEach((id) => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener('click', () => {
                    if (this.audio && typeof this.audio.playPress === 'function') {
                        this.audio.playPress();
                    }
                    const lang = btn.dataset.lang || 'en';
                    if (window.I18N && typeof window.I18N.setLanguage === 'function') {
                        window.I18N.setLanguage(lang);
                    }
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
            playBtn.addEventListener('click', () => {
                if (this.audio && typeof this.audio.playPress === 'function') {
                    this.audio.playPress();
                }
                this.start();
            });
        }

        // Buy Slow / Buy Shield на стартовом экране — кликабельна вся карточка .start-spell-btn
        document.querySelectorAll('.start-spell-btn').forEach((card) => {
            card.addEventListener('click', (e) => {
                e.stopPropagation();
                const btn = card.querySelector('.start-buy-btn');
                if (!btn || btn.disabled) return;
                const spell = btn.dataset?.spell;
                let bought = false;
                if (spell === 'slow' && this.perks?.buySlow?.()) {
                    bought = true;
                    this.persistProgressionSoon();
                    this.updateUI();
                    this.renderer?.ui?.updateStartGameScreen?.(this.getGameState());
                } else if (spell === 'shield' && this.perks?.buyShield?.()) {
                    bought = true;
                    this.persistProgressionSoon();
                    this.updateUI();
                    this.renderer?.ui?.updateStartGameScreen?.(this.getGameState());
                }
                if (bought && this.audio && typeof this.audio.playBuy === 'function') {
                    this.audio.playBuy();
                }
            });
        });

        const perksBtn = document.getElementById('perks-btn');
        if (perksBtn) {
            const open = (e) => {
                e?.preventDefault?.();
                this.openPerksModal();
            };
            perksBtn.addEventListener('click', open);
            perksBtn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') open(e);
            });
        }

        const modeSwitchBtn = document.getElementById('mode-switch-btn');
        if (modeSwitchBtn) {
            modeSwitchBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleMode();
            });
        }

        const actionBtn = document.getElementById('action-btn');
        if (actionBtn) {
            actionBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.performAction();
            });
        }

        const gameArea = document.getElementById('game-area');
        if (gameArea) {
            let touchStart = null;

            gameArea.addEventListener('touchstart', (e) => {
                if (e.target?.closest?.('button, [role="button"]')) return;
                const touch = e.changedTouches?.[0];
                if (!touch) return;
                if (this.renderer?.isPixiControlHit?.(touch.clientX, touch.clientY)) {
                    touchStart = null;
                    return;
                }
                touchStart = { x: touch.clientX, y: touch.clientY, at: Date.now() };
            }, { passive: true });

            gameArea.addEventListener('touchend', (e) => {
                if (!touchStart) return;
                if (e.target?.closest?.('button, [role="button"]')) {
                    touchStart = null;
                    return;
                }
                const touch = e.changedTouches?.[0];
                if (!touch) {
                    touchStart = null;
                    return;
                }
                if (this.renderer?.isPixiControlHit?.(touch.clientX, touch.clientY)) {
                    touchStart = null;
                    return;
                }
                const dx = touch.clientX - touchStart.x;
                const dy = touch.clientY - touchStart.y;
                const absX = Math.abs(dx);
                const absY = Math.abs(dy);

                if (absY > 34 && absY > absX * 1.1) {
                    this.setMode(dy < 0 ? 'swallow' : 'bite');
                } else if (dx > 34 && absX > absY * 1.1) {
                    this.performAction();
                }

                touchStart = null;
            }, { passive: true });
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

        // Клик по строке «You» в лидерборде — редактирование имени через игровой оверлей
        const lbMe = document.getElementById('leaderboard-me');
        const renameModal = document.getElementById('rename-modal');
        const renameInput = document.getElementById('rename-input');
        const renameSaveBtn = document.getElementById('rename-save-btn');
        const renameCloseBtn = document.getElementById('rename-close-btn');

        const closeRenameModal = () => {
            if (!renameModal) return;
            renameModal.classList.add('hidden');
        };

        const openRenameModal = () => {
            if (!renameModal || !renameInput) return;
            const current = this.playerNameManager.getCurrentName() || '';
            renameInput.value = current;
            renameModal.classList.remove('hidden');
            renameInput.focus();
            renameInput.select();
        };

        const applyRename = async () => {
            if (!renameInput) return;
            const next = renameInput.value;
            try {
                await this.playerNameManager.setCustomName(next);
                this.playerNameManager.markHintSeen();
                this.refreshLeaderboard('edit');
                closeRenameModal();
            } catch (err) {
                if (err && err.code === 'INVALID_NAME') {
                    // Пока что оставляем системное сообщение об ошибке как fallback.
                    window.alert('Name must be 2-20 letters/numbers.');
                }
            }
        };

        if (lbMe && renameModal && renameInput && renameSaveBtn && renameCloseBtn) {
            lbMe.addEventListener('click', (e) => {
                e.preventDefault();
                openRenameModal();
            });

            renameSaveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                applyRename();
            });

            renameCloseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                closeRenameModal();
            });

            renameModal.addEventListener('click', (e) => {
                if (e.target === renameModal) {
                    closeRenameModal();
                }
            });

            renameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    applyRename();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    closeRenameModal();
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
                    this.openPauseOverlay();
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
            this.hideStartScreenOverlay();

            // Обновляем лидерборд при старте новой игры (стартовый синк)
            this.refreshLeaderboard('start');

            // Сбрасываем изображения пингвина в нормальное состояние
            this.renderer?.resetPenguinState?.();

            // Сбрасываем счёт забега
            this.score = 0;
            this.runCoinsEarned = 0;
            this.slowCooldownUntil = 0;
            this.shieldCooldownUntil = 0;
            this.shieldActive = false;
            this.shieldHitsRemaining = 0;
            this.shieldExpiresAt = 0;
            this.shieldStartedBySlowSafety = false;
            this.coinRushProgress = 0;
            this.coinRushTarget = 10;
            this.coinRushActive = false;
            this.coinRushEndsAt = 0;
            this.hp = this.maxHp;
            this.currentMode = 'swallow';
            this.stunUntil = 0;
            this.syncGameplayPresentation();
            this.updateUI();

            this.state = 'COUNTDOWN';
            this.timer.reset();
            this.perks.reset();
            this.persistProgressionSoon();
            this.audio.reset();

        // ВАЖНО: при новой игре пересоздаем DOM-окно ленты,
        // иначе там остаются значения из прошлой сессии и current=0 не центрируется до первого шага.
        if (this.renderer && typeof this.renderer.resetStripWindow === 'function') {
            this.renderer.resetStripWindow();
        }
        
        // Обратный отсчет
        await this.renderer.showCountdown();
        
        this.state = 'RUNNING';
        this._pausedByOverlay = false;
        this._pauseStartTime = null;
        this.lastUpdateTime = performance.now();
        this.lastSnapshotTime = Date.now();
        this.syncGameplayPresentation();
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
        this.updateShieldStateByTime();
        this.updateCoinRushStateByTime();
        
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
            if (now - this.lastCloudSnapshotSyncAt >= this.cloudSnapshotSyncInterval) {
                this.gamePush.saveSnapshot(this.buildSnapshotPayload());
                this.lastCloudSnapshotSyncAt = now;
            }
        }
        
        // Следующий кадр
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
    }

    // Рендеринг
    render() {
        // Лента обновляется в Renderer (physics/conveyor) каждый кадр из gameLoop.

        // UI
        this.updateUI();
        this.renderer?.setStunned?.(this.isStunned() ? Math.max(0, this.stunUntil - Date.now()) : 0);

        // Конвейер: позиция ленты обновляется каждый кадр
        if (this.renderer && typeof this.renderer.updateConveyor === 'function') {
            this.renderer.updateConveyor(this.timer);
        }
    }

    getInteractionState() {
        return {
            mode: this.currentMode,
            hp: this.hp,
            maxHp: this.maxHp,
            stunned: this.isStunned(),
            gameStatus: this.state
        };
    }

    isStunned() {
        return this.state === 'RUNNING' && Date.now() < (this.stunUntil || 0);
    }

    isInputLocked() {
        return this.state !== 'RUNNING' || this.isStunned();
    }

    syncGameplayPresentation() {
        this.renderer?.setMode?.(this.currentMode);
        this.renderer?.setHealth?.(this.hp, this.maxHp);
        this.renderer?.setStunned?.(this.isStunned() ? Math.max(0, this.stunUntil - Date.now()) : 0);
    }

    setMode(mode) {
        const nextMode = mode === 'bite' ? 'bite' : 'swallow';
        if (this.state === 'RUNNING' && this.isStunned()) return false;
        if (nextMode === this.currentMode) {
            this.renderer?.setMode?.(nextMode);
            this.updateUI();
            return true;
        }
        this.currentMode = nextMode;
        this.renderer?.setMode?.(nextMode);
        if (this.audio) {
            if (nextMode === 'swallow' && typeof this.audio.playJawOpen === 'function') {
                this.audio.playJawOpen();
            } else if (nextMode === 'bite' && typeof this.audio.playJawClose === 'function') {
                this.audio.playJawClose();
            }
        }
        this.updateUI();
        return true;
    }

    toggleMode() {
        return this.setMode(this.currentMode === 'swallow' ? 'bite' : 'swallow');
    }

    performAction() {
        if (this.isInputLocked()) return false;
        const handled = this.renderer?.performAction?.();
        this.updateUI();
        return !!handled;
    }

    applyStun(durationMs = 0) {
        const extendMs = Math.max(0, Math.floor(durationMs || 0));
        if (extendMs <= 0) return;
        this.stunUntil = Math.max(this.stunUntil || 0, Date.now() + extendMs);
        this.renderer?.setStunned?.(Math.max(0, this.stunUntil - Date.now()));
    }

    applyDamage(amount = 0) {
        const damage = Math.max(0, Math.floor(amount || 0));
        if (damage <= 0) return;
        const prevHp = this.hp;
        this.hp = Math.max(0, this.hp - damage);
        this.renderer?.setHealth?.(this.hp, this.maxHp);
        if (this.hp > 0 && this.hp < prevHp) {
            const fallenPairIndex = Math.max(0, Math.min(2, this.maxHp - this.hp - 1));
            this.renderer?.penguinRig?.triggerTimingTeethHitFx?.(fallenPairIndex);
        }
        if (prevHp > 0 && this.hp <= 0) {
            this.beginDeath({ reason: 'HP_DEPLETED' });
        }
    }

    handleResolvedItem(data = {}) {
        const scoreDelta = Math.max(0, Math.floor(data.scoreDelta || 0));
        const coinsDelta = Math.max(0, Math.floor(data.coinsDelta || 0));
        const damage = Math.max(0, Math.floor(data.damage || 0));
        const stunMs = Math.max(0, Math.floor(data.stunMs || 0));

        if ((data.effect === 'swallow' || data.effect === 'action-swallow' || data.effect === 'swallow-heavy') && this.audio?.playSwallow) {
            this.audio.playSwallow();
            this.renderer?.penguinRig?.triggerSwallowPulse?.();
        } else if ((data.effect === 'crush' || data.effect === 'action-bite' || data.effect === 'bite-food') && this.audio?.playJawClose) {
            this.audio.playJawClose();
            this.renderer?.penguinRig?.triggerAutoBiteCrunch?.();
        }

        if (data.actionUsed) {
            this.renderer?.ui?.triggerActionSuccessFx?.();
        }
        if (this.shouldShowEatRipple(data)) {
            this.renderer?.showEatRipple?.(data.x, data.y, data.itemKind);
        }

        if (scoreDelta > 0) {
            this.score += scoreDelta;
            eventBus.emit('FOOD_EATEN', data);
            const incomeBonus = this.perks?.getCoinIncomeBonusPer10Score?.() || 0;
            if (incomeBonus > 0 && this.score > 0 && this.score % 10 === 0) {
                this.perks.addCoins(incomeBonus);
                this.runCoinsEarned += incomeBonus;
                this.persistProgressionSoon();
            }
        }

        if (coinsDelta > 0) {
            this.perks.addCoins(coinsDelta);
            this.runCoinsEarned += coinsDelta;
            this.renderer?.showFloatingCoinBonus?.(data.x, data.y, coinsDelta);
            this.persistProgressionSoon();
        }

        if (damage > 0) {
            this.applyDamage(damage);
        }

        if (stunMs > 0) {
            this.applyStun(stunMs);
        }

        if (data.fatal) {
            this.beginDeath({ reason: data.fatalReason || 'ITEM_FATAL' });
        }

        this.updateUI();
    }

    shouldShowEatRipple(data = {}) {
        if (data.fatal) return false;
        const effect = String(data.effect || '');
        if (effect === 'swallow' || effect === 'swallow-heavy' || effect === 'action-swallow') return true;
        if (effect === 'crush' || effect === 'bite-food' || effect === 'action-bite' || effect === 'bite-coin') return true;
        return false;
    }

    // Запуск "смерти" с задержкой (чтобы показать анимацию столкновения)
    beginDeath(meta = null) {
        // Дублирующий safeguard: если щит активен, любой вход в смерть должен быть поглощён.
        if (this.absorbHitWithShield()) {
            this.updateUI();
            return;
        }
        if (this.deathInProgress) return;
        if (this.state !== 'RUNNING') return;
        this.deathInProgress = true;
        this.state = 'DYING';
        const jammedDeath = meta?.reason === 'TEETH_JAMMED' || meta?.reason === 'MISSED_CHOMP' || meta?.reason === 'SWALLOW_STUCK';
        if (this.audio) {
            if (jammedDeath && typeof this.audio.playJawBroke === 'function') {
                this.audio.playJawBroke();
            } else if (typeof this.audio.playFrontCrush === 'function') {
                this.audio.playFrontCrush();
            }
        }
        if (jammedDeath) {
            this.renderer?.penguinRig?.triggerTimingTeethHitFx?.();
        }
        try {
            if (jammedDeath) {
                this.renderer?.freezeMouthInPlace?.();
                this.renderer?.pauseBeltUpdate?.();
            } else {
                this.renderer?.stopAllBites?.();
                this.renderer?.setPenguinGameOverState?.();
            }
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
        const now = Date.now();
        const slowSpellCount = this.perks?.getSpellCount?.('slow') ?? this.perks?.slowSpellCount ?? 0;
        const shieldSpellCount = this.perks?.getSpellCount?.('shield') ?? this.perks?.shieldSpellCount ?? 0;
        return {
            timer: this.timer,
            perks: this.perks,
            streak: Math.max(0, this.coinRushProgress),
            streakPoints: Math.max(0, this.coinRushProgress),
            slowSpellCount,
            shieldSpellCount,
            coins: this.perks?.coins ?? 0,
            score: this.score || 0,
            bestScore: this.bestScore,
            gameStatus: this.state,
            soundMuted: this.soundMuted,
            leaderboardRank: this._getLeaderboardRankForHUD(),
            mode: this.currentMode,
            hp: this.hp,
            maxHp: this.maxHp,
            stunned: this.isStunned(),
            stunRemainingMs: Math.max(0, (this.stunUntil || 0) - now),
            inputLocked: this.isInputLocked(),
            shieldActive: !!this.shieldActive,
            shieldHitsRemaining: Math.max(0, this.shieldHitsRemaining || 0),
            slowCooldownRemainingMs: Math.max(0, (this.slowCooldownUntil || 0) - now),
            shieldCooldownRemainingMs: Math.max(0, (this.shieldCooldownUntil || 0) - now),
            coinRushProgress: Math.max(0, this.coinRushProgress || 0),
            coinRushTarget: Math.max(10, this.coinRushTarget || 10),
            coinRushActive: !!this.coinRushActive,
            spellShopCosts: this.perks ? { ...this.perks.spellShopCosts } : undefined
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
        if (Date.now() < (this.slowCooldownUntil || 0)) return;
        const ok = this.perks.useSlowDown();
        if (!ok) return;
        if (this.timer && typeof this.timer.activateSlowDown === 'function') {
            const durationSec = 10;
            this.timer.activateSlowDown(durationSec);
            if (this.audio && typeof this.audio.playSlowSpell === 'function') {
                this.audio.playSlowSpell();
            }

            const safetyMultiplier = this.perks?.getSlowSafetyMultiplier?.() || 0;
            if (safetyMultiplier > 0) {
                this.activateShield({ bySlowSafety: true, customDurationMs: durationSec * 1000 * safetyMultiplier, consumeSpell: false });
            }
        }
        const cdMultiplier = this.perks?.getSlowCooldownMultiplier?.() || 1;
        this.slowCooldownUntil = Date.now() + Math.round(this.slowCooldownBaseMs * cdMultiplier);
        this.persistProgressionSoon();
        this.saveSnapshot();
        this.updateUI();
    }

    useShield() {
        if (this.state !== 'RUNNING') return;
        if (this.shieldActive) return;
        if (Date.now() < (this.shieldCooldownUntil || 0)) return;
        this.activateShield({ bySlowSafety: false, consumeSpell: true });
        this.persistProgressionSoon();
        this.saveSnapshot();
        this.updateUI();
    }

    activateShield({ bySlowSafety = false, customDurationMs = 0, consumeSpell = true } = {}) {
        if (consumeSpell) {
            if (!this.perks?.canUseShield?.() || !this.perks.useShield()) return false;
        }
        this.shieldActive = true;
        this.shieldStartedBySlowSafety = !!bySlowSafety;
        this.shieldHitsRemaining = 1 + (this.perks?.getShieldExtraHits?.() || 0);
        if (customDurationMs > 0) {
            this.shieldExpiresAt = Date.now() + customDurationMs;
        } else {
            this.shieldExpiresAt = 0;
        }
        if (this.audio && typeof this.audio.playShieldSpell === 'function') {
            this.audio.playShieldSpell();
        }
        return true;
    }

    deactivateShield({ startCooldown = true } = {}) {
        if (!this.shieldActive) return;
        const shouldStartCooldown = startCooldown && !this.shieldStartedBySlowSafety;
        this.shieldActive = false;
        this.shieldStartedBySlowSafety = false;
        this.shieldHitsRemaining = 0;
        this.shieldExpiresAt = 0;
        if (shouldStartCooldown) {
            const mult = this.perks?.getShieldCooldownMultiplier?.() || 1;
            this.shieldCooldownUntil = Date.now() + Math.round(this.shieldCooldownBaseMs * mult);
        }
    }

    absorbHitWithShield() {
        if (!this.shieldActive) return false;
        this.shieldHitsRemaining = Math.max(0, (this.shieldHitsRemaining || 0) - 1);
        const depleted = this.shieldHitsRemaining <= 0;
        if (depleted && this.audio && typeof this.audio.playShieldAbsorb === 'function') {
            this.audio.playShieldAbsorb();
        }
        if (depleted) {
            this.deactivateShield({ startCooldown: true });
        }
        // В collisionEngine на первом "смертельном" контакте ставится deathTriggered=true.
        // Если удар поглощён щитом, нужно снять этот lock, иначе коллизии/поедание замирают.
        this.renderer?.collisionEngine?.reset?.();
        this.persistProgressionSoon();
        this.saveSnapshot();
        return true;
    }

    updateShieldStateByTime() {
        if (!this.shieldActive) return;
        if (this.shieldExpiresAt > 0 && Date.now() >= this.shieldExpiresAt) {
            this.deactivateShield({ startCooldown: false });
        }
    }

    activateCoinRush() {
        if (this.state !== 'RUNNING') return false;
        if (this.coinRushActive) return false;
        if ((this.coinRushProgress || 0) < (this.coinRushTarget || 10)) return false;

        this.coinRushActive = true;
        this.coinRushEndsAt = Date.now() + this.coinRushDurationMs;
        this.coinRushProgress = 0;
        this.coinRushTarget = Math.max(10, (this.coinRushTarget || 10) + this.coinRushStep);
        if (this.audio && typeof this.audio.playCoinRush === 'function') {
            this.audio.playCoinRush();
        }
        this.renderer?.refreshVisibleItemTypes?.();
        this.updateUI();
        this.saveSnapshot();
        return true;
    }

    updateCoinRushStateByTime() {
        if (!this.coinRushActive) return;
        if (Date.now() < (this.coinRushEndsAt || 0)) return;
        this.coinRushActive = false;
        this.coinRushEndsAt = 0;
        if (this.audio && typeof this.audio.stopCoinRush === 'function') {
            this.audio.stopCoinRush();
        }
        // Не вызываем refreshVisibleItemTypes: уже заспавненные монеты остаются монетами,
        // новые объекты будут создаваться как еда/монета по value в ensureFoodCircle.
        this.updateUI();
    }

    isCoinRushActive() {
        return !!this.coinRushActive;
    }

    resetCoinRushStreak() {
        if ((this.coinRushProgress || 0) === 0) return;
        this.coinRushProgress = 0;
    }

    // Пауза (повторное нажатие при открытой паузе — закрывает её)
    pause() {
        if (this.getActiveOverlayId() === 'pause') {
            this.closePauseOverlay();
            return;
        }
        this.openPauseOverlay();
    }

    // Резюм
    async resume() {
        this.closePauseOverlay();
    }

    // Game Over
    gameOver(meta = null) {
        if (this.state !== 'RUNNING' && this.state !== 'DYING') return;
        
        this.state = 'GAME_OVER';
        this.deathInProgress = false;
        if (this.audio && typeof this.audio.stopCoinRush === 'function') {
            this.audio.stopCoinRush();
        }
        this.audio.pause();
        if (this.audio && typeof this.audio.playGameOverJingle === 'function') {
            this.audio.playGameOverJingle();
        }

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
        
        this.showGameOverOverlay(score, this.bestScore, this.runCoinsEarned || 0);
        eventBus.emit('DEATH');
        
        // Очистка снапшота
        this.storage.clearSnapshot();
        this.gamePush.saveSnapshot(null);
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
        this.hideGameOverOverlay();
        this.restart();
        this.start();
    }

    // Рестарт
    restart() {
        this.state = 'MENU';
        this._pausedByOverlay = false;
        this._pauseStartTime = null;
        this.timer.reset();
        this.perks.reset();
        this.audio.reset();
        this.storage.clearSnapshot();
        this.runCoinsEarned = 0;
        this.slowCooldownUntil = 0;
        this.shieldCooldownUntil = 0;
        this.shieldActive = false;
        this.shieldHitsRemaining = 0;
        this.shieldExpiresAt = 0;
        this.shieldStartedBySlowSafety = false;
        this.coinRushProgress = 0;
        this.coinRushTarget = 10;
        this.coinRushActive = false;
        this.coinRushEndsAt = 0;

        // Сброс состояния смерти
        this.deathInProgress = false;
        this.score = 0;
        this.hp = this.maxHp;
        this.currentMode = 'swallow';
        this.stunUntil = 0;
        this.renderer?.resetStripWindow?.();
        this.syncGameplayPresentation();
        this.updateUI();
        
        this.hideGameOverOverlay();
        while (this.topOverlayId) {
            this.closeTopOverlay();
        }
        
        // Показываем стартовый экран
        this.showStartScreenOverlay();
    }

    // Сохранение снапшота
    saveSnapshot() {
        const snapshot = this.buildSnapshotPayload();
        this.storage.saveSnapshot(snapshot);
    }

    buildSnapshotPayload() {
        return {
            version: 2,
            timestamp: Date.now(),
            timer: this.timer.toSnapshot(),
            progression: this.perks.toSnapshot(),
            run: {
                score: this.score || 0,
                runCoinsEarned: this.runCoinsEarned || 0,
                slowCooldownUntil: this.slowCooldownUntil || 0,
                shieldCooldownUntil: this.shieldCooldownUntil || 0,
                shieldActive: !!this.shieldActive,
                shieldHitsRemaining: this.shieldHitsRemaining || 0,
                shieldExpiresAt: this.shieldExpiresAt || 0,
                shieldStartedBySlowSafety: !!this.shieldStartedBySlowSafety,
                coinRushProgress: this.coinRushProgress || 0,
                coinRushTarget: this.coinRushTarget || 10,
                coinRushActive: !!this.coinRushActive,
                coinRushEndsAt: this.coinRushEndsAt || 0,
                hp: this.hp || this.maxHp,
                maxHp: this.maxHp || 4,
                currentMode: this.currentMode || 'swallow',
                stunUntil: this.stunUntil || 0
            }
        };
    }

    // Загрузка снапшота
    loadSnapshot() {
        const gpSnapshot = this.gamePush.getSnapshot();
        const localSnapshot = this.storage.loadSnapshot();
        if (!gpSnapshot) return localSnapshot;
        if (!localSnapshot) return gpSnapshot;
        const gpTs = Number(gpSnapshot?.timestamp || 0);
        const localTs = Number(localSnapshot?.timestamp || 0);
        return gpTs > localTs ? gpSnapshot : localSnapshot;
    }

    // Восстановление из снапшота
    restoreFromSnapshot(snapshot) {
        if (!snapshot) return;
        
        // Проверка актуальности (не старше 24 часов)
        const age = Date.now() - (snapshot.timestamp || 0);
        if (age > 24 * 60 * 60 * 1000) {
            this.storage.clearSnapshot();
            this.gamePush.saveSnapshot(null);
            return;
        }
        
        // Восстанавливаем данные, но НЕ запускаем игру
        this.timer.fromSnapshot(snapshot.timer || {});
        this.perks.fromSnapshot(snapshot.progression || snapshot.perks || {});
        const run = snapshot.run || {};
        this.score = Math.max(0, Math.floor(run.score || 0));
        this.runCoinsEarned = Math.max(0, Math.floor(run.runCoinsEarned || 0));
        this.slowCooldownUntil = Math.max(0, Math.floor(run.slowCooldownUntil || 0));
        this.shieldCooldownUntil = Math.max(0, Math.floor(run.shieldCooldownUntil || 0));
        this.shieldActive = !!run.shieldActive;
        this.shieldHitsRemaining = Math.max(0, Math.floor(run.shieldHitsRemaining || 0));
        this.shieldExpiresAt = Math.max(0, Math.floor(run.shieldExpiresAt || 0));
        this.shieldStartedBySlowSafety = !!run.shieldStartedBySlowSafety;
        this.coinRushProgress = Math.max(0, Math.floor(run.coinRushProgress || 0));
        this.coinRushTarget = Math.max(10, Math.floor(run.coinRushTarget || 10));
        this.coinRushActive = !!run.coinRushActive;
        this.coinRushEndsAt = Math.max(0, Math.floor(run.coinRushEndsAt || 0));
        this.maxHp = Math.max(1, Math.floor(run.maxHp || this.maxHp || 4));
        this.hp = Math.max(0, Math.min(this.maxHp, Math.floor(run.hp ?? this.maxHp)));
        this.currentMode = run.currentMode === 'bite' ? 'bite' : 'swallow';
        this.stunUntil = Math.max(0, Math.floor(run.stunUntil || 0));
        this.syncGameplayPresentation();
        
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
                this.leaderboardData.displayBestScore = this.bestScore;

                this.updateUI();
                if (this.renderer?.isLeaderboardModalOpen?.()) {
                    this.renderer.renderLeaderboardModal(this.leaderboardData);
                }
            }
        })();

        return this._leaderboardRefreshInFlight;
    }

    getActiveOverlayId() {
        return this.topOverlayId || this.middleOverlayId || null;
    }

    _getOverlayElement(overlayId) {
        const map = {
            pause: 'pause-screen',
            language: 'language-screen',
            leaderboard: 'leaderboard-modal',
            perks: 'perks-modal',
            gameover: 'game-over-screen',
            start: 'start-screen'
        };
        const id = map[overlayId];
        return id ? document.getElementById(id) : null;
    }

    _applyOverlayStackOrder() {
        const ids = ['pause', 'language', 'leaderboard', 'perks', 'gameover', 'start'];
        ids.forEach((id) => {
            const el = this._getOverlayElement(id);
            if (!el) return;
            el.dataset.overlayActive = '0';
            el.style.zIndex = '';
        });

        if (this.middleOverlayId) {
            const middleEl = this._getOverlayElement(this.middleOverlayId);
            if (middleEl) {
                middleEl.style.zIndex = '210';
                middleEl.dataset.overlayActive = this.topOverlayId ? '0' : '1';
            }
        }

        if (this.topOverlayId) {
            const topEl = this._getOverlayElement(this.topOverlayId);
            if (topEl) {
                topEl.style.zIndex = '220';
                topEl.dataset.overlayActive = '1';
            }
        }
    }

    _pauseGameplayForOverlay() {
        if (this.state !== 'RUNNING') return;
        this._pausedByOverlay = true;
        this._pauseStartTime = performance.now();
        this.state = 'PAUSED';
        if (this.timer) this.timer.lastStepTime = 0;
        this.audio.pause();
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.renderer?.stopCircleAnimation?.();
        this.renderer?.stopStripAnimation?.();
        this.renderer?.pauseBeltUpdate?.();
        eventBus.emit('PAUSE', { source: 'game' });
    }

    _resumeGameplayAfterOverlay() {
        if (this.state !== 'PAUSED' || !this._pausedByOverlay) return;
        if (this.topOverlayId || this.middleOverlayId) return;

        this._pausedByOverlay = false;
        this.state = 'RUNNING';
        if (this.timer) this.timer.lastStepTime = 0;
        this.lastUpdateTime = performance.now();
        if (this.renderer?.resumeBeltUpdate && this._pauseStartTime) {
            const pauseDuration = performance.now() - this._pauseStartTime;
            this.renderer.resumeBeltUpdate(pauseDuration);
        }
        this._pauseStartTime = null;
        this.audio.play();
        this.gameLoop();
        eventBus.emit('RESUME', { source: 'game' });
    }

    _openMiddleOverlay(overlayId, { show = true } = {}) {
        if (this.middleOverlayId === overlayId) return false;
        if (this.middleOverlayId) {
            this._closeMiddleOverlay(this.middleOverlayId, { hide: true, resumeWhenEmpty: false });
        }
        this._pauseGameplayForOverlay();
        this.middleOverlayId = overlayId;
        if (show) {
            switch (overlayId) {
                case 'start': this.renderer?.showStartScreen?.(this.getGameState()); break;
                case 'gameover': this.renderer?.showGameOverScreen?.(this.score || 0, this.bestScore || 0, this.runCoinsEarned || 0); break;
                default: break;
            }
        }
        this._applyOverlayStackOrder();
        return true;
    }

    _closeMiddleOverlay(overlayId, { hide = true, resumeWhenEmpty = true } = {}) {
        if (this.middleOverlayId !== overlayId) return false;
        this.middleOverlayId = null;
        if (hide) {
            switch (overlayId) {
                case 'gameover': this.renderer?.hideGameOverScreen?.(); break;
                case 'start': this.renderer?.hideStartScreen?.(); break;
                default: break;
            }
        }
        this._applyOverlayStackOrder();
        if (resumeWhenEmpty) this._resumeGameplayAfterOverlay();
        return true;
    }

    _openTopOverlay(overlayId, { show = true, replace = true } = {}) {
        if (this.topOverlayId === overlayId) return false;
        this._pauseGameplayForOverlay();
        if (replace && this.topOverlayId) {
            this._closeTopOverlay(this.topOverlayId, { hide: true, resumeWhenEmpty: false });
        }
        this.topOverlayId = overlayId;
        if (show) {
            switch (overlayId) {
                case 'pause': this.renderer?.showPauseScreen?.(); break;
                case 'language': this.renderer?.ui?.showLanguageScreen?.(); break;
                case 'leaderboard': this.renderer?.showLeaderboardModal?.(); break;
                case 'perks': this.renderer?.ui?.showPerksModal?.(); break;
                default: break;
            }
        }
        this._applyOverlayStackOrder();
        return true;
    }

    _closeTopOverlay(overlayId, { hide = true, resumeWhenEmpty = true } = {}) {
        if (this.topOverlayId !== overlayId) return false;
        this.topOverlayId = null;
        if (hide) {
            switch (overlayId) {
                case 'pause': this.renderer?.hidePauseScreen?.(); break;
                case 'language': this.renderer?.ui?.hideLanguageScreen?.(); break;
                case 'leaderboard': this.renderer?.hideLeaderboardModal?.(); break;
                case 'perks': this.renderer?.ui?.hidePerksModal?.(); break;
                default: break;
            }
        }
        this._applyOverlayStackOrder();
        if (resumeWhenEmpty) this._resumeGameplayAfterOverlay();
        return true;
    }

    closeTopOverlay() {
        if (!this.topOverlayId) return false;
        return this._closeTopOverlay(this.topOverlayId);
    }

    openPauseOverlay() {
        const wasRunning = this.state === 'RUNNING';
        const opened = this._openTopOverlay('pause');
        if (opened && wasRunning) {
            this.saveSnapshot();
            this.gamePush.saveSnapshot(this.buildSnapshotPayload());
        }
    }

    closePauseOverlay() {
        this._closeTopOverlay('pause');
    }

    openLanguageOverlay() {
        this._openTopOverlay('language');
    }

    closeLanguageOverlay() {
        if (this._closeTopOverlay('language')) {
            // Возвращаемся в экран паузы как в "родительское" меню
            this._openTopOverlay('pause');
        }
    }

    showStartScreenOverlay() {
        this._openMiddleOverlay('start');
    }

    hideStartScreenOverlay() {
        if (!this._closeMiddleOverlay('start', { hide: true, resumeWhenEmpty: false })) {
            this.renderer?.hideStartScreen?.();
        }
    }

    showGameOverOverlay(score, bestScore, coins) {
        this.renderer?.showGameOverScreen?.(score, bestScore, coins);
        this._openMiddleOverlay('gameover', { show: false });
    }

    hideGameOverOverlay() {
        this.renderer?.hideGameOverScreen?.();
        this._closeMiddleOverlay('gameover', { hide: false, resumeWhenEmpty: false });
    }

    openLeaderboardModal() {
        this.refreshLeaderboard('open');
        this.leaderboardData.displayBestScore = this.bestScore;
        this.renderer?.renderLeaderboardModal?.(this.leaderboardData);
        this._openTopOverlay('leaderboard');
    }

    closeLeaderboardModal() {
        this._closeTopOverlay('leaderboard');
    }

    mergeProgression(localProgression, cloudProgression) {
        if (!localProgression && !cloudProgression) return null;
        if (!localProgression) return cloudProgression;
        if (!cloudProgression) return localProgression;
        const localTs = Number(localProgression?.updatedAt || 0);
        const cloudTs = Number(cloudProgression?.updatedAt || 0);
        return cloudTs > localTs ? cloudProgression : localProgression;
    }

    persistProgressionSoon() {
        const payload = this.perks.toSnapshot();
        this.storage.saveProgression(payload);

        if (this.progressionSyncDebounceTimer) {
            window.clearTimeout(this.progressionSyncDebounceTimer);
        }
        this.progressionSyncDebounceTimer = window.setTimeout(() => {
            this.progressionSyncDebounceTimer = null;
            this.gamePush.saveProgression(payload);
        }, 1500);
    }

    openPerksModal() {
        this.renderer?.ui?.renderPerksModal?.(this.getGameState(), this.perks.getCatalog());
        this._openTopOverlay('perks');

        this.renderer?.ui?.bindPerksModalActions?.({
            onClose: () => this.closePerksModal(),
            onUpgrade: (perkId) => this.upgradePerk(perkId)
        });
    }

    closePerksModal() {
        this._closeTopOverlay('perks');
    }

    upgradePerk(perkId) {
        if (!this.perks?.upgradePerk?.(perkId)) return;
        this.persistProgressionSoon();
        this.updateUI();
        this.renderer?.ui?.updateStartGameScreen?.(this.getGameState());
        this.renderer?.ui?.renderPerksModal?.(this.getGameState(), this.perks.getCatalog());
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
        try {
            await this.gamePush?.clearProgression?.();
        } catch (e) {
            // ignore
        }

        this.bestScore = 0;
        this.score = 0;
        this.perks = new PerkSystem();
        this.updateUI();

        // Обновим лидерборд, чтобы подтянуть обнулённый счёт
        this.refreshLeaderboard('debugReset');

        // Небольшой визуальный фидбек в консоли
        // eslint-disable-next-line no-console
        console.log('[DEBUG] Progress has been reset (local + GamePush)');
    }
}
