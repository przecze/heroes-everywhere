# Changes

## 2026-11-03

- Without the HotA installer the main menu and loading screen show the original's pictures, even where HotA's
  were unpacked or kept by the browser before (taking the installer out of installers/ now takes its files too).
- The game's own names in the browser, the environment (HEROES_DATA_DIRS ...) and the scripting handle
  (window.heroes) say "heroes".
- Without HotA's files: the quick exchange buttons (all one way, swap), Min / Max by the sliders and the town's
  Exchange button stay, drawn as plain arrows; New Game starts with HotA's content off.
- A map's story window waits for the loading screen to finish; "X is moving" goes as your turn starts.
- Battles: a wide creature strikes from any of the eight sides around a hex; breath attacks follow the original;
  fliers and the moat, the drawbridge and the Dreadnought's punch as the original.
- Routes go through your own garrisons; a route ends at its object's visit; entrances closed above work both ways.
- Holding any battle or map button says what it does, and a held pop-up stays after the finger lifts.
- Phones: battles no longer freeze while aiming; the map's ground jumps at once; HotA's creatures take far less memory;
  the marketplace pays with a tap on one of seven resource cards.
- New games start on Hard (130%); random dwellings tied to a town take its faction.
- New Game: the desktop and phone screens share one setup, so they no longer disagree.
- Fixed: no "move" reminder for a hero that can't step; a full army at a dwelling makes room; a tap inside a window
  never closes it.

## 2026-11-02

- Towns on the map show what is built in them: the village, the walls, the Capitol.
- Undo in battle: back to before your last move (the battle's menu, or Ctrl+Z).
- A new computer opponent: it plans its economy
  around its rivals, flees stronger armies, takes guarded routes, teleports and boats, and casts adventure spells
  (Fly, Water Walk, Dimension Door, Town Portal, Visions and more).
- The computer's personality is picked with the original's arrows in Advanced Options and on Random Map.
- Phones: smoother play (the map draws only what is near the screen, 60 frames a second at most); the battle log
  in words with every effect; upright battles show only the heroes' front half.
- Monsters are drawn exactly where they stand.
- Phones: the battle menu as nine tiles with Undo first; one shopping list for every shop; upright towns show each
  hero against its own army; windows full width.
- Map objects say what they do, on hover and in the long-press pop-up.
- Sieges: the drawbridge follows the original (corpses hold it down), towers aim as the original.
- Seers, banks, week animals and objects' names in the game's language.
- Fixed: a texture leak that crashed phones after a while; a hired hero's army now matches the tavern's preview;
  a game played on another device no longer hangs here.

## 2026-11-01

- The licence is MIT.
- The computer plays fair: it decides only on what its player can see. Full games end again (Free for All, seed 2:
  Red wins on day 425).
- Every message, the battle log and the market speak the game's own lines from your files, in your installer's
  language; nothing of the game's text is in this repository.
- The original heroes' starting armies follow your installer: Horn of the Abyss sizes with its installer, the
  original's without.
- On a computer the adventure map is drawn at the screen's own pixels, so it stays sharp zoomed out.
- Siege tactics; boats in their faction's look; the Capitol greyed where it can't be built; movement bars per tile;
  portraits in the hero exchange; the sound of an empty find; map objects' titles in the game's language.
