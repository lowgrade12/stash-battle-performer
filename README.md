# HotOrNot Plugin

A plugin for [Stash](https://stashapp.cc/) that uses an ELO-style rating system to rank performers and images through head-to-head comparisons.

## Features

**Comparison Modes:**
- **Swiss** ⚖️ – Fair matchups between similarly-rated items with recency weighting to reduce repetition (available for performers and images)
- **Gauntlet** 🎯 – Place a performer in your rankings by climbing from the bottom until they lose (performers only)
- **Champion** 🏆 – Winner stays on, with reduced rating changes for stable rankings (performers only)

**Smart Tracking:**
- Comprehensive statistics: wins, losses, streaks, win rates, and match history
- Adaptive K-factor: new performers adjust faster, established performers maintain stable rankings
- Dynamic filter support: respects your active Stash filters (tags, studios, favorites, etc.)

**Performance Optimized:**
- Performers: Full dataset for accurate ranking across all library sizes
- Images: Intelligent sampling (500) for libraries >1000 images
- Tested with 15,000+ performers and 177,000+ images

## Installation

⚠️ **Backup your database first** (Settings → Interface → Editing)

1. Download the `/plugins/hotornot/` folder to your Stash plugins directory
2. Optional: Change Rating System Type to "Decimal" for better precision (Settings → Interface → Editing)

## Usage

**For Performers:**
1. Navigate to the Performers page in Stash
2. Optional: Apply filters (tags, studios, favorites, etc.) - the plugin respects your active filters
3. Click the 🔥 button in the bottom-right corner
4. Choose your comparison mode (Swiss/Gauntlet/Champion)
5. Click a performer (or use arrow keys) to pick the winner
6. Click "📊 View All Stats" to see comprehensive statistics

**For Images:**
1. Navigate to the Images page in Stash
2. Click the 🔥 button in the bottom-right corner
3. Click an image (or use arrow keys) to pick the winner

## How It Works

**ELO Rating System:**
- Ratings stored in Stash's native `rating100` field (1-100 scale)
- Beating higher-rated items earns more points
- Losing to lower-rated items costs more points

**Adaptive K-Factor:**
- New performers (<10 matches): K=16 for fast initial positioning
- Moderately established (10-30 matches): K=12 for balanced adjustments
- Well-established (>50 matches): K=8 for stable rankings

**Statistics Tracking:**
Tracks wins, losses, streaks, win rates, and match history in the `hotornot_stats` custom field.

**Mode-Specific Behavior:**
- **Swiss**: Full stats and normal rating changes for both participants
- **Gauntlet**: Full stats for active challenger; defenders get participation tracking only
- **Champion**: Full stats for both, but 50% reduced K-factor for gradual evolution

**Recency Weighting (Swiss Mode):**
Recently matched performers are less likely to reappear:
- 0-1 hours ago: ~4% chance
- 1-6 hours ago: ~12% chance
- 6-24 hours ago: ~25% chance
- 24+ hours ago: ~50% chance

## Requirements

- Stash v0.27 or later
- At least 2 performers or images in your library

## Technical Details

For implementation details and design decisions, see:
- [APPROACH2_IMPLEMENTATION.md](APPROACH2_IMPLEMENTATION.md)
- [APPROACH2_SUMMARY.md](APPROACH2_SUMMARY.md)
- [CUSTOM_FIELDS_RESEARCH.md](CUSTOM_FIELDS_RESEARCH.md)
- [FILTER_CAPTURE_SUMMARY.md](FILTER_CAPTURE_SUMMARY.md)
- [TESTING_FILTERS.md](TESTING_FILTERS.md)

## Credits

Inspired by [stash-battle](https://github.com/dtt-git/stash-battle) by dtt-git

## License

See [LICENCE](LICENCE) for details.
