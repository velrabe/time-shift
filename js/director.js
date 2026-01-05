// Director System - процедурная генерация опасностей и кнопок
class Director {
    constructor() {
        this.dangerWindows = [];
        this.currentButtons = [];
        this.nextThreatStep = 0;
        this.overrideRules = [];
        this.initialized = false;
    }

    // Обновление директора
    update(state) {
        const { timer, streak } = state;
        
        // Инициализация при первом запуске
        if (!this.initialized) {
            this.scheduleNextThreat(timer.maxReached);
            this.initialized = true;
        }
        
        // Проверка инверсии
        if (timer.inversionActive) {
            // Во время инверсии не создаем новые угрозы
            return;
        }

        // Проверка оверрайдов
        if (this.hasNoDangerOverride(timer.maxReached)) {
            return;
        }

        // Удаление прошедших окон
        this.dangerWindows = this.dangerWindows.filter(window => {
            const end = window.start + window.length - 1;
            return end >= timer.current;
        });

        // Генерация новых угроз
        if (timer.current >= this.nextThreatStep) {
            this.generateThreat(state);
            this.scheduleNextThreat(timer.maxReached);
        }

        // Генерация кнопок
        this.ensureButtons(state);
    }

    // Проверка наличия NO_DANGER оверрайда
    hasNoDangerOverride(maxReached) {
        return this.overrideRules.some(rule => 
            rule.type === 'NO_DANGER' &&
            maxReached >= rule.range.from &&
            maxReached <= rule.range.to
        );
    }

    // Генерация угрозы
    generateThreat(state) {
        const { timer, streak } = state;
        
        // Определяем длину окна в зависимости от прогресса
        const windowLength = this.calculateWindowLength(timer.maxReached);
        
        // Выбираем решение (безопасное действие)
        const solutionDelta = this.chooseSolutionDelta(timer.maxReached);
        
        // Вычисляем позицию окна так, чтобы решение работало
        const windowStart = timer.current + this.calculateSafeDistance(solutionDelta, timer.stepDurationSec);
        
        // Создаем окно
        const dangerWindow = {
            start: windowStart,
            length: windowLength,
            solutionDelta: solutionDelta
        };
        
        this.dangerWindows.push(dangerWindow);
    }

    // Вычисление длины окна
    calculateWindowLength(progress) {
        if (progress < 10) return 1;
        if (progress < 30) return 2;
        if (progress < 60) return 3;
        if (progress < 100) return 4;
        return 5;
    }

    // Выбор безопасного решения
    chooseSolutionDelta(progress) {
        const options = [];
        
        // Ранняя игра - маленькие значения
        if (progress < 20) {
            options.push(1, 2, 3);
        } else if (progress < 50) {
            options.push(2, 3, 4, 5);
        } else {
            options.push(3, 4, 5, 6, 7);
        }
        
        return options[Math.floor(Math.random() * options.length)];
    }

    // Вычисление безопасного расстояния до окна
    calculateSafeDistance(solutionDelta, stepDuration) {
        // Нужно дать игроку время нажать кнопку до того, как окно достигнет центра
        // Учитываем задержку реакции (примерно 1-2 шага)
        const reactionSteps = 2;
        return Math.max(solutionDelta + reactionSteps, 3);
    }

    // Планирование следующей угрозы
    scheduleNextThreat(progress) {
        let interval;
        
        if (progress < 20) {
            interval = 6 + Math.random() * 6; // 6-12 шагов
        } else if (progress < 50) {
            interval = 4 + Math.random() * 5; // 4-9 шагов
        } else {
            interval = 3 + Math.random() * 4; // 3-7 шагов
        }
        
        this.nextThreatStep = progress + interval;
    }

    // Обеспечение наличия кнопок
    ensureButtons(state) {
        if (this.currentButtons.length > 0) return;
        
        const { timer } = state;
        const buttons = this.generateButtons(state);
        this.currentButtons = buttons;
        if (buttons.length > 0) {
            eventBus.emit('BUTTONS_UPDATED', { buttons });
        }
    }

