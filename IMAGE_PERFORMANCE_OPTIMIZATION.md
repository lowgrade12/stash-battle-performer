# Image Performance Optimization

## Summary

This document describes the performance optimizations made to handle large image libraries (177,000+ images) and the simplification to use Swiss mode exclusively for images.

## Changes Made

### 1. Sampling for Image Swiss Mode

Images use intelligent sampling when the library exceeds 1,000 images:

- **Libraries with ≤1,000 images**: Uses full dataset for accurate ranking
- **Libraries with >1,000 images**: Uses intelligent sampling (500 images) for fast performance
- Sampling uses random selection to ensure variety while maintaining rating-based matching

**Code Changes:**
- Updated `fetchSwissPairImages()` to check total image count and use sampling when appropriate
- When sampling is used, ranks are set to `null` since they don't represent true position in the full library
- Same adaptive rating window logic applies (10-25 point window based on pool size)

### 2. Swiss Mode Only for Images

Images now use **Swiss mode exclusively** for optimal performance and simplicity:

**What was removed:**
- Gauntlet mode for images (including 5-image selection UI)
- Champion mode for images
- Mode selection toggle on images page

**What was kept:**
- Full Swiss mode functionality with performance optimizations
- All three modes (Swiss, Gauntlet, Champion) remain available for performers

**Benefits:**
- Simpler, cleaner UI for images
- No need to track champion state or defeated opponents for images
- Performance optimizations (sampling) work perfectly with Swiss mode
- Users get straight into comparisons without mode selection

## Performance Impact

### Before Optimization:
- **Swiss Mode**: Fetched ALL images (177,000) from database, causing significant performance issues
- **Gauntlet/Champion Modes**: Required full dataset loading and complex state tracking

### After Optimization:
- **Swiss Mode Only**: Fetches only 500 images when library > 1,000 images
- **No Gauntlet/Champion**: Simplified code path, no unnecessary mode logic
- **Expected Performance**: ~350x reduction in data transfer for large libraries (177,000 → 500 images)
- **UI Performance**: Faster load times, simpler state management

## Technical Details

The implementation uses intelligent sampling:

```javascript
// Sampling logic
const totalImages = await fetchImageCount();
const useSampling = totalImages > 1000;
const sampleSize = useSampling ? Math.min(500, totalImages) : totalImages;

// Query adjustment
filter: {
  per_page: sampleSize,
  sort: useSampling ? "random" : "rating",
  direction: useSampling ? undefined : "DESC"
}
```

Mode enforcement for images:

```javascript
// Force Swiss mode for images
if (path === '/images' || path === '/images/') {
  battleType = "images";
  currentMode = "swiss";  // Always Swiss for images
}
```

## User Experience

1. **Swiss Mode**: Fast, fair matchups with no mode selection needed
   - Click the 🔥 button on images page
   - Start comparing immediately (no mode choice)
   - Rating adjustments happen in real-time
   - Skip button always available

2. **Performers**: Full mode selection remains available
   - Swiss, Gauntlet, and Champion modes all work as before
   - Mode toggle visible on performers page
   - All existing features preserved

## Backward Compatibility

All changes are backward compatible:
- Works with any size image library (2 to 177,000+)
- No database schema changes required
- Maintains existing rating algorithm and ELO calculations
- Existing image ratings preserved and continue to be updated
- Performers retain all three modes unchanged
