# ELO Ranking System Analysis

## Current Implementation Overview

The HotOrNot plugin implements an ELO-inspired rating system for ranking performers and images in Stash. The system supports three comparison modes:

1. **Swiss Mode** (⚖️) - Fair matchups between similarly-rated items where both ratings adjust
2. **Gauntlet Mode** (🎯) - Single item climbs from bottom until defeated
3. **Champion Mode** (🏆) - Winner stays on to battle new challengers

## Current ELO Formula Analysis

### Location
File: `/plugins/hotornot/hotornot.js`
Function: `handleComparison()` (lines 579-631)

### Current Implementation Details

#### 1. Expected Score Formula
```javascript
const expectedWinner = 1 / (1 + Math.pow(10, ratingDiff / 40));
```

**Analysis:**
- Uses rating difference divided by 40
- Standard ELO typically uses 400 as the divisor
- **Current divisor of 40** means a 40-point difference = ~76% expected win probability
- **Standard divisor of 400** would mean a 400-point difference = ~91% expected win probability
- With a 1-100 scale (vs traditional 1000-3000), the divisor of 40 is actually **appropriate**

**Mathematical Relationship:**
- Traditional ELO: `E = 1 / (1 + 10^((Rb - Ra) / 400))`
- Current HotOrNot: `E = 1 / (1 + 10^((Rb - Ra) / 40))`
- Since the rating scale is ~10x smaller (100 vs 1000-2000), the divisor is correctly scaled ~10x smaller (40 vs 400)

#### 2. K-Factor
```javascript
const kFactor = 8;
```

**Analysis:**
- Fixed K-factor of 8 for all items regardless of:
  - Number of comparisons completed
  - Current rating level
  - Rating volatility

**Standard ELO K-Factor Ranges:**
- FIDE (Chess): 40 for new players, 20 for experienced, 10 for masters
- Online games: Often 32-64 for new, 16-32 for experienced
- With 1-100 scale, K=8 is reasonable but could benefit from variation

**Implications:**
- Fixed K=8 on 1-100 scale means:
  - Maximum gain/loss per match ≈ 8 points (when probability is 0 or 1)
  - Typical gain/loss for evenly matched ≈ 4 points
  - Takes many comparisons to establish accurate ratings
  - New items and established items change at same rate

#### 3. Rating Change Calculation

**Swiss Mode (both players adjust):**
```javascript
winnerGain = Math.max(1, Math.round(kFactor * (1 - expectedWinner)));
loserLoss = Math.max(1, Math.round(kFactor * expectedWinner));
```

**Gauntlet/Champion Mode (only active player adjusts):**
- Only the champion/falling item's rating changes
- Defenders stay the same (used as benchmarks)
- Exception: Rank #1 item loses 1 point when defeated

**Issues Identified:**
- `Math.max(1, ...)` forces minimum change of 1 point even when ELO formula suggests 0
- This can cause **rating inflation** over time
- Violates zero-sum principle in Swiss mode

#### 4. Rating Bounds
```javascript
const newWinnerRating = Math.min(100, Math.max(1, winnerRating + winnerGain));
const newLoserRating = Math.min(100, Math.max(1, loserRating - loserLoss));
```

- Ratings clamped to 1-100 range
- Standard approach for bounded rating systems

## Identified Issues and Recommendations

### Issue 1: Non-Zero-Sum Rating Changes (CRITICAL)

**Problem:**
```javascript
winnerGain = Math.max(1, Math.round(kFactor * (1 - expectedWinner)));
loserLoss = Math.max(1, Math.round(kFactor * expectedWinner));
```

When both values are forced to minimum 1:
- If expectedWinner = 0.99 (strong favorite wins):
  - Formula: winnerGain = 0.08, loserLoss = 7.92
  - Actual: winnerGain = 1, loserLoss = 8
  - **Net change: -7 points (deflation)**

- If expectedWinner = 0.01 (huge upset):
  - Formula: winnerGain = 7.92, loserLoss = 0.08
  - Actual: winnerGain = 8, loserLoss = 1
  - **Net change: +7 points (inflation)**

**Impact:**
- In Swiss mode, this violates the zero-sum principle
- Can cause systematic rating drift over many comparisons
- More upsets = inflation, more expected results = deflation

**Recommendation:**
Option A (Proper Zero-Sum):
```javascript
const expectedChange = kFactor * (1 - expectedWinner);
const roundedChange = Math.round(expectedChange);
winnerGain = Math.max(0, roundedChange);  // Allow 0
loserLoss = Math.max(0, roundedChange);   // Allow 0
```

