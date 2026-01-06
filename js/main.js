// Точка входа
let game;

async function init() {
    game = new Game();
    await game.init();
    
    // Показываем стартовый экран (игра начнется по клику на PLAY)
    game.renderer.showStartScreen();
}

// Инициализация при загрузке
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

