// Точка входа
let game;

async function init() {
    game = new Game();
    await game.init();
    
    // Автоматический старт (можно изменить на кнопку)
    game.start();
}

// Инициализация при загрузке
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