Option B (Symmetric Minimum):
```javascript
const expectedChange = kFactor * (1 - expectedWinner);
const roundedChange = Math.max(1, Math.round(expectedChange));
winnerGain = roundedChange;
loserLoss = roundedChange;  // Same value for zero-sum
```

**Recommended: Option A** - Allows no change for extremely expected results, maintaining zero-sum property.

### Issue 2: Fixed K-Factor for All Items

**Problem:**
- New items with 0 comparisons use same K-factor as items with 100+ comparisons
- Ratings stabilize too slowly for new items
- Established ratings change too much from single comparisons

**Recommendation:**
Implement dynamic K-factor based on comparison count:

```javascript
function getKFactor(itemId, currentRating) {
  const comparisonCount = getComparisonCount(itemId); // Need to track this
  
  if (comparisonCount < 10) {
    return 16;  // High volatility for new items (2x current)
  } else if (comparisonCount < 30) {
    return 12;  // Medium volatility
  } else {
    return 8;   // Low volatility for established ratings
  }
}
```

**Alternative (simpler, no tracking needed):**
Rating-based K-factor:
```javascript
function getKFactor(currentRating) {
  // Items near extremes are likely more established
  const distanceFromMiddle = Math.abs(currentRating - 50);
  
  if (distanceFromMiddle < 10) {
    return 12;  // Unproven items near default rating
  } else {
    return 8;   // Established items with clear ratings
  }
}
```

### Issue 3: Rating Window for Swiss Mode Matchmaking

**Current:**
```javascript
// Find items within ±15 rating points
return Math.abs(rating - rating1) <= 15;
```

**Analysis:**
- ±15 points on 1-100 scale = ±30% of total range
- On traditional 1000-2000 scale, equivalent to ±300 points
- This is quite wide for "similar" ratings

**Recommendation:**
Make the window adaptive based on pool size:
```javascript
function getSimilarityWindow(totalItems, currentRating) {
  // Tighter window for larger pools
  if (totalItems > 50) {
    return 10;  // ±10 points
  } else if (totalItems > 20) {
    return 15;  // ±15 points (current)
  } else {
    return 25;  // ±25 points for small pools
  }
}
```

### Issue 4: Initial Rating Distribution

**Current:**
```javascript
const rating1 = scene1.rating100 || 50;
```

**Problem:**
- All new items start at 50
- Creates initial clustering at midpoint
- Can take many comparisons to spread out

**Recommendation:**
Option A: Keep 50 (simplest, most standard)
Option B: Add small random variance:
```javascript
const defaultRating = item.rating100 || (50 + Math.floor(Math.random() * 10 - 5)); // 45-55
```

**Recommended: Keep Option A (50)** - Random variance could confuse users and isn't standard ELO practice.

### Issue 5: Gauntlet Mode Rating Changes

**Current Behavior:**
- Only active (champion/falling) item changes rating
- Defenders are static benchmarks
- Rank #1 item loses 1 point when defeated

**Analysis:**
- This isn't traditional ELO (not zero-sum)
- Makes sense for the game mode (faster, more exciting)
- Could cause rating drift if same items are defenders repeatedly

**Recommendation:**
Keep current behavior but document it clearly as non-ELO. Consider optional "True ELO" gauntlet mode where both change.

### Issue 6: No Rating Decay or Recency Weighting

**Current:**
- Ratings never decay
- Old comparisons weighted same as recent ones

