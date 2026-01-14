# HotOrNot Plugin

A plugin for [Stash](https://stashapp.cc/) that uses an ELO-style rating system to help you rank performers and images.

## 🔥 HotOrNot (Performers & Images)

A head-to-head comparison plugin that helps you rank performers and images.

**Features:**
- **Three Comparison Modes:**
  - **Swiss** ⚖️ – Fair matchups between similarly-rated items. Both ratings adjust based on the outcome.
  - **Gauntlet** 🎯 – Place a random item in your rankings. They climb from the bottom, challenging each item above them until they lose, then settle into their final position.
  - **Champion** 🏆 – Winner stays on. The winning item keeps battling until they're dethroned.

## Overview

The plugin presents you with two performers or images side-by-side and asks you to pick the better one. Based on your choices, ratings are automatically updated using an ELO algorithm. Over time, this builds an accurate ranking of your entire library based on your personal preferences.

## Installation

⚠️ Install at your own risk, nearly entirely vibe coded for myself using Claude, I have barely reviewed the code at all.

Recommend saving a backup of your database beforehand (Settings → Interface → Editing)

### Manual Download: 
1. Download the `/plugins/hotornot/` folder to your Stash plugins directory

## Usage

Optional Step: Change Rating System Type to "Decimal" (Settings → Interface → Editing)

### For Performers:
1. Navigate to the **Performers** page in Stash
2. Click the floating 🔥 button in the bottom-right corner
3. Choose your preferred comparison mode
4. Click on a performer (or use arrow keys) to pick the winner
5. Watch your rankings evolve over time!

### For Images:
1. Navigate to the **Images** page in Stash
2. Click the floating 🔥 button in the bottom-right corner
3. Choose your preferred comparison mode
4. Click on an image (or use arrow keys) to pick the winner
5. Watch your rankings evolve over time!

## How It Works

The plugin uses an ELO-inspired algorithm where:
- Beating a higher-rated item earns more points than beating a lower-rated one
- Losing to a lower-rated item costs more points than losing to a higher-rated one
- Ratings are stored in Stash's native `rating100` field (1-100 scale which is why changing to decimal rating system type is recommended)

### Match Count Tracking (NEW!)

For performers, the plugin now tracks how many comparisons each performer has participated in using Stash's native **customFields API** (requires Stash v0.27+):
- **New performers** (<10 matches): Faster rating changes (K=16) to quickly find their accurate position
- **Moderately established** (10-30 matches): Balanced rating changes (K=12)
- **Well-established** (>50 matches): Smaller rating changes (K=8) for stable rankings

This means new performers reach their accurate rating faster, while established performers' hard-earned rankings are better protected from random fluctuations.

Match data is stored using Stash's custom fields feature and is fully backward compatible with existing performers.

## Requirements

- **Stash v0.27 or later** (for match count tracking feature)
- At least 2 performers or images in your library (depending on which page you're on)

## Credits

- **HotOrNot** - Inspired by [stash-battle](https://github.com/dtt-git/stash-battle) by dtt-git, adapted for performer and image ranking

## License

See [LICENCE](LICENCE) for details.
