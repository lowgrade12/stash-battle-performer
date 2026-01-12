# HotOrNot Plugin

A plugin for [Stash](https://stashapp.cc/) that uses an ELO-style rating system to help you rank performers.

## 🔥 HotOrNot (Performers)

A head-to-head performer comparison plugin that helps you rank performers.

**Features:**
- **Three Comparison Modes:**
  - **Swiss** ⚖️ – Fair matchups between similarly-rated performers. Both ratings adjust based on the outcome.
  - **Gauntlet** 🎯 – Place a random performer in your rankings. They climb from the bottom, challenging each performer above them until they lose, then settle into their final position.
  - **Champion** 🏆 – Winner stays on. The winning performer keeps battling until they're dethroned.

## Overview

The plugin presents you with two performers side-by-side and asks you to pick the better one. Based on your choices, ratings are automatically updated using an ELO algorithm. Over time, this builds an accurate ranking of your entire library based on your personal preferences.

## Installation

⚠️ Install at your own risk, nearly entirely vibe coded for myself using Claude, I have barely reviewed the code at all.

Recommend saving a backup of your database beforehand (Settings → Interface → Editing)

### Manual Download: 
1. Download the `/plugins/hotornot/` folder to your Stash plugins directory

## Usage

Optional Step: Change Rating System Type to "Decimal" (Settings → Interface → Editing)

1. Navigate to the **Performers** page in Stash
2. Click the floating 🔥 button in the bottom-right corner
3. Choose your preferred comparison mode
4. Click on a performer (or use arrow keys) to pick the winner
5. Watch your rankings evolve over time!

## How It Works

The plugin uses an ELO-inspired algorithm where:
- Beating a higher-rated performer earns more points than beating a lower-rated one
- Losing to a lower-rated performer costs more points than losing to a higher-rated one
- Ratings are stored in Stash's native `rating100` field (1-100 scale which is why changing to decimal rating system type is recommended)

## Requirements

- At least 2 performers in your library

## Credits

- **HotOrNot** - Inspired by [stash-battle](https://github.com/dtt-git/stash-battle) by dtt-git, adapted for performer ranking

## License

See [LICENCE](LICENCE) for details.
