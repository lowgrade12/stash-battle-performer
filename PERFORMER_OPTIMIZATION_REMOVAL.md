# Performer Optimization Removal & Stats Feature

## Summary

This update removes the performance optimization (sampling) from performers while keeping it for images, and adds a comprehensive stats breakdown feature for performers.

## Changes Made

### 1. Removed Performer Sampling

**Before:**
- Libraries with ≤1000 performers: Full dataset
- Libraries with >1000 performers: Sampling (500 performers)

**After:**
- **All performer libraries:** Full dataset for accurate ranking
- No sampling regardless of library size

**Code Changes:**
- Removed sampling logic from `fetchSwissPairPerformers()` (lines ~1810-1814)
- Changed to always use `per_page: -1` for full dataset
- Removed conditional rank nullification

### 2. Image Sampling Unchanged

Images continue to use intelligent sampling:
- Libraries with ≤1000 images: Full dataset
- Libraries with >1000 images: Sampling (500 images)

This optimization remains in `fetchSwissPairImages()` for performance with large image libraries (177,000+ tested).

### 3. New Performer Stats Feature

Added a "📊 View All Stats" button (performers only) that displays:

**Summary Statistics:**
- Total performers
- Total matches
- Average matches per performer
- Average rating

**Per-Performer Statistics:**
- Current rank (by rating)
- Name (with link to performer page)
- Rating (0-100)
- Total matches
- Wins (green)
- Losses (red)
- Win rate percentage
- Current streak (positive/negative)
- Best streak
- Worst streak

**Implementation:**
- `fetchAllPerformerStats()` - Fetches all performers with current filters
- `createStatsModalContent()` - Generates stats table HTML
- `openStatsModal()` - Opens modal with loading state, then displays stats
- Respects URL filters (uses `getPerformerFilter()`)
- Responsive table design with sticky header
- Color-coded stats (wins=green, losses=red, ranks=gold)

### 4. CSS Additions

Added comprehensive styling:
- `.hon-stats-button` - Stats button in header
- `.hon-stats-modal` - Modal overlay
- `.hon-stats-modal-dialog` - Modal content area
- `.hon-stats-table` - Statistics table
- Color classes for positive/negative values
- Mobile responsive breakpoints

## Benefits

### Performers
- ✅ Always accurate ranking across all library sizes
- ✅ No rank null values in Swiss mode
- ✅ Comprehensive stats breakdown
- ✅ Better visibility into performer performance

### Images
- ✅ Maintains performance optimization for large libraries
- ✅ Fast comparisons with 177,000+ images

### Filtering
- ✅ All features respect URL filters
- ✅ Stats modal shows only filtered performers
- ✅ Consistent filter behavior across all modes

## Testing Checklist

- [x] Syntax validation (no errors)
- [x] Performer sampling removed
- [x] Image sampling preserved
- [x] Stats button added to performers UI
- [x] Stats modal opens and displays data
- [x] Filters respected in stats modal
- [x] CSS styling applied correctly
- [x] Documentation updated

## Usage

1. Navigate to `/performers` page
2. Click the 🔥 button to open HotOrNot
3. Click "📊 View All Stats" to see comprehensive statistics
4. View breakdown of all performers with their rankings and performance
5. Click performer names to open their detail pages

## Technical Details

**Stats Data Source:**
- Uses `hotornot_stats` custom field (JSON)
- Parses via `parsePerformerEloData()`
- Displays comprehensive match statistics

**Filter Compatibility:**
- Stats modal uses `getPerformerFilter()`
- Respects cached URL filters from page
- Consistent with comparison filtering

**Performance:**
- Stats fetch uses `per_page: -1` (full dataset)
- Single query for all performers
- Client-side sorting and calculation
- Optimized table rendering

## Files Modified

- `plugins/hotornot/hotornot.js` - Main logic
- `plugins/hotornot/hotornot.css` - Stats styling
- `README.md` - Documentation updates
