// Director System - процедурная генерация опасностей и кнопок
class Director {
    constructor() {
        this.dangerWindows = [];
        this.passedDangerWindows = []; // История пройденных окон
        this.currentButtons = [];
        this.overrideRules = [];
        this.initialized = false;
        
        // ControlSet система
        this.controlSet = null;
        this.dangerPassedCount = 0; // Счетчик пройденных опасностей
        this.controlSetMinTTL = 3; // Минимум 3 опасности набор не меняется
        this.controlSetMaxTTL = 7; // Максимум 7 опасностей
    }

    // Обновление директора
    update(state) {
        const { timer, streak, perks } = state;
        
        // Инициализация при первом запуске
        if (!this.initialized) {
            // Инициализируем ControlSet
            if (!this.controlSet) {
                this.updateControlSet(timer.maxReached);
            }
            
            // Генерируем начальный буфер угроз (на 100 шагов вперед)
            const initialLookahead = 100;
            let furthestThreat = timer.current;
            let attempts = 0;
            const maxAttempts = 20; // Защита от бесконечного цикла
            
            while (furthestThreat < timer.current + initialLookahead && attempts < maxAttempts) {
                const shouldGenerate = this.shouldGenerateThreat(timer.current, timer.maxReached, furthestThreat);
                if (shouldGenerate) {
                    this.generateThreat(state);
                    // Обновляем furthestThreat после генерации
                    const newFurthest = this.dangerWindows.length > 0 
                        ? Math.max(...this.dangerWindows.map(w => w.start + w.length - 1))
                        : timer.current;
                    if (newFurthest <= furthestThreat) {
                        break;
                    }
                    furthestThreat = newFurthest;
                } else {
                    break;
                }
                attempts++;
            }
            
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

        // Перемещение прошедших окон в историю
        const passedWindows = this.dangerWindows.filter(window => {
            const end = window.start + window.length - 1;
            return end < timer.current;
        });

        // Начисление streak: 1 очко за КАЖДОЕ danger window (независимо от длины окна)
        if (passedWindows.length > 0) {
            // Основной путь: напрямую обновляем PerkSystem (не зависит от порядка подписок)
            if (perks && typeof perks.addStreak === 'function') {
                perks.addStreak(passedWindows.length);
            }

            // Сигнал для UI/аналитики (не должен менять streak сам по себе)
            eventBus.emit('DANGER_PASSED', { count: passedWindows.length });
            // Обновляем внутреннюю механику Director (TTL ControlSet и т.п.) по каждому окну
            for (let i = 0; i < passedWindows.length; i++) {
                this.onDangerPassed(timer.maxReached);
            }
        }
        
        // Добавляем пройденные окна в историю
        passedWindows.forEach(window => {
            if (!this.passedDangerWindows.some(w => w.start === window.start && w.length === window.length)) {
                this.passedDangerWindows.push(window);
            }
        });
        
        // Удаляем прошедшие окна из активных
        this.dangerWindows = this.dangerWindows.filter(window => {
            const end = window.start + window.length - 1;
            return end >= timer.current;
        });

        // Генерация новых угроз
        // Генерируем угрозы заранее, чтобы всегда был буфер впереди
        const lookaheadDistance = 100; // Генерируем угрозы на 100 шагов вперед
        let furthestThreat = this.dangerWindows.length > 0 
            ? Math.max(...this.dangerWindows.map(w => w.start + w.length - 1))
            : timer.current;
        
        // Генерируем угрозы пока не достигнем lookaheadDistance
        // Защита от бесконечного цикла и от генерации слишком много угроз за раз
        let attempts = 0;
        const maxAttempts = 10; // Ограничиваем количество угроз за один update
        
        // Генерируем максимум до lookaheadDistance, но не более maxAttempts угроз за раз
        while (furthestThreat < timer.current + lookaheadDistance && attempts < maxAttempts) {
            const shouldGenerateThreat = this.shouldGenerateThreat(timer.current, timer.maxReached, furthestThreat);
            if (shouldGenerateThreat) {
                this.generateThreat(state);
                // Обновляем furthestThreat после генерации
                const newFurthest = this.dangerWindows.length > 0 
                    ? Math.max(...this.dangerWindows.map(w => w.start + w.length - 1))
                    : timer.current;
                if (newFurthest <= furthestThreat) {
                    // Не удалось сгенерировать угрозу дальше - выходим
                    break;
                }
                furthestThreat = newFurthest;
            } else {
                // Не можем сгенерировать сейчас - выходим
                break;
            }
            attempts++;
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
    
    // Проверка, нужно ли создавать новую угрозу
    shouldGenerateThreat(current, maxReached, furthestThreat) {
        // Проверка 1: есть ли активные угрозы впереди
        const minThreatLookaheadSteps = 3; // Минимум 3 шага до ближайшей угрозы
        
        // Находим ближайшую угрозу впереди (правильно - через минимум)
        const threatsAhead = this.dangerWindows.filter(w => w.start > current);
        if (threatsAhead.length > 0) {
            // Находим ближайшую (минимальный start)
            const nextThreat = threatsAhead.reduce((min, w) => !min || w.start < min.start ? w : min, null);
            if (nextThreat) {
                const distanceToNext = nextThreat.start - current;
                // Если ближайшая угроза слишком близко, не создаем новую
                if (distanceToNext < minThreatLookaheadSteps) {
                    return false;
                }
            }
        }
        
        // Проверка 2: не создаем угрозу слишком близко к текущей позиции
        // Новая угроза должна начинаться минимум через gapSteps от furthestThreat
        const gapSteps = this.calculateGapSteps(maxReached);
        const minStart = furthestThreat + gapSteps;
        
        // Если минимальная позиция для новой угрозы слишком близко к current, не создаем
        if (minStart <= current + minThreatLookaheadSteps) {
            return false;
        }
        
        return true;
    }

    // Генерация угрозы
    generateThreat(state) {
        const { timer, streak } = state;
        
        // Убеждаемся, что ControlSet существует
        if (!this.controlSet) {
            this.updateControlSet(timer.maxReached);
        }
        
        // 1. Определяем длину окна в зависимости от прогресса
        let windowLength = this.calculateWindowLength(timer.maxReached);
        
        // 2. Проверяем, нужно ли форсировать обновление ControlSet
        if (this.shouldForceUpdateControlSet(windowLength, timer.maxReached)) {
            this.updateControlSet(timer.maxReached);
        }
        
        // 3. Проверяем, может ли текущий ControlSet решить окно длины windowLength
        // Если нет - ограничиваем длину окна до максимально решаемой
        const minRequired = windowLength + 1;
        const available = this.controlSet.availableDeltas.filter(d => d > 0);
        const maxSolution = available.length > 0 ? Math.max(...available) : 2;
        
        // Если максимальная solution недостаточна для окна, ограничиваем длину окна
        if (maxSolution < minRequired) {
            const maxSolvableLength = Math.max(1, maxSolution - 1);
            windowLength = maxSolvableLength;
        }
        
        // 4. Выбираем решение из текущего ControlSet с учетом длины окна
        // Используем самую дальнюю угрозу как базу, чтобы не создавать окна слишком близко
        const furthestThreat = this.dangerWindows.length > 0 
            ? Math.max(...this.dangerWindows.map(w => w.start + w.length - 1))
            : timer.current;
        const basePosition = Math.max(timer.current, furthestThreat);
        
        const solutionDelta = this.chooseSolutionFromControlSet(basePosition, windowLength);
        
        // 5. Вычисляем позицию окна так, чтобы solution гарантированно работала
        const windowStart = this.calculateWindowStartForSolution(basePosition, solutionDelta, windowLength, timer.maxReached);
        
        // 6. Создаем окно
        const dangerWindow = {
            start: windowStart,
            length: windowLength,
            solutionDelta: solutionDelta
        };
        
        // 7. Финальная проверка гарантии решения
        this.validateSolution(dangerWindow, timer.current);
        
        this.dangerWindows.push(dangerWindow);
    }
    
    // Выбор solution из текущего ControlSet с учетом длины окна
    chooseSolutionFromControlSet(current, windowLength) {
        if (!this.controlSet || this.controlSet.availableDeltas.length === 0) {
            // Fallback если ControlSet не готов
            return Math.max(2, windowLength + 1);
        }
        
        const availableDeltas = this.controlSet.availableDeltas;
        
        // Выбираем положительную дельту (solution обычно вперед)
        const positiveDeltas = availableDeltas.filter(d => d > 0);
        
        if (positiveDeltas.length > 0) {
            // Solution должна перепрыгнуть окно в худшем случае
            // Минимальная requirement: solutionDelta >= windowLength + 1
            const minRequired = windowLength + 1;
            
            // Ищем подходящую solution из доступных
            const suitable = positiveDeltas.filter(d => d >= minRequired);
            
            if (suitable.length > 0) {
                // Есть подходящая - берем минимальную из подходящих
                return Math.min(...suitable);
            } else {
                // Нет подходящей - берем самую большую
                // Но тогда окно будет размещено дальше, чтобы solution работала
                return Math.max(...positiveDeltas);
            }
        }
        
        // Если нет положительных, берем первую доступную (но это не должно происходить)
        return availableDeltas[0] || (windowLength + 1);
    }
    
    // Вычисление позиции окна для гарантированной работы solution
    calculateWindowStartForSolution(current, solutionDelta, windowLength, maxReached) {
        // КРИТИЧНО: Худший случай - игрок находится на D-1 (прямо перед окном)
        // В этом случае: current = D-1, и current + solutionDelta должно быть >= D + windowLength
        // То есть: (D-1) + solutionDelta >= D + windowLength
        // solutionDelta >= windowLength + 1
        
        // Вычисляем gapSteps в зависимости от прогресса
        const gapSteps = this.calculateGapSteps(maxReached);
        
        // Начальная позиция окна: current + gapSteps
        let windowStart = current + gapSteps;
        
        // Проверяем худший случай: игрок на windowStart - 1
        const worstCaseCurrent = windowStart - 1;
        const worstCaseNewPos = worstCaseCurrent + solutionDelta;
        const windowEnd = windowStart + windowLength - 1;
        
        // Если в худшем случае solution попадает в окно, сдвигаем окно дальше
        if (worstCaseNewPos >= windowStart && worstCaseNewPos <= windowEnd) {
            // Нужно сдвинуть окно так, чтобы worstCaseNewPos был после окна
            if (solutionDelta <= windowLength) {
                // Сдвигаем окно так, чтобы solution гарантированно перепрыгнула
                windowStart = current + solutionDelta + 1;
            } else {
                // solutionDelta достаточна, но нужно убедиться что окно не слишком близко
                windowStart = Math.max(windowStart, worstCaseNewPos + 1);
            }
        }
        
        return windowStart;
    }
    
    // Валидация solution - финальная проверка гарантии
    validateSolution(dangerWindow, current) {
        const solutionDelta = dangerWindow.solutionDelta;
        const windowLength = dangerWindow.length;
        
        // Проверяем худший случай: игрок на windowStart - 1
        const worstCaseCurrent = dangerWindow.start - 1;
        const worstCaseNewPos = worstCaseCurrent + solutionDelta;
        const windowEnd = dangerWindow.start + windowLength - 1;
        
        // Solution должна перепрыгнуть окно в худшем случае
        if (worstCaseNewPos <= windowEnd) {
            // Сдвигаем окно так, чтобы solution гарантированно перепрыгнула
            dangerWindow.start = worstCaseCurrent + solutionDelta + 1;
        }
    }

    // Вычисление длины окна по эталону
    calculateWindowLength(progress) {
        // maxReached < 15 → L=1 (всегда)
        if (progress < 15) {
            return 1;
        }
        
        // 15–99 → L=1 (60%) / L=2 (40%) - двойные начинаются раньше
        if (progress < 100) {
            return Math.random() < 0.4 ? 2 : 1;
        }
        
        // Эталон: 100–199 → L=2 (70%) / L=3 (30%)
        if (progress < 200) {
            return Math.random() < 0.3 ? 3 : 2;
        }
        
        // Эталон: 200+ → L=2–4 (по распределению)
        // Но нужно учитывать, что для L=4 нужен solutionDelta >= 5
        // Распределение: L=2 (40%), L=3 (40%), L=4 (20%)
        const rand = Math.random();
        if (rand < 0.4) return 2;
        if (rand < 0.8) return 3;
        return 4;
    }


    // Фильтрация нейтральных дельт (не приводят к попаданию в окно)
    filterNeutralDeltas(deltas, current, window) {
        const windowStart = window.start;
        const windowEnd = window.start + window.length - 1;
        
        return deltas.filter(delta => {
            const newPos = current + delta;
            // Безопасно если до окна или после окна
            return newPos < windowStart || newPos > windowEnd;
        });
    }
    

    // Вычисление gapSteps (расстояние до следующей угрозы) в зависимости от прогресса
    calculateGapSteps(progress) {
        // early: 6–12 (включительно)
        if (progress < 20) {
            return Math.floor(6 + Math.random() * 7); // 6-12 шагов (целое число)
        }
        // mid: 4–9 (включительно)
        if (progress < 50) {
            return Math.floor(4 + Math.random() * 6); // 4-9 шагов (целое число)
        }
        // late: 3–7 (включительно)
        return Math.floor(3 + Math.random() * 5); // 3-7 шагов (целое число)
    }

    
    // Получение стадии ControlSet на основе maxReached (прогресса)
    getControlSetStage(maxReached) {
        // Эталон: стадии должны быть привязаны к maxReached
        // DangerPassed 0–9: [-1, +2] → maxReached < 30
        // 10–24: [-1, +2, +3] → maxReached 30-49
        // 25–49: [-1, +3, -2] → maxReached 50-99
        // 50–99: [-1, +3, +4] → maxReached 100-199
        // 100+: [-1, +4, -2] или [-1, +3, +4] → maxReached 200+
        
        if (maxReached < 30) return 0;
        if (maxReached < 50) return 1;
        if (maxReached < 100) return 2;
        if (maxReached < 200) return 3;
        return 4; // 200+
    }
    
    // Получение ControlSet для стадии (по эталону)
    getControlSetForStage(stage) {
        switch (stage) {
            case 0: return [-1, 2]; // [-1, +2] - maxReached < 30
            case 1: return [-1, 2, 3]; // [-1, +2, +3] - maxReached 30-49
            case 2: return [-1, 3, -2]; // [-1, +3, -2] - maxReached 50-99
            case 3: return [-1, 3, 4]; // [-1, +3, +4] - maxReached 100-199
            default: return [-1, 5, -2]; // [-1, +5, -2] - maxReached 200+ (для поддержки L=4 нужен +5)
        }
    }
    
    // Сравнение массивов
    arraysEqual(a, b) {
        if (a.length !== b.length) return false;
        return a.every((val, i) => val === b[i]);
    }
    
    // Плавная эволюция ControlSet (меняем только одну кнопку)
    evolveControlSet(currentSet, targetDeltas, targetStage) {
        const current = currentSet.availableDeltas;
        const target = targetDeltas;
        
        // Если текущий набор уже соответствует цели, возвращаем его
        if (this.arraysEqual(current.sort(), target.sort())) {
            return {
                ...currentSet,
                createdAtDangerCount: this.dangerPassedCount,
                stage: targetStage
            };
        }
        
        // Находим разницу
        const toAdd = target.filter(d => !current.includes(d));
        const toRemove = current.filter(d => !target.includes(d));
        
        let newDeltas = [...current];
        
        // Если есть что добавить и что убрать - заменяем одну кнопку
        if (toAdd.length > 0 && toRemove.length > 0) {
            const removeIndex = current.indexOf(toRemove[0]);
            newDeltas[removeIndex] = toAdd[0];
        } else if (toAdd.length > 0) {
            // Добавляем одну кнопку
            newDeltas.push(toAdd[0]);
        } else if (toRemove.length > 0) {
            // Убираем одну кнопку
            newDeltas = newDeltas.filter(d => d !== toRemove[0]);
        }
        
        return {
            availableDeltas: newDeltas,
            createdAtDangerCount: this.dangerPassedCount,
            stage: targetStage
        };
    }
    
    // Проверка необходимости обновления ControlSet
    shouldUpdateControlSet(maxReached) {
        if (!this.controlSet) return true;
        
        // Проверяем, изменилась ли стадия на основе maxReached
        const currentStage = this.getControlSetStage(maxReached);
        const controlSetStage = this.controlSet.stage || 0;
        
        if (currentStage > controlSetStage) {
            // Стадия выросла - нужно обновить
            return true;
        }
        
        const ttl = this.controlSetMaxTTL;
        const minTTL = this.controlSetMinTTL;
        
        // Обновляем если прошло достаточно опасностей
        const dangerSinceCreation = this.dangerPassedCount - this.controlSet.createdAtDangerCount;
        
        // Минимум minTTL, максимум ttl
        if (dangerSinceCreation < minTTL) return false;
        if (dangerSinceCreation >= ttl) return true;
        
        // Случайное обновление между minTTL и ttl для разнообразия
        return Math.random() > 0.7;
    }
    
    // Обновление ControlSet (плавное изменение)
    updateControlSet(maxReached) {
        const stage = this.getControlSetStage(maxReached);
        const newDeltas = this.getControlSetForStage(stage);
        
        if (!this.controlSet) {
            // Первое создание
            this.controlSet = {
                availableDeltas: newDeltas,
                createdAtDangerCount: this.dangerPassedCount,
                createdAtMaxReached: maxReached,
                stage: stage
            };
        } else {
            // Плавное изменение - меняем только одну кнопку
            this.controlSet = this.evolveControlSet(this.controlSet, newDeltas, stage);
            this.controlSet.createdAtMaxReached = maxReached;
        }
    }
    
    // Проверка, нужно ли форсировать обновление ControlSet из-за недостаточной solution
    shouldForceUpdateControlSet(windowLength, maxReached) {
        if (!this.controlSet) return true;
        
        // Проверяем, есть ли в ControlSet решение для окна длины windowLength
        // Нужно: solutionDelta >= windowLength + 1
        const minRequired = windowLength + 1;
        const available = this.controlSet.availableDeltas.filter(d => d > 0);
        
        if (available.length === 0) return true;
        
        const suitable = available.filter(d => d >= minRequired);
        
        // Если нет подходящей solution, нужно обновить ControlSet
        if (suitable.length === 0) {
            // Проверяем, не слишком ли рано обновлять (защита от частых обновлений)
            const stage = this.getControlSetStage(maxReached);
            const currentStage = this.controlSet.stage || 0;
            
            // Если стадия изменилась, можно обновить
            if (stage > currentStage) {
                return true;
            }
            
            // Если стадия та же, но прошло достаточно времени
            const dangerSinceCreation = this.dangerPassedCount - this.controlSet.createdAtDangerCount;
            if (dangerSinceCreation >= this.controlSetMinTTL) {
                return true;
            }
        }
        
        return false;
    }
    

    // Обеспечение наличия кнопок
    ensureButtons(state) {
        if (this.currentButtons.length > 0) return;
        
        const { timer } = state;
        const buttons = this.generateButtons(state);
        this.currentButtons = buttons;
        if (buttons.length > 0) {
            eventBus.emit('BUTTONS_UPDATED', { buttons });
        } else {
            // Принудительно создаем кнопки
            this.currentButtons = [
                { delta: 1, type: 'neutral', label: '+1' },
                { delta: 2, type: 'neutral', label: '+2' },
                { delta: -1, type: 'neutral', label: '-1' }
            ];
            eventBus.emit('BUTTONS_UPDATED', { buttons: this.currentButtons });
        }
    }

    // Получение фиксированного набора всех возможных кнопок
    getAllPossibleButtons() {
        // Фиксированный набор всех возможных кнопок в фиксированном порядке
        // Отрицательные слева, положительные справа, отсортированы по модулю
        return [-1, 2, 3, 4, 5, 6];
    }

    // Генерация кнопок из текущего ControlSet
    generateButtons(state) {
        const { timer } = state;
        
        // Убеждаемся, что ControlSet существует
        if (!this.controlSet) {
            if (typeof this.updateControlSet === 'function') {
                // КРИТИЧНО: передаем maxReached
                this.updateControlSet(timer.maxReached);
            } else {
                // Fallback если метод еще не определен
                this.controlSet = {
                    availableDeltas: [-1, 2],
                    createdAtDangerCount: 0,
                    createdAtMaxReached: timer.maxReached,
                    stage: 0
                };
            }
        }
        
        if (!this.controlSet || !this.controlSet.availableDeltas) {
            // Еще один fallback
            this.controlSet = {
                availableDeltas: [-1, 2],
                createdAtDangerCount: 0,
                createdAtMaxReached: timer.maxReached,
                stage: 0
            };
        }
        
        const availableDeltas = this.controlSet.availableDeltas;
        
        // Ближайшее активное/наступающее окно (end >= current), с минимальным start
        const nextWindow = this.dangerWindows
            .filter(w => (w.start + w.length - 1) >= timer.current)
            .reduce((min, w) => (!min || w.start < min.start ? w : min), null);
        
        // Определяем активные кнопки
        const activeDeltas = new Set();
        if (nextWindow) {
            // Solution button из окна
            activeDeltas.add(nextWindow.solutionDelta);
            
            // Остальные кнопки из ControlSet
            const otherDeltas = availableDeltas.filter(d => d !== nextWindow.solutionDelta);
            
            // Нейтральные кнопки (не приводят к попаданию в окно)
            const neutralDeltas = this.filterNeutralDeltas(otherDeltas, timer.current, nextWindow);
            neutralDeltas.forEach(d => activeDeltas.add(d));
            
            // Ловушки (опционально, в зависимости от прогресса)
            if (timer.maxReached > 20 && Math.random() > 0.5) {
                const trapDeltas = otherDeltas.filter(d => !neutralDeltas.includes(d));
                if (trapDeltas.length > 0) {
                    activeDeltas.add(trapDeltas[0]);
                }
            }
        } else {
            // Нет активных окон - все кнопки из ControlSet активны
            availableDeltas.forEach(d => activeDeltas.add(d));
        }
        
        // Гарантируем минимум 2 активные кнопки
        if (activeDeltas.size < 2) {
            const missing = availableDeltas.filter(d => !activeDeltas.has(d));
            missing.slice(0, 2 - activeDeltas.size).forEach(d => activeDeltas.add(d));
        }
        
        // Создаем фиксированный набор всех возможных кнопок
        const allPossibleButtons = this.getAllPossibleButtons();
        const buttons = allPossibleButtons.map(delta => {
            const isActive = activeDeltas.has(delta);
            let type = 'neutral';
            
            // Определяем тип только для активных кнопок
            if (isActive) {
                if (nextWindow && delta === nextWindow.solutionDelta) {
                    type = 'solution';
                } else if (nextWindow && availableDeltas.includes(delta)) {
                    // Проверяем, является ли это ловушкой
                    const windowStart = nextWindow.start;
                    const windowEnd = nextWindow.start + nextWindow.length - 1;
                    const newPos = timer.current + delta;
                    if (newPos >= windowStart && newPos <= windowEnd) {
                        type = 'trap';
                    } else {
                        type = 'neutral';
                    }
                } else {
                    type = 'neutral';
                }
            }
            
            return {
                delta: delta,
                type: type,
                label: delta > 0 ? `+${delta}` : `${delta}`,
                active: isActive
            };
        });
        
        return buttons;
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
    onDangerPassed(maxReached) {
        // Прошедшие окна уже перемещены в историю в update()
        this.dangerPassedCount++;
        
        // Проверяем, нужно ли обновить ControlSet
        if (this.shouldUpdateControlSet(maxReached)) {
            this.updateControlSet(maxReached);
        }
        
        // Сбрасываем кнопки для регенерации (но они будут из текущего ControlSet)
        this.currentButtons = [];
    }
    
    // Получение всех опасных окон (активных + пройденных)
    getAllDangerWindows() {
        return [...this.dangerWindows, ...this.passedDangerWindows];
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
            passedDangerWindows: this.passedDangerWindows,
            currentButtons: this.currentButtons,
            overrideRules: this.overrideRules,
            initialized: this.initialized,
            controlSet: this.controlSet,
            dangerPassedCount: this.dangerPassedCount
        };
    }

    // Восстановление из снапшота
    fromSnapshot(snapshot) {
        this.dangerWindows = snapshot.dangerWindows || [];
        this.passedDangerWindows = snapshot.passedDangerWindows || [];
        this.currentButtons = snapshot.currentButtons || [];
        this.overrideRules = snapshot.overrideRules || [];
        this.initialized = snapshot.initialized !== undefined ? snapshot.initialized : true;
        this.controlSet = snapshot.controlSet || null;
        this.dangerPassedCount = snapshot.dangerPassedCount || 0;
    }
}

