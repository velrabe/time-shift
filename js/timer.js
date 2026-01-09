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

        // Slow down (streak perk)
        this.slowDownActive = false;
        this.slowDownEndTime = 0;
        this.slowDownRecoverStartTime = 0;
        this.slowDownRecoverEndTime = 0;
    }

    // Вычисление длительности шага по формуле
    calculateStepDuration() {
        if (this.inversionActive) {
            // Во время инверсии скорость заморожена на значении активации
            return this.frozenStepDuration || this.stepDurationSec;
        }

        const now = Date.now();
        if (this.slowDownActive && now < this.slowDownEndTime) {
            // Во время slow down скорость = дефолтная
            return this.S0;
        }
        
        const progress = this.maxReached;
        const target = this.Smax + (this.S0 - this.Smax) * Math.exp(-this.k * progress);
        const clampedTarget = Math.max(target, this.Smax);

        // Быстро возвращаемся к нормальной скорости после slow down (быстрый "набор скорости")
        if (this.slowDownRecoverStartTime && now >= this.slowDownRecoverStartTime && now < this.slowDownRecoverEndTime) {
            const p = (now - this.slowDownRecoverStartTime) / Math.max(1, (this.slowDownRecoverEndTime - this.slowDownRecoverStartTime));
            const t = Math.max(0, Math.min(1, p));
            return this.S0 + (clampedTarget - this.S0) * t;
        }

        return clampedTarget;
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

        // ВАЖНО: при ручном сдвиге "текущий шаг" меняется мгновенно,
        // поэтому нужно обнулить таймер шага, иначе следующий auto-step
        // может сработать раньше (донаследует elapsed от прошлого шага).
        // Ставим 0, чтобы следующий update() заново инициализировал старт тика
        // и гарантированно дал "полный тик на подумать" после перемотки.
        this.lastStepTime = 0;
        // Обновим значение длительности шага, чтобы UI/анимации брали актуальную скорость.
        this.stepDurationSec = this.calculateStepDuration();
        
        eventBus.emit('SHIFT_USED', { 
            delta, 
            current: this.current,
            timer: this // Передаем таймер для обновления ленты
        });
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

    // Активация slow down: скорость = дефолт (S0) на durationSec, затем быстрый возврат к нормальной
    activateSlowDown(durationSec = 10, recoverSec = 2.5) {
        const now = Date.now();
        this.slowDownActive = true;
        this.slowDownEndTime = now + durationSec * 1000;
        this.slowDownRecoverStartTime = this.slowDownEndTime;
        this.slowDownRecoverEndTime = this.slowDownEndTime + recoverSec * 1000;
        eventBus.emit('SLOWDOWN_ACTIVATED', { duration: durationSec });
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
        this.slowDownActive = false;
        this.slowDownEndTime = 0;
        this.slowDownRecoverStartTime = 0;
        this.slowDownRecoverEndTime = 0;
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
            frozenStepDuration: this.frozenStepDuration,
            slowDownActive: this.slowDownActive,
            slowDownEndTime: this.slowDownEndTime,
            slowDownRecoverStartTime: this.slowDownRecoverStartTime,
            slowDownRecoverEndTime: this.slowDownRecoverEndTime
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
        this.slowDownActive = snapshot.slowDownActive || false;
        this.slowDownEndTime = snapshot.slowDownEndTime || 0;
        this.slowDownRecoverStartTime = snapshot.slowDownRecoverStartTime || 0;
        this.slowDownRecoverEndTime = snapshot.slowDownRecoverEndTime || 0;
        this.lastStepTime = 0; // сброс для корректного обновления
    }
}

