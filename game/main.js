// Router SPA minimaliste
const SCREENS = {
  main_menu:    () => import('./ui/screens/MainMenu.js'),
  deck_selector: () => import('./ui/screens/DeckSelector.js'),
  deck_builder:  () => import('./ui/screens/DeckBuilder.js'),
  game:          () => import('./ui/screens/GameScreen.js'),
  testbench:     () => import('./ui/screens/TestBench.js'),
  testbench3d:   () => import('./ui/screens/TestBench3D.js'),
  poc3d:         () => import('./ui/screens/Poc3D.js'),
  game3d:        () => import('./ui/screens/GameScreen3D.js'),
};

const container = document.getElementById('screen');
let currentScreen = null;

export async function navigate(screenName, params = {}) {
  if (!SCREENS[screenName]) throw new Error(`Unknown screen: ${screenName}`);
  container.innerHTML = '';
  currentScreen = screenName;
  const mod = await SCREENS[screenName]();
  await mod.mount(container, params);
}

// Bootstrap
// Permet d'ouvrir un écran directement via l'URL, ex: /?screen=deck_builder&publicDeckId=PUBLIC_DECK_001
const initialParams = new URLSearchParams(window.location.search);
const initialScreen = initialParams.get('screen');
if (initialScreen && SCREENS[initialScreen]) {
  navigate(initialScreen, Object.fromEntries(initialParams));
} else {
  navigate('main_menu');
}
