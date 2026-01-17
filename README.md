# HotOrNot Plugin

A plugin for [Stash](https://stashapp.cc/) that uses an ELO-style rating system to help you rank performers and images.

## 🔥 HotOrNot (Performers & Images)

A head-to-head comparison plugin that helps you rank performers and images.

**Features:**
- **Three Comparison Modes (Performers only):**
  - **Swiss** ⚖️ – Fair matchups between similarly-rated items. Both ratings adjust based on the outcome. Recently matched performers are less likely to reappear (but not excluded) to reduce repetition.
  - **Gauntlet** 🎯 – Place a random performer in your rankings. They climb from the bottom, challenging each performer above them until they lose, then settle into their final position.
  - **Champion** 🏆 – Winner stays on. The winning performer keeps battling until they're dethroned. Both performers' ratings and stats are updated, but at a reduced rate (50% of Swiss mode) to maintain more stable rankings while still allowing gradual adjustments.
- **Swiss Mode for Images:**
  - Images use Swiss mode exclusively for optimal performance with large libraries (177,000+ images tested).
  - Intelligent sampling ensures fast comparisons even with massive image collections.

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
2. **Optional:** Apply filters to narrow down performers (by tags, studios, favorites, etc.)
3. Click the floating 🔥 button in the bottom-right corner
4. Choose your preferred comparison mode
5. Click on a performer (or use arrow keys) to pick the winner
6. Watch your rankings evolve over time!

**New Feature - Dynamic Filter Support:** The plugin now dynamically captures and respects your currently active filters! Using Stash's `PluginApi.Event` system, the plugin automatically detects when you navigate or change filters on the performers page. This means:
- Filters are captured in real-time as you apply them
- The plugin always uses your current filters when you open HotOrNot
- You can filter performers by tags, studios, favorites, or any other criteria
- Filter changes are logged to the console for debugging

This allows you to:
- Run battles within specific categories (e.g., only performers with a "Favorite" tag)
- Compare performers from a specific studio
- Focus on performers matching specific criteria
- See exactly what filters are being applied via console logs

See [FILTER_CAPTURE_SUMMARY.md](FILTER_CAPTURE_SUMMARY.md) and [TESTING_FILTERS.md](TESTING_FILTERS.md) for technical details and testing instructions.

### For Images:
1. Navigate to the **Images** page in Stash
2. Click the floating 🔥 button in the bottom-right corner
3. Click on an image (or use arrow keys) to pick the winner
4. Watch your rankings evolve over time!

**Note:** Images use Swiss mode exclusively for optimal performance with large libraries. The mode selection (Swiss/Gauntlet/Champion) is only available for performers.

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

### Comprehensive Stats Tracking (NEW! - Approach 2)

Building on the match count tracking, the plugin now tracks detailed statistics for each performer:

- **Win/Loss Records**: See exactly how many matches each performer has won or lost
- **Win Streaks**: Track current streaks, best win streaks, and worst loss streaks
- **Match History**: Timestamp of last comparison
- **Smart Upgrades**: Automatically upgrades from basic match count to comprehensive stats
- **Recency-Aware Selection** (Swiss mode only): Recently matched performers are less likely to reappear, reducing repetition while keeping everyone in the pool

**Example Stats:**
- Total Matches: 42
- Win-Loss Record: 28-14 (66.7% win rate)
- Current Streak: 🔥 5 wins
- Best Streak: 8 wins
- Last Match: 2026-01-14

Stats are stored in the `hotornot_stats` custom field and work seamlessly with all three comparison modes (Swiss, Gauntlet, Champion).

**Mode-Specific Stat Tracking:**
- **Swiss Mode**: Both participants get full stats tracked (wins, losses, streaks). Ratings change at normal rate based on K-factor.
- **Gauntlet Mode**: 
  - Active champion/falling performer gets full stats tracked
  - Defenders get participation tracking only (match count and timestamp)
  - Defenders' wins/losses/streaks are NOT updated (they're benchmarks)
  - This ensures accurate match counts for K-factor calculation while preserving the gauntlet concept
- **Champion Mode**:
  - Both participants get full stats tracked (wins, losses, streaks)
  - Both performers' ratings are updated at a reduced rate (50% of Swiss mode K-factor)
  - This allows rankings to evolve gradually while maintaining the "winner stays on" excitement

**Recency Weighting (Swiss Mode):**
In Swiss mode, performer selection uses the `last_match` timestamp to reduce (but not eliminate) recently-matched performers:
- 0-1 hours ago: Very unlikely (~4% chance)
- 1-6 hours ago: Less likely (~12% chance)
- 6-24 hours ago: Moderately likely (~25% chance)
- 24+ hours ago: Full probability (~50% chance)

This ensures variety without completely excluding performers, so they can still appear if they're the best match rating-wise.

**Performance Optimization for Large Libraries:**
- Libraries with ≤1000 performers: Uses full dataset for accurate ranking
- Libraries with >1000 performers: Uses intelligent sampling (500 performers) for fast performance
- Recency weighting and rating-based matching work seamlessly in both modes
- Optimized for libraries with 15,000+ performers

**Technical Details:**
- See [APPROACH2_IMPLEMENTATION.md](APPROACH2_IMPLEMENTATION.md) for implementation details
- See [APPROACH2_SUMMARY.md](APPROACH2_SUMMARY.md) for overview and testing results
- See [CUSTOM_FIELDS_RESEARCH.md](CUSTOM_FIELDS_RESEARCH.md) for research and design decisions

## Requirements

- **Stash v0.27 or later** (for match count tracking feature)
- At least 2 performers or images in your library (depending on which page you're on)

## Credits

- **HotOrNot** - Inspired by [stash-battle](https://github.com/dtt-git/stash-battle) by dtt-git, adapted for performer and image ranking

## License

See [LICENCE](LICENCE) for details.
