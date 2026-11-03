#!/bin/sh
# Unpacks the installers in /installers into /game, once. Needs the GOG installer of Heroes of Might and Magic III
# Complete (its .exe and the .bin beside it); the Horn of the Abyss installer is optional.
set -eu
mkdir -p /game
gog=$(ls /installers/setup_heroes_of_might_and_magic_3_complete*.exe 2>/dev/null | grep -v -i patch | head -1 || true)
hota=$(ls /installers/HotA*setup*.exe /installers/hota*setup*.exe 2>/dev/null | head -1 || true)
if [ ! -d /game/gog/Data ]; then
  if [ -z "$gog" ]; then
    echo "No GOG installer in installers/: put setup_heroes_of_might_and_magic_3_complete_...exe and its -1.bin there." >&2
    exit 1
  fi
  echo "Unpacking $(basename "$gog") (a few minutes)..."
  rm -rf /game/gog.part && innoextract --silent --progress=0 -d /game/gog.part "$gog"
  # Newer GOG installers put the game under app/; older ones at the top.
  if [ -d /game/gog.part/app/Data ]; then mv /game/gog.part/app /game/gog && rm -rf /game/gog.part; else mv /game/gog.part /game/gog; fi
fi
# The HotA files follow installers/: taken out (or swapped for another version), what was unpacked from it goes too.
hotaName=$( [ -n "$hota" ] && basename "$hota" || echo none)
if [ -d /game/hota ] && [ "$(cat /game/hota.from 2>/dev/null || echo unknown)" != "$hotaName" ]; then
  echo "The HotA installer changed or went: its files go."
  rm -rf /game/hota /game/hota.from /state/l10n/ru
fi
if [ ! -d /game/hota/app ]; then
  if [ -n "$hota" ]; then
    echo "Unpacking $(basename "$hota")..."
    rm -rf /game/hota.part && innoextract --silent --progress=0 -e -d /game/hota.part "$hota" && mv /game/hota.part /game/hota && echo "$hotaName" > /game/hota.from
  fi
fi
# What was found, for the setup page.
printf '{"gog":"%s","hota":"%s"}\n' "$(basename "$gog")" "$( [ -n "$hota" ] && basename "$hota")" > /game/installers.json
# HotA's Russian release, from the HotA installer itself: the game can speak Russian with no pack.
if [ -n "$hota" ] && [ -f "$hota" ] && [ ! -f /state/l10n/ru/lang.json ]; then
  mkdir -p /state/l10n && node /app/tools/i18n/hota-language.ts "$hota" /tmp/ru.tar.gz >/dev/null && tar xzf /tmp/ru.tar.gz -C /state/l10n && rm -f /tmp/ru.tar.gz || echo "No Russian from the HotA installer."
fi
echo "Game files ready: $(ls /game | tr '\n' ' ')"
