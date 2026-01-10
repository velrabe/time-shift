// Таймер с экспоненциальным ускорением
class Timer {
    constructor() {
        this.current = 0;
        this.maxReached = 0;
        this.direction = 1; // 1 = вперед, -1 = назад
        this.stepDurationSec = 1.0;
        // tickStartTimeMs: старт текущего тика (время прогресса внутри тика)
        this.lastStepTime = 0;
        this.tickCounter = 0;
        // Визуальная "плавная перемотка" (чтобы хоткей не телепортировал ленту мгновенно)
        // shiftOffset добавляется к дробной позиции и за 1 тик анимируется к 0.
        this.shiftVisual = null; // { startTimeMs, durationMs, fromOffset }
        this.shiftAnimId = 0;
        
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

    // ======= Профиль движения внутри тика (time -> distance) =======
    // Требование:
    // - первые 15% пути проходят за 60% времени с плавным ускорением (ease-in)
    // - оставшиеся 85% пути проходят за 40% времени (быстро)
    //
    // timeProgress: 0..1 (время в рамках тика)
    // distanceProgress: 0..1 (пройденная доля "точки")
    distanceProgressFromTimeProgress(timeProgress) {
        const t = Math.max(0, Math.min(1, Number(timeProgress)));
        const tSlow = 0.60;
        const sSlow = 0.15;
        if (t <= tSlow) {
            const x = tSlow > 0 ? (t / tSlow) : 1;
            // ease-in quad
            return sSlow * (x * x);
        }
        // оставшиеся 40% времени — оставшиеся 85% пути линейно
        const x = (t - tSlow) / Math.max(1e-9, (1 - tSlow)); // 0..1
        return sSlow + (1 - sSlow) * x;
    }

    // Инверсия: distance -> time (нужно, чтобы после SHIFT сохранить % пути)
    timeProgressFromDistanceProgress(distanceProgress) {
        const s = Math.max(0, Math.min(1, Number(distanceProgress)));
        const tSlow = 0.60;
        const sSlow = 0.15;
        if (s <= sSlow) {
            const x = sSlow > 0 ? (s / sSlow) : 1;
            // inverse of ease-in quad: x = sqrt(s/sSlow)
            return tSlow * Math.sqrt(Math.max(0, x));
        }
        const x = (s - sSlow) / Math.max(1e-9, (1 - sSlow)); // 0..1
        return tSlow + (1 - tSlow) * x;
    }

    // Прогресс по времени в текущем тике (0..1)
    getTickTimeProgress(nowMs) {
        if (!this.lastStepTime) return 0;
        const durMs = Math.max(1, this.stepDurationSec * 1000);
        return Math.max(0, Math.min(1, (nowMs - this.lastStepTime) / durMs));
    }

    // Прогресс по пути в текущем тике (0..1)
    getTickDistanceProgress(nowMs) {
        return this.distanceProgressFromTimeProgress(this.getTickTimeProgress(nowMs));
    }

    // Текущая "дробная позиция" (например 2.9)
    getPosition(nowMs) {
        const s = this.getTickDistanceProgress(nowMs);
        return this.current + this.direction * s + this.getShiftOffset(nowMs);
    }

    // Текущий визуальный оффсет перемотки (анимируется к 0 за durationMs)
    getShiftOffset(nowMs) {
        const anim = this.shiftVisual;
        if (!anim) return 0;
        const dur = Math.max(1, anim.durationMs);
        const t = Math.max(0, Math.min(1, (nowMs - anim.startTimeMs) / dur));
        // Для хоткей-перемотки хотим "быстро доехать" до целевой точки без профиля авто-тика.
        // Поэтому в shift-режиме используем линейный прогресс.
        const p = anim.profile === 'fast_linear' ? t : this.distanceProgressFromTimeProgress(t);
        const offset = (anim.fromOffset || 0) * (1 - p);
        if (t >= 1) {
            // завершили визуальную перемотку
            this.shiftVisual = null;
            return 0;
        }
        return offset;
    }

    // Обновление таймера
    update(currentTime) {
        if (this.lastStepTime === 0) {
            this.lastStepTime = currentTime;
            return;
        }

        this.stepDurationSec = this.calculateStepDuration();

        // Можем перескочить несколько тиков за один кадр (если вкладка лагнула) — обрабатываем в цикле.
        const durMs = Math.max(1, this.stepDurationSec * 1000);
        let elapsedMs = currentTime - this.lastStepTime;

        // Обрабатываем тики порциями, сохраняя остаток времени внутри текущего тика
        let guard = 0;
        while (elapsedMs >= durMs && guard < 10) {
            this.current += this.direction;
            this.tickCounter += 1;

            if (this.direction === 1 && this.current > this.maxReached) {
                this.maxReached = this.current;
            }

            this.lastStepTime += durMs;
            elapsedMs = currentTime - this.lastStepTime;

            eventBus.emit('TICK_STEP', {
                current: this.current,
                maxReached: this.maxReached,
                stepDuration: this.stepDurationSec,
                timer: this
            });
            guard++;
        }
    }

    // Сдвиг таймера
    shift(delta) {
        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        this.stepDurationSec = this.calculateStepDuration();

        // Сохраняем "процент пути" внутри тика (distanceProgress), чтобы после SHIFT он остался тем же.
        const distanceProgress = this.getTickDistanceProgress(nowMs);
        const prevVisualOffset = this.getShiftOffset(nowMs);

        const prevCurrent = this.current;
        let newCurrent = prevCurrent + delta;
        if (newCurrent < 0) newCurrent = 0;
        this.current = newCurrent;
        const effectiveDelta = newCurrent - prevCurrent;

        if (this.current > this.maxReached) {
            this.maxReached = this.current;
        }

        // Восстанавливаем tickStartTime так, чтобы timeProgress соответствовал тем же % пути,
        // иначе после SHIFT тик "перескочит" или резко замедлится.
        const timeProgress = this.timeProgressFromDistanceProgress(distanceProgress);
        const durMs = Math.max(1, this.stepDurationSec * 1000);
        this.lastStepTime = nowMs - timeProgress * durMs;

        // Визуально лента должна "доехать" до новой позиции за то же время, что и авто-тик.
        // Поэтому логический current меняем мгновенно (кнопки/окна пересчитываются),
        // а визуальный оффсет ставим таким, чтобы позиция НЕ прыгнула, и плавно анимируем к 0 за 1 тик.
        // Если уже была незавершённая визуальная перемотка — учитываем её, чтобы не было дерганья.
        // Важно: используем effectiveDelta (после клэмпа), иначе "назад" около 0 ломается.
        const fromOffset = (prevVisualOffset || 0) - effectiveDelta;
        const animId = ++this.shiftAnimId;
        this.shiftVisual = {
            startTimeMs: nowMs,
            // Хоткей должен доезжать до конечной точки быстро (за 40% времени тика)
            durationMs: durMs * 0.4,
            fromOffset,
            profile: 'fast_linear',
            id: animId
        };
        
        eventBus.emit('SHIFT_USED', { 
            delta: effectiveDelta, 
            current: this.current,
            position: this.getPosition(nowMs),
            animId,
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

