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
        this.lastSnapshotTime = 0;
        this.snapshotInterval = 1000; // сохранять каждую секунду
        
        this.animationFrameId = null;
        this.lastUpdateTime = 0;
        
        // Убеждаемся, что игра не запущена
        this.state = 'MENU';
        
        this.setupEventListeners();
    }

    // Инициализация
    async init() {
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
        
        // Обновление UI
        this.updateUI();
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
        
        // Делаем экземпляр игры доступным глобально для обработчиков
        window.gameInstance = this;

        // События перков
        eventBus.on('PERK_ACTIVATED', (data) => {
            this.onPerkActivated(data.perkId);
        });

        // События паузы/резюма
        eventBus.on('PAUSE', () => {
            this.pause();
        });

        eventBus.on('RESUME', () => {
            this.resume();
        });

        // Горячие клавиши
        document.addEventListener('keydown', (e) => {
            if (this.state !== 'RUNNING') return;
            
            const key = e.key;
            if (key >= '1' && key <= '4') {
                const index = parseInt(key) - 1;
                const buttons = this.director.currentButtons;
                if (buttons[index]) {
                    this.onButtonClicked(buttons[index].delta);
                }
            } else if (key === 'Escape' || key === ' ') {
                e.preventDefault();
                this.pause();
            }
        });

        // Кнопки UI
        const pauseBtn = document.getElementById('pause-btn');
        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => this.pause());
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

        // Ползунок громкости
        const volumeSlider = document.getElementById('volume-slider');
        const volumeValue = document.getElementById('volume-value');
        if (volumeSlider && volumeValue) {
            // Загружаем сохраненное значение громкости
            const savedVolume = this.storage.loadSettings()?.volume || 50;
            volumeSlider.value = savedVolume;
            volumeValue.textContent = `${savedVolume}%`;
            this.audio.setVolume(savedVolume / 100);
            
            volumeSlider.addEventListener('input', (e) => {
                const volume = parseInt(e.target.value);
                volumeValue.textContent = `${volume}%`;
                this.audio.setVolume(volume / 100);
                
                // Сохраняем настройку
                const settings = this.storage.loadSettings() || {};
                settings.volume = volume;
                this.storage.saveSettings(settings);
            });
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
        // Скрываем стартовый экран
        this.renderer.hideStartScreen();
        
        this.state = 'COUNTDOWN';
        this.timer.reset();
        this.director = new Director();
        this.perks.reset();
        this.audio.reset();
        
        // Обратный отсчет
        await this.renderer.showCountdown();
        
        this.state = 'RUNNING';
        this.lastUpdateTime = performance.now();
        this.lastSnapshotTime = Date.now();
        this.lastRenderedButtons = null;
        this.lastPerksRender = 0;
        this.userInteracted = true; // Помечаем как взаимодействовал (клик на PLAY)
        
        // Генерация начальных кнопок
        const gameState = this.getGameState();
        this.director.currentButtons = []; // Принудительно сбрасываем
        this.director.ensureButtons(gameState);
        if (this.director.currentButtons.length > 0) {
            this.renderer.renderControlButtons(this.director.currentButtons);
            this.lastRenderedButtons = JSON.stringify(this.director.currentButtons);
        }
        
        // Запуск аудио при старте таймера (после взаимодействия пользователя)
        this.audio.play();
        
        // Рендерим ленту для начального состояния (current = 0)
        this.renderer.renderNumberStrip(this.timer, this.director);
        
        // Устанавливаем правильную начальную позицию ленты для current = 0
        // И сразу запускаем анимацию для перехода к current = 1
        requestAnimationFrame(() => {
            // Устанавливаем начальную позицию для current = 0 мгновенно (без анимации)
            this.renderer.updateStripPosition(this.timer.current, null);
            
            // Запускаем анимацию круга для начального состояния
            const initialStepDuration = this.timer.calculateStepDuration();
            this.renderer.animateFocusZone(initialStepDuration);
            
        });
        
        // Запуск игрового цикла
        this.gameLoop();
    }

    // Игровой цикл
    gameLoop() {
        // Строгая проверка - только RUNNING запускает цикл
        if (this.state !== 'RUNNING') {
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
        
        // Проверка инверсии
        this.timer.checkInversion();
        
        // Обновление директора
        const gameState = this.getGameState();
        this.director.update(gameState);
        
        // Проверка опасности
        if (this.director.checkDanger(this.timer.current)) {
            this.gameOver();
            return;
        }
        
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
        
        // Лента чисел (рендерим каждый кадр для плавности, передаем director для истории)
        this.renderer.renderNumberStrip(this.timer, this.director);
        
        // Кнопки (рендерим только при изменении)
        if (this.director.currentButtons.length === 0) {
            this.director.ensureButtons(gameState);
        }
        // Рендерим кнопки только если они изменились
        if (this.director.currentButtons.length > 0 && this.shouldRenderButtons()) {
            this.renderer.renderControlButtons(this.director.currentButtons);
            this.lastRenderedButtons = JSON.stringify(this.director.currentButtons);
        }
        
        // Перки (рендерим реже)
        if (!this.lastPerksRender || Date.now() - this.lastPerksRender > 500) {
            const availablePerks = this.perks.getAvailablePerks(gameState);
            this.renderer.renderPerks(availablePerks);
            this.lastPerksRender = Date.now();
        }
        
        // UI
        this.updateUI();
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
            streak: this.perks.streak,
            dangerPassedStreak: this.perks.dangerPassedStreak,
            bestScore: this.bestScore
        };
    }

    // Обработка шага таймера
    onTickStep(data) {
        // Проверка прохождения опасного окна
        const passedWindows = this.director.dangerWindows.filter(window => {
            const end = window.start + window.length - 1;
            return end < this.timer.current;
        });
        
        if (passedWindows.length > 0) {
            this.perks.dangerPassedStreak++;
            eventBus.emit('DANGER_PASSED');
            this.director.onDangerPassed(this.timer.maxReached);
        }
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

        this.timer.shift(delta);
        
        // Проверка опасности после сдвига
        if (this.director.checkDanger(this.timer.current)) {
            this.gameOver();
            return;
        }
        
        // Обновление кнопок
        const gameState = this.getGameState();
        this.director.currentButtons = [];
        this.director.ensureButtons(gameState);
        if (this.director.currentButtons.length > 0) {
            this.renderer.renderControlButtons(this.director.currentButtons);
        }
    }

    // Обработка активации перка
    onPerkActivated(perkId) {
        if (this.state !== 'RUNNING' && this.state !== 'GAME_OVER') return;
        
        const gameState = this.getGameState();
        const result = this.perks.activatePerk(perkId, gameState);
        
        if (!result) return;
        
        if (result.type === 'continue') {
            this.continueAfterDeath();
        } else if (result.type === 'inversion') {
            this.timer.activateInversion(result.duration);
        }
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
        // Возобновляем музыку
        this.audio.play();
        this.gameLoop();
        eventBus.emit('RESUME');
    }

    // Game Over
    gameOver() {
        if (this.state !== 'RUNNING') return;
        
        this.state = 'GAME_OVER';
        this.audio.pause();
        
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        // Обновление best score
        const score = this.timer.maxReached;
        if (score > this.bestScore) {
            this.bestScore = score;
            this.storage.saveLocalBestScore(score);
            this.gamePush.saveBestScore(score);
        }
        
        // Проверка доступности Continue
        const gameState = this.getGameState();
        const canContinue = this.perks.getAvailablePerks(gameState).some(p => 
            p.id === 'continue' && p.charged
        );
        
        this.renderer.showGameOverScreen(score, canContinue);
        eventBus.emit('DEATH');
        
        // Очистка снапшота
        this.storage.clearSnapshot();
    }

    // Продолжение после смерти
    continueAfterDeath() {
        if (this.state !== 'GAME_OVER') return;
        
        this.renderer.hideGameOverScreen();
        
        // Восстановление на безопасное значение (до опасного окна)
        // Находим последнее пройденное окно или используем отступ
        let safeValue = Math.max(0, this.timer.current - 5);
        
        // Если есть пройденные окна, ставим после последнего
        if (this.director.passedDangerWindows.length > 0) {
            const lastWindow = this.director.passedDangerWindows[this.director.passedDangerWindows.length - 1];
            safeValue = Math.max(0, lastWindow.start + lastWindow.length);
        }
        
        this.timer.current = safeValue;
        
        // Очистка опасных окон
        this.director.dangerWindows = [];
        this.director.currentButtons = [];
        
        // Сброс стрика (частичный)
        this.perks.dangerPassedStreak = Math.max(0, this.perks.dangerPassedStreak - 5);
        
        this.state = 'RUNNING';
        this.lastUpdateTime = performance.now();
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

