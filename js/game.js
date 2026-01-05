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
        
        // Загрузка снапшота (если есть)
        const snapshot = this.loadSnapshot();
        if (snapshot) {
            // Предлагаем восстановить игру
            this.restoreFromSnapshot(snapshot);
        }
        
        // Инициализация аудио
        this.audio.init();
        
        // Обновление UI
        this.updateUI();
    }

    // Настройка обработчиков событий
    setupEventListeners() {
        // События таймера
        eventBus.on('TICK_STEP', (data) => {
            this.onTickStep(data);
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
            this.onButtonClicked(data.delta);
        });

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
        
        // Генерация начальных кнопок
        const gameState = this.getGameState();
        this.director.ensureButtons(gameState);
        if (this.director.currentButtons.length > 0) {
            this.renderer.renderControlButtons(this.director.currentButtons);
        }
        
        // Запуск аудио
        this.audio.play();
        
        // Запуск игрового цикла
        this.gameLoop();
    }

    // Игровой цикл
    gameLoop() {
        if (this.state !== 'RUNNING') {
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
        
        // Убеждаемся, что кнопки отображены
        if (this.director.currentButtons.length > 0) {
            this.renderer.renderControlButtons(this.director.currentButtons);
        }
        
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
        
        // Лента чисел
        this.renderer.renderNumberStrip(this.timer, this.director.dangerWindows);
        
        // Кнопки (если нужно обновить)
        if (this.director.currentButtons.length === 0) {
            this.director.ensureButtons(gameState);
            if (this.director.currentButtons.length > 0) {
                this.renderer.renderControlButtons(this.director.currentButtons);
            }
        }
        
        // Перки
        const availablePerks = this.perks.getAvailablePerks(gameState);
        this.renderer.renderPerks(availablePerks);
        
        // UI
        this.updateUI();
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
            this.director.onDangerPassed();
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
        if (this.state !== 'RUNNING') return;
        
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
        
        // Восстановление на безопасное значение
        const safeValue = Math.max(0, this.timer.current - 5);
        this.timer.current = safeValue;
        
        // Очистка опасных окон
        this.director.dangerWindows = [];
        this.director.currentButtons = [];
        
        // Сброс стрика (частичный)
        this.perks.dangerPassedStreak = Math.max(0, this.perks.dangerPassedStreak - 5);
        
        this.state = 'RUNNING';
        this.lastUpdateTime = performance.now();
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
        
        this.start();
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
        
        this.timer.fromSnapshot(snapshot.timer);
        this.director.fromSnapshot(snapshot.director);
        this.perks.fromSnapshot(snapshot.perks);
        
        // Отображение кнопок при восстановлении
        if (this.director.currentButtons.length > 0) {
            this.renderer.renderControlButtons(this.director.currentButtons);
        } else {
            const gameState = this.getGameState();
            this.director.ensureButtons(gameState);
            if (this.director.currentButtons.length > 0) {
                this.renderer.renderControlButtons(this.director.currentButtons);
            }
        }
        
        // Обновление best score из снапшота
        if (snapshot.timer && snapshot.timer.maxReached) {
            this.gamePush.updateBestScoreFromSnapshot(snapshot.timer.maxReached);
        }
    }
}

