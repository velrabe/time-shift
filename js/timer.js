// Таймер с экспоненциальным ускорением
class Timer {
    constructor() {
        this.current = 0;
        this.maxReached = 0;
        this.direction = 1; // 1 = вперед, -1 = назад
        this.stepDurationSec = 1.0;
        this.lastStepTime = 0;
        
        // Параметры скорости
        this.S0 = 1.0; // базовая скорость
        this.Smax = 0.3; // минимальная скорость (максимальное ускорение)
        this.k = 0.002; // коэффициент ускорения (уменьшен для более плавного ускорения)
        
        // Инверсия
        this.inversionActive = false;
        this.inversionEndTime = 0;
        this.frozenStepDuration = null;
    }

    // Вычисление длительности шага по формуле
    calculateStepDuration() {
        if (this.inversionActive) {
            // Во время инверсии скорость заморожена на значении активации
            return this.frozenStepDuration || this.stepDurationSec;
        }
        
        const progress = this.maxReached;
        const stepDuration = this.Smax + (this.S0 - this.Smax) * Math.exp(-this.k * progress);
        return Math.max(stepDuration, this.Smax);
    }

    // Обновление таймера
    update(currentTime) {
        if (this.lastStepTime === 0) {
            this.lastStepTime = currentTime;
            return;
        }

        const elapsed = (currentTime - this.lastStepTime) / 1000; // в секундах
        this.stepDurationSec = this.calculateStepDuration();
        
        if (elapsed >= this.stepDurationSec) {
            this.current += this.direction;
            
            // Обновляем maxReached только при движении вперед
            if (this.direction === 1 && this.current > this.maxReached) {
                this.maxReached = this.current;
            }
            
            this.lastStepTime = currentTime;
            eventBus.emit('TICK_STEP', {
                current: this.current,
                maxReached: this.maxReached,
                stepDuration: this.stepDurationSec,
                timer: this // Передаем сам таймер для обновления ленты
            });
        }
    }

    // Сдвиг таймера
    shift(delta) {
        this.current += delta;
        
        // Обновляем maxReached при движении вперед
        if (this.current > this.maxReached) {
            this.maxReached = this.current;
        }
        
        eventBus.emit('SHIFT_USED', { delta, current: this.current });
    }

    // Активация инверсии
    activateInversion(durationSec = 60) {
        this.inversionActive = true;
        this.direction = -1;
        // Замораживаем скорость на текущем значении
        this.frozenStepDuration = this.stepDurationSec;
        this.inversionEndTime = Date.now() + durationSec * 1000;
        eventBus.emit('INVERSION_ACTIVATED', { duration: durationSec });
    }

    // Деактивация инверсии
    deactivateInversion() {
        this.inversionActive = false;
        this.direction = 1;
        this.frozenStepDuration = null;
        eventBus.emit('INVERSION_DEACTIVATED');
    }

    // Проверка окончания инверсии
    checkInversion() {
        if (this.inversionActive && Date.now() >= this.inversionEndTime) {
            this.deactivateInversion();
        }
    }

    // Получение множителя скорости для аудио
    getSpeedMultiplier() {
        return Math.min(this.S0 / this.stepDurationSec, this.S0 / this.Smax);
    }

    // Сброс
    reset() {
        this.current = 0;
        this.maxReached = 0;
        this.direction = 1;
        this.stepDurationSec = 1.0;
        this.lastStepTime = 0;
        this.inversionActive = false;
        this.inversionEndTime = 0;
    }

    // Сериализация для снапшота
    toSnapshot() {
        return {
            current: this.current,
            maxReached: this.maxReached,
            direction: this.direction,
            stepDurationSec: this.stepDurationSec,
            inversionActive: this.inversionActive,
            inversionEndTime: this.inversionEndTime,
            frozenStepDuration: this.frozenStepDuration
        };
    }

    // Восстановление из снапшота
    fromSnapshot(snapshot) {
        this.current = snapshot.current || 0;
        this.maxReached = snapshot.maxReached || 0;
        this.direction = snapshot.direction || 1;
        this.stepDurationSec = snapshot.stepDurationSec || 1.0;
        this.inversionActive = snapshot.inversionActive || false;
        this.inversionEndTime = snapshot.inversionEndTime || 0;
        this.frozenStepDuration = snapshot.frozenStepDuration || null;
        this.lastStepTime = 0; // сброс для корректного обновления
    }
}

