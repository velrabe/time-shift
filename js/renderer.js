// Система рендеринга
class Renderer {
    constructor() {
        this.numberStrip = document.getElementById('number-strip');
        this.focusZone = document.getElementById('focus-zone');
        this.controlButtons = document.getElementById('control-buttons');
        this.perksContainer = document.getElementById('perks-container');
        
        this.focusZoneCenter = 0; // будет вычислено
        this.numberWidth = 0;
        this.visibleNumbers = [];
        
        this.setupFocusZone();
        this.setupEventListeners();
    }

    setupFocusZone() {
        // Вычисляем центр экрана
        const container = document.getElementById('game-area');
        this.focusZoneCenter = container.offsetWidth / 2;
    }

    setupEventListeners() {
        // Обновление при изменении размера окна
        window.addEventListener('resize', () => {
            this.setupFocusZone();
        });
    }

    // Рендер ленты чисел
    renderNumberStrip(timer, dangerWindows) {
        if (!this.numberStrip) return;

        const current = timer.current;
        const range = 15; // количество чисел слева и справа от центра
        
        // Очистка
        this.numberStrip.innerHTML = '';
        
        // Создание чисел
        for (let i = current - range; i <= current + range; i++) {
            if (i < 0) continue;
            
            const numberEl = document.createElement('div');
            numberEl.className = 'number';
            numberEl.textContent = i;
            numberEl.dataset.value = i;
            
            // Проверка на опасность
            const isDanger = this.isDangerNumber(i, dangerWindows);
            if (isDanger) {
                numberEl.classList.add('danger');
            } else {
                numberEl.classList.add('normal');
            }
            
            // Проверка на активность (в центре)
            if (i === current) {
                numberEl.classList.add('active');
            }
            
            this.numberStrip.appendChild(numberEl);
        }
        
        // Позиционирование ленты (с задержкой для корректного измерения)
        setTimeout(() => {
            this.updateStripPosition(timer.current);
        }, 0);
    }

    // Обновление позиции ленты
    updateStripPosition(current) {
        if (!this.numberStrip) return;
        
        // Используем requestAnimationFrame для корректного измерения
        requestAnimationFrame(() => {
            const numberEl = this.numberStrip.querySelector(`[data-value="${current}"]`);
            if (!numberEl) return;
            
            const container = document.getElementById('game-area');
            if (!container) return;
            
            const containerCenter = container.offsetWidth / 2;
            const numberRect = numberEl.getBoundingClientRect();
            const stripRect = this.numberStrip.getBoundingClientRect();
            const numberCenter = numberRect.left - stripRect.left + numberRect.width / 2;
            const offset = containerCenter - numberCenter;
            
            this.numberStrip.style.transform = `translateX(${offset}px)`;
        });
    }

    // Проверка, является ли число опасным
    isDangerNumber(value, dangerWindows) {
        for (const window of dangerWindows) {
            if (value >= window.start && value < window.start + window.length) {
                return true;
            }
        }
        return false;
    }

    // Рендер кнопок управления
    renderControlButtons(buttons) {
        if (!this.controlButtons) return;
        
        this.controlButtons.innerHTML = '';
        
        buttons.forEach((button, index) => {
            const btn = document.createElement('button');
            btn.className = 'control-btn';
            btn.textContent = button.label;
            btn.dataset.delta = button.delta;
            
            // Добавляем классы по типу
            if (button.type === 'solution') {
                btn.classList.add('solution');
            } else if (button.type === 'trap') {
                btn.classList.add('trap');
            }
            
            // Обработчик клика
            btn.addEventListener('click', () => {
                eventBus.emit('BUTTON_CLICKED', { delta: button.delta });
            });
            
            // Горячие клавиши (1, 2, 3, 4)
            if (index < 4) {
                const key = (index + 1).toString();
                btn.title = `Hotkey: ${key}`;
            }
            
            this.controlButtons.appendChild(btn);
        });
    }

    // Рендер перков
    renderPerks(perks) {
        if (!this.perksContainer) return;
        
        this.perksContainer.innerHTML = '';
        
        perks.forEach(perk => {
            const btn = document.createElement('button');
            btn.className = 'ui-btn perk-btn';
            btn.textContent = `${perk.uiSpec().icon} ${perk.uiSpec().label}`;
            btn.title = perk.description;
            
            if (!perk.charged) {
                btn.classList.add('disabled');
            } else {
                btn.classList.add('charged');
            }
            
            // Прогресс бар
            const progressBar = document.createElement('div');
            progressBar.className = 'perk-progress';
            progressBar.style.width = `${perk.progress * 100}%`;
            btn.appendChild(progressBar);
            
            // Обработчик клика
            if (perk.charged) {
                btn.addEventListener('click', () => {
                    eventBus.emit('PERK_ACTIVATED', { perkId: perk.id });
                });
            }
            
            this.perksContainer.appendChild(btn);
        });
    }

    // Обновление UI
    updateUI(state) {
        // Score
        const currentScoreEl = document.getElementById('current-score');
        const bestScoreEl = document.getElementById('best-score');
        const streakEl = document.getElementById('streak-count');
        
        if (currentScoreEl) {
            currentScoreEl.textContent = Math.floor(state.timer.maxReached);
        }
        if (bestScoreEl) {
            bestScoreEl.textContent = Math.floor(state.bestScore);
        }
        if (streakEl) {
            streakEl.textContent = state.dangerPassedStreak;
        }
    }

    // Показ экрана паузы
    showPauseScreen() {
        const pauseScreen = document.getElementById('pause-screen');
        if (pauseScreen) {
            pauseScreen.classList.remove('hidden');
        }
    }

    // Скрытие экрана паузы
    hidePauseScreen() {
        const pauseScreen = document.getElementById('pause-screen');
        if (pauseScreen) {
            pauseScreen.classList.add('hidden');
        }
    }

    // Показ экрана Game Over
    showGameOverScreen(score, canContinue) {
        const gameOverScreen = document.getElementById('game-over-screen');
        const finalScoreEl = document.getElementById('final-score');
        const continueBtn = document.getElementById('continue-btn');
        
        if (gameOverScreen) {
            gameOverScreen.classList.remove('hidden');
        }
        if (finalScoreEl) {
            finalScoreEl.textContent = `Score: ${Math.floor(score)}`;
        }
        if (continueBtn) {
            if (canContinue) {
                continueBtn.classList.remove('hidden');
            } else {
                continueBtn.classList.add('hidden');
            }
        }
    }

    // Скрытие экрана Game Over
    hideGameOverScreen() {
        const gameOverScreen = document.getElementById('game-over-screen');
        if (gameOverScreen) {
            gameOverScreen.classList.add('hidden');
        }
    }

    // Показ обратного отсчета
    async showCountdown() {
        const countdownOverlay = document.getElementById('countdown-overlay');
        const countdownText = document.getElementById('countdown-text');
        
        if (!countdownOverlay || !countdownText) return;
        
        countdownOverlay.classList.remove('hidden');
        
        for (let i = 3; i > 0; i--) {
            countdownText.textContent = i;
            countdownText.style.animation = 'none';
            setTimeout(() => {
                countdownText.style.animation = 'countdownPulse 1s ease-in-out';
            }, 10);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        countdownText.textContent = 'GO!';
        await new Promise(resolve => setTimeout(resolve, 500));
        
        countdownOverlay.classList.add('hidden');
    }
}

