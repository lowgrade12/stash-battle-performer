# Image Performance Optimization

## Summary

This document describes the performance optimizations made to handle large image libraries (177,000+ images).

## Changes Made

### 1. Sampling for Image Swiss Mode

Similar to the existing performer optimization, images now use intelligent sampling when the library exceeds 1,000 images:

- **Libraries with ≤1,000 images**: Uses full dataset for accurate ranking
- **Libraries with >1,000 images**: Uses intelligent sampling (500 images) for fast performance
- Sampling uses random selection to ensure variety while maintaining rating-based matching

**Code Changes:**
- Updated `fetchSwissPairImages()` to check total image count and use sampling when appropriate
- When sampling is used, ranks are set to `null` since they don't represent true position in the full library
- Same adaptive rating window logic applies (10-25 point window based on pool size)

### 2. 5-Image Selection for Gauntlet Mode

Added the same 5-image selection UI that was previously only available for performers:

**New Functions:**
- `fetchImagesForSelection(count = 5)`: Fetches a random sample of images for selection
- `createImageSelectionCard(image)`: Creates HTML for an image selection card
- `loadImageSelection()`: Loads and displays the image selection UI
- `startGauntletWithImage(image)`: Starts the gauntlet with the selected image as champion
- `showImageSelection()`: Shows the image selection UI
- `hideImageSelection()`: Hides the image selection UI

**Integration:**
- Updated `loadNewPair()` to show image selection when entering gauntlet mode with images
- Updated mode switching logic to hide image selection when leaving gauntlet mode
- Reuses the same HTML container (`hon-performer-selection`) and styling as performer selection

## Performance Impact

### Before:
- **Swiss Mode**: Fetched ALL images (177,000) from database, causing significant performance issues
- **Gauntlet Mode**: No selection UI, random image was automatically chosen

### After:
- **Swiss Mode**: Fetches only 500 images when library > 1,000 images
- **Gauntlet Mode**: Shows 5 random images to choose from, giving user control over which image to rank
- **Expected Performance**: ~350x reduction in data transfer for large libraries (177,000 → 500 images)

## Technical Details

The implementation follows the same pattern as the existing performer optimization:

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

## User Experience

1. **Swiss Mode**: No visible changes - users will just experience faster loading
2. **Gauntlet Mode**: Users now see a selection screen with 5 random images to choose from
   - Click an image to start the gauntlet with that image
   - Same behavior as performer gauntlet mode
   - More control over which images are ranked

## Backward Compatibility

All changes are backward compatible:
- Works with any size image library (2 to 177,000+)
- No database schema changes required
- Maintains existing rating algorithm and ELO calculations
- UI automatically adapts based on battle type (performers vs images)