**Consideration:**
For content that changes over time (e.g., performers' appearance), might want:
- Time decay: Reduce ratings toward mean over time
- Recency weighting: Recent comparisons matter more

**Recommendation:**
Not needed for current use case. Items (performers/images) don't inherently change. Can add later if requested.

## Summary of Recommendations

### High Priority (Recommended Implementation)

1. **Fix Zero-Sum Property (CRITICAL)**
   - Allow 0-point changes when appropriate
   - Prevents rating inflation/deflation
   - Maintains mathematical integrity

2. **Implement Dynamic K-Factor**
   - Start with simple rating-based approach (no tracking needed)
   - Helps new items stabilize faster
   - Protects established ratings

3. **Adaptive Swiss Matching Window**
   - Tighter matching for larger pools
   - Better quality matchups

### Medium Priority (Consider for Future)

4. **Track Comparison Count**
   - Enables better K-factor algorithm
   - Could display as "confidence" metric
   - Useful for statistics

5. **Add Configuration Options**
   - Allow users to customize K-factor
   - Adjustable similarity window
   - Different modes could have different parameters

### Low Priority (Monitor)

6. **Rating Decay/Recency**
   - Only if user behavior patterns suggest need
   - Current model is fine for static content

## Proposed Changes

### Change 1: Fix Zero-Sum Rating Calculation
**File:** `hotornot.js`, line 616-617
**Current:**
```javascript
winnerGain = Math.max(1, Math.round(kFactor * (1 - expectedWinner)));
loserLoss = Math.max(1, Math.round(kFactor * expectedWinner));
```

**Proposed:**
```javascript
winnerGain = Math.max(0, Math.round(kFactor * (1 - expectedWinner)));
loserLoss = Math.max(0, Math.round(kFactor * expectedWinner));
```

### Change 2: Implement Dynamic K-Factor
**File:** `hotornot.js`, before line 579
**Add new function:**
```javascript
function getKFactor(currentRating) {
  // Items near the default rating (50) are likely less established
  // Items far from 50 have likely had more comparisons
  const distanceFromDefault = Math.abs(currentRating - 50);
  
  if (distanceFromDefault < 10) {
    return 12;  // Higher K for unproven items near default
  } else if (distanceFromDefault < 25) {
    return 10;  // Medium K for moderately established items
  } else {
    return 8;   // Lower K for well-established items
  }
}
```

**Update usage (line 597, 614):**
```javascript
// Gauntlet/Champion mode
const kFactor = getKFactor(winnerRating);

// Swiss mode
const kFactor = getKFactor(winnerRating);
```

### Change 3: Adaptive Swiss Matching Window
**File:** `hotornot.js`, line 757-762
**Current:**
```javascript
const similarPerformers = performers.filter(s => {
  if (s.id === performer1.id) return false;
  const rating = s.rating100 || 50;
  return Math.abs(rating - rating1) <= 15;
});
```

**Proposed:**
```javascript
const matchWindow = performers.length > 50 ? 10 : performers.length > 20 ? 15 : 25;
const similarPerformers = performers.filter(s => {
  if (s.id === performer1.id) return false;
  const rating = s.rating100 || 50;
  return Math.abs(rating - rating1) <= matchWindow;
});
```

## Testing Recommendations

After implementing changes:

1. **Unit Tests** (if test framework exists):
   - Test zero-sum property: `winnerGain + loserChange should equal 0`
   - Test K-factor ranges with various ratings
   - Test boundary conditions (1, 50, 100 ratings)

2. **Manual Testing**:
   - Create test database with known ratings
   - Perform series of comparisons
   - Verify average rating remains stable (no inflation/deflation)
   - Check that new items reach accurate rating faster

3. **Statistical Analysis** (optional):
   - Track rating distribution over time
   - Monitor average rating (should stay near 50)
   - Check rating spread (standard deviation)

## Mathematical Verification

### Zero-Sum Check
For Swiss mode, rating changes should sum to zero:
```
ΔR_winner + ΔR_loser = 0
winnerGain + (-loserLoss) = 0
winnerGain = loserLoss
```

Current code can violate this. Proposed fix ensures:
```javascript
const change = Math.max(0, Math.round(kFactor * (1 - expectedWinner)));
winnerGain = change;
loserLoss = change;
// Therefore: change + (-change) = 0 ✓
```

### K-Factor Impact Analysis

With current K=8 on 1-100 scale:
- 50 vs 50: Expected 0.5, gain = 4 points
- 70 vs 50: Expected 0.76, gain = 2 points (favorite), 6 points (underdog)
- 90 vs 50: Expected 0.91, gain = 1 point (favorite), 7 points (underdog)

With proposed dynamic K (12 for new, 8 for established):
- New vs New (50 vs 50): gain = 6 points (50% faster convergence)
- Established (70) vs New (50): 
  - New wins: +9 points
  - Established wins: +3 points
- More responsive to early results while protecting established ratings

## Conclusion

The current implementation is a reasonable ELO-inspired system, but has some mathematical issues that could cause rating drift over time. The recommended changes are:

1. **Must Fix**: Zero-sum property in Swiss mode
2. **Should Add**: Dynamic K-factor for faster convergence
3. **Nice to Have**: Adaptive matching window

These changes maintain the spirit of the current system while making it more mathematically sound and responsive to new items.