    // Генерация кнопок
    generateButtons(state) {
        const { timer } = state;
        const buttons = [];
        
        // Находим ближайшее опасное окно
        const nextWindow = this.dangerWindows.find(w => w.start > timer.current);
        
        if (nextWindow) {
            // Solution button
            buttons.push({
                delta: nextWindow.solutionDelta,
                type: 'solution',
                label: `+${nextWindow.solutionDelta}`
            });
            
            // Нейтральные кнопки
            const neutralCount = 1 + Math.floor(Math.random() * 2);
            const usedDeltas = new Set([nextWindow.solutionDelta]);
            for (let i = 0; i < neutralCount; i++) {
                let delta = this.generateNeutralDelta(timer.current, nextWindow);
                let attempts = 0;
                while (usedDeltas.has(delta) && attempts < 10) {
                    delta = this.generateNeutralDelta(timer.current, nextWindow);
                    attempts++;
                }
                usedDeltas.add(delta);
                buttons.push({
                    delta: delta,
                    type: 'neutral',
                    label: delta > 0 ? `+${delta}` : `${delta}`
                });
            }
            
            // Ловушки (опционально, в зависимости от прогресса)
            if (timer.maxReached > 20 && Math.random() > 0.5) {
                const trapDelta = this.generateTrapDelta(timer.current, nextWindow);
                if (!usedDeltas.has(trapDelta)) {
                    buttons.push({
                        delta: trapDelta,
                        type: 'trap',
                        label: trapDelta > 0 ? `+${trapDelta}` : `${trapDelta}`
                    });
                }
            }
        } else {
            // Нет активных окон - генерируем случайные кнопки
            const count = 2 + Math.floor(Math.random() * 2);
            const usedDeltas = new Set();
            for (let i = 0; i < count; i++) {
                let delta = (Math.random() > 0.5 ? 1 : -1) * (1 + Math.floor(Math.random() * 5));
                let attempts = 0;
                while ((usedDeltas.has(delta) || delta === 0) && attempts < 10) {
                    delta = (Math.random() > 0.5 ? 1 : -1) * (1 + Math.floor(Math.random() * 5));
                    attempts++;
                }
                usedDeltas.add(delta);
                buttons.push({
                    delta: delta,
                    type: 'neutral',
                    label: delta > 0 ? `+${delta}` : `${delta}`
                });
            }
        }
        
        // Минимум 2 кнопки
        if (buttons.length < 2) {
            const baseDelta = buttons.length > 0 ? Math.abs(buttons[0].delta) : 1;
            buttons.push({
                delta: baseDelta + 1,
                type: 'neutral',
                label: `+${baseDelta + 1}`
            });
        }
        
        // Перемешиваем для разнообразия
        return this.shuffle(buttons);
    }

    // Генерация нейтральной дельты
    generateNeutralDelta(current, window) {
        // Кнопка, которая не приведет к попаданию в окно
        const safeOptions = [];
        for (let d = -5; d <= 5; d++) {
            if (d === 0 || d === window.solutionDelta) continue;
            const newPos = current + d;
            if (newPos < window.start || newPos >= window.start + window.length) {
                safeOptions.push(d);
            }
        }
        
        if (safeOptions.length === 0) {
            return window.solutionDelta === 1 ? 2 : 1;
        }
        
        return safeOptions[Math.floor(Math.random() * safeOptions.length)];
    }

    // Генерация ловушки
    generateTrapDelta(current, window) {
        // Кнопка, которая приведет к попаданию в окно
        const trapOptions = [];
        for (let d = -7; d <= 7; d++) {
            if (d === window.solutionDelta || d === 0) continue;
            const newPos = current + d;
            if (newPos >= window.start && newPos < window.start + window.length) {
                trapOptions.push(d);
            }
        }
        
        if (trapOptions.length === 0) {
            return window.solutionDelta === 1 ? -1 : 1;
        }
        
        return trapOptions[Math.floor(Math.random() * trapOptions.length)];
    }

    // Перемешивание массива
    shuffle(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    // Проверка попадания в опасное окно
    checkDanger(current) {
        for (const window of this.dangerWindows) {
            if (current >= window.start && current < window.start + window.length) {
                return true;
            }
        }
        return false;
    }

    // Очистка прошедших окон и обновление кнопок
    onDangerPassed() {
        // Удаляем прошедшие окна
        this.dangerWindows = this.dangerWindows.filter(window => {
            const end = window.start + window.length - 1;
            return end >= 0; // оставляем только будущие
        });
        
        // Сбрасываем кнопки для регенерации
        this.currentButtons = [];
    }

    // Добавление оверрайда
    addOverrideRule(rule) {
        this.overrideRules.push(rule);
    }

    // Удаление оверрайда
    removeOverrideRule(id) {
        this.overrideRules = this.overrideRules.filter(r => r.id !== id);
    }

    // Сериализация для снапшота
    toSnapshot() {
        return {
            dangerWindows: this.dangerWindows,
            currentButtons: this.currentButtons,
            nextThreatStep: this.nextThreatStep,
            overrideRules: this.overrideRules,
            initialized: this.initialized
        };
    }

    // Восстановление из снапшота
    fromSnapshot(snapshot) {
        this.dangerWindows = snapshot.dangerWindows || [];
        this.currentButtons = snapshot.currentButtons || [];
        this.nextThreatStep = snapshot.nextThreatStep || 0;
        this.overrideRules = snapshot.overrideRules || [];
        this.initialized = snapshot.initialized !== undefined ? snapshot.initialized : true;
    }
}

