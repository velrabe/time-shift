// Главный класс игры
class Game {
    constructor() {
        this.timer = new Timer();
        this.director = new Director();
        this.perks = new PerkSystem();
        this.audio = new AudioSystem();
        this.storage = new StorageSystem();
        this.gamePush = new GamePushSystem();
        this.renderer = new Renderer();
        
        this.state = 'MENU'; // MENU, RUNNING, PAUSED, GAME_OVER, COUNTDOWN
        this.bestScore = 0;
        this.soundMuted = false;
        this.lastSnapshotTime = 0;
        this.snapshotInterval = 1000; // сохранять каждую секунду
        
        this.animationFrameId = null;
        this.lastUpdateTime = 0;

        // Ограничение частоты действий игрока (иначе можно "заморозить" авто-тик и всегда выигрывать хоткеями)
        this.nextActionAllowedAtMs = 0;
        this.lastActionAtMs = 0;
        this.lastActionCooldownMs = 0;

        // Отложенная смерть (для анимации столкновения)
        this.deathInProgress = false;
        
        // Смерть "после приземления" на хоткей-перемотке
        this.pendingShiftDeath = null; // { animId, meta }

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
                // Передаем director в данные события для обновления ленты
                if (data) {
                    data.director = this.director;
                }
                this.onTickStep(data);
            }
        });

        eventBus.on('SHIFT_USED', (data) => {
            this.onShiftUsed(data);
        });

        // События директора
        eventBus.on('BUTTONS_UPDATED', (data) => {
            this.renderer.renderControlButtons(data.buttons);
        });

        // События кнопок
        eventBus.on('BUTTON_CLICKED', (data) => {
            if (data && typeof data.delta === 'number') {
                this.onButtonClicked(data.delta);
            }
        });

        // Новая кнопка открытия рта
        eventBus.on('MOUTH_BUTTON_CLICKED', () => {
            if (this.state === 'RUNNING' && this.renderer) {
                this.renderer.openMouth(500); // Открываем рот на 500мс
            }
        });
        
        // Делаем экземпляр игры доступным глобально для обработчиков
        window.gameInstance = this;

        // События паузы/резюма
        eventBus.on('PAUSE', () => {
            this.pause();
        });

        eventBus.on('RESUME', () => {
            this.resume();
        });

        // Game over по коллизии "danger касается головы пингвина"
        eventBus.on('PENGUIN_DANGER_COLLISION', (data) => {
            if (this.state !== 'RUNNING') return;
            this.beginDeath({ reason: 'PENGUIN_DANGER_COLLISION', dangerStart: data?.dangerStart });
        });

        // Счёт и streak от реально съеденных объектов
        eventBus.on('FOOD_EATEN', (data) => {
            if (this.state !== 'RUNNING') return;
            const kind = data?.kind === 'big' ? 'big' : 'small';
            const value = Number.isFinite(data?.value) ? data.value : null;

            // +1 очко за ЛЮБОЙ съеденный объект
            this.score = (this.score || 0) + 1;

            // Streak только за большие объекты
            if (kind === 'big' && this.perks && typeof this.perks.addStreak === 'function') {
                this.perks.addStreak(1);
            }

            // При желании score/streak можно логировать для дебага
            // console.debug('FOOD_EATEN', kind, this.score, this.perks.streakPoints);

            this.updateUI();
        });

        // Горячие клавиши
        document.addEventListener('keydown', (e) => {
            if (this.state !== 'RUNNING') return;
            
            const key = e.key;
            if (key === ' ' || key === 'Spacebar') {
                e.preventDefault();
                // Кнопка открытия рта
                if (this.renderer) {
                    this.renderer.openMouth(500);
                }
            } else if (key === 'Escape') {
                e.preventDefault();
                this.pause();
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

        const slowDownBtn = document.getElementById('slowdown-btn');
        if (slowDownBtn) {
            slowDownBtn.addEventListener('click', () => this.useSlowDown());
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
            
            // Сбрасываем изображения пингвина в нормальное состояние
            this.renderer?.resetPenguinState?.();
            
            this.state = 'COUNTDOWN';
            this.timer.reset();
            this.director = new Director();
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
        this.lastRenderedButtons = null;
        this.lastRenderedCurrent = null;
        this.lastPerksRender = 0;
        this.userInteracted = true; // Помечаем как взаимодействовал (клик на PLAY)

        // Сброс ограничений/смерти для новой сессии
        this.nextActionAllowedAtMs = 0;
        this.lastActionAtMs = 0;
        this.lastActionCooldownMs = 0;
        this.deathInProgress = false;
        
        // Генерация кнопки управления (одна кнопка для открытия рта)
        if (this.renderer) {
            this.renderer.renderControlButtons([]);
        }
        
        // Запуск аудио при старте таймера (после взаимодействия пользователя)
        this.audio.play();
        
        // Сбрасываем состояние рендера перед новой сессией
        if (this.renderer) {
            if (typeof this.renderer.stopStripAnimation === 'function') this.renderer.stopStripAnimation();
            if (typeof this.renderer.stopCircleAnimation === 'function') this.renderer.stopCircleAnimation();
            if (typeof this.renderer.resetStripWindow === 'function') {
                this.renderer.resetStripWindow();
            }
        }

        // Рендерим ленту для начального состояния
        this.renderer.renderNumberStrip(this.timer, this.director);
        
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
        
        // Обновление директора
        const gameState = this.getGameState();
        this.director.update(gameState);
        if (this.state !== 'RUNNING') return;
        
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
        const gameState = this.getGameState();
        // Лента/круг теперь управляются событийно внутри Renderer (TICK_STEP/SHIFT_USED),
        // чтобы корректно анимировать "конвейер" и не конфликтовать с gameLoop.
        
        // Кнопка управления (всегда одна - открытие рта)
        // В новой системе не используем director для кнопок
        if (this.renderer && this.renderer.controlButtons) {
            const hasButton = this.renderer.controlButtons.querySelector('.control-btn');
            if (!hasButton) {
                this.renderer.renderControlButtons([]);
            }
        }
        
        // UI
        this.updateUI();

        // Визуализация кулдауна на действиях (в реальном времени, независимо от перерендера кнопок)
        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        let cooldownProgress = 1;
        if (this.lastActionCooldownMs > 0) {
            cooldownProgress = Math.max(0, Math.min(1, (nowMs - this.lastActionAtMs) / this.lastActionCooldownMs));
        }
        if (this.renderer && typeof this.renderer.updateActionCooldown === 'function') {
            this.renderer.updateActionCooldown(cooldownProgress);
        }

        // Конвейер: позиция ленты обновляется каждый кадр из дробной позиции таймера
        if (this.renderer && typeof this.renderer.updateConveyor === 'function') {
            this.renderer.updateConveyor(this.timer, this.director);
        }

        const shiftActiveBefore = !!this.timer?.shiftVisual;
        // ВАЖНО: getPosition() может завершить shiftVisual (она вызывает getShiftOffset()).
        const pos = (typeof this.timer.getPosition === 'function') ? this.timer.getPosition(nowMs) : this.timer.current;
        const shiftActiveAfter = !!this.timer?.shiftVisual;

        // Если хоткей-анимация закончилась в этот кадр — проверяем смерть по "приземлению"
        if (this.state === 'RUNNING' && !this.deathInProgress && shiftActiveBefore && !shiftActiveAfter && this.pendingShiftDeath) {
            const lastAnimId = this.timer?.shiftAnimId || 0;
            if (this.pendingShiftDeath.animId === lastAnimId) {
                this.beginDeath(this.pendingShiftDeath.meta);
            }
            this.pendingShiftDeath = null;
        }

        // В conveyor/physics режиме смертельная коллизия считается ТОЛЬКО физикой в Renderer
        // (пересечение с челюстью). Старую логику "fatal window by position" отключаем,
        // иначе game over выглядит случайным относительно объектов на ленте.
        const conveyorEnabled = !!this.renderer?._conveyorEnabled;
        if (!conveyorEnabled) {
            // Фатальная коллизия по дробной позиции (legacy):
            // - для auto: проверяем всегда
            // - для хоткей-анимации: НЕ проверяем "на пролёте", только на приземлении (выше)
            if (this.state === 'RUNNING' && !this.deathInProgress && !shiftActiveBefore && !shiftActiveAfter && this.director?.getFatalWindowAtPosition) {
                const w = this.director.getFatalWindowAtPosition(pos);
                if (w) {
                    this.beginDeath({ reason: 'FATAL_DANGER', dangerStart: w.start, position: pos });
                }
            }
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

        // Блокируем дальнейшие действия игрока
        this.nextActionAllowedAtMs = Infinity;

        // Даём игре доехать до финальной позы: через секунду показываем экран Game Over.
        window.setTimeout(() => {
            // Разрешаем gameOver из состояния DYING
            this.gameOver(meta);
        }, 1000);
    }
    
    // Проверка необходимости рендера кнопок
    shouldRenderButtons() {
        const currentButtonsStr = JSON.stringify(this.director.currentButtons);
        return !this.lastRenderedButtons || this.lastRenderedButtons !== currentButtonsStr;
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
            director: this.director,
            perks: this.perks,
            streak: this.perks?.getStreakPoints ? this.perks.getStreakPoints() : (this.perks?.streakPoints || 0),
            streakPoints: this.perks.getStreakPoints ? this.perks.getStreakPoints() : (this.perks.streakPoints || 0),
            score: this.score || 0,
            bestScore: this.bestScore,
            gameStatus: this.state,
            soundMuted: this.soundMuted
        };
    }

        // Обработка шага таймера (legacy, оставлена для совместимости событийной модели)
        // В conveyor/physics-режиме логика смертей и streak перенесена в Renderer/PerkSystem.
        onTickStep(_data) {
            // Ничего не делаем — оставлено намеренно, чтобы не дублировать логику.
            return;
        }

    // Обработка использования сдвига
    onShiftUsed(data) {
        // Обновление кнопок после сдвига
        const gameState = this.getGameState();
        this.director.currentButtons = [];
        this.director.ensureButtons(gameState);
        if (this.director.currentButtons.length > 0) {
            this.renderer.renderControlButtons(this.director.currentButtons);
        }
    }

    // Обработка клика по кнопке
    onButtonClicked(delta) {
        if (this.state !== 'RUNNING') {
            return;
        }

        // Кулдаун: не даём спамить и "застопорить" геймплей
        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (nowMs < this.nextActionAllowedAtMs) return;

        const stepMs = Math.max(150, (this.timer?.calculateStepDuration?.() ?? 1.0) * 1000);
        // примерно 1 действие на тик (чуть быстрее, чтобы было ощущение контроля)
        const cdMs = stepMs * 0.75;
        this.lastActionAtMs = nowMs;
        this.lastActionCooldownMs = cdMs;
        this.nextActionAllowedAtMs = nowMs + cdMs;

        // Воспроизведение звуков эффектов
        if (this.audio.isPlaying) {
            if (delta < 0) {
                // Отрицательная дельта - звук перемотки назад
                this.audio.playBackSound();
            } else if (delta > 0) {
                // Положительная дельта - звук перемотки вперед
                this.audio.playForwardSound();
            }
        }

        const beforeAnimId = this.timer?.shiftAnimId || 0;
        this.timer.shift(delta);
        if (this.state !== 'RUNNING') return;

        // Если конечная точка перемотки фатальна — планируем смерть ПОСЛЕ приземления (после окончания анимации).
        // Во время перемещения смерть не должна срабатывать.
        if (this.director?.getFatalWindowAtPosition && typeof this.timer.getTickDistanceProgress === 'function') {
            const nowMs2 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const distProgress = this.timer.getTickDistanceProgress(nowMs2);
            const landingPos = this.timer.current + (typeof this.timer.direction === 'number' ? this.timer.direction : 1) * distProgress;
            const w = this.director.getFatalWindowAtPosition(landingPos);
            const currentAnimId = this.timer?.shiftAnimId || beforeAnimId;
            if (w) {
                this.pendingShiftDeath = {
                    animId: currentAnimId,
                    meta: { reason: 'SHIFT_FATAL', dangerStart: w.start, position: landingPos }
                };
            } else {
                this.pendingShiftDeath = null;
            }
        }
        
        // Обновление кнопок
        const gameState = this.getGameState();
        this.director.currentButtons = [];
        this.director.ensureButtons(gameState);
        if (this.director.currentButtons.length > 0) {
            this.renderer.renderControlButtons(this.director.currentButtons);
        }
    }

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
        this.lastUpdateTime = performance.now();
        // После резюма снова разрешаем действия
        this.nextActionAllowedAtMs = 0;
        this.lastActionAtMs = 0;
        this.lastActionCooldownMs = 0;
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

        // Запоминаем danger window, в котором произошла смерть,
        // чтобы Continue мог вернуть игрока на точку ДО начала этого окна
        const hintedStart = (meta && typeof meta.dangerStart === 'number') ? meta.dangerStart : null;
        const deathWindow = this.director?.dangerWindows?.find(w => {
            if (hintedStart != null) return w.start === hintedStart;
            return this.timer.current >= w.start && this.timer.current < (w.start + w.length);
        });
        this.lastDeathDangerWindow = deathWindow ? {
            start: deathWindow.start,
            length: deathWindow.length,
            solutionDelta: deathWindow.solutionDelta
        } : null;

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
        
        // Обновление best score: используем новый счёт (по съеденным объектам),
        // а maxReached оставляем только как резервный fallback.
        const score = this.score || this.timer.maxReached;
        if (score > this.bestScore) {
            this.bestScore = score;
            this.storage.saveLocalBestScore(score);
            this.gamePush.saveBestScore(score);
        }
        
        // Проверка доступности Continue
        const canContinue = !!(this.perks && typeof this.perks.hasSecondLife === 'function' && this.perks.hasSecondLife());
        
        this.renderer.showGameOverScreen(score, canContinue);
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
        
        this.renderer.hideGameOverScreen();
        
        // Продолжаем с точки прямо ПЕРЕД началом danger zone, в которой произошла смерть.
        // Важно: НЕ очищаем dangerWindows, иначе Director сгенерирует новую "ленту".
        let safeValue = Math.max(0, this.timer.current - 5);

        const w =
            this.lastDeathDangerWindow ||
            this.director?.dangerWindows?.find(win =>
                this.timer.current >= win.start && this.timer.current < (win.start + win.length)
            );

        if (w && typeof w.start === 'number') {
            safeValue = Math.max(0, w.start - 1);
        }

        this.timer.current = safeValue;
        // Чтобы после Continue не было "мгновенного тика" из-за паузы на Game Over
        this.timer.lastStepTime = 0;

        // Обновляем кнопки под восстановленную позицию
        this.director.currentButtons = [];
        const gameState = this.getGameState();
        this.director.ensureButtons(gameState);
        if (this.director.currentButtons.length > 0) {
            this.renderer.renderControlButtons(this.director.currentButtons);
        }

        // Синхронизируем ленту и СРАЗУ запускаем круг (иначе до первого TICK_STEP будет "заморозка")
        if (this.renderer) {
            if (typeof this.renderer.stopStripAnimation === 'function') this.renderer.stopStripAnimation();
            if (typeof this.renderer.stopCircleAnimation === 'function') this.renderer.stopCircleAnimation();
            this.renderer.lastCurrentValue = null;
            if (typeof this.renderer.handleStepChange === 'function') {
                this.renderer.handleStepChange({
                    current: this.timer.current,
                    timer: this.timer,
                    director: this.director,
                    stepDurationSec: this.timer.calculateStepDuration(),
                    isAuto: true
                });
            } else {
                // Fallback: если API изменится
                if (typeof this.renderer.updateStripPosition === 'function') {
                    this.renderer.updateStripPosition(this.timer.current, null);
                }
                if (typeof this.renderer.updateStripClasses === 'function') {
                    this.renderer.updateStripClasses(this.timer.current, this.director);
                }
                if (typeof this.renderer.animateCircleAuto === 'function') {
                    this.renderer.animateCircleAuto(this.timer.calculateStepDuration());
                }
            }
        }

        // Использовали checkpoint — очищаем, чтобы не применять повторно
        this.lastDeathDangerWindow = null;
        
        this.state = 'RUNNING';
        this.lastUpdateTime = performance.now();
        // После Continue снова разрешаем действия
        this.nextActionAllowedAtMs = 0;
        this.lastActionAtMs = 0;
        this.lastActionCooldownMs = 0;
        this.deathInProgress = false;
        // Запускаем музыку
        this.audio.play();
        this.gameLoop();
    }

    // Рестарт
    restart() {
        this.state = 'MENU';
        this.timer.reset();
        this.director = new Director();
        this.perks.reset();
        this.audio.reset();
        this.storage.clearSnapshot();

        // Сброс ограничений/смерти
        this.nextActionAllowedAtMs = 0;
        this.lastActionAtMs = 0;
        this.lastActionCooldownMs = 0;
        this.deathInProgress = false;
        
        this.renderer.hideGameOverScreen();
        this.renderer.hidePauseScreen();
        
        // Показываем стартовый экран
        this.renderer.showStartScreen();
    }

    // Сохранение снапшота
    saveSnapshot() {
        const snapshot = {
            timer: this.timer.toSnapshot(),
            director: this.director.toSnapshot(),
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
        this.director.fromSnapshot(snapshot.director);
        this.perks.fromSnapshot(snapshot.perks);
        
        // Обновление best score из снапшота
        if (snapshot.timer && snapshot.timer.maxReached) {
            this.gamePush.updateBestScoreFromSnapshot(snapshot.timer.maxReached);
        }
        
        // НЕ запускаем игру автоматически - пользователь должен нажать PLAY
        // НЕ отображаем кнопки - они появятся только после старта игры
    }
}

