# ⚔️ Stash Battle

A head-to-head comparison plugin for [Stash](https://stashapp.cc/) that uses an ELO-style rating system to help you rank your scenes and performers.

## Overview

Stash Battle presents you with two items (scenes or performers) side-by-side and asks you to pick the better one. Based on your choices, ratings are automatically updated using an ELO algorithm. Over time, this builds an accurate ranking of your entire library based on your personal preferences.

## Features

- **Dual Mode Support:**
  - **Scenes** 🎬 – Compare and rank scenes from your library
  - **Performers** 👤 – Compare and rank performers
  
- **Three Comparison Modes:**
  - **Swiss** ⚖️ – Fair matchups between similarly-rated items. Both ratings adjust based on the outcome.
  - **Gauntlet** 🎯 – Place a random item in your rankings. It climbs from the bottom, challenging each item above it until it loses, then settles into its final position.
  - **Champion** 🏆 – Winner stays on. The winning item keeps battling until it's dethroned.

## Installation

⚠️ Install at your own risk, nearly entirely vibe coded for myself using Claude, I have barely reviewed the code at all.

Recommend saving a backup of your database beforehand (Settings → Interface → Editing)

### Manual Download: 
1. Download the `/plugins/stash-battle/` folder to your Stash plugins directory

## Usage

Optional Step: Change Rating System Type to "Decimal" (Settings → Interface → Editing)

### For Scenes:
1. Navigate to the **Scenes** page in Stash
2. Click the floating ⚔️ button in the bottom-right corner
3. Choose your preferred comparison mode
4. Click on a scene (or use arrow keys) to pick the winner
5. Watch your rankings evolve over time!

### For Performers:
1. Navigate to the **Performers** page in Stash
2. Click the floating ⚔️ button in the bottom-right corner
3. Choose your preferred comparison mode
4. Click on a performer (or use arrow keys) to pick the winner
5. Watch your rankings evolve over time!

## How It Works

The plugin uses an ELO-inspired algorithm where:
- Beating a higher-rated item earns more points than beating a lower-rated one
- Losing to a lower-rated item costs more points than losing to a higher-rated one
- Ratings are stored in Stash's native `rating100` field (1-100 scale which is why changing to decimal rating system type is recommended)

## Requirements

- At least 2 scenes or 2 performers in your library (depending on mode)

## Credits

This plugin merges functionality from:
- [stash-battle](https://github.com/dtt-git/stash-battle) by dtt-git (scenes)
- stash-battle-performer (performers - derivative work)

Both plugins have been combined into a single unified plugin that works on both scenes and performers.

## License

See [LICENCE](LICENCE) for details.
