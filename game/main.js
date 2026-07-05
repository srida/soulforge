// Router SPA minimaliste
const SCREENS = {
  main_menu:    () => import('./ui/screens/MainMenu.js'),
  deck_selector: () => import('./ui/screens/DeckSelector.js'),
  deck_builder:  () => import('./ui/screens/DeckBuilder.js'),
  testbench3d:   () => import('./ui/screens/TestBench3D.js'),
  game3d:        () => import('./ui/screens/GameScreen3D.js'),
  tournament:    () => import('./ui/screens/TournamentScreen.js'),
  auth:          () => import('./ui/screens/AuthScreen.js'),
  profile:       () => import('./ui/screens/ProfileScreen.js'),
  friends:       () => import('./ui/screens/FriendsScreen.js'),
};

const container = document.getElementById('screen');
let currentScreen = null;
let currentModule = null;

export async function navigate(screenName, params = {}) {
  if (!SCREENS[screenName]) throw new Error(`Unknown screen: ${screenName}`);
  currentModule?.unmount?.();
  container.innerHTML = '';
  currentScreen = screenName;
  const mod = await SCREENS[screenName]();
  currentModule = mod;
  await mod.mount(container, params);
}

// Bootstrap
// Permet d'ouvrir un écran directement via l'URL, ex: /?screen=deck_builder&publicDeckId=PUBLIC_DECK_001
const initialParams = new URLSearchParams(window.location.search);
const initialScreen = initialParams.get('screen');

async function bootstrap() {
  // Résout la session puis synchronise les decks du compte, idéalement AVANT le
  // premier écran (pour que DeckSelector/DeckBuilder voient les bons decks).
  // Mais on ne bloque JAMAIS le rendu sur le réseau online : si le serveur
  // traîne ou ne répond pas, on rend le menu au bout de 2s en mode local.
  const sync = (async () => {
    const AuthClient = await import('./data/AuthClient.js');
    await AuthClient.me();
    if (AuthClient.isLoggedIn()) {
      const DeckRepository = await import('./data/DeckRepository.js');
      await DeckRepository.pull();
    }
  })().catch(() => { /* ignore : mode local */ });

  try {
    await Promise.race([sync, new Promise(r => setTimeout(r, 2000))]);
  } catch { /* ignore */ }

  if (initialScreen && SCREENS[initialScreen]) {
    navigate(initialScreen, Object.fromEntries(initialParams));
  } else {
    navigate('main_menu');
  }
}

bootstrap();
