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
        
        // Анимация focus zone
        this.focusZoneAnimationId = null;
        this.focusZoneBaseSize = 0; // Базовый размер круга
        
        // Анимация ленты
        this.stripAnimationId = null;
        this.currentStripOffset = 0; // Текущее смещение ленты в px
        
        this.setupFocusZone();
        this.setupEventListeners();
        this.setupFocusZoneAnimation();
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
        
        // Подписка на события таймера для анимации focus zone и ленты
        eventBus.on('TICK_STEP', (data) => {
            if (data && data.stepDuration) {
                const stepDuration = data.stepDuration;
                
                // Время начала анимации - СРАЗУ при TICK_STEP (синхронно для круга и ленты)
                const animationStartTime = performance.now();
                
                console.log('[TICK_STEP]', {
                    current: data.current,
                    stepDuration: stepDuration,
                    animationStartTime: animationStartTime
                });
                
                // СНАЧАЛА обновляем ленту для нового current (если есть timer и director)
                // Это нужно, чтобы элементы были созданы перед запуском анимации
                if (data.timer && data.director) {
                    this.renderNumberStrip(data.timer, data.director);
                }
                
                // Вычисляем целевое смещение для нового current
                const targetOffset = this.calculateTargetOffset(data.current);
                
                // Запускаем синхронные анимации круга и ленты
                this.animateFocusZoneAndStrip(stepDuration, targetOffset);
            }
        });
        
        // Остановка анимации при паузе
        eventBus.on('PAUSE', () => {
            this.stopFocusZoneAnimation();
        });
        
        // Возобновление анимации при резюме
        eventBus.on('RESUME', () => {
            // Анимация возобновится автоматически при следующем TICK_STEP
        });
    }
    
    setupFocusZoneAnimation() {
        // Получаем базовый размер круга из CSS (анимированного кольца)
        const focusCircle = this.focusZone?.querySelector('.focus-circle');
        if (focusCircle) {
            const computedStyle = window.getComputedStyle(focusCircle);
            this.focusZoneBaseSize = parseInt(computedStyle.width) || 75;
        }
    }
    
    // Вычисление целевого смещения ленты для указанного current
    calculateTargetOffset(current) {
        if (!this.numberStrip) return 0;
        
        const numberEl = this.numberStrip.querySelector(`[data-value="${current}"]`);
        if (!numberEl) return this.currentStripOffset;
        
        const container = document.getElementById('game-area');
        if (!container) return this.currentStripOffset;
        
        const containerCenter = container.offsetWidth / 2;
        const numberRect = numberEl.getBoundingClientRect();
        const stripRect = this.numberStrip.getBoundingClientRect();
        const numberCenter = numberRect.left - stripRect.left + numberRect.width / 2;
        const targetOffset = containerCenter - numberCenter;
        
        return targetOffset;
    }
    
    // Синхронная анимация focus zone и ленты
    animateFocusZoneAndStrip(stepDurationSec, targetOffset) {
        if (!this.focusZone || !this.numberStrip) return;
        
        // Находим анимированное кольцо
        const focusCircle = this.focusZone.querySelector('.focus-circle');
        if (!focusCircle) return;
        
        // Отменяем предыдущие анимации если есть
        if (this.focusZoneAnimationId) {
            cancelAnimationFrame(this.focusZoneAnimationId);
        }
        if (this.stripAnimationId) {
            cancelAnimationFrame(this.stripAnimationId);
        }
        
        const expandDuration = stepDurationSec * 0.9; // 90% времени - увеличение
        const shrinkDuration = stepDurationSec * 0.1; // 10% времени - уменьшение
        const expandScale = 2.0; // Увеличиваем с 75px до 150px (в 2 раза)
        
        // Вычисляем смещения для ленты
        const startOffset = this.currentStripOffset;
        const deltaOffset = targetOffset - startOffset;
        const expandOffset = startOffset + deltaOffset * 0.05; // 5% движения при увеличении
        const finalOffset = targetOffset; // 100% движения при уменьшении (оставшиеся 95%)
        
        const startTime = performance.now();
        const expandEndTime = startTime + expandDuration * 1000;
        const totalEndTime = startTime + stepDurationSec * 1000;
        
        const animate = (currentTime) => {
            const elapsed = (currentTime - startTime) / 1000; // в секундах
            
            if (currentTime < expandEndTime) {
                // Фаза увеличения круга (0.9 шага) + плавное движение ленты на 5%
                const progress = elapsed / expandDuration; // 0..1
                
                // Анимация круга
                const scale = 1 + (expandScale - 1) * progress; // 1.0 -> 2.0
                focusCircle.style.transform = `scale(${scale})`;
                
                // Плавное движение ленты на 5%
                const stripProgress = progress;
                const currentStripOffset = startOffset + (expandOffset - startOffset) * stripProgress;
                this.numberStrip.style.transition = 'none';
                this.numberStrip.style.transform = `translateX(${currentStripOffset}px)`;
                this.currentStripOffset = currentStripOffset;
                
                this.focusZoneAnimationId = requestAnimationFrame(animate);
            } else if (currentTime < totalEndTime) {
                // Фаза уменьшения круга (0.1 шага) + резкое движение ленты на оставшиеся 95%
                const shrinkProgress = (elapsed - expandDuration) / shrinkDuration; // 0..1
                
                // Анимация круга
                const scale = expandScale - (expandScale - 1) * shrinkProgress; // 2.0 -> 1.0
                focusCircle.style.transform = `scale(${scale})`;
                
                // Резкое движение ленты на оставшиеся 95%
                const currentStripOffset = expandOffset + (finalOffset - expandOffset) * shrinkProgress;
                this.numberStrip.style.transition = 'none';
                this.numberStrip.style.transform = `translateX(${currentStripOffset}px)`;
                this.currentStripOffset = currentStripOffset;
                
                this.focusZoneAnimationId = requestAnimationFrame(animate);
            } else {
                // Анимация завершена
                focusCircle.style.transform = 'scale(1)';
                this.numberStrip.style.transition = 'none';
                this.numberStrip.style.transform = `translateX(${finalOffset}px)`;
                this.currentStripOffset = finalOffset;
                this.focusZoneAnimationId = null;
            }
        };
        
        this.focusZoneAnimationId = requestAnimationFrame(animate);
    }
    
    // Анимация focus zone (для обратной совместимости)
    animateFocusZone(stepDurationSec) {
        // Используем новую синхронную функцию, но только для круга
        if (!this.focusZone) return null;
        
        const focusCircle = this.focusZone.querySelector('.focus-circle');
        if (!focusCircle) return null;
        
        if (this.focusZoneAnimationId) {
            cancelAnimationFrame(this.focusZoneAnimationId);
        }
        
        const expandDuration = stepDurationSec * 0.9;
        const shrinkDuration = stepDurationSec * 0.1;
        const expandScale = 2.0;
        
        const startTime = performance.now();
        const expandEndTime = startTime + expandDuration * 1000;
        const totalEndTime = startTime + stepDurationSec * 1000;
        
        const animate = (currentTime) => {
            const elapsed = (currentTime - startTime) / 1000;
            
            if (currentTime < expandEndTime) {
                const progress = elapsed / expandDuration;
                const scale = 1 + (expandScale - 1) * progress;
                focusCircle.style.transform = `scale(${scale})`;
                this.focusZoneAnimationId = requestAnimationFrame(animate);
            } else if (currentTime < totalEndTime) {
                const shrinkProgress = (elapsed - expandDuration) / shrinkDuration;
                const scale = expandScale - (expandScale - 1) * shrinkProgress;
                focusCircle.style.transform = `scale(${scale})`;
                this.focusZoneAnimationId = requestAnimationFrame(animate);
            } else {
                focusCircle.style.transform = 'scale(1)';
                this.focusZoneAnimationId = null;
            }
        };
        
        this.focusZoneAnimationId = requestAnimationFrame(animate);
        return shrinkDuration;
    }
    
    // Остановка анимации focus zone и ленты
    stopFocusZoneAnimation() {
        if (this.focusZoneAnimationId) {
            cancelAnimationFrame(this.focusZoneAnimationId);
            this.focusZoneAnimationId = null;
        }
        if (this.stripAnimationId) {
            cancelAnimationFrame(this.stripAnimationId);
            this.stripAnimationId = null;
        }
        // Возвращаем к базовому размеру
        const focusCircle = this.focusZone?.querySelector('.focus-circle');
        if (focusCircle) {
            focusCircle.style.transform = 'scale(1)';
        }
    }

    // Рендер ленты чисел
    renderNumberStrip(timer, dangerWindows) {
        if (!this.numberStrip) return;

        const current = timer.current;
        const range = 15; // количество чисел слева и справа от центра
        
        // Получаем все опасные окна (активные + пройденные)
        const allDangerWindows = dangerWindows.getAllDangerWindows ? 
            dangerWindows.getAllDangerWindows() : dangerWindows;
        
        // Определяем нужный диапазон
        const minValue = Math.max(0, current - range);
        const maxValue = current + range;
        
        // Проверяем, нужно ли пересоздавать элементы
        // Пересоздаем только если диапазон изменился или элементов нет
        const existingElements = Array.from(this.numberStrip.children);
        const needsRebuild = existingElements.length === 0 || 
            existingElements[0]?.dataset.value != minValue ||
            existingElements[existingElements.length - 1]?.dataset.value != maxValue;
        
        if (needsRebuild) {
            // Очистка
            this.numberStrip.innerHTML = '';
            
            // Создание кружков вместо чисел
            for (let i = minValue; i <= maxValue; i++) {
                const circleEl = document.createElement('div');
                circleEl.className = 'number-circle';
                circleEl.dataset.value = i;
                
                // Проверка на опасность (включая пройденные окна)
                const isDanger = this.isDangerNumber(i, allDangerWindows);
                if (isDanger) {
                    circleEl.classList.add('danger');
                } else {
                    circleEl.classList.add('normal');
                }
                
                // Проверка на активность (в центре)
                if (i === current) {
                    circleEl.classList.add('active');
                }
                
                this.numberStrip.appendChild(circleEl);
            }
            
            // Устанавливаем начальную позицию сразу (без задержки)
            // Это нужно для правильного позиционирования при запуске
            this.updateStripPosition(timer.current, null);
        } else {
            // Обновляем только классы существующих элементов (опасность и активность)
            existingElements.forEach(el => {
                const value = parseInt(el.dataset.value);
                
                // Обновление опасности
                const isDanger = this.isDangerNumber(value, allDangerWindows);
                if (isDanger) {
                    el.classList.remove('normal');
                    el.classList.add('danger');
                } else {
                    el.classList.remove('danger');
                    el.classList.add('normal');
                }
                
                // Обновление активности
                if (value === current) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            });
        }
    }

    // Обновление позиции ленты (мгновенное, без анимации)
    updateStripPosition(current, stepDuration = null) {
        if (!this.numberStrip) return;
        
        // Принудительно заставляем браузер пересчитать layout
        // чтобы getBoundingClientRect() вернул актуальные значения
        void this.numberStrip.offsetHeight;
        
        const targetOffset = this.calculateTargetOffset(current);
        this.currentStripOffset = targetOffset;
        
        // Мгновенное перемещение без анимации
        this.numberStrip.style.transition = 'none';
        this.numberStrip.style.transform = `translateX(${targetOffset}px)`;
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
        if (!this.controlButtons) {
            console.error('controlButtons element not found!');
            return;
        }
        
        if (!buttons || buttons.length === 0) {
            console.warn('No buttons to render');
            return;
        }
        
        // Очищаем только если количество кнопок изменилось
        const existingButtons = this.controlButtons.querySelectorAll('.control-btn');
        if (existingButtons.length !== buttons.length) {
            this.controlButtons.innerHTML = '';
        }
        
        // Создаем или обновляем кнопки
        buttons.forEach((button, index) => {
            if (!button || button.delta === undefined) {
                return;
            }
            
            // Ищем существующую кнопку по delta
            let btn = Array.from(existingButtons).find(b => b.dataset.delta == button.delta);
            
            if (!btn) {
                // Создаем новую кнопку
                btn = document.createElement('button');
                btn.className = 'control-btn';
                btn.dataset.delta = button.delta;
                btn.type = 'button';
                this.controlButtons.appendChild(btn);
            }
            
            // Обновляем содержимое и состояние
            btn.textContent = button.label || (button.delta > 0 ? `+${button.delta}` : `${button.delta}`);
            
            // Удаляем все классы типов
            btn.classList.remove('solution', 'trap', 'neutral', 'inactive');
            
            // Добавляем классы по типу и активности
            if (button.active) {
                if (button.type === 'solution') {
                    btn.classList.add('solution');
                } else if (button.type === 'trap') {
                    btn.classList.add('trap');
                } else {
                    btn.classList.add('neutral');
                }
                btn.disabled = false;
            } else {
                btn.classList.add('inactive');
                btn.disabled = true;
            }
            
            // Удаляем старые обработчики
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            btn = newBtn;
            
            // Добавляем обработчик клика только для активных кнопок
            if (button.active) {
                const clickHandler = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Помечаем, что пользователь взаимодействовал (для аудио)
                    if (window.gameInstance) {
                        window.gameInstance.userInteracted = true;
                    }
                    eventBus.emit('BUTTON_CLICKED', { delta: button.delta });
                };
                
                btn.addEventListener('click', clickHandler);
                btn.addEventListener('touchstart', clickHandler);
            }
            
            // Горячие клавиши только для активных кнопок
            if (button.active && index < 4) {
                const key = (index + 1).toString();
                btn.title = `Hotkey: ${key}`;
            } else {
                btn.title = '';
            }
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

    // Показ стартового экрана
    showStartScreen() {
        const startScreen = document.getElementById('start-screen');
        if (startScreen) {
            startScreen.classList.remove('hidden');
        }
    }

    // Скрытие стартового экрана
    hideStartScreen() {
        const startScreen = document.getElementById('start-screen');
        if (startScreen) {
            startScreen.classList.add('hidden');
        }
    }
}

